// 钓鱼指南 · 从入门到上鱼
const C = require("./utils/config.js");
const KEYS = {
  LOG: "fish.log.v1",     // 渔获日志
  GEAR: "fish.gear.v1",   // 装备勾选状态
  SPOT: "fish.spot.v1",   // 收藏钓点
  PARAM: "fish.param.v1", // 出钓指数参数缓存
  TIMER: "fish.timer.v1"  // 出钓计时（进行中的那一次）
};

App({
  KEYS: KEYS,
  onLaunch() {
    // 初始化云开发（识别鱼获走云函数中转 Key）；没填环境 ID 时用默认环境
    if (wx.cloud) {
      try { wx.cloud.init(C.CLOUD_ENV ? { env: C.CLOUD_ENV, traceUser: true } : { traceUser: true }); } catch (e) {}
    }
    const sys = wx.getSystemInfoSync ? wx.getSystemInfoSync() : {};
    this.globalData.safeBottom = (sys.safeArea && sys.screenHeight)
      ? sys.screenHeight - sys.safeArea.bottom : 0;
  },
  globalData: {
    safeBottom: 0
  },

  // ---- 本地存储封装（与 Web 版 localStorage 语义一致，仅换底层 API）----
  get(key, def) {
    try {
      const v = wx.getStorageSync(key);
      return (v === "" || v === null || v === undefined) ? def : v;
    } catch (e) {
      return def;
    }
  },
  set(key, val) {
    try { wx.setStorageSync(key, val); } catch (e) { /* 存储满或隐私模式，静默 */ }
  },
  remove(key) {
    try { wx.removeStorageSync(key); } catch (e) {}
  }
});
