// 我的
const app = getApp();
const TH = require("../../utils/theme.js");

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
    themeName: "跟随手机主题", themeIcon: "📱", themeLight: false
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
