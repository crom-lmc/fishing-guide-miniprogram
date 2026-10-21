// 出钓指数算法
// 移植自 Web 版 js/score.js，权重 / 评分表 / 硬止损规则与线上一致，改这里等于改两边，注意同步

const WNAME = { sunny: "晴", pcloudy: "多云", cloudy: "阴", drizzle: "小雨/阵雨", rain: "中雨", heavy: "大雨/暴雨", thunder: "雷雨", fog: "雾", snow: "雪" };
const DIRNAME = { ne: "东北风", e: "东风", n: "北风", se: "东南风", s: "南风", nw: "西北风", w: "西风", sw: "西南风", none: "静风" };
const TIMENAME = { dawn: "清晨", am: "上午", noon: "正午", pm: "下午", dusk: "傍晚", night: "夜间" };
const SEASONNAME = ["春", "夏", "秋", "冬"];
const WTYPE = { pond: "池塘/黑坑", lake: "湖泊/水库", river: "河流/河道", wild: "野塘/野水库", sea: "海钓" };

// 加权评分模型：每个因素先转成 0-1 的适宜度，再按权重加权平均
const WEIGHTS = { pres: .22, temp: .18, weather: .16, wind: .14, season: .12, time: .10, dir: .08 };
const RATING = {
  weather: { sunny: .62, pcloudy: .82, cloudy: .70, drizzle: .92, rain: .60, heavy: .18, thunder: 0, fog: .45, snow: .35 },
  wind: { "0": .55, "1": .88, "2": .95, "3": .88, "4": .45, "5": .28, "6": .08 },
  dir: { ne: .82, e: .80, n: .72, none: .62, se: .55, s: .55, w: .45, nw: .42, sw: .28 },
  time: { dawn: .95, dusk: .95, am: .72, night: .68, pm: .62, noon: .22 },
  season: { fresh: [.82, .62, .92, .35], sea: [.60, .80, .88, .50] }
};

const FACTOR_LABEL = { pres: "气压", temp: "气温", weather: "天气", wind: "风力", season: "季节", time: "时段", dir: "风向" };

function tempScoreFor(t) {
  if (t >= 15 && t <= 28) return .95;
  if ((t >= 11 && t < 15) || (t > 28 && t <= 31)) return .72;
  if ((t >= 6 && t < 11) || (t > 31 && t <= 34)) return .42;
  if (t >= 1 && t < 6) return .28;
  return .12;
}

function presScoreFor(p) {
  if (p >= 1022) return .98;
  if (p >= 1013) return .88;
  if (p >= 1005) return .62;
  if (p >= 998) return .32;
  return .10;
}

/**
 * 纯函数：给定一组出钓参数，返回 0-100 的适钓指数
 * @param {object} p {w 天气, t 气温℃, p 气压hPa, wi 风级, dr 风向, tm 时段, se 季节0-3, wt 水域}
 */
function calcScore(p) {
  const r = {
    weather: RATING.weather[p.w],
    temp: tempScoreFor(p.t),
    pres: presScoreFor(p.p),
    wind: RATING.wind[p.wi],
    dir: RATING.dir[p.dr],
    time: RATING.time[p.tm],
    season: RATING.season[p.wt === "sea" ? "sea" : "fresh"][p.se]
  };
  let sum = 0;
  Object.keys(WEIGHTS).forEach(k => { sum += WEIGHTS[k] * r[k]; });
  // 雷雨与 6 级以上大风属于安全问题，直接封顶 22 分
  const hardStop = (p.w === "thunder" || +p.wi >= 6);
  let score = Math.round(sum * 100);
  if (hardStop) score = Math.min(score, 22);
  return { score: score, hardStop: hardStop, r: r };
}

function level(score, hardStop, w) {
  if (hardStop) {
    return {
      lv: "不建议出钓", type: "bad",
      adv: w === "thunder"
        ? "雷雨天气严禁在水边停留，碳素竿举高等于给自己立了个避雷针，请立即收竿避险。"
        : "6 级及以上大风，抛竿困难、水面波浪大，鱼也被压得贴底不吃饵。"
    };
  }
  if (score >= 80) return { lv: "极佳 · 抓紧出钓", type: "good", adv: "各项条件都落在黄金区间，鱼活性高、开口猛。选好钓位、快速打窝，今天很可能爆护。" };
  if (score >= 68) return { lv: "良好 · 值得一去", type: "good", adv: "条件不错，正常发挥应该有稳定收获。把精力放在找准水层与钓位上，别在位置上浪费时间。" };
  if (score >= 55) return { lv: "一般 · 可以一试", type: "warn", adv: "鱼情平平，需要用技巧弥补：延长打窝养窝时间、减小饵团、勤换钓位找鱼，不要死守一个点。" };
  if (score >= 40) return { lv: "较差 · 收获有限", type: "warn", adv: "天气条件对鱼不利，鱼口轻、开口时间短。建议改钓深水、缩短出钓时长，或者干脆改天。" };
  return { lv: "很差 · 建议改期", type: "bad", adv: "多项条件同时不利，鱼基本处于停口状态。与其在岸边吹风，不如在家整理装备、准备饵料。" };
}

// 出钓方案：钓层钓位 / 饵料 / 时段 / 气压 / 风力 / 目标鱼
function plan(o) {
  const depth = {
    pond: ["1.0–1.8m", "钓边钓浅，优先水草边、增氧机附近"],
    lake: ["2–3m（夏） / 1–1.5m（春秋）", "找深浅交界、铧尖、库湾回水处"],
    river: ["1.5–3m", "钓缓流回水湾、桥墩下游、支流交汇口"],
    wild: ["2–4m", "找水下沟坎、倒树、乱石，安静守钓"],
    sea: ["看目标鱼与潮水", "跟潮找流，钓白沫带、礁石边缘、防波堤转角"]
  }[o.wt] || ["—", "—"];

  const baitTip = [
    "低温期主用红虫、蚯蚓等活饵，或浓腥商品饵，饵团要小。",
    "水温适中，腥香兼顾即可，可按当天鱼口做微调。",
    "高温期用清淡本味、藻腥饵，搓大饵减少雾化避开小杂鱼。",
    "初冬与深冬只钓鲫鱼，浓腥 + 红虫，小钩细线，饵团黄豆大小。"
  ][o.se];

  const timeTip = {
    dawn: "清晨是全天第一个觅食高峰，务必在天亮前到位、提前打窝。",
    am: "上午鱼口逐渐减弱，可适当钓深一档、放慢节奏。",
    noon: "正午鱼下潜或上浮，此时应钓深、钓阴凉，或干脆休息养窝。",
    pm: "下午 15 点后鱼口开始转好，是准备迎接傍晚高峰的时段。",
    dusk: "傍晚是全天第二个高峰，天黑前 1–2 小时是黄金窗口，别提前收竿。",
    night: "夜间大鱼靠岸，用腥饵守底、保持安静，别用强光扫水面。"
  }[o.tm] || "";

  const pressureTip = o.p < 1000
    ? "气压偏低，水溶氧不足，鱼大概率浮头、不下底。建议改钓半水或浅水的阴凉处，或改期。"
    : (o.p >= 1015 ? "气压理想，水溶氧充足，鱼的活跃度与开口意愿都处在好状态。" : "气压中等，鱼情一般，靠钓位和饵料来补。");

  const windTip = (+o.wi <= 1)
    ? "风小水面平静，鱼警惕性相对高，抛竿要轻、走动要少。"
    : (+o.wi <= 3 ? "微风正好，迎风岸往往聚鱼，可以尝试钓下风口。" : "风偏大，抛竿与看漂都受影响，建议改用重铅大漂或找背风处。");

  const targets = (o.se === 3)
    ? ["鲫鱼"]
    : (o.se === 1 ? ["草鱼", "鲢鳙", "翘嘴", "黑鱼", "罗非鱼"] : ["鲫鱼", "鲤鱼", "鳊鱼", "翘嘴", "鲈鱼（加州鲈）"]);

  return { depth: depth, baitTip: baitTip, timeTip: timeTip, pressureTip: pressureTip, windTip: windTip, targets: targets };
}

// 按当前时间推断季节与时段（与线上 applySeasonTime 同一套口径）
function curSeasonIndex() {
  const m = new Date().getMonth() + 1;
  return m >= 3 && m <= 5 ? 0 : m >= 6 && m <= 8 ? 1 : m >= 9 && m <= 11 ? 2 : 3;
}
function timeKeyOfHour(h) {
  return h < 8 ? "dawn" : h < 11 ? "am" : h < 14 ? "noon" : h < 17 ? "pm" : h < 20 ? "dusk" : "night";
}
function curTimeKey() {
  return timeKeyOfHour(new Date().getHours());
}
// Open-Meteo 天气编码 → 本站天气键（接入实时天气时用）
function wxCodeToKey(code) {
  if (code === 0 || code === 1) return "sunny";
  if (code === 2) return "pcloudy";
  if (code === 45 || code === 48) return "fog";
  if ([51, 53, 55, 61, 80].indexOf(code) >= 0) return "drizzle";
  if ([63, 81].indexOf(code) >= 0) return "rain";
  if ([65, 82].indexOf(code) >= 0) return "heavy";
  if ([95, 96, 99].indexOf(code) >= 0) return "thunder";
  if ([71, 73, 75, 77, 85, 86].indexOf(code) >= 0) return "snow";
  return "cloudy";
}
function kmhToLevel(kmh) {
  return kmh < 1 ? 0 : kmh < 6 ? 1 : kmh < 12 ? 2 : kmh < 20 ? 3 : kmh < 29 ? 4 : kmh < 39 ? 5 : 6;
}
function degToDirKey(d) {
  const dirs = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];
  return dirs[Math.round(d / 45) % 8];
}

module.exports = {
  WNAME: WNAME, DIRNAME: DIRNAME, TIMENAME: TIMENAME, SEASONNAME: SEASONNAME, WTYPE: WTYPE,
  FACTOR_LABEL: FACTOR_LABEL,
  calcScore: calcScore, level: level, plan: plan,
  curSeasonIndex: curSeasonIndex, curTimeKey: curTimeKey, timeKeyOfHour: timeKeyOfHour,
  wxCodeToKey: wxCodeToKey, kmhToLevel: kmhToLevel, degToDirKey: degToDirKey
};
