// 手动选点的「楼名缓存」
//
// 为什么需要它：自动定位只能给出经纬度，逆地理编码走的是境外免 key 数据源
// （BigDataCloud 只到区县；Photon/OSM 国内几乎没有写字楼、园区的名字），
// 所以「广联达西安数字建筑研发大厦」「凯瑞H座」这类楼名永远解析不出来。
// 而 wx.chooseLocation 背后是腾讯地图，返回的 name 就是标准 POI 名。
//
// 于是：用户手动选过一次之后，把坐标 + 楼名存下来；下次自动定位落在 300m 内，
// 直接用当时那个楼名，不再被逆地理编码带偏。
const KEY = "fish.place.v1";
const DEFAULT_RADIUS = 300;

function app() {
  try { return getApp(); } catch (e) { return null; }
}

function haversine(a, b, c, d) {
  const R = 6371000, p = Math.PI / 180;
  const x = (c - a) * p, y = (d - b) * p;
  const h = Math.sin(x / 2) * Math.sin(x / 2)
    + Math.cos(a * p) * Math.cos(c * p) * Math.sin(y / 2) * Math.sin(y / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// 记住用户手动选定的地点（都在 GCJ02 下比较，与小程序地图一致）
function savePicked(lat, lng, name) {
  const a = app();
  if (!a || lat == null || lng == null || !name) return;
  a.set(KEY, { lat: lat, lng: lng, name: String(name), at: Date.now() });
}

// 当前点距上次手动选点在 maxM 米内 → 返回当时的楼名；否则返回空串
function nearbyName(lat, lng, maxM) {
  const a = app();
  if (!a) return "";
  const p = a.get(KEY, null);
  if (!p || !p.name || p.lat == null || p.lng == null) return "";
  const r = maxM || DEFAULT_RADIUS;
  return haversine(lat, lng, p.lat, p.lng) <= r ? p.name : "";
}

// 地名净化：剔除替换符、控制字符、孤立代理对、零宽/变体选择符与私用区字符。
// 与云函数 weather 里的 cleanText 同一套规则：真机出现过 place 某个字渲染成
// 「�◆�」字节级乱码（渭城区·朗诗·渭城府），这里在显示前再兜一道底，
// 同时覆盖本地 chooseLocation 存下的楼名等非云函数来源。
function cleanText(s) {
  const str = String(s == null ? "" : s);
  let out = "";
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c >= 0xD800 && c <= 0xDBFF) {              // 高位代理：成对保留，孤立丢弃
      const d = str.charCodeAt(i + 1);
      if (d >= 0xDC00 && d <= 0xDFFF) { out += str[i] + str[i + 1]; i++; }
      continue;
    }
    if (c >= 0xDC00 && c <= 0xDFFF) continue;      // 孤立低位代理
    if (c === 0xFFFD) continue;                    // 替换字符
    if (c === 0xFEFF || c === 0x200B || c === 0xFE0E || c === 0xFE0F) continue;  // 零宽/变体选择符
    if (c < 0x20 && c !== 0x0A) continue;          // C0 控制字符（保留换行）
    if (c >= 0x7F && c < 0xA0) continue;           // C1 控制字符（字节级乱码常客）
    if (c >= 0xE000 && c <= 0xF8FF) continue;      // 私用区（真机多半没字形）
    out += str[i];
  }
  return out;
}

module.exports = { savePicked, nearbyName, haversine, cleanText };
