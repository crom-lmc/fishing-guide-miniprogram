// 钓点标签词表：分组 + 单选/多选语义
// 之所以用固定词表而不是纯自由输入，是为了让「筛选/展示/海报」三处口径一致；
// 词表覆盖不到的用「其他」组的自定义标签兜底
const FD = require("./../data/fishing-data.js");

// 「常见鱼」词表直接取自鱼种图鉴 FISH（保持两边一致，图鉴更新这里自动跟着变），
// 末尾保留「杂鱼多」作为非图鉴鱼种的兜底标签
const FISH_NAMES = FD.FISH.map(f => f.n).concat(["杂鱼多"]);

const GROUPS = [
  { k: "depth", n: "水深", multi: false, opts: ["浅水", "中等水深", "深水"] },
  { k: "bottom", n: "底质", multi: true, opts: ["泥底", "沙底", "石底", "水草多", "有障碍物"] },
  { k: "fee", n: "收费", multi: false, opts: ["免费", "收费", "按斤结算", "需办卡"] },
  { k: "time", n: "时段", multi: false, opts: ["可夜钓", "仅限白天"] },
  { k: "fac", n: "配套", multi: true, opts: ["停车方便", "有厕所", "有小卖部", "需徒步", "可打窝", "可用饵料"] },
  { k: "fish", n: "常见鱼", multi: true, opts: FISH_NAMES }
];

// 词表全集，用于给自定义标签「去重」：已收录的不重复塞进「其他」
const ALL = (function () {
  const set = Object.create(null);
  GROUPS.forEach(g => g.opts.forEach(o => { set[o] = true; }));
  return set;
})();

// 老数据（没有 tags/photos/note 字段）补齐，避免到处写 `|| []`
function ensure(spot) {
  const s = spot || {};
  return {
    id: s.id,
    name: s.name || "未命名钓点",
    addr: s.addr || "",
    lat: s.lat,
    lng: s.lng,
    tags: Array.isArray(s.tags) ? s.tags : [],
    photos: Array.isArray(s.photos) ? s.photos : [],
    note: s.note || ""
  };
}

// 把一维 tags 还原成「分组 + 该组已选项」，多出来的进「其他」组。
// opts 输出成 {v, on}：WXML 表达式里调 indexOf 不保险，选中态在这里算好
function groupsOf(tags) {
  const list = Array.isArray(tags) ? tags : [];
  const used = Object.create(null);
  const pack = (opts) => opts.map(o => {
    const on = list.indexOf(o) >= 0;
    if (on) used[o] = true;
    return { v: o, on: on };
  });
  const out = GROUPS.map(g => ({
    k: g.k, n: g.n, multi: g.multi, opts: pack(g.opts)
  }));
  const rest = list.filter(t => !used[t]);
  out.push({ k: "other", n: "其他", multi: true, opts: pack(rest) });
  return out;
}

// 点选标签：单选组互斥（同组其它项先清掉），多选组直接开关
function toggle(tags, groupKey, val) {
  const list = (tags || []).slice();
  const g = GROUPS.filter(x => x.k === groupKey)[0] || { k: groupKey, multi: true, opts: [] };
  if (g.multi) {
    const at = list.indexOf(val);
    if (at >= 0) list.splice(at, 1); else list.push(val);
  } else {
    const had = list.indexOf(val) >= 0;
    g.opts.forEach(o => {
      const i = list.indexOf(o);
      if (i >= 0) list.splice(i, 1);
    });
    if (!had) list.push(val);
  }
  return list;
}

// 卡片上只显示前 n 个，避免超长标签把卡片撑爆
function brief(tags, n) {
  return (tags || []).slice(0, n || 4);
}

module.exports = { GROUPS: GROUPS, ALL: ALL, ensure: ensure, groupsOf: groupsOf, toggle: toggle, brief: brief };
