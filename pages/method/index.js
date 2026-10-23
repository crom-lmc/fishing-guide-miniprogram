// 钓法教学
const D = require("../../data/fishing-data.js");
const SHR = require("../../utils/share.js");
const H = require("../../utils/html.js");
const TH = require("../../utils/theme.js");

// 默认外部链接：按标题生成 B站搜索链接（中性入口，不指向具体版权视频）。
// 若某条在 RIG_VIDEOS 里写了 url 字段，则优先使用（放已获授权的具体地址）。
function videoUrl(v) {
  return v.url || ("https://search.bilibili.com/all?keyword=" + encodeURIComponent(v.title));
}

Page(TH.mix({
  data: { list: [], vgroups: [], guide: { show: false, url: "", title: "" } },

  onLoad() {
    // METHODS 正文是 HTML 字符串，转成 rich-text 可用的 nodes
    const list = D.METHODS.map((m, i) => ({
      n: m.n,
      tag: m.tag,
      open: false,
      nodes: H.toNodes(m.body)
    }));

    // 视频按 cat 分类分组；「放链接」形式：每条附一个外部链接（默认 B站搜索）
    const vgroups = [];
    D.RIG_VIDEOS.forEach((v, i) => {
      let g = vgroups.find(x => x.cat === v.cat);
      if (!g) { g = { cat: v.cat, items: [] }; vgroups.push(g); }
      g.items.push(Object.assign({}, v, { _i: i, url: videoUrl(v) }));
    });

    this.setData({ list: list, vgroups: vgroups });
  },

  toggle(e) {
    const i = e.currentTarget.dataset.i;
    const key = "list[" + i + "].open";
    this.setData({ [key]: !this.data.list[i].open });
  },

  // 「放链接 + 引导」形式：点击弹出引导浮层，明确指引用户去浏览器打开
  openGuide(e) {
    const url = e.currentTarget.dataset.url;
    const title = e.currentTarget.dataset.title;
    if (!url) {
      wx.showToast({ title: "该教程链接待补充", icon: "none" });
      return;
    }
    this.setData({ guide: { show: true, url: url, title: title } });
  },

  // 浮层内点击「复制链接」：写入剪贴板并提示去浏览器粘贴
  copyFromGuide() {
    const url = this.data.guide.url;
    wx.setClipboardData({
      data: url,
      success: () => {
        wx.showToast({ title: "已复制，去浏览器粘贴", icon: "none" });
        this.setData({ "guide.show": false });
      },
      fail: () => wx.showToast({ title: "复制失败，请手动记录", icon: "none" })
    });
  },

  // 关闭引导浮层（点遮罩或取消）
  closeGuide() {
    this.setData({ "guide.show": false });
  },

  // 拦截卡片区域的点击冒泡，避免误关浮层
  stop() {}
,
  // 转发 / 朋友圈：页面里不写 onShareAppMessage，右上角菜单那两项就是灰的
  onShareAppMessage() { return SHR.friend(SHR.titleOf("/pages/method/index"), "/pages/method/index"); },
  onShareTimeline() { return SHR.timeline(SHR.titleOf("/pages/method/index")); }
}));
