// 云函数：腾讯位置服务「路线规划」代理（导航到钓点用）
// 个人主体 + ICP 备案未全量通过，客户端不能直连 apis.map.qq.com（需 request 合法域名 + 类目），
// 故与 weather 函数一样走 wx.cloud.callFunction 微信自有通道。
// 调用方：
//   wx.cloud.callFunction({
//     name: "map",
//     data: { action: "direction", from: "34.34,108.98", to: "34.30,109.10", mode: "driving" }
//   })
// 返回：{ ok: true, route: { mode, distance, duration, steps:[{text,dist}], polyline:[{latitude,longitude}] }, taxi? }
//   失败时 { ok: false, msg }
//
// 坐标系：腾讯路线规划只认 GCJ02（火星坐标）。小程序侧坐标（chooseLocation / getFuzzyLocation）
// 本就是 GCJ02，无需转换，直接喂即可。
const https = require("https");
const crypto = require("crypto");

// 与 weather 函数共用同一个 Key（在云开发控制台 → 本函数 → 环境变量里加）：
//   TENCENT_MAP_KEY = 完整 key
//   TENCENT_MAP_SK  = 该 key 的 Secret key（仅当 key 启用了「签名校验」才需要）
const TENCENT_KEY = process.env.TENCENT_MAP_KEY || "";
const TENCENT_SK = process.env.TENCENT_MAP_SK || "";

// ---- 腾讯 WebServiceAPI 签名（key 启用「签名校验」时必须）----
// 规则：参数按参数名 ASCII 升序 → md5(路径 + "?" + k=v&k=v(原始未编码) + SK) → 32 位小写。
// 实测不排序必返回 111；值默认仅中文等非 ASCII 才编码（minimal），遇 111 自动切全编码重试。
let ENCODE_STYLE = "minimal";

function md5hex(s) { return crypto.createHash("md5").update(s, "utf8").digest("hex"); }

function tencentSign(pathOnly, params, fullEncode) {
  const keys = Object.keys(params).sort();
  const rawQuery = keys.map((k) => k + "=" + params[k]).join("&");
  const sig = TENCENT_SK ? md5hex(pathOnly + "?" + rawQuery + TENCENT_SK) : "";
  const sendQuery = keys.map((k) => {
    const v = String(params[k]);
    const need = fullEncode || /[^\x20-\x7E]/.test(v);
    return k + "=" + (need ? encodeURIComponent(v) : v);
  }).join("&");
  return { sendQuery: sendQuery, sig: sig };
}

function get(url, timeout) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: "GET",
      headers: { "User-Agent": "fishing-guide-miniprogram/1.0", "Accept": "application/json" }
    }, (res) => {
      let data = "";
      res.on("data", (c) => { data += c; });
      res.on("end", () => {
        if (res.statusCode !== 200) return reject(new Error("HTTP " + res.statusCode));
        try { resolve(JSON.parse(data)); } catch (e) { reject(new Error("返回不是 JSON")); }
      });
    });
    req.setTimeout(timeout || 9000, () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

function tencentGet(pathOnly, params, timeout) {
  const a = tencentSign(pathOnly, params, ENCODE_STYLE === "full");
  const url = "https://apis.map.qq.com" + pathOnly + "?" + a.sendQuery + (a.sig ? "&sig=" + a.sig : "");
  return get(url, timeout || 9000).then((j) => {
    if (!j || j.status !== 111 || !TENCENT_SK) return j;
    const b = tencentSign(pathOnly, params, ENCODE_STYLE !== "full");
    return get("https://apis.map.qq.com" + pathOnly + "?" + b.sendQuery + "&sig=" + b.sig, timeout || 9000)
      .then((j2) => { if (j2 && j2.status === 0) ENCODE_STYLE = ENCODE_STYLE === "full" ? "minimal" : "full"; return j2; });
  });
}

const MODE_PATH = { driving: "/ws/direction/v1/driving", walking: "/ws/direction/v1/walking", bicycling: "/ws/direction/v1/bicycling" };
const MODE_NAME = { driving: "驾车", walking: "步行", bicycling: "骑行" };

// 把一条路线提炼成「距离 + 用时 + 关键步骤 + 抽稀后的坐标折线」
function summarize(route, mode) {
  const r = (route || {});
  const steps = (r.steps || []).map((s) => ({
    text: (s.instruction || s.road_name || "").trim(),
    dist: typeof s.distance === "number" ? s.distance : null
  })).filter((s) => s.text);

  return {
    mode: mode,
    modeName: MODE_NAME[mode],
    distance: typeof r.distance === "number" ? r.distance : null,   // 米
    duration: typeof r.duration === "number" ? r.duration : null,   // 分钟
    steps: steps.slice(0, 24),
    polyline: decodePolyline(r.polyline)                            // [{latitude,longitude}]
  };
}

// 腾讯 polyline 解压：数组首位两个是真实坐标，其后是差分值（÷1e6 累加）——官方 demo 算法
function decodePolyline(coors) {
  if (!coors || !coors.length) return [];
  const a = coors.map(Number);
  for (let i = 2; i < a.length; i++) a[i] = a[i - 2] + a[i] / 1000000;
  const pts = [];
  for (let i = 0; i < a.length; i += 2) {
    pts.push({ latitude: a[i], longitude: a[i + 1] });
  }
  return thinOut(pts, 400);   // 抽稀到 ≤400 点，setData 传输量可控、画线依然平滑
}

// 等距抽稀（保留首尾点）
function thinOut(pts, max) {
  if (pts.length <= max) return pts;
  const step = (pts.length - 1) / (max - 1);
  const out = [];
  for (let i = 0; i < max; i++) out.push(pts[Math.round(i * step)]);
  return out;
}

async function direction(from, to, mode) {
  const path = MODE_PATH[mode];
  if (!path) throw new Error("不支持的出行方式：" + mode);
  if (!from || !to) throw new Error("缺少起点或终点坐标");
  const params = {
    from: from, to: to, key: TENCENT_KEY,
    output: "json",
    get_polyline: 1            // 返回路线坐标点（压缩格式，summarize 里解压）
  };
  if (mode === "driving") params.get_mp = 0;   // 只返回一条推荐路线
  const j = await tencentGet(path, params, 9000);
  if (!j || j.status !== 0) throw new Error((j && j.message) || "腾讯路线规划异常");
  const routes = j.result && j.result.routes;
  if (!routes || !routes.length) throw new Error("未找到可用路线");
  const route = summarize(routes[0], mode);
  const out = { route: route };
  if (mode === "driving" && j.result.routes[0] && j.result.routes[0].taxi_fare) {
    out.taxi = j.result.routes[0].taxi_fare.fare;
  }
  return out;
}

exports.main = async (event) => {
  const action = (event && event.action) || "";
  try {
    if (!TENCENT_KEY) return { ok: false, msg: "未配置 TENCENT_MAP_KEY（云函数环境变量）" };
    if (action === "direction") {
      const route = await direction(event.from, event.to, event.mode || "driving");
      return { ok: true, mode: event.mode || "driving", ...route };
    }
    return { ok: false, msg: "未知 action：" + action };
  } catch (e) {
    return { ok: false, msg: (e && e.message) || "map 云函数异常" };
  }
};
