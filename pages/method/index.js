// 钓法教学
const D = require("../../data/fishing-data.js");
const H = require("../../utils/html.js");
const TH = require("../../utils/theme.js");

Page(TH.mix({
  data: { list: [] },

  onLoad() {
    // METHODS 正文是 HTML 字符串，转成 rich-text 可用的 nodes
    const list = D.METHODS.map((m, i) => ({
      n: m.n,
      tag: m.tag,
      open: i === 0,
      nodes: H.toNodes(m.body)
    }));
    this.setData({ list: list });
  },

  toggle(e) {
    const i = e.currentTarget.dataset.i;
    const key = "list[" + i + "].open";
    this.setData({ [key]: !this.data.list[i].open });
  }
}));
