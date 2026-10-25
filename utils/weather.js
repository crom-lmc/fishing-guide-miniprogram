// 实时天气获取（与 Web 版同一数据源：Open-Meteo）
// 域名问题：api.open-meteo.com 无 ICP 备案，配不了 request 合法域名（真机/体验版必失败），
// 因此统一走云函数 weather 代理；逆地理编码（BigDataCloud）同理无备案，
// 由同一云函数顺带返回地名，客户端只发一次调用。
// 部署：开发者工具 → 右键 cloudfunctions/weather → 上传并部署（需先在 mp 后台开通云开发）。
const S = require("./score.js");

// 同一位置 10 分钟内复用结果（≈100m 网格）：
//   开发期反复编译、出钓页/日志页来回切、日志页与出钓页各查一次，都不会重复打云函数，
//   既省腾讯位置服务的每日额度（逆地址解析 6000/天、地点搜索仅 200/天），
//   也让同一位置的地名稳定，不会一会儿这个楼一会儿那个楼。
// 内存 + 本地存储双缓存：内存挡同一页面内的重复调用，存储挡冷启动/跨页面。
const CACHE_TTL = 10 * 60 * 1000;
// 缓存键随云函数逻辑升级而升级：v5 把腾讯「本站气压」换算成海平面气压后，
// 旧缓存里 974 这种站压值会让分数偏低约 19 分。升键作废全部旧缓存，
// 部署 v5 后重新编译即可立刻拿到换算后的数据，不必苦等 10 分钟 TTL 过期。
// v2：v1 缓存里可能出现过一个坏字符的 place（真机渲染成乱码），升键作废全部旧缓存
// v4：云函数 v6 修掉了「拿不到海拔时把本站气压当海平面气压用」的 bug（西安站压 974 会让分数低十几分）。
//     本地缓存里可能还存着按错误气压算出来的天气，升键作废，重新编译即刻生效，不必苦等 10 分钟 TTL。
const CACHE_KEY = "fish.weather.cache.v4";
const CACHE_MAX = 40;
const _mem = {};

function cacheKey(lat, lng, coordType) {
  return Number(lat).toFixed(3) + "," + Number(lng).toFixed(3) + "," + (coordType || "gcj02");
}

function readStore() {
  try {
    return wx.getStorageSync(CACHE_KEY) || {};
  } catch (e) {
    return {};
  }
}

function saveStore(k, item) {
  try {
    const m = readStore();
    m[k] = item;
    const ks = Object.keys(m);
    if (ks.length > CACHE_MAX) {
      // 超量时丢掉最旧的，避免本地存储无限膨胀
      ks.sort((a, b) => (m[a].t || 0) - (m[b].t || 0));
      for (let i = 0; i < ks.length - CACHE_MAX; i++) delete m[ks[i]];
    }
    wx.setStorageSync(CACHE_KEY, m);
  } catch (e) {}
}

// 返回 { weather: <Open-Meteo JSON>, place: "陕西省西安市未央区",
//         v: 云函数版本号, weather_src: "tencent"|"open-meteo",
//         pressure_src: "msl-converted"|"open-meteo"|"unknown" }；失败都 reject
// coordType：本项目客户端拿到的坐标都是 GCJ02（地图组件中心 / chooseLocation / getFuzzyLocation 均取 gcj02），
// 传下去让云函数在查境外数据源前转 WGS84 —— 不转会整体偏 400~500m，逆地理编码就落到隔壁厂区了。
// force=true 时跳过缓存（首页「刷新」按钮用，保证部署新版本后立刻拿到最新数据，不被 10 分钟缓存挡住）。
function fetchAll(lat, lng, coordType, force) {
  const ct = coordType || "gcj02";
  const ck = cacheKey(lat, lng, ct);
  const now = Date.now();

  // 1) 内存缓存
  const m = _mem[ck];
  if (!force && m && now - m.t < CACHE_TTL) return Promise.resolve(m.v);

  // 2) 本地存储缓存（跨页面 / 冷启动）
  const s = readStore()[ck];
  if (!force && s && now - s.t < CACHE_TTL) {
    _mem[ck] = s;
    return Promise.resolve(s.v);
  }

  // 3) 真正请求云函数
  return new Promise((resolve, reject) => {
    if (!wx.cloud || !wx.cloud.callFunction) {
      reject(new Error("当前微信版本不支持云开发，请手动填写。"));
      return;
    }
    wx.cloud.callFunction({
      name: "weather",
      data: { lat: lat, lng: lng, coordType: ct },
      success: (r) => {
        const d = (r && r.result) || {};
        if (d.ok && d.weather && d.weather.current) {
          const v = {
            weather: d.weather,
            place: d.place || "",
            // 透传部署版本与数据来源，首页据此显示「云函数 v6 · 腾讯实况 · 气压已换算海平面」，
            // 便于确认新版本是否真的生效（不用再靠猜）。
            v: d.v,
            weather_src: d.weather_src || (d.weather && d.weather._src) || "",
            pressure_src: (d.weather.current && d.weather.current.pressure_src) || ""
          };
          const item = { t: Date.now(), v: v };
          _mem[ck] = item;
          saveStore(ck, item);
          resolve(v);
        } else {
          reject(new Error(d.msg || "天气数据获取失败"));
        }
      },
      fail: (e) => {
        const msg = (e && e.errMsg) || "";
        // 云函数没部署 / 云开发没开通时 errMsg 带 not exist、-404011 之类
        reject(new Error(/not (exist|found)|找不到|未找到|-404011/.test(msg)
          ? "云函数 weather 未部署：请在开发者工具右键 cloudfunctions/weather → 上传并部署"
          : "天气服务暂时不可用：" + msg));
      }
    });
  });
}

// Open-Meteo current → 出钓指数参数（气压必须用海平面气压 pressure_msl，与 Web 版同口径）
function toParams(current, se, wt) {
  const c = current || {};
  const pRaw = (typeof c.pressure_msl === "number") ? c.pressure_msl : c.surface_pressure;
  return {
    w: S.wxCodeToKey(c.weather_code),
    t: Math.round(c.temperature_2m || 0),
    p: Math.round(pRaw || 1010),
    wi: String(S.kmhToLevel(c.wind_speed_10m || 0)),
    dr: S.degToDirKey(c.wind_direction_10m || 0),
    tm: S.curTimeKey(),
    se: se,
    wt: wt
  };
}

module.exports = { fetchAll: fetchAll, toParams: toParams };
