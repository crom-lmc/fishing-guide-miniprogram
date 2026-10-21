// 云函数：代理外部免密钥接口，规避小程序 request 合法域名限制
//   - Open-Meteo   实时天气：api.open-meteo.com 无 ICP 备案，配不了合法域名（真机/体验版必失败）
//   - BigDataCloud 逆地理编码：api.bigdatacloud.net 同理，坐标 → 省市区地名
// wx.cloud.callFunction 走微信自有通道，不经过域名白名单，这是无 Key 方案的唯一出路。
// 调用方：wx.cloud.callFunction({ name: "weather", data: { lat: 34.34, lng: 108.98 } })
// 返回：{ ok: true, weather: <Open-Meteo JSON>, place: "陕西省西安市未央区" }
//       天气失败时 ok:false 且带 msg；地名失败不影响天气，place 退化为 ""
const https = require("https");

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

function fetchPlace(lat, lng) {
  return get("https://api.bigdatacloud.net/data/reverse-geocode-client"
    + "?latitude=" + lat.toFixed(5) + "&longitude=" + lng.toFixed(5)
    + "&localityLanguage=zh", 8000)
    .then(compose)
    .catch(() => "");   // 地名拿不到只影响展示，静默降级
}

// ===== 附近 POI（水域 / 钓场）=====
// 数据源优先级：
//   1) 腾讯位置服务 place/search —— 在云开发控制台给本函数配环境变量 TENCENT_MAP_KEY 即启用；
//      真正的 POI 搜索（含收费钓场），返回 _distance，结果最准。
//   2) Overpass / OSM（免 key 兜底）—— 只能按 OSM 标签找水域，国内钓场数据几乎为空。
const TENCENT_KEY = process.env.TENCENT_MAP_KEY || "";

function haversine(a, b, c, d) {
  const R = 6371000, p = Math.PI / 180;
  const x = (c - a) * p, y = (d - b) * p;
  const h = Math.sin(x / 2) * Math.sin(x / 2)
    + Math.cos(a * p) * Math.cos(c * p) * Math.sin(y / 2) * Math.sin(y / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function tencentPlace(lat, lng, radius, keyword) {
  const url = "https://apis.map.qq.com/ws/place/v1/search"
    + "?keyword=" + encodeURIComponent(keyword)
    + "&boundary=nearby(" + lat + "," + lng + "," + Math.round(radius) + ",1)"
    + "&orderby=_distance&page_size=20&key=" + TENCENT_KEY;
  return get(url, 9000).then((j) => {
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

async function nearby(lat, lng, radius, mode) {
  let list = [], source = "osm", dbg = {};
  if (TENCENT_KEY) {
    source = "tencent";
    const kws = mode === "water" ? ["水库", "湖", "河"] : ["钓场", "钓鱼"];
    const arrs = await Promise.all(kws.map((k) => tencentPlace(lat, lng, radius, k)
      .catch((e) => { dbg["err_" + k] = e.message; return []; })));
    list = arrs.reduce((a, b) => a.concat(b), []);
  } else {
    const r = await nearbyOSM(lat, lng, radius, mode);
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
      return await nearby(nlat, nlng, radius, mode);
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

  // 两个接口并行，总耗时取决于较慢的那个
  const [weather, place] = await Promise.all([
    fetchWeather(lat, lng).catch((e) => ({ __err: e.message || "天气接口失败" })),
    fetchPlace(lat, lng)
  ]);

  if (weather && weather.__err) return { ok: false, msg: weather.__err, place: place };
  if (!weather || !weather.current) return { ok: false, msg: "天气接口返回异常", place: place };
  return { ok: true, weather: weather, place: place };
};
