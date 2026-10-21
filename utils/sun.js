// 日出 / 日落 / 黄金窗口：NOAA 简化太阳位置算法，纯本地计算，不请求任何接口
// 精度约 ±1~2 分钟（受地形、海拔、大气折射模型影响），够用来排出钓时段
const RAD = Math.PI / 180;

// 一年中的第几天（1 起）
function dayOfYear(d) {
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d.getTime() - start.getTime()) / 86400000);
}

// 一天中的分钟数
function minsOf(d) { return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60; }

function hhmm(m) {
  let v = Math.round(m) % 1440;
  if (v < 0) v += 1440;
  const h = Math.floor(v / 60), mi = v % 60;
  return (h < 10 ? "0" : "") + h + ":" + (mi < 10 ? "0" : "") + mi;
}

// 时差（单位：分钟）与太阳赤纬（单位：弧度）——都以正午为基准，同一天共用
function solar(d) {
  const g = 2 * Math.PI / 365 * (dayOfYear(d) - 1);
  const eqtime = 229.18 * (0.000075
    + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g)
    - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918
    - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g)
    - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g)
    - 0.002697 * Math.cos(3 * g) + 0.001480 * Math.sin(3 * g);
  return { eqtime: eqtime, decl: decl };
}

// 太阳中心升到指定高度角时的本地分钟数
// deg = 太阳高度角（度）：
//   -0.833° → 日出 / 日落（已含大气折射与日面半径，是通用的标准定义）
//   -6°     → 民用曙光始 / 昏影终（天已亮到能看清浮漂 / 天开始全黑）
// sign = +1 求上午（日出/曙光始），-1 求下午（日落/昏影终）
function at(date, lat, lng, tzOff, deg, sign) {
  const s = solar(date);
  const latR = lat * RAD;
  // 时角：cos(H) = sin(alt) / (cosφ·cosδ) − tanφ·tanδ
  //   注意：NOAA 原式写作 cos(zenith)，zenith = 90° − alt，故 cos(zenith) ≡ sin(alt)
  const c = Math.sin(deg * RAD) / (Math.cos(latR) * Math.cos(s.decl))
    - Math.tan(latR) * Math.tan(s.decl);
  if (c > 1) return null;    // 极昼：太阳整天都在该高度角之上
  if (c < -1) return null;   // 极夜：整天都到不了该高度角
  const ha = Math.acos(c) / RAD;                      // 时角（度）
  const utc = 720 - 4 * (lng + sign * ha) - s.eqtime; // UTC 分钟（东经为正）
  return utc + tzOff * 60;
}

// 主入口：日出 / 日落 / 正午 / 天光，外加黄金窗口与当前所处阶段
function of(date, lat, lng) {
  const d = date || new Date();
  const tzOff = -d.getTimezoneOffset() / 60;

  const rise = at(d, lat, lng, tzOff, -0.833, 1);
  const set = at(d, lat, lng, tzOff, -0.833, -1);
  const dawn = at(d, lat, lng, tzOff, -6, 1);
  const dusk = at(d, lat, lng, tzOff, -6, -1);
  const s = solar(d);
  const noon = 720 - 4 * lng - s.eqtime + tzOff * 60;

  if (rise == null || set == null) {
    // 极圈内（中国不会出现，防御性处理）：给不出日出日落，把状态说清楚
    return { ok: false, tip: "该纬度今日无常规日出日落（极昼/极夜）" };
  }

  const dayMin = set - rise;
  const now = minsOf(d);

  // 黄金窗口：日出前 30 分钟到日出后 2 小时；日落前 2 小时到日落后 30 分钟
  const w1 = [Math.max(0, rise - 30), rise + 120];
  const w2 = [set - 120, Math.min(1440, set + 30)];

  let stage = "夜间";
  if (now >= w1[0] && now <= w1[1]) stage = "清晨窗口";
  else if (now >= w2[0] && now <= w2[1]) stage = "傍晚窗口";
  else if (now > w1[1] && now < w2[0]) stage = "白天";
  else if (dawn != null && now >= dawn && now < rise) stage = "天将亮";
  else if (dusk != null && now > set && now <= dusk) stage = "天将黑";

  // 距离下一个窗口还有多久
  let next = null;
  if (now < w1[0]) next = { nm: "清晨窗口", at: w1[0] };
  else if (now < w2[0]) next = { nm: "傍晚窗口", at: w2[0] };
  else next = { nm: "明日清晨窗口", at: w1[0] };
  const leftMin = Math.round(next.at - now + (next.at < now ? 1440 : 0));
  const leftTxt = leftMin >= 60
    ? Math.floor(leftMin / 60) + " 小时 " + (leftMin % 60) + " 分后"
    : leftMin + " 分钟后";

  return {
    ok: true,
    rise: hhmm(rise), set: hhmm(set),
    dawn: dawn == null ? "" : hhmm(dawn),
    dusk: dusk == null ? "" : hhmm(dusk),
    noon: hhmm(noon),
    dayLen: Math.floor(dayMin / 60) + " 小时 " + Math.round(dayMin % 60) + " 分",
    w1: hhmm(w1[0]) + "–" + hhmm(w1[1]),
    w2: hhmm(w2[0]) + "–" + hhmm(w2[1]),
    stage: stage,
    next: next.nm,
    left: leftTxt,
    // 夜钓参考：天全黑（民用昏影终）的时刻
    darkAt: dusk == null ? "" : hhmm(dusk)
  };
}

module.exports = { of: of };
