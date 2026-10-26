// 登录会话：极简本地持久化
// 云开发免鉴权下，身份就是 OPENID（微信给的，稳定不变）。
// 这里只缓存一份「身份 + 资料 + 过期时间」，避免每次启动都打云函数。
const KEY = "fgw_session";
const TTL = 7 * 86400000; // 7 天软过期，过期后下次自动重新静默登录

function get() {
  try {
    const s = wx.getStorageSync(KEY);
    if (!s || !s.openid) return null;
    if (s.expireAt && s.expireAt < Date.now()) return null;
    return s;
  } catch (e) {
    return null;
  }
}

function set(s) {
  try { wx.setStorageSync(KEY, s); } catch (e) { /* 隐私模式/存储满，静默 */ }
}

function clear() {
  try { wx.removeStorageSync(KEY); } catch (e) {}
}

function valid() {
  return !!get();
}

module.exports = { KEY: KEY, TTL: TTL, get: get, set: set, clear: clear, valid: valid };
