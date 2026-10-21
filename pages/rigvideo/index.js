// 绑线组教学视频 · 播放页
const D = require("../../data/fishing-data.js");
const TH = require("../../utils/theme.js");

Page(TH.mix({
  data: { v: null },

  onLoad(q) {
    const i = parseInt(q.i, 10);
    const v = D.RIG_VIDEOS[i];
    if (!v) {
      wx.showToast({ title: "视频不存在", icon: "none" });
      setTimeout(() => wx.navigateBack(), 1200);
      return;
    }
    wx.setNavigationBarTitle({ title: v.title });
    this.setData({ v: v });
  }
}));
