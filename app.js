// 钓鱼指南 · 从入门到上鱼
const C = require("./utils/config.js");
const SH = require("./utils/share.js");
const S = require("./utils/session.js");

// 在所有页面注册之前执行：给漏写分享回调的页面补上默认实现。
// 不补的话，右上角「…」里的「转发给朋友」「分享到朋友圈」就是灰的（与备案/认证无关）。
SH.installShareDefaults();
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

    // 静默登录：仅当配置了云环境才跑；没填 CLOUD_ENV 时完全跳过，本地功能不受影响
    if (C.CLOUD_ENV) this.silentLogin();
  },

  // 微信云开发免鉴权登录：前端无需 wx.login，云函数用 getWXContext().OPENID 拿身份
  // 1) 本地 session 有效 → 直接用，秒开、无网络请求
  // 2) 无效/没有 → 静默调一次 sync.login，upsert users 后把身份写回本地
  silentLogin() {
    if (this.globalData.user) return;            // 已经登录，跳过
    const cached = S.get();
    if (cached) { this.globalData.user = cached; return; }
    if (this._loggingIn) return;                  // 防止并发重复触发
    this._loggingIn = true;
    wx.cloud.callFunction({
      name: "sync",
      data: { action: "login" },
      success: (r) => {
        const d = (r && r.result) || {};
        if (d.ok) {
          const s = {
            openid: d.openid,
            nickname: (d.profile && d.profile.nickname) || "微信用户",
            avatarUrl: (d.profile && d.profile.avatarUrl) || "",
            expireAt: d.expireAt
          };
          S.set(s);
          this.globalData.user = s;
        }
      },
      complete: () => { this._loggingIn = false; }
    });
  },

  globalData: {
    safeBottom: 0,
    user: null   // 登录态：{ openid, nickname, avatarUrl, expireAt }，未登录为 null
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
