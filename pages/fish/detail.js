// 鱼种详情
const D = require("../../data/fishing-data.js");
const TH = require("../../utils/theme.js");
const IM = require("../../utils/img.js");
const SHR = require("../../utils/share.js");

Page(TH.mix({
  data: { f: null, src: "", imgErr: false },

  onLoad(q) {
    const name = decodeURIComponent(q.n || "");
    const f = D.FISH.find(x => x.n === name);
    if (!f) {
      wx.showToast({ title: "未找到该鱼种", icon: "none" });
      return;
    }
    wx.setNavigationBarTitle({ title: f.n });
    this.setData({ f: f, src: IM.fishSrc(f.img), imgErr: false });
  },

  // 大图加载失败 → 隐藏通栏图，退回原来的彩色首字头像
  onImgErr() { this.setData({ imgErr: true }); },

  // 带着鱼种直接去记一笔
  goLog() {
    wx.setStorageSync("fish.log.prefill", { fish: this.data.f.n });
    wx.navigateTo({ url: "/pages/log/index" });
  },

  goBait() { wx.switchTab({ url: "/pages/bait/index" }); },

  // 分享这条鱼种：path / query 都要带 n，否则对方打开是空页
  onShareAppMessage() {
    const f = this.data.f || {};
    return SHR.friend(f.n ? f.n + " · 习性 / 钓法 / 用饵" : "鱼种图鉴 · 常见淡水鱼识别与习性",
      "/pages/fish/detail?n=" + encodeURIComponent(f.n || ""));
  },

  onShareTimeline() {
    const f = this.data.f || {};
    return SHR.timeline(f.n ? f.n + " · 习性 / 钓法 / 用饵" : "鱼种图鉴 · 常见淡水鱼识别与习性",
      f.n ? "n=" + encodeURIComponent(f.n) : "");
  }
}));
