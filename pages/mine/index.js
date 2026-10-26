// 我的
const app = getApp();
const TH = require("../../utils/theme.js");
const SHR = require("../../utils/share.js");
const S = require("../../utils/session.js");
const C = require("../../utils/config.js");

// 外观条目的展示态：跟随模式显示 📱 + 当前实际主题；手动模式显示 ☀️/🌙
function themeView() {
  const mode = TH.getMode();
  const t = TH.get();
  if (mode === "auto") {
    return { name: "跟随手机主题 · " + (t === "light" ? "白天" : "夜间"), icon: "📱", light: t === "light" };
  }
  return { name: t === "light" ? "白天" : "夜间", icon: t === "light" ? "☀️" : "🌙", light: t === "light" };
}

Page(TH.mix({
  data: {
    stat: { times: 0, total: 0, max: 0.0, hours: 0.0 },
    gearDone: 0, gearTotal: 0, spots: 0,
    themeName: "跟随手机主题", themeIcon: "📱", themeLight: false,
    isLogin: false, nickname: "", avatarUrl: "", editing: false, saving: false, _avatarTmp: ""
  },

  onShow() {
    // 登录态：优先用 app 全局（silentLogin 已写好），否则回退读本地 session
    const u = app.globalData.user || S.get();
    if (u && u.openid) {
      this.setData({ isLogin: true, nickname: u.nickname || "微信用户", avatarUrl: u.avatarUrl || "" });
    } else {
      this.setData({ isLogin: false, nickname: "", avatarUrl: "" });
      // 纯静默：未登录时自动重试一次（云环境就绪后自愈），不弹按钮
      if (C.CLOUD_ENV && app.silentLogin) app.silentLogin();
    }

    const logs = app.get(app.KEYS.LOG, []);
    const total = logs.reduce((a, r) => a + (+r.count || 0), 0);
    const max = logs.reduce((a, r) => Math.max(a, +r.max || 0), 0);
    const hours = logs.reduce((a, r) => a + (+r.hours || 0), 0);

    const D = require("../../data/fishing-data.js");
    const gearTotal = D.GEAR.reduce((a, s) => a + s.items.length, 0);
    const ck = app.get(app.KEYS.GEAR, {});
    const gearDone = Object.keys(ck).filter(k => ck[k]).length;
    const spots = (app.get(app.KEYS.SPOT, []) || []).length;

    const v = themeView();
    this.setData({
      stat: { times: logs.length, total: total, max: max.toFixed(2), hours: hours.toFixed(1) },
      gearDone: gearDone, gearTotal: gearTotal, spots: spots,
      themeName: v.name, themeIcon: v.icon, themeLight: v.light
    });
  },

  // 切主题：写 storage 后立刻套用（mix 注入的 onShow 只在本页进入时跑，这里要当场生效）
  toggleTheme() {
    const m = TH.getMode();
    const idx = m === "auto" ? 0 : (m === "light" ? 1 : 2);
    wx.showActionSheet({
      itemList: ["跟随手机主题", "白天模式", "夜间模式"],
      success: (r) => {
        const mode = ["auto", "light", "dark"][r.tapIndex];
        if (r.tapIndex === idx) return;
        TH.setMode(mode);
        const t = TH.get();
        TH.applyChrome(t);
        const v = themeView();
        // tc 是根节点 class（由 theme.mix 注入），必须一起改，否则本页颜色变量不会跟着换
        this.setData({
          tc: t === "light" ? "light" : "",
          themeName: v.name, themeIcon: v.icon, themeLight: v.light
        });
        wx.showToast({
          title: mode === "auto" ? ("已跟随手机主题（当前" + (t === "light" ? "白天" : "夜间") + "）")
               : (t === "light" ? "已切到白天模式" : "已切到夜间模式"),
          icon: "none"
        });
      }
    });
  },

  goStats() { wx.navigateTo({ url: "/pages/stats/index" }); },

  // 长按小程序码 → 存相册，方便发群 / 发朋友圈
  saveQr() {
    wx.getImageInfo({
      src: "/images/wxacode.png",
      success: (r) => {
        wx.saveImageToPhotosAlbum({
          filePath: r.path,
          success: () => wx.showToast({ title: "已保存到相册", icon: "success" }),
          fail: (e) => {
            const m = (e && e.errMsg) || "";
            if (/auth|deny|authorize|privacy/i.test(m)) {
              wx.showModal({
                title: "需要相册权限",
                content: "保存小程序码需要「保存到相册」权限，是否去设置里打开？",
                confirmText: "去设置",
                success: (s) => { if (s.confirm) wx.openSetting(); }
              });
              return;
            }
            wx.showToast({ title: "保存失败，可截图分享", icon: "none" });
          }
        });
      },
      fail: () => wx.showToast({ title: "读取图片失败", icon: "none" })
    });
  },

  // ---- 登录态 / 资料（P3）----
  noop() {},

  editProfile() {
    if (!this.data.isLogin) return;
    this._nick = null; // 清掉上一次的暂存
    this.setData({ editing: true });
  },

  closeEdit() {
    this.setData({ editing: false, _avatarTmp: "" });
  },

  // chooseAvatar 回调：拿到的是临时路径，需上传到云存储才能持久
  onChooseAvatar(e) {
    const url = (e && e.detail && e.detail.avatarUrl) || "";
    if (!url) return;
    this.setData({ avatarUrl: url, _avatarTmp: url });
  },

  // type=nickname 键盘选微信名后，如果在 blur 里 setData 会触发重渲染、
  // 把刚填的名字冲回旧值（表现为"选了没回填"）。这里只暂存到非响应式变量，
  // 输入框显示交给原生，保存时才取 this._nick。
  onNick(e) {
    const v = ((e && e.detail && e.detail.value) || "").trim();
    this._nick = v;
  },

  saveProfile() {
    if (this.data.saving) return;
    const u = app.globalData.user || S.get();
    if (!u || !u.openid) { wx.showToast({ title: "未登录，无法保存", icon: "none" }); return; }
    this.setData({ saving: true });
    const self = this;
    const nickname = (this._nick != null && this._nick !== "") ? this._nick : (self.data.nickname || "微信用户");

    // 把一份干净的身份回写本地，供下次启动读取
    const commit = (avatarUrl) => {
      wx.cloud.callFunction({
        name: "sync",
        data: { action: "updateProfile", nickname: nickname, avatarUrl: avatarUrl || "" },
        success: (r) => {
          const d = (r && r.result) || {};
          if (!d.ok) { wx.showToast({ title: d.msg || "保存失败", icon: "none" }); self.setData({ saving: false }); return; }
          const s = Object.assign({}, u, { nickname: nickname, avatarUrl: avatarUrl || "" });
          S.set(s); app.globalData.user = s;
          self.setData({ editing: false, _avatarTmp: "", isLogin: true, nickname: s.nickname, avatarUrl: s.avatarUrl, saving: false });
          wx.showToast({ title: "已保存", icon: "success" });
        },
        fail: () => { wx.showToast({ title: "网络异常，保存失败", icon: "none" }); self.setData({ saving: false }); }
      });
    };

    // 选了新头像 → 先上传云存储拿持久 fileID；否则只更新昵称
    const tmp = self.data._avatarTmp;
    if (tmp) {
      const ext = (tmp.split(".").pop() || "png").split("?")[0];
      wx.cloud.uploadFile({
        cloudPath: "avatar/" + u.openid + "." + ext,
        filePath: tmp,
        success: (res) => commit(res.fileID),
        fail: () => { wx.showToast({ title: "头像上传失败", icon: "none" }); self.setData({ saving: false }); }
      });
    } else {
      commit(self.data.avatarUrl || "");
    }
  },

  go(e) { wx.navigateTo({ url: e.currentTarget.dataset.url }); },

  clearAll() {
    wx.showModal({
      title: "清空本地数据",
      content: "将删除本机保存的渔获日志、装备勾选与收藏钓点，且无法恢复。确定吗？",
      confirmColor: "#F87171",
      success: (r) => {
        if (!r.confirm) return;
        [app.KEYS.LOG, app.KEYS.GEAR, app.KEYS.SPOT].forEach(k => app.remove(k));
        this.onShow();
        wx.showToast({ title: "已清空", icon: "none" });
      }
    });
  }
,
  // 转发 / 朋友圈：页面里不写 onShareAppMessage，右上角菜单那两项就是灰的
  onShareAppMessage() { return SHR.friend(SHR.titleOf("/pages/mine/index"), "/pages/mine/index"); },
  onShareTimeline() { return SHR.timeline(SHR.titleOf("/pages/mine/index")); }
}));
