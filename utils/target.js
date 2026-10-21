// 今日推荐目标鱼：用图鉴里已有的水温 / 季节数据，结合当前气温与季节推算
// 不做任何外部请求，纯本地计算；结果只是「优先钓谁」的建议，不是保证
const D = require("../data/fishing-data.js");

// 从 "5–30℃（最佳 15–25℃）" 里抠出最佳区间；抠不到就退回总区间
function bestRange(tempStr) {
  const s = String(tempStr || "");
  let m = s.match(/最佳\s*([\d.]+)\s*[–\-~]\s*([\d.]+)/);
  if (m) return [parseFloat(m[1]), parseFloat(m[2])];
  m = s.match(/([\d.]+)\s*[–\-~]\s*([\d.]+)/);
  if (m) return [parseFloat(m[1]), parseFloat(m[2])];
  return null;
}

// 一句话时机建议：按水层/习性给，不编造具体参数
function tipOf(fish) {
  const layer = String(fish.layer || "");
  const n = fish.n || "";
  // 先认鱼种再认水层：翘嘴/黑鱼/鳜鱼这类「窗口期路亚」的习性比水层更有指导性，
  // 否则会被它们自身的「中上层」标签抢先匹配成「午前后钓浮」
  if (n.indexOf("白条") >= 0) return "全天可钓，打浮抢接口，腥香饵雾化要快";
  if (n.indexOf("翘嘴") >= 0 || n.indexOf("黑鱼") >= 0 || n.indexOf("鳜鱼") >= 0
    || n.indexOf("鲈鱼") >= 0) return "清晨与傍晚窗口期，路亚搜索结构区";
  if (fish.w === "海水") return "找礁区、防波堤与深浅交界，涨落潮转换时口最好";
  if (layer.indexOf("底层") >= 0) return "早晚钓底，找深浅交界与水草边";
  if (layer.indexOf("中上") >= 0) return "午前后可钓浮，活性随水温升高";
  if (layer.indexOf("中下") >= 0) return "底钓为主，偶尔截口可试离底";
  return "按常规钓法找鱼层";
}

function one(fish, t, seasonName) {
  const r = bestRange(fish.temp);
  let sc = 55;
  let note = "水温参考 " + String(fish.temp || "");
  if (r) {
    const a = r[0], b = r[1];
    if (t >= a && t <= b) {
      sc = 92;
      note = "当前 " + t + "℃ 正落在最佳 " + a + "–" + b + "℃";
    } else {
      const d = t < a ? a - t : t - b;
      // 下限压到 6：否则「差 40℃」的鱼也会被托到 25 分，靠季节加成反超真正耐寒/耐热的对象
      sc = Math.max(6, 92 - d * 7);
      note = "最佳 " + a + "–" + b + "℃，当前差 " + d.toFixed(0) + "℃";
    }
  }
  const se = String(fish.season || "");
  // 季节串是自由文本，罗非鱼写着「夏季最佳，无冬钓」——纯子串匹配会给它加「冬」的加成，
  // 所以命中季节前先排掉「无X / 不X / 忌X / 少X」这类否定写法
  const negSeason = seasonName && new RegExp("[无不难忌少]" + seasonName).test(se);
  if (seasonName && se.indexOf(seasonName) >= 0 && !negSeason) sc += 5;
  if (se.indexOf("全年") >= 0) sc += 2;

  const score = Math.max(0, Math.min(100, Math.round(sc)));
  return {
    id: fish.n,                       // WXML 的 wx:key 需要标量
    first: String(fish.n || "").slice(0, 1),
    score: score,
    // 只给语义等级，具体色值由页面按当前主题取（白底上不能用亮绿/亮黄）
    lv: score >= 85 ? "good" : score >= 65 ? "mid" : score >= 45 ? "warn" : "bad",
    fish: fish,
    note: note,
    tip: tipOf(fish)
  };
}

// t：当前气温（℃）；seasonName：春/夏/秋/冬；wtKey：pages 里的水域类型（海钓要过滤）
function recommend(t, seasonName, wtKey, n) {
  const temp = (typeof t === "number" && isFinite(t)) ? t : null;
  // 海钓只推海鱼，其余只推淡水鱼；图鉴里 w 只有「淡水 / 海水」两种
  const want = wtKey === "sea" ? "海水" : "淡水";
  // minor = 小杂鱼（鳑鲏、麦穗鱼等）：图鉴里要能查到，但不该出现在「今日推荐目标鱼」里
  const pool = D.FISH.filter((f) => f.w === want && !f.minor);
  const list = (pool.length ? pool : D.FISH)
    .map((f) => one(f, temp == null ? 20 : temp, seasonName || ""));
  list.sort((a, b) => b.score - a.score);
  return list.slice(0, n || 3);
}

module.exports = { recommend: recommend, tipOf: tipOf };
