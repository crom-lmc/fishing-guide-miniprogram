// 月相：按朔望周期本地计算，不请求任何接口
// 参考点：2000-01-06 18:14 UTC 为新月；朔望月 29.530588853 天
const SYNODIC = 29.530588853;
const REF = Date.UTC(2000, 0, 6, 18, 14) / 86400000;   // 单位：天

function phaseOf(date) {
  const d = date || new Date();
  const days = d.getTime() / 86400000 - REF;
  let age = ((days % SYNODIC) + SYNODIC) % SYNODIC;    // 月龄 0~29.53
  const ratio = age / SYNODIC;

  let name = "新月", emoji = "🌑";
  if (age < 1.5) { name = "新月"; emoji = "🌑"; }
  else if (age < 6) { name = "蛾眉月"; emoji = "🌒"; }
  else if (age < 9) { name = "上弦月"; emoji = "🌓"; }
  else if (age < 13) { name = "盈凸月"; emoji = "🌔"; }
  else if (age < 16) { name = "满月"; emoji = "🌕"; }
  else if (age < 21) { name = "亏凸月"; emoji = "🌖"; }
  else if (age < 24) { name = "下弦月"; emoji = "🌗"; }
  else if (age < 28) { name = "残月"; emoji = "🌘"; }

  return {
    name: name,
    emoji: emoji,
    age: age.toFixed(1),
    ratio: ratio,
    // 夜钓光线：越接近满月越亮（仅为经验提示，不构成因果结论）
    nightLight: ratio > 0.45 && ratio < 0.55 ? "满月前后，夜间水面光线足"
      : ratio < 0.06 || ratio > 0.94 ? "新月前后，夜间几乎无月光"
        : "有一定月光"
  };
}

module.exports = { phaseOf: phaseOf };
