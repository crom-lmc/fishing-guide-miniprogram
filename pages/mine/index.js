// 我的
const app = getApp();
const TH = require("../../utils/theme.js");

Page(TH.mix({
  data: {
    stat: { times: 0, total: 0, max: 0.0, hours: 0.0 },
    gearDone: 0, gearTotal: 0, spots: 0,
    themeName: "夜间", themeIcon: "🌙", themeLight: false
  },

  onShow() {
    const logs = app.get(app.KEYS.LOG, []);
    const total = logs.reduce((a, r) => a + (+r.count || 0), 0);
    const max = logs.reduce((a, r) => Math.max(a, +r.max || 0), 0);
    const hours = logs.reduce((a, r) => a + (+r.hours || 0), 0);

    const D = require("../../data/fishing-data.js");
    const gearTotal = D.GEAR.reduce((a, s) => a + s.items.length, 0);
    const ck = app.get(app.KEYS.GEAR, {});
    const gearDone = Object.keys(ck).filter(k => ck[k]).length;
    const spots = (app.get(app.KEYS.SPOT, []) || []).length;

    const light = TH.get() === "light";
    this.setData({
      stat: { times: logs.length, total: total, max: max.toFixed(2), hours: hours.toFixed(1) },
      gearDone: gearDone, gearTotal: gearTotal, spots: spots,
      themeName: light ? "白天" : "夜间",
      themeIcon: light ? "☀️" : "🌙",
      themeLight: light
    });
  },

  // 切主题：写 storage 后立刻套用（mix 注入的 onShow 只在本页进入时跑，这里要当场生效）
  toggleTheme() {
    const t = TH.toggle();
    TH.applyChrome(t);
    const light = t === "light";
    // tc 是根节点 class（由 theme.mix 注入），必须一起改，否则本页颜色变量不会跟着换
    this.setData({
      tc: light ? "light" : "", themeName: light ? "白天" : "夜间",
      themeIcon: light ? "☀️" : "🌙", themeLight: light
    });
    wx.showToast({ title: light ? "已切到白天模式" : "已切到夜间模式", icon: "none" });
  },

  goStats() { wx.navigateTo({ url: "/pages/stats/index" }); },

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
}));
