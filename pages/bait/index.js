// 饵料配方
const D = require("../../data/fishing-data.js");
const TH = require("../../utils/theme.js");
const IM = require("../../utils/img.js");

const LABEL = { winter: "冬", spring: "春", summer: "夏", autumn: "秋", all: "通用" };
const KEY = { "春": "spring", "夏": "summer", "秋": "autumn", "冬": "winter", "通用": "all" };
const SEASON_IDX = { spring: 0, summer: 1, autumn: 2, winter: 3 };

function curSeasonKey() {
  const m = new Date().getMonth() + 1;
  return m >= 3 && m <= 5 ? "spring" : m >= 6 && m <= 8 ? "summer" : m >= 9 && m <= 11 ? "autumn" : "winter";
}

Page(TH.mix({
  data: {
    cats: ["全部", "春", "夏", "秋", "冬", "通用"],
    cat: "全部",
    tip: "",
    list: []
  },

  onLoad() {
    // 与 Web 版一致：进页面默认落到当前月份的当季配方
    const auto = LABEL[curSeasonKey()];
    this.setData({ cat: auto });
    this.apply(auto);
  },

  setCat(e) {
    const c = e.currentTarget.dataset.c;
    this.setData({ cat: c });
    this.apply(c);
  },

  // 假饵配图加载失败 → 该条隐藏图片，不留白块
  onLureErr(e) {
    const i = Number(e.currentTarget.dataset.i);
    if (isNaN(i)) return;
    this.setData({ ["lures[" + i + "]._broken"]: true });
  },

  apply(cat) {
    const key = KEY[cat];
    const raw = key ? D.BAITS.filter(r => r.season === key) : D.BAITS.slice();
    // WXML 里不能调函数，标签文案与配色在这里先算好
    const list = raw.map(r => ({
      n: r.n,
      desc: r.desc,
      use: r.use,
      label: LABEL[r.season] || "通用",
      type: r.season === "winter" ? "b" : (r.season === "summer" ? "g" : ""),
      mix: r.mix.map(m => ({ nm: m[0], pc: m[1] }))
    }));
    // 路亚假饵速查：与季节无关，始终全量展示；难度标签配色与配图地址在这算好
    const lures = D.LURES.map(l => ({
      n: l.n, kind: l.kind, layer: l.layer, fish: l.fish, act: l.act, use: l.use,
      lv: l.lv,
      lvType: l.lv.indexOf("首选") >= 0 ? "g" : (l.lv === "进阶" ? "b" : ""),
      _src: IM.fishSrc("images/lure/" + l.key + ".png"),
      _broken: false
    }));
    const month = new Date().getMonth() + 1;
    const tip = (cat !== "全部" && cat === LABEL[curSeasonKey()])
      ? "已按当前月份（" + month + " 月）默认选中「" + cat + "」，点「全部」看所有配方" : "";
    this.setData({ list: list, lures: lures, tip: tip });
  }
}));
