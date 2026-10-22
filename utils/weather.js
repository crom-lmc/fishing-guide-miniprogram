// 实时天气获取（与 Web 版同一数据源：Open-Meteo）
// 域名问题：api.open-meteo.com 无 ICP 备案，配不了 request 合法域名（真机/体验版必失败），
// 因此统一走云函数 weather 代理；逆地理编码（BigDataCloud）同理无备案，
// 由同一云函数顺带返回地名，客户端只发一次调用。
// 部署：开发者工具 → 右键 cloudfunctions/weather → 上传并部署（需先在 mp 后台开通云开发）。
const S = require("./score.js");

// 返回 { weather: <Open-Meteo JSON>, place: "陕西省西安市未央区" }；失败都 reject
// coordType：本项目客户端拿到的坐标都是 GCJ02（地图组件中心 / chooseLocation / getFuzzyLocation 均取 gcj02），
// 传下去让云函数在查境外数据源前转 WGS84 —— 不转会整体偏 400~500m，逆地理编码就落到隔壁厂区了。
function fetchAll(lat, lng, coordType) {
  return new Promise((resolve, reject) => {
    if (!wx.cloud || !wx.cloud.callFunction) {
      reject(new Error("当前微信版本不支持云开发，请手动填写。"));
      return;
    }
    wx.cloud.callFunction({
      name: "weather",
      data: { lat: lat, lng: lng, coordType: coordType || "gcj02" },
      success: (r) => {
        const d = (r && r.result) || {};
        if (d.ok && d.weather && d.weather.current) {
          resolve({ weather: d.weather, place: d.place || "" });
        } else {
          reject(new Error(d.msg || "天气数据获取失败"));
        }
      },
      fail: (e) => {
        const m = (e && e.errMsg) || "";
        // 云函数没部署 / 云开发没开通时 errMsg 带 not exist、-404011 之类
        reject(new Error(/not (exist|found)|找不到|未找到|-404011/.test(m)
          ? "云函数 weather 未部署：请在开发者工具右键 cloudfunctions/weather → 上传并部署"
          : "天气服务暂时不可用：" + m));
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
