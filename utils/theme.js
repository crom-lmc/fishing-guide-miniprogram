// 白天 / 夜间主题切换
// 实现要点：小程序没有给 <page> 加 class 的能力，所以
//   1) 颜色变量统一挂在页面根节点 `.wrap` 上，靠 `.wrap.light` 覆盖（CSS 变量会向下继承）；
//   2) 页面背景、导航栏、底部 tabBar 是框架层，只能分别用 setBackgroundColor / setNavigationBarColor / setTabBarStyle 改。
// 存的是「模式」：auto = 跟随手机主题（默认），light / dark = 手动固定。
// get() 返回的是「实际主题」：auto 模式下解析成当前系统主题，其余原样返回——
// 全项目其他地方只认 get()，不感知模式的存在。
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

// 画布（分享海报 / 战绩卡片）取色：canvas 画的像素同样不认 CSS 变量，
// 不按主题切换的话，白天模式的应用里会插一张纯黑的海报，非常割裂。
const CANVAS = {
  dark: {
    bg1: "#171A23", bg2: "#10131B", glow: "rgba(126,155,250,0.22)",
    card: "rgba(255,255,255,0.05)", line: "rgba(255,255,255,0.06)",
    tx: "#E6EAF2", mu: "#8A93A6", addr: "#9FA9BD",
    note: "#B9C2D0", noteBar: "rgba(126,155,250,0.42)", foot: "#6B7488",
    acc1: "#7E9BFA", acc2: "#43C4BF",
    tagBg: "rgba(67,196,191,0.16)", tagTx: "#4FD3CE",
    hero1: "rgba(126,155,250,0.20)", hero2: "rgba(96,140,214,0.10)", hero3: "rgba(67,196,191,0.16)",
    glowC: "rgba(120,190,190,0.20)", glowC2: "rgba(120,190,190,0.07)",
    ripple: ["rgba(150,180,255,0.13)", "rgba(150,180,255,0.09)", "rgba(150,180,255,0.06)"],
    photoPh: "rgba(255,255,255,0.04)", photoPhLine: "rgba(255,255,255,0.08)", photoPhTx: "#5C6478",
    qrPlate: "#FFFFFF", qrEdge: null, qrPh: "rgba(255,255,255,0.05)",
    // 照片底边渐隐到背景色的 RGB 三通道（渐变停靠点要拼 alpha，只能存分量）
    fade: "16,19,27"
  },
  light: {
    bg1: "#FFFFFF", bg2: "#E9EEF6", glow: "rgba(126,155,250,0.16)",
    card: "rgba(16,24,40,0.045)", line: "rgba(16,24,40,0.08)",
    tx: "#1B2130", mu: "#5A6478", addr: "#5A6478",
    note: "#3C465C", noteBar: "rgba(62,99,224,0.45)", foot: "#8A93A6",
    acc1: "#4C6FE0", acc2: "#0E8C86",
    tagBg: "rgba(14,140,134,0.12)", tagTx: "#0B7A75",
    hero1: "rgba(126,155,250,0.18)", hero2: "rgba(96,140,214,0.09)", hero3: "rgba(67,196,191,0.15)",
    glowC: "rgba(120,190,190,0.16)", glowC2: "rgba(120,190,190,0.06)",
    ripple: ["rgba(76,111,224,0.12)", "rgba(76,111,224,0.08)", "rgba(76,111,224,0.05)"],
    photoPh: "rgba(16,24,40,0.04)", photoPhLine: "rgba(16,24,40,0.10)", photoPhTx: "#8A93A6",
    qrPlate: "#F3F6FB", qrEdge: "#D8E0EC", qrPh: "rgba(16,24,40,0.05)",
    fade: "233,238,246"
  }
};

function getMode() {
  try {
    const v = wx.getStorageSync(KEY);
    if (v === "light" || v === "dark" || v === "auto") return v;
  } catch (e) { /* 忽略 */ }
  return "auto";
}

// 手机当前主题：优先 getAppBaseInfo（轻量），老基础库退回 getSystemInfoSync
function systemTheme() {
  try {
    if (wx.getAppBaseInfo) {
      const i = wx.getAppBaseInfo();
      if (i && i.theme) return i.theme;
    }
  } catch (e) { /* 忽略 */ }
  try {
    const s = wx.getSystemInfoSync();
    if (s && s.theme) return s.theme;
  } catch (e) { /* 忽略 */ }
  return "dark";
}

function get() {
  const m = getMode();
  return m === "auto" ? systemTheme() : m;
}

// 当前主题下「可读」的语义色（画文字、细条用）
function levelTx() { return LEVEL_TX[get()] || LEVEL_TX.dark; }
// 鲜亮语义色（画头像底色、圆点用）
function vivid() { return LEVEL_BG; }
function callout() { return CALLOUT[get()] || CALLOUT.dark; }
// 画布配色：调用时机要在绘制前（主题可能被切换过）
function canvasSkin() { return CANVAS[get()] || CANVAS.dark; }

function set(t) {
  try { wx.setStorageSync(KEY, t === "light" ? "light" : "dark"); } catch (e) { /* 忽略 */ }
}

function setMode(m) {
  if (m !== "auto" && m !== "light" && m !== "dark") m = "auto";
  try { wx.setStorageSync(KEY, m); } catch (e) { /* 忽略 */ }
}

// 手机主题切换时（仅 auto 模式生效）：刷新所有在栈页面的根 class + 框架层颜色。
// 需要 app.json 开 darkmode: true 才能收到回调。
let themeHooked = false;
function hookThemeChange() {
  if (themeHooked) return;
  themeHooked = true;
  if (!wx.onThemeChange) return;
  wx.onThemeChange(function () {
    if (getMode() !== "auto") return;
    const t = get();
    const cls = t === "light" ? "light" : "";
    const pages = getCurrentPages() || [];
    pages.forEach(p => {
      try { if (p && p.setData && p.data && p.data.tc !== cls) p.setData({ tc: cls }); } catch (e) { /* 忽略 */ }
    });
    applyChrome(t);
  });
}
hookThemeChange();

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
  KEY: KEY, get: get, set: set, setMode: setMode, getMode: getMode, systemTheme: systemTheme,
  toggle: toggle, applyChrome: applyChrome, mix: mix,
  levelTx: levelTx, vivid: vivid, callout: callout, canvasSkin: canvasSkin
};
