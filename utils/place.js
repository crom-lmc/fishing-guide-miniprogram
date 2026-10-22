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

module.exports = { savePicked, nearbyName, haversine };
