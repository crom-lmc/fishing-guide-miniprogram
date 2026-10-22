// 一次性探测脚本：看看腾讯位置服务「天气服务」到底返回什么
// 目的：切换天气数据源前，先摸清字段结构与生活指数（有没有钓鱼指数），并对比 Open-Meteo 的耗时
//
// 用法（Key 只从环境变量读，不写进任何文件、不入库）：
//   TENCENT_MAP_KEY=你的key TENCENT_MAP_SK=你的sk node tools/probe-weather.js
//   TENCENT_MAP_KEY=你的key node tools/probe-weather.js 34.34,108.98      # 只配 key（未开签名校验时）
// 未开签名校验可以不传 SK。
const https = require("https");
const crypto = require("crypto");

const KEY = process.env.TENCENT_MAP_KEY || "";
const SK = process.env.TENCENT_MAP_SK || "";
const LOC = process.argv[2] || "34.3416,108.9398";   // 默认西安

function md5hex(s) { return crypto.createHash("md5").update(s, "utf8").digest("hex"); }

function sign(pathOnly, params) {
  const keys = Object.keys(params).sort();
  const raw = keys.map(k => k + "=" + params[k]).join("&");
  const sig = SK ? md5hex(pathOnly + "?" + raw + SK) : "";
  const qs = keys.map(k => {
    const v = String(params[k]);
    return k + "=" + (/[^\x20-\x7E]/.test(v) ? encodeURIComponent(v) : v);
  }).join("&");
  return "https://apis.map.qq.com" + pathOnly + "?" + qs + (sig ? "&sig=" + sig : "");
}

function get(url) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: "GET",
      headers: { "User-Agent": "fishing-guide-probe/1.0", "Accept": "application/json" }
    }, res => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => {
        let j = null;
        try { j = JSON.parse(d); } catch (e) { j = { _raw: d.slice(0, 400) }; }
        resolve({ ms: Date.now() - t0, status: res.statusCode, json: j });
      });
    });
    req.setTimeout(15000, () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

const cut = (o, n) => JSON.stringify(o, null, 2).slice(0, n || 3000);

(async () => {
  if (!KEY) {
    console.error("缺少 TENCENT_MAP_KEY。用法：TENCENT_MAP_KEY=xxx node tools/probe-weather.js");
    process.exit(1);
  }
  console.log("坐标：" + LOC + "（默认西安，可传参覆盖）\n");

  // 1) 基础天气
  console.log("===== 1. 基础天气 /ws/weather/v1 =====");
  const r1 = await get(sign("/ws/weather/v1/", { location: LOC, key: KEY, output: "json" }));
  console.log("HTTP " + r1.status + "  耗时 " + r1.ms + "ms");
  console.log("status=" + r1.json.status + " message=" + (r1.json.message || "-"));
  console.log(cut(r1.json.result || r1.json, 2500));

  // 2) 带生活指数
  console.log("\n===== 2. 生活指数 added_fields=index =====");
  const r2 = await get(sign("/ws/weather/v1/", { location: LOC, key: KEY, output: "json", added_fields: "index" }));
  console.log("HTTP " + r2.status + "  耗时 " + r2.ms + "ms");
  console.log("status=" + r2.json.status + " message=" + (r2.json.message || "-"));
  const res2 = r2.json.result || {};
  const idx = res2.indexes || (res2.index && res2.index.items) || null;
  if (idx) {
    console.log("生活指数共 " + idx.length + " 项：");
    idx.forEach(i => console.log("  · " + i.name + " | " + i.level + " | " + (i.desc || i.detail || "-")));
    const fish = idx.filter(i => /钓|鱼/.test(i.name || ""));
    console.log(fish.length ? "\n>>> 含钓鱼相关指数：" + fish.map(i => i.name).join("、")
                            : "\n>>> 未发现名称含「钓/鱼」的指数");
  } else {
    console.log("未返回 indexes，完整结构：");
    console.log(cut(res2, 2500));
  }

  // 3) 对比 Open-Meteo 同坐标耗时
  console.log("\n===== 3. 对比 Open-Meteo（现用源）=====");
  const [la, ln] = LOC.split(",");
  try {
    const r3 = await get("https://api.open-meteo.com/v1/forecast?latitude=" + la + "&longitude=" + ln
      + "&current=temperature_2m,surface_pressure,wind_speed_10m,precipitation,cloud_cover,weather_code");
    console.log("耗时 " + r3.ms + "ms  current=" + JSON.stringify(r3.json.current || {}));
  } catch (e) {
    console.log("Open-Meteo 请求失败：" + e.message);
  }
})();
