// 白天 / 夜间主题切换
// 实现要点：小程序没有给 <page> 加 class 的能力，所以
//   1) 颜色变量统一挂在页面根节点 `.wrap` 上，靠 `.wrap.light` 覆盖（CSS 变量会向下继承）；
//   2) 页面背景、导航栏、底部 tabBar 是框架层，只能分别用 setBackgroundColor / setNavigationBarColor / setTabBarStyle 改。
const KEY = "fish.theme.v1";

const SKIN = {
  dark: {
    navBg: "#12141C", navFront: "#ffffff",
    bg: "#12141C",
    // tabBar 的选中图标是 PNG（一个色值走两个主题），所以文字选中色跟图标统一用 #17A29B
    tabColor: "#8A93A6", tabSel: "#17A29B", tabBg: "#171A23", tabBorder: "black"
  },
  light: {
    navBg: "#FFFFFF", navFront: "#000000",
    bg: "#F4F6FA",
    tabColor: "#8A93A6", tabSel: "#17A29B", tabBg: "#FFFFFF", tabBorder: "white"
  }
};

// 语义色（用于分数、因素条、目标鱼这类「数据着色」）
// 白天模式必须把饱和度压下来：#34D399 / #FBBF24 这种亮色放在白底上几乎看不清
const LEVEL_TX = {
  dark: { good: "#34D399", mid: "#43C4BF", warn: "#FBBF24", bad: "#F87171" },
  light: { good: "#0B8A66", mid: "#0E8C86", warn: "#9A6200", bad: "#C0392B" }
};
// 色块底（头像、圆点）两个主题都用鲜亮版：底色深一点、上面压深色字，反而更醒目
const LEVEL_BG = { good: "#34D399", mid: "#43C4BF", warn: "#FBBF24", bad: "#F87171" };

// 地图 marker 的 callout 是原生层，不认 CSS 变量，只能按主题取色
const CALLOUT = {
  dark: { color: "#E6EAF2", bgColor: "#171A23" },
  light: { color: "#1B2130", bgColor: "#FFFFFF" }
};

function get() {
  try { return wx.getStorageSync(KEY) === "light" ? "light" : "dark"; } catch (e) { return "dark"; }
}

// 当前主题下「可读」的语义色（画文字、细条用）
function levelTx() { return LEVEL_TX[get()] || LEVEL_TX.dark; }
// 鲜亮语义色（画头像底色、圆点用）
function vivid() { return LEVEL_BG; }
function callout() { return CALLOUT[get()] || CALLOUT.dark; }

function set(t) {
  try { wx.setStorageSync(KEY, t === "light" ? "light" : "dark"); } catch (e) { /* 忽略 */ }
}

function toggle() {
  const t = get() === "light" ? "dark" : "light";
  set(t);
  return t;
}

// 框架层的三处颜色：窗口背景 / 导航栏 / tabBar
function applyChrome(t) {
  const s = SKIN[t] || SKIN.dark;
  try {
    wx.setNavigationBarColor({
      frontColor: s.navFront, backgroundColor: s.navBg,
      animation: { duration: 150, timingFunc: "easeIn" }
    });
  } catch (e) { /* 部分页面无导航栏，忽略 */ }
  try {
    wx.setBackgroundColor({ backgroundColor: s.bg, backgroundColorTop: s.bg, backgroundColorBottom: s.bg });
  } catch (e) { /* 忽略 */ }
  try {
    wx.setTabBarStyle({
      color: s.tabColor, selectedColor: s.tabSel,
      backgroundColor: s.tabBg, borderStyle: s.tabBorder
    });
  } catch (e) { /* 非 tabBar 页面会抛错，忽略 */ }
}

// 包装 Page 配置：自动注入 tc（根节点 class 用）并在 onLoad / onShow 时同步主题
// 用法：Page(T.mix({ ... }))；WXML 根节点写 class="wrap {{tc}}"
function mix(opt) {
  const oldLoad = opt.onLoad;
  const oldShow = opt.onShow;

  opt.data = Object.assign({ tc: "" }, opt.data || {});

  const sync = function () {
    const t = get();
    const cls = t === "light" ? "light" : "";
    if (this.data.tc !== cls) this.setData({ tc: cls });
    applyChrome(t);
  };

  opt.onLoad = function (q) {
    sync.call(this);
    if (oldLoad) return oldLoad.call(this, q);
  };
  opt.onShow = function () {
    sync.call(this);
    if (oldShow) return oldShow.call(this);
  };
  return opt;
}

module.exports = {
  KEY: KEY, get: get, set: set, toggle: toggle, applyChrome: applyChrome, mix: mix,
  levelTx: levelTx, vivid: vivid, callout: callout
};
