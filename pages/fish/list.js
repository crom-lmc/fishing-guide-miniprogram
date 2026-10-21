// 鱼种图鉴
const D = require("../../data/fishing-data.js");
const TH = require("../../utils/theme.js");
const IM = require("../../utils/img.js");
const CF = require("../../utils/config.js");
const app = getApp();

Page(TH.mix({
  data: {
    cats: ["全部", "淡水", "海水"],
    cat: "全部",
    kw: "",
    list: [],
    fuzzy: false,          // 名称/别名没命中、降级按水层与栖息地搜时的提示标记
    prog: { got: 0, total: 0, pct: 0 }   // 图鉴解锁进度
  },

  onLoad() { this.apply(); },

  // 从日志回来时刷新解锁状态（图鉴页常驻栈底，onShow 比 onLoad 靠谱）
  onShow() { this.apply(); },

  // 统计每种鱼在渔获日志里的捕获次数：解锁 = 次数 >= 1
  // 匹配规则：日志鱼名包含图鉴鱼名即算（「大鲫鱼」「野生鲫鱼」都能命中「鲫鱼」）
  catchStats() {
    const logs = app.get(app.KEYS.LOG, []) || [];
    const m = {};
    logs.forEach(l => {
      const fn = (l.fish || "").trim();
      if (!fn) return;
      D.FISH.forEach(f => {
        if (fn.indexOf(f.n) >= 0) {
          const c = Math.max(1, Math.round(+l.count) || 1);
          m[f.n] = (m[f.n] || 0) + c;
        }
      });
    });
    return m;
  },

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

    // 解锁进度：全量鱼种算一次，与筛选无关
    const stat = this.catchStats();
    const total = D.FISH.length;
    // UNLOCK_ALL 为 true 时按全部解锁显示，否则以日志为准
    const got = CF.UNLOCK_ALL ? total : D.FISH.filter(f => stat[f.n] > 0).length;
    const prog = { got, total, pct: total ? Math.round(got * 100 / total) : 0 };

    const mark = list => list.map(f => Object.assign({}, f, {
      _n: stat[f.n] || 0,                                   // 真实渔获次数，0 次不显示角标
      _locked: CF.UNLOCK_ALL ? false : !(stat[f.n] > 0)
    })).sort((a, b) => (a._locked ? 1 : 0) - (b._locked ? 1 : 0)); // 已解锁排前面

    if (!kw) {
      this.setData({ list: IM.withFishSrc(mark(base)), fuzzy: false, prog });
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

    this.setData({ list: IM.withFishSrc(mark(list)), fuzzy: fuzzy, prog });
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
