// 云函数：代理外部免密钥接口，规避小程序 request 合法域名限制
//   - Open-Meteo   实时天气：api.open-meteo.com 无 ICP 备案，配不了合法域名（真机/体验版必失败）
//   - BigDataCloud 逆地理编码：api.bigdatacloud.net 同理，坐标 → 省市区地名
// wx.cloud.callFunction 走微信自有通道，不经过域名白名单，这是无 Key 方案的唯一出路。
// 调用方：wx.cloud.callFunction({ name: "weather", data: { lat: 34.34, lng: 108.98 } })
// 返回：{ ok: true, weather: <Open-Meteo JSON>, place: "陕西省西安市未央区" }
//       天气失败时 ok:false 且带 msg；地名失败不影响天气，place 退化为 ""
const https = require("https");
const crypto = require("crypto");

// 腾讯位置服务 key（可选）：配了它，附近 POI 搜索和逆地址解析都能到门牌级。
// 在云开发控制台 → 本函数 → 配置 → 环境变量里加：
//   TENCENT_MAP_KEY = 完整 key（形如 XXXXX-XXXXX-XXXXX-XXXXX-XXXXX）
//   TENCENT_MAP_SK  = 该 key 的 Secret key（仅当 key 启用了「签名校验」才需要）
// 不配也能跑（走免 key 方案）。
const TENCENT_KEY = process.env.TENCENT_MAP_KEY || "";
const TENCENT_SK = process.env.TENCENT_MAP_SK || "";

// ===== 坐标系换算（本次修复的根因）=====
// 小程序侧拿到的坐标全部是 GCJ02（火星坐标）：地图组件 moveToLocation 后的中心、chooseLocation 返回值。
// 而 Open-Meteo / BigDataCloud / Photon(OSM) 全部按 WGS84 理解坐标，直接喂 GCJ02 会整体偏移。
// 实测西安（34.3618,108.9290）：GCJ02→WGS84 差 459m，逆地理编码会解析到隔壁厂区
// 「华润雪花啤酒(西安)分公司」，而不是所在的「经开区·明光路·广联达/凯瑞」一带。
// 腾讯位置服务反过来只认 GCJ02，所以只在调用境外数据源前转换。
const PI = Math.PI, GCJ_A = 6378245.0, GCJ_EE = 0.00669342162296594323;

function outOfChina(lat, lng) {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}
function gcjTLat(x, y) {
  let r = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  r += (20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2 / 3;
  r += (20 * Math.sin(y * PI) + 40 * Math.sin(y / 3 * PI)) * 2 / 3;
  r += (160 * Math.sin(y / 12 * PI) + 320 * Math.sin(y * PI / 30)) * 2 / 3;
  return r;
}
function gcjTLng(x, y) {
  let r = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  r += (20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2 / 3;
  r += (20 * Math.sin(x * PI) + 40 * Math.sin(x / 3 * PI)) * 2 / 3;
  r += (150 * Math.sin(x / 12 * PI) + 300 * Math.sin(x / 30 * PI)) * 2 / 3;
  return r;
}
function gcjDelta(lat, lng) {
  let dLat = gcjTLat(lng - 105, lat - 35);
  let dLng = gcjTLng(lng - 105, lat - 35);
  const radLat = lat / 180 * PI;
  let magic = Math.sin(radLat);
  magic = 1 - GCJ_EE * magic * magic;
  const sq = Math.sqrt(magic);
  dLat = (dLat * 180) / ((GCJ_A * (1 - GCJ_EE)) / (magic * sq) * PI);
  dLng = (dLng * 180) / (GCJ_A / sq * Math.cos(radLat) * PI);
  return { dLat: dLat, dLng: dLng };
}
function gcj2wgs(lat, lng) {
  if (outOfChina(lat, lng)) return { lat: lat, lng: lng };
  const d = gcjDelta(lat, lng);
  return { lat: lat - d.dLat, lng: lng - d.dLng };
}
function wgs2gcj(lat, lng) {
  if (outOfChina(lat, lng)) return { lat: lat, lng: lng };
  const d = gcjDelta(lat, lng);
  return { lat: lat + d.dLat, lng: lng + d.dLng };
}

function get(url, timeout) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: "GET",
      // Overpass 会拒没有 UA 的请求（406），统一带上
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

// ---- 腾讯 WebServiceAPI 签名（key 启用「签名校验」时必须）----
// 官方规则（https://lbs.qq.com/faq/serverFaq/webServiceKey 第 4 节）：
//   1) 参数按「参数名」ASCII 升序排序（a-z）；
//   2) 参与 md5 的必须是**未做任何 URL 编码的原始值**；
//   3) sig = md5(请求路径 + "?" + 排序后的 k=v&k=v + SK)，32 位小写；
//   4) 实际发请求时值要 URL 编码，但签名串用原始值；路径带不带尾斜杠均可，但签名与请求必须一致。
// 第 1 条是最容易踩的坑：不排序就必然 111（我最初按文档参数原顺序算，实测全是 111）。
let TENCENT_ENCODE_STYLE = "minimal";   // minimal=仅中文等非 ASCII 才编码；full=全部 encodeURIComponent

function md5hex(s) {
  return crypto.createHash("md5").update(s, "utf8").digest("hex");
}

// params: { 参数名: 原始值(未编码) }
function tencentSign(pathOnly, params, fullEncode) {
  const keys = Object.keys(params).sort();                      // ① 字典序
  const rawQuery = keys.map((k) => k + "=" + params[k]).join("&");  // ② 原始值
  const sig = TENCENT_SK ? md5hex(pathOnly + "?" + rawQuery + TENCENT_SK) : "";
  const sendQuery = keys.map((k) => {
    const v = String(params[k]);
    const need = fullEncode || /[^\x20-\x7E]/.test(v);          // ③ 只有需要时才编码
    return k + "=" + (need ? encodeURIComponent(v) : v);
  }).join("&");
  return { sendQuery: sendQuery, sig: sig };
}

function tencentGet(pathOnly, params, timeout) {
  const a = tencentSign(pathOnly, params, TENCENT_ENCODE_STYLE === "full");
  const url = "https://apis.map.qq.com" + pathOnly + "?" + a.sendQuery + (a.sig ? "&sig=" + a.sig : "");
  return get(url, timeout || 7000).then((j) => {
    if (!j || j.status !== 111 || !TENCENT_SK) return j;        // 111 才可能是编码风格问题
    console.log("[weather] 腾讯签名 111，改用全编码风格重试");
    const b = tencentSign(pathOnly, params, TENCENT_ENCODE_STYLE !== "full");
    return get("https://apis.map.qq.com" + pathOnly + "?" + b.sendQuery + "&sig=" + b.sig, timeout || 7000)
      .then((j2) => {
        if (j2 && j2.status === 0) {
          TENCENT_ENCODE_STYLE = TENCENT_ENCODE_STYLE === "full" ? "minimal" : "full";
          console.log("[weather] 腾讯签名编码风格已锁定为 " + TENCENT_ENCODE_STYLE);
        }
        return j2;
      });
  });
}

function fetchWeather(lat, lng) {
  // 参数与 Web 版/原 wx.request 版完全一致，客户端 toParams/computeHourly 无需改
  return get("https://api.open-meteo.com/v1/forecast?latitude=" + lat.toFixed(3)
    + "&longitude=" + lng.toFixed(3)
    + "&current=temperature_2m,pressure_msl,wind_speed_10m,wind_direction_10m,weather_code"
    + "&hourly=temperature_2m,pressure_msl,wind_speed_10m,wind_direction_10m,weather_code"
    + "&past_days=1&forecast_days=2&timezone=auto", 9000);
}

// ---- 繁→简：BigDataCloud localityLanguage=zh 返回繁体（如「未央區」）----
const T2S = {
  陜: "陕", 廣: "广", 雲: "云", 貴: "贵", 肅: "肃", 寧: "宁", 遼: "辽",
  龍: "龙", 內: "内", 灣: "湾", 臺: "台", 鐵: "铁", 銀: "银", 銅: "铜",
  鋼: "钢", 礦: "矿", 蘇: "苏", 錫: "锡", 連: "连", 鹽: "盐", 揚: "扬",
  紹: "绍", 溫: "温", 麗: "丽", 鷹: "鹰", 滬: "沪", 閩: "闽", 瓊: "琼",
  萬: "万", 亞: "亚", 綿: "绵", 瀋: "沈", 蘭: "兰", 楊: "杨", 寶: "宝",
  雞: "鸡", 漢: "汉", 鄭: "郑", 許: "许", 黃: "黄", 張: "张", 濟: "济",
  臨: "临", 錦: "锦", 撫: "抚", 順: "顺", 盤: "盘", 嶺: "岭", 鶴: "鹤",
  綏: "绥", 蕪: "芜", 齊: "齐", 魯: "鲁", 鳳: "凤", 烏: "乌", 庫: "库",
  爾: "尔", 薩: "萨", 則: "则", 納: "纳", 紅: "红", 畢: "毕", 節: "节",
  瀘: "泸", 樂: "乐", 達: "达", 涼: "凉", 欽: "钦", 賀: "贺", 來: "来",
  賓: "宾", 荊: "荆", 隨: "随", 懷: "怀", 婁: "娄", 無: "无", 與: "与",
  區: "区", 縣: "县", 鎮: "镇", 鄉: "乡", 裡: "里", 鄰: "邻", 號: "号",
  樓: "楼", 棟: "栋", 廈: "厦", 門: "门", 閣: "阁", 園: "园", 場: "场",
  廠: "厂", 鋪: "铺", 館: "馆", 廳: "厅", 層: "层", 東: "东", 雙: "双",
  華: "华", 興: "兴", 陽: "阳", 陰: "阴", 岡: "冈", 崗: "岗", 島: "岛",
  頭: "头", 觀: "观", 蓮: "莲", 豐: "丰", 馬: "马", 鳥: "鸟", 魚: "鱼",
  橋: "桥", 關: "关", 開: "开", 長: "长", 嶽: "岳", 資: "资", 灘: "滩",
  壩: "坝", 澤: "泽", 溝: "沟", 營: "营", 莊: "庄", 條: "条", 滄: "沧",
  學: "学", 醫: "医", 衛: "卫", 離: "离", 環: "环"
};

// 自治区/特别行政区长名压缩；港澳台按规范表述
const PROV_SHORT = [
  [/内蒙古自治区/, "内蒙古"],
  [/广西壮族自治区/, "广西"],
  [/宁夏回族自治区/, "宁夏"],
  [/新疆维吾尔自治区/, "新疆"],
  [/西藏自治区/, "西藏"],
  [/香港特别行政区/, "中国香港"],
  [/澳门特别行政区/, "中国澳门"],
  [/^台湾/, "中国台湾"]
];

function t2s(s) {
  let out = "";
  for (let i = 0; i < s.length; i++) out += T2S[s[i]] || s[i];
  return out;
}

// 结构化字段优先，administrative 按 adminLevel 兜底（4=省 5=市 6=区县；直辖市省市同名，indexOf 去重）
function compose(d) {
  const adm = (d.localityInfo && d.localityInfo.administrative) || [];
  const byLevel = (lv) => {
    for (let i = 0; i < adm.length; i++) if (adm[i] && adm[i].adminLevel === lv) return adm[i].name || "";
    return "";
  };
  const parts = [];
  const push = (v) => {
    let s = t2s(String(v == null ? "" : v).trim());
    for (let i = 0; i < PROV_SHORT.length; i++) s = s.replace(PROV_SHORT[i][0], PROV_SHORT[i][1]);
    if (s && parts.indexOf(s) < 0) parts.push(s);
  };
  push(d.principalSubdivision || byLevel(4));
  push(d.city || byLevel(5));
  push(d.locality || byLevel(6));
  return parts.slice(0, 3).join("");
}

// ---- 地名第二级：Photon（免 key，能到小区 / 路名）----
// BigDataCloud 只给到区县（如「新城区」），informative 里全是「亚洲 / 时区 / 渭河平原」这类长文本，
// 拿不到街道。Photon 是 OSM 数据，同一个点能返回「省气象局家属院」「龙首中路」这种具体地名。
// 注意：Photon 不支持 lang=zh（带上直接 400），不带参数反而返回中文原名。
function photonPlace(lat, lng) {
  return get("https://photon.komoot.io/reverse?lat=" + lat.toFixed(5)
    + "&lon=" + lng.toFixed(5) + "&limit=8", 6000)
    .then((j) => {
      const arr = (j && j.features) || [];
      const cand = [];
      for (let i = 0; i < arr.length; i++) {
        const p = arr[i].properties || {};
        const nm = t2s(String(p.name || "").trim());
        if (!nm || nm === "中国" || nm === "中华人民共和国") continue;
        // 省/市/区县这级太粗，留给 BigDataCloud，这里只要更细的
        const k = p.osm_key || "", v = p.osm_value || "";
        if (k === "place" && /^(country|state|county|city|town|district|suburb)$/.test(v)) continue;
        const c = arr[i].geometry && arr[i].geometry.coordinates;
        if (!c || c.length < 2) continue;
        const d = Math.round(haversine(lat, lng, c[1], c[0]));
        if (d > 400) continue;                    // 400m 之外的“最近地名”没有参考价值
        // 权重：楼宇/园区/商业/公共服务最有用；工厂、工业用地、道路、交通设施都不是“你在哪”
        let w;
        if (/^(building|office|amenity|shop|tourism|leisure|healthcare|education)$/.test(k)) w = 3;
        else if (k === "landuse" || k === "man_made") w = (v === "industrial" || v === "works") ? -2 : 0;
        else if (/^(highway|railway|public_transport|route)$/.test(k)) w = -3;
        else w = 1;
        cand.push({ nm: nm, d: d, w: w });
      }
      if (!cand.length) return "";
      // 先按权重（楼名优先），同权重再按距离近的
      cand.sort((a, b) => (b.w - a.w) || (a.d - b.d));
      return cand[0].nm;
    })
    .catch(() => "");
}

// ---- 地名第一级：腾讯位置服务（配了 TENCENT_MAP_KEY 才启用，最准）----
// 返回省市区 + 街道门牌 + 最近地标，是国内数据里唯一能稳定到门牌级的。
function tencentGeocode(lat, lng) {
  return tencentGet("/ws/geocoder/v1", {
    location: lat + "," + lng,
    key: TENCENT_KEY,
    get_poi: 1          // 必带：只有它返回周边 POI，才拿得到「广联达数字建筑研发大厦 / 凯瑞H座」这类楼名
  }, 6000)
    .then((j) => {
      if (!j || j.status !== 0) throw new Error((j && j.message) || "腾讯逆地址解析异常");
      const r = j.result || {};
      const ac = r.address_component || {};
      const parts = [];
      const push = (v) => {
        const s0 = Array.isArray(v) ? (v[0] || "") : v;   // 直辖市的 city 是数组
        let s = t2s(String(s0 == null ? "" : s0).trim());
        for (let i = 0; i < PROV_SHORT.length; i++) s = s.replace(PROV_SHORT[i][0], PROV_SHORT[i][1]);
        if (s && parts.indexOf(s) < 0) parts.push(s);
      };
      push(ac.province);
      push(ac.city);
      push(ac.district);
      const out = parts.join("");
      const norm = (v) => t2s(String(v == null ? "" : v).trim());

      // 楼名优先：get_poi=1 返回的周边 POI 是唯一能拿到「广联达西安数字建筑研发大厦 / 凯瑞H座」
      // 这类具体楼名的来源（OSM / BigDataCloud 国内没有这样的覆盖）。只认 300m 内的，远了就是别人的楼。
      const pois = (r.pois || []).slice().sort((a, b) => {
        const da = a && typeof a._distance === "number" ? a._distance : 9999;
        const db = b && typeof b._distance === "number" ? b._distance : 9999;
        return da - db;
      });
      for (let i = 0; i < pois.length; i++) {
        const p0 = pois[i] || {};
        const d = typeof p0._distance === "number" ? p0._distance : 9999;
        if (d > 300) break;                      // 已按距离升序，后面只会更远
        const t = norm(p0.title);
        if (t) return out + "·" + t;
      }

      // 其次用腾讯自己给的「推荐地址」（往往是楼名 / 小区名）
      const fa = r.formatted_addresses || {};
      const rec = norm(fa.recommend);
      let dup = false;
      for (let i = 0; i < parts.length; i++) if (parts[i] && rec.indexOf(parts[i]) >= 0) dup = true;
      if (rec && rec !== out && !dup) return out + "·" + rec;

      const st = norm(ac.street), sn = norm(ac.street_number);
      if (st) return out + "·" + st + sn;
      const lm = (r.landmarks || [])[0];
      if (lm && lm.title) return out + "·" + norm(lm.title);
      return out;
    });
}

function fetchPlace(lat, lng, coordType) {
  // 调用方默认给 GCJ02（小程序地图/chooseLocation 都是这套），境外数据源要先转 WGS84；
  // 腾讯位置服务反过来只认 GCJ02，两者各用各的坐标，不能混。
  const fromWgs = coordType === "wgs84";
  const w = fromWgs ? { lat: lat, lng: lng } : gcj2wgs(lat, lng);
  const g = fromWgs ? wgs2gcj(lat, lng) : { lat: lat, lng: lng };

  // 1) 腾讯：最准，但要自己申请 key（能到楼名 / 门牌）
  //    关键：腾讯失败时把错误打进云函数日志。之前是 .catch(() => "") 静默吞掉，
  //    结果「配了 key 却还是楼名级解析不出来」时，线上完全看不到原因（是 311 格式错误？
  //    还是 110 没开通 WebServiceAPI？）。现在把 message 记下来，去云开发控制台 → 日志即可定位。
  let tencentErr = "";
  const viaTencent = TENCENT_KEY
    ? tencentGeocode(g.lat, g.lng).catch((e) => {
        tencentErr = (e && e.message) || "未知错误";
        console.error("[weather] 腾讯逆地址解析失败：" + tencentErr);
        return "";
      })
    : Promise.resolve("");

  // 2) 免 key 兜底：BigDataCloud 出省市区，Photon 出小区/楼名，两个并行（都按 WGS84 查）
  const viaBD = get("https://api.bigdatacloud.net/data/reverse-geocode-client"
    + "?latitude=" + w.lat.toFixed(5) + "&longitude=" + w.lng.toFixed(5)
    + "&localityLanguage=zh", 8000)
    .then(compose)
    .catch(() => "");
  const viaPhoton = photonPlace(w.lat, w.lng);

  return Promise.all([viaTencent, viaBD, viaPhoton]).then((r) => {
    let place;
    if (r[0]) place = r[0];
    else {
      const bd = r[1], ph = r[2];
      // Photon 的结果如果已经包含在省市区里（比如返回「新城区」），就不重复拼
      const extra = (ph && (!bd || bd.indexOf(ph) < 0)) ? ph : "";
      place = extra ? (bd ? bd + "·" + extra : extra) : bd;
    }
    // tencentErr 透传给调用方：配了 key 但仍拿不到楼名时，能直接看到是 311 / 110 / 163 哪一类
    return { place: place, tencentErr: tencentErr };
  });
}

// ===== 附近 POI（水域 / 钓场）=====
// 数据源优先级：
//   1) 腾讯位置服务 place/search —— 配了环境变量 TENCENT_MAP_KEY 即启用（定义在文件顶部）；
//      真正的 POI 搜索（含收费钓场），返回 _distance，结果最准。
//   2) Overpass / OSM（免 key 兜底）—— 只能按 OSM 标签找水域，国内钓场数据几乎为空。

function haversine(a, b, c, d) {
  const R = 6371000, p = Math.PI / 180;
  const x = (c - a) * p, y = (d - b) * p;
  const h = Math.sin(x / 2) * Math.sin(x / 2)
    + Math.cos(a * p) * Math.cos(c * p) * Math.sin(y / 2) * Math.sin(y / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function tencentPlace(lat, lng, radius, keyword) {
  const r = Math.round(radius);
  return tencentGet("/ws/place/v1/search", {
    keyword: keyword,
    boundary: "nearby(" + lat + "," + lng + "," + r + ",1)",
    orderby: "_distance",
    page_size: 20,
    key: TENCENT_KEY
  }, 9000).then((j) => {
    if (!j || j.status !== 0) throw new Error((j && j.message) || "腾讯位置服务返回异常");
    return (j.data || []).map((p) => ({
      name: p.title || "",
      type: String(p.category || "").split(":").pop() || "POI",
      lat: p.location && p.location.lat,
      lng: p.location && p.location.lng,
      dist: typeof p._distance === "number" ? p._distance : null
    }));
  });
}

function osmType(t, mode) {
  if (mode === "spot") return "钓点";
  if (t.water === "reservoir") return "水库";
  if (t.water === "lake") return "湖泊";
  if (t.water === "pond") return "池塘";
  if (t.waterway === "river" || t.waterway === "canal") return "河流";
  if (t.natural === "wetland") return "湿地";
  return "水域";
}

// 公共 Overpass 镜像，按顺序试；前一个超时/报错就换下一个
// 实测（2026-10-21，国内家宽）：osm.fr 全球数据且可达；osm.ch 只含瑞士，中国查不到（0 结果），不可用；
// overpass-api.de / kumi / private.coffee 国内直接超时，仅作境外兜底。
const OVERPASS = [
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter"
];

// 语句越少越快：只用 2 条 nwr（含 node/way/relation，relation 也能出 center），
// 去掉 stream（太碎）、wetland、landuse=reservoir（数量少且常与 natural=water 重复）。
// 用 bbox 包围盒而不是 around：Overpass 对 bbox 走空间索引，实测 8km 从 4~6s 降到 2.7~3.2s，
// 且命中更多（around 只算圆周内）。bbox 是方形，外扩到 1.414 倍的角部结果由 dist 过滤掉。
function osmQuery(lat, lng, radius, mode) {
  const cos = Math.max(0.01, Math.cos(lat * Math.PI / 180));
  const dLat = radius / 111320;
  const dLng = radius / (111320 * cos);
  const bb = (lat - dLat).toFixed(6) + "," + (lng - dLng).toFixed(6) + ","
    + (lat + dLat).toFixed(6) + "," + (lng + dLng).toFixed(6);
  const head = "[out:json][timeout:22];(";
  return mode === "water"
    ? head
      + 'nwr["natural"="water"](' + bb + ");"
      + 'nwr["waterway"~"river|canal"](' + bb + ");"
      + ");out center qt 250;"
    : head
      + 'nwr["leisure"="fishing"](' + bb + ");"
      + 'nwr["sport"="fishing"](' + bb + ");"
      + ");out center qt 60;";
}

// 拆成「有名字 / 没名字」两组：OSM 国内大量水体没有 name 标签，
// 有名字的优先展示，实在凑不够再用无名水体补（标注「未标注名称」）
function splitElements(els, lat, lng, mode) {
  const named = [], unnamed = [];
  els.forEach((e) => {
    const t = e.tags || {};
    const c = e.center || (e.lat != null ? { lat: e.lat, lon: e.lon } : null);
    if (!c || c.lat == null || c.lon == null) return;
    // 喷泉 / 泳池 / 蓄水池这类不是能下竿的水面，直接跳过
    if (t.water === "fountain" || t.water === "swimming_pool" || t.water === "basin"
      || t.swimming_pool || t.amenity === "fountain") return;
    const type = osmType(t, mode);
    const item = {
      name: t.name || "",
      type: type,
      lat: c.lat, lng: c.lon,
      dist: Math.round(haversine(lat, lng, c.lat, c.lon))
    };
    if (t.name) named.push(item);
    else unnamed.push(item);
  });
  return { named: named, unnamed: unnamed };
}

async function nearbyOSM(lat, lng, radius, mode) {
  const q = osmQuery(lat, lng, radius, mode);
  const errs = [];
  for (let i = 0; i < OVERPASS.length; i++) {
    const host = OVERPASS[i].split("/")[2];
    try {
      // 实测 8~20km 查询 3~7s，这里给 16s；云函数务必把超时时间调到 20s
      const j = await get(OVERPASS[i] + "?data=" + encodeURIComponent(q), 16000);
      const els = (j && j.elements) || [];
      // Overpass 出错时会回 200 + remark（无 elements），当失败处理继续换镜像
      if (!els.length && j && j.remark) throw new Error(String(j.remark).slice(0, 60));
      const r = splitElements(els, lat, lng, mode);
      r.mirror = host;
      return r;
    } catch (e) {
      errs.push(host + "→" + (e.message || "失败"));
    }
  }
  throw new Error(errs.join("；"));
}

// 同名且 100m 内视为同一处（OSM 里同一水体常有 way + relation 两份）
function dedupe(list) {
  const seen = {};
  const out = [];
  list.forEach((x) => {
    if (x.lat == null || x.lng == null) return;
    const k = (x.name || "") + "|" + Math.round(x.lat * 1000) + "," + Math.round(x.lng * 1000);
    if (seen[k]) return;
    seen[k] = 1;
    out.push(x);
  });
  return out;
}

async function nearby(lat, lng, radius, mode, coordType) {
  // 与逆地理编码同一套坐标规则：腾讯搜索要 GCJ02，OSM/Overpass 要 WGS84。
  // 返回给客户端时统一换成 GCJ02 —— 小程序地图是按 GCJ02 画的，直接把 OSM 的 WGS84 坐标丢上去
  // 会整体错位约 450m（在 3~8km 的检索半径里，表现为“标记都在路对面/隔壁街区”）。
  const fromWgs = coordType === "wgs84";
  const w = fromWgs ? { lat: lat, lng: lng } : gcj2wgs(lat, lng);
  const g = fromWgs ? wgs2gcj(lat, lng) : { lat: lat, lng: lng };

  let list = [], source = "osm", dbg = {};
  if (TENCENT_KEY) {
    source = "tencent";
    const kws = mode === "water" ? ["水库", "湖", "河"] : ["钓场", "钓鱼"];
    const arrs = await Promise.all(kws.map((k) => tencentPlace(g.lat, g.lng, radius, k)
      .catch((e) => { dbg["err_" + k] = e.message; return []; })));
    list = arrs.reduce((a, b) => a.concat(b), []);
  } else {
    const r = await nearbyOSM(w.lat, w.lng, radius, mode);
    dbg.mirror = r.mirror;
    dbg.named = r.named.length;
    dbg.unnamed = r.unnamed.length;
    list = r.named;
    // 有名字的都凑不满 3 条时，用无名水体补齐（至少让地图上有东西可看）
    if (list.length < 3) {
      list = list.concat(r.unnamed.map((x) => Object.assign({}, x, {
        name: x.type + "（未标注名称）"
      })));
    }
  }
  const seen = {};
  list = dedupe(list)
    .filter((x) => x.dist == null || x.dist <= radius * 1.05)
    .sort((a, b) => (a.dist == null ? 1e9 : a.dist) - (b.dist == null ? 1e9 : b.dist))
    .filter((x) => {
      // 去重后再按坐标收一遍，防止「无名水体」同点重复
      const k = Math.round(x.lat * 2000) + "," + Math.round(x.lng * 2000);
      if (seen[k]) return false;
      seen[k] = 1;
      return true;
    });

  // 名称黑名单：景观水景不是钓点
  const NOISE = /喷泉|水池|泳池|景观水|水景|游泳池/;
  list = list.filter((x) => !x.name || !NOISE.test(x.name));

  // 同名合并：OSM 把一条河/渠切成很多段（实测「沣惠渠」一次返回 5 条，全在 15.4~15.8km），
  // 逐段展示就是刷屏。这里保留最近的一段，并记下总段数 seg。
  // 列表已按距离升序，所以第一次出现的同名项就是最近的那段。
  const byName = Object.create(null);
  const merged = [];
  list.forEach((x) => {
    if (!x.name) { merged.push(x); return; }
    const g = byName[x.name];
    if (g) { g.seg += 1; return; }
    x.seg = 1;
    byName[x.name] = x;
    merged.push(x);
  });
  list = merged.slice(0, 30);
  // OSM 返回的是 WGS84，转成 GCJ02 再交给小程序地图，否则标记整体偏约 450m
  if (source === "osm") {
    list = list.map((x) => {
      if (x.lat == null || x.lng == null) return x;
      const c = wgs2gcj(x.lat, x.lng);
      return Object.assign({}, x, { lat: c.lat, lng: c.lng });
    });
  }
  dbg.total = list.length;
  dbg.merged = merged.length;
  return { ok: true, v: 2, source: source, list: list, dbg: dbg };
}

exports.main = async (event) => {
  // ---- 附近水域 / 钓场检索 ----
  if (event && event.action === "nearby") {
    const nlat = parseFloat(event.lat), nlng = parseFloat(event.lng);
    if (!isFinite(nlat) || !isFinite(nlng)) return { ok: false, v: 2, msg: "坐标缺失" };
    const radius = Math.min(30000, Math.max(500, parseFloat(event.radius) || 3000));
    const mode = event.mode === "spot" ? "spot" : "water";
    try {
      return await nearby(nlat, nlng, radius, mode, event.coordType === "wgs84" ? "wgs84" : "gcj02");
    } catch (e) {
      return {
        ok: false, v: 2,
        reason: String(e.message || "").slice(0, 160),
        msg: "附近 POI 暂不可用：免 key 的 OpenStreetMap 数据源在国内网络基本连不上（已试 3 个镜像，全部超时）。"
          + "请到 lbs.qq.com 免费申请一个 key，在云开发控制台给本函数加环境变量 TENCENT_MAP_KEY，然后重新部署。"
      };
    }
  }

  const lat = parseFloat(event.lat), lng = parseFloat(event.lng);
  if (!isFinite(lat) || !isFinite(lng)) return { ok: false, msg: "坐标缺失" };

  // 坐标基准：默认按 GCJ02 理解（小程序地图组件 / chooseLocation 都是 GCJ02）。
  // Open-Meteo 的网格约 1~11km，转不转对天气值几乎无影响，但统一按 WGS84 请求更自洽；
  // 逆地理编码对差 400~500m 很敏感，必须转（这是「定位到隔壁厂区」的根因）。
  const coordType = event.coordType === "wgs84" ? "wgs84" : "gcj02";
  const w = coordType === "wgs84" ? { lat: lat, lng: lng } : gcj2wgs(lat, lng);

  // 两个接口并行，总耗时取决于较慢的那个
  const [weather, placeRes] = await Promise.all([
    fetchWeather(w.lat, w.lng).catch((e) => ({ __err: e.message || "天气接口失败" })),
    fetchPlace(lat, lng, coordType)
  ]);
  const place = (placeRes && placeRes.place) || "";
  const tencentErr = (placeRes && placeRes.tencentErr) || "";

  if (weather && weather.__err) return { ok: false, msg: weather.__err, place: place, tencent_err: tencentErr };
  if (!weather || !weather.current) return { ok: false, msg: "天气接口返回异常", place: place, tencent_err: tencentErr };
  return { ok: true, weather: weather, place: place, tencent_err: tencentErr };
};
