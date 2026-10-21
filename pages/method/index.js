// 钓法教学
const D = require("../../data/fishing-data.js");
const H = require("../../utils/html.js");
const TH = require("../../utils/theme.js");

Page(TH.mix({
  data: { list: [], vgroups: [] },

  onLoad() {
    // METHODS 正文是 HTML 字符串，转成 rich-text 可用的 nodes
    const list = D.METHODS.map((m, i) => ({
      n: m.n,
      tag: m.tag,
      open: false,
      nodes: H.toNodes(m.body)
    }));

    // 视频按 cat 分类分组；_i 记录在 RIG_VIDEOS 里的原始下标，跳播放页用
    const vgroups = [];
    D.RIG_VIDEOS.forEach((v, i) => {
      let g = vgroups.find(x => x.cat === v.cat);
      if (!g) { g = { cat: v.cat, items: [] }; vgroups.push(g); }
      g.items.push(Object.assign({}, v, { _i: i }));
    });

    this.setData({ list: list, vgroups: vgroups });
  },

  toggle(e) {
    const i = e.currentTarget.dataset.i;
    const key = "list[" + i + "].open";
    this.setData({ [key]: !this.data.list[i].open });
  },

  // 列表不放原生 video（避免同页多个播放器），跳独立播放页
  playVideo(e) {
    wx.navigateTo({ url: "/pages/rigvideo/index?i=" + e.currentTarget.dataset.i });
  }
}));
