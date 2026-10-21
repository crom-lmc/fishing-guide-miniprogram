// 鱼种图鉴
const D = require("../../data/fishing-data.js");
const TH = require("../../utils/theme.js");
const IM = require("../../utils/img.js");

Page(TH.mix({
  data: {
    cats: ["全部", "淡水", "海水"],
    cat: "全部",
    kw: "",
    list: [],
    fuzzy: false          // 名称/别名没命中、降级按水层与栖息地搜时的提示标记
  },

  onLoad() { this.apply(); },

  onSearch(e) {
    this.setData({ kw: e.detail.value });
    this.apply();
  },

  setCat(e) {
    this.setData({ cat: e.currentTarget.dataset.c });
    this.apply();
  },

  apply() {
    const kw = (this.data.kw || "").trim();
    const cat = this.data.cat;
    // 先按水域过滤，后面的搜索只在这个子集里找
    const base = D.FISH.filter(f => cat === "全部" || f.w === cat);

    if (!kw) {
      this.setData({ list: IM.withFishSrc(base), fuzzy: false });
      return;
    }

    // 只按「鱼名 + 别名」检索。以前把 layer / habitat 也拼进去，导致搜「草」时
    // 栖息地写着「水草区」的鲫鱼、黑鱼、鲈鱼全被带出来 —— 用户要的是按鱼找鱼。
    const low = kw.toLowerCase();
    const hitName = f => ((f.n || "") + (f.al || "")).toLowerCase().indexOf(low) >= 0;

    let list = base.filter(hitName);
    let fuzzy = false;

    // 名称/别名一个都没命中时，才降级到水层与栖息地（搜「水草」「乱石」这类习性词才有用）
    if (!list.length) {
      list = base.filter(f => ((f.layer || "") + (f.habitat || "")).toLowerCase().indexOf(low) >= 0);
      fuzzy = list.length > 0;
    }

    this.setData({ list: IM.withFishSrc(list), fuzzy: fuzzy });
  },

  // 远程图加载失败（图没传齐 / 域名没配白名单 / 断网）→ 该条退回首字头像，不留白块
  onImgErr(e) {
    const i = Number(e.currentTarget.dataset.i);
    if (isNaN(i)) return;
    this.setData({ ["list[" + i + "]._broken"]: true });
  },

  open(e) {
    wx.navigateTo({ url: "/pages/fish/detail?n=" + encodeURIComponent(e.currentTarget.dataset.n) });
  }
}));
