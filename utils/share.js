// 分享配置统一出口
//
// 右上角「…」菜单里那两项完全由页面生命周期决定，和备案 / 微信认证都无关：
//   1. 页面没定义 onShareAppMessage → 「转发给朋友」直接置灰（官方原话：
//      「只有定义了此事件处理函数，右上角菜单才会显示转发按钮」）
//   2. 「分享到朋友圈」还要求页面同时定义 onShareTimeline，两个缺一个都不给点
//      （open-ability/share-timeline.html：页面需先允许「发送给朋友」，再允许「分享到朋友圈」）
//
// 所以这里做两件事：
//   - 给需要的页面提供统一的标题 / 分享图生成
//   - installShareDefaults() 在 App 启动时给所有页面兜底，避免漏写导致菜单项变灰
const IMG = "/images/share.png";

// 按页面路径给出默认标题；未列出的页面走 fallback
const TITLES = {
  "/pages/index/index": "钓鱼指南 · 今日出钓指数",
  "/pages/fish/list": "鱼种图鉴 · 常见淡水鱼识别与习性",
  "/pages/fish/detail": "鱼种图鉴",
  "/pages/method/index": "钓法教学 · 台钓 / 路亚 / 传统钓",
  "/pages/bait/index": "饵料配方 · 四季用饵思路",
  "/pages/mine/index": "钓鱼指南 · 记录每一次出钓",
  "/pages/map/index": "钓点地图 · 把常去的钓点标在地图上",
  "/pages/nearby/index": "附近水域 · 找找身边能下竿的水",
  "/pages/log/index": "渔获日志 · 记下每次出钓",
  "/pages/stats/index": "出钓统计 · 一年的鱼获趋势",
  "/pages/gear/index": "出钓装备清单",
  "/pages/rules/index": "垂钓法规 · 禁渔期与准用钓具",
  "/pages/spot/index": "钓点详情",
  "/pages/sync/index": "数据同步",
  "/pages/card/index": "渔获战绩卡片",
  "/pages/poster/index": "钓点海报"
};

const FALLBACK = "钓鱼指南 · 从入门到上鱼";

// 分享标题过长会被截断，统一裁到 26 字
function cut(s, n) {
  const str = String(s || "").trim();
  const max = n || 26;
  return str.length > max ? str.slice(0, max - 1) + "…" : str;
}

function titleOf(route) {
  return TITLES[route] || FALLBACK;
}

// 转发给朋友 / 群：可自定义 path（页面路径 + query）
function friend(title, path) {
  const r = { title: cut(title), imageUrl: IMG };
  if (path) r.path = path;
  return r;
}

// 分享到朋友圈：官方不支持自定义页面路径，只能给 query（会附加到当前页面）
function timeline(title, query) {
  const r = { title: cut(title), imageUrl: IMG };
  if (query) r.query = query;
  return r;
}

let installed = false;

// 给所有页面补上缺失的两个回调。
// 单页（页面里自己写了）的以页面为准，这里只填空，不覆盖。
// 例外：canTimeline === false 的页面只补 onShareAppMessage（如纯本地工具页）
function installShareDefaults() {
  if (installed) return;
  if (typeof Page !== "function") return;
  installed = true;

  const raw = typeof Page === "function" ? Page : null;
  if (!raw) return;

  const patched = function (opts) {
    if (opts && typeof opts === "object") {
      const route = "/" + String(opts.__route || "");
      if (typeof opts.onShareAppMessage !== "function") {
        opts.onShareAppMessage = function () {
          return friend(titleOf("/" + String(this.route || "")));
        };
      }
      if (typeof opts.onShareTimeline !== "function" && opts.canTimeline !== false) {
        opts.onShareTimeline = function () {
          return timeline(titleOf("/" + String(this.route || "")));
        };
      }
    }
    return raw(opts);
  };

  // 继承 Page 上可能存在的静态属性（防御性，正常用不到）
  try {
    Object.keys(raw).forEach(function (k) { patched[k] = raw[k]; });
  } catch (e) {}

  // 非严格模式下这是改写全局 Page；若运行环境是严格模式会抛错，
  // 这里吞掉异常——主要页面都已显式写了回调，兜底失效不影响它们。
  try { Page = patched; } catch (e) { /* 降级：只保留显式实现 */ }
}

module.exports = { friend: friend, timeline: timeline, titleOf: titleOf, installShareDefaults: installShareDefaults, IMG: IMG };
