// 数据统计：月度柱状 / 鱼种横条 / 最大单尾折线
// 全部 Canvas 2D 手绘（不引第三方图表库，避免体积与域名问题），配色跟随主题
const app = getApp();
const TH = require("../../utils/theme.js");
const SHR = require("../../utils/share.js");

const PAL = {
  dark: { grid: "#262B38", axis: "#8A93A6", val: "#E6EAF2", bar1: "#7E9BFA", bar2: "#43C4BF", line: "#43C4BF" },
  light: { grid: "#E2E7F0", axis: "#8A93A6", val: "#1B2130", bar1: "#4F74E8", bar2: "#17A29B", line: "#17A29B" }
};

// 坐标轴上限取整到 1/2/5×10^n，避免出现 37 这种刻度
function niceMax(v) {
  if (!v || v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  const s = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return s * p;
}

function ym(d) {
  const p = n => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1);
}

// X 轴月份标签自动抽稀
// 12 个「n月」在手机宽度上必定重叠（单标签约 30px，单格只有 24px 左右），
// 所以按「(标签宽 + 10) / 相邻间距」算步长；起点取 (n-1) % step，
// 让序列末尾正好落在最后一个月——否则抽稀后当月反而没有标签。
function drawXLabels(ctx, rows, xOf, y, W, color, font) {
  const n = rows.length;
  if (!n) return;
  ctx.font = font || "17px sans-serif";
  ctx.fillStyle = color;
  let maxW = 0;
  rows.forEach((r) => { maxW = Math.max(maxW, ctx.measureText(r.label).width); });
  const gap = n > 1 ? Math.abs(xOf(1) - xOf(0)) : W;
  const step = gap > 0 ? Math.max(1, Math.ceil((maxW + 10) / gap)) : 1;
  const start = (n - 1) % step;
  for (let i = start; i < n; i += step) {
    const t = rows[i].label;
    const w = ctx.measureText(t).width;
    // 首尾贴边时改成左右贴边对齐，避免被裁掉半个字
    const x = Math.max(2, Math.min(W - w - 2, xOf(i) - w / 2));
    ctx.fillText(t, x, y);
  }
}

// 柱顶圆角（不用 ctx.roundRect，部分基础库/iOS 版本没有这个方法）
function roundTopBar(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h);
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
  ctx.fill();
}

Page(TH.mix({
  data: {
    empty: true,
    stat: { times: 0, total: 0, max: "0.00", hours: "0.0" },
    months: [], topFish: [], topSpot: [],
    fishH: 200
  },

  onShow() { this.build(); },

  build() {
    const list = app.get(app.KEYS.LOG, []) || [];
    const total = list.reduce((a, r) => a + (+r.count || 0), 0);
    const max = list.reduce((a, r) => Math.max(a, +r.max || 0), 0);
    const hours = list.reduce((a, r) => a + (+r.hours || 0), 0);

    // 近 12 个月
    const now = new Date();
    const months = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ key: ym(d), label: (d.getMonth() + 1) + "月", count: 0, maxw: 0 });
    }
    const idx = Object.create(null);
    months.forEach((m, i) => { idx[m.key] = i; });
    list.forEach((r) => {
      const i = idx[String(r.date || "").slice(0, 7)];
      if (i == null) return;
      months[i].count += (+r.count || 0);
      months[i].maxw = Math.max(months[i].maxw, +r.max || 0);
    });

    // 鱼种 TOP 8
    const byFish = Object.create(null);
    list.forEach((r) => {
      const k = r.fish || "未填鱼种";
      byFish[k] = (byFish[k] || 0) + (+r.count || 0);
    });
    const topFish = Object.keys(byFish)
      .map(k => ({ n: k, c: byFish[k] }))
      .sort((a, b) => b.c - a.c).slice(0, 8);

    // 钓点 TOP 5（按尾数，其次按次数）
    const bySpot = Object.create(null);
    list.forEach((r) => {
      const k = (r.spot || "").trim();
      if (!k) return;
      if (!bySpot[k]) bySpot[k] = { n: k, c: 0, t: 0 };
      bySpot[k].c += (+r.count || 0);
      bySpot[k].t += 1;
    });
    const topSpot = Object.keys(bySpot)
      .map(k => bySpot[k])
      .sort((a, b) => (b.c - a.c) || (b.t - a.t)).slice(0, 5);

    const rowH = 34;
    this.setData({
      empty: list.length === 0,
      stat: {
        times: list.length, total: total,
        max: max.toFixed(2), hours: hours.toFixed(1)
      },
      months: months, topFish: topFish, topSpot: topSpot,
      fishH: Math.max(1, topFish.length) * rowH + 20
    });

    if (!list.length) return;
    const tick = wx.nextTick ? wx.nextTick.bind(wx) : (f) => setTimeout(f, 30);
    tick(() => { this.drawMonth(); this.drawFish(); this.drawMax(); });
  },

  pal() { return TH.get() === "light" ? PAL.light : PAL.dark; },

  // 统一取 canvas 节点并按 dpr 初始化
  ctxOf(id) {
    return new Promise((resolve) => {
      wx.createSelectorQuery().in(this)
        .select("#" + id).fields({ node: true, size: true })
        .exec((res) => {
          const r = (res && res[0]) || null;
          if (!r || !r.node || !r.width || !r.height) return resolve(null);
          const canvas = r.node;
          const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
          const dpr = info.pixelRatio || 2;
          canvas.width = Math.round(r.width * dpr);
          canvas.height = Math.round(r.height * dpr);
          const ctx = canvas.getContext("2d");
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.scale(dpr, dpr);
          ctx.clearRect(0, 0, r.width, r.height);
          resolve({ canvas: canvas, ctx: ctx, W: r.width, H: r.height });
        });
    });
  },

  // 柱状图：近 12 个月渔获尾数
  async drawMonth() {
    const c = await this.ctxOf("cvMonth");
    if (!c) return;
    const { ctx, W, H } = c;
    const P = this.pal();
    const rows = this.data.months;
    const max = niceMax(Math.max.apply(null, rows.map(r => r.count).concat([1])));

    const padL = 30, padB = 30, padT = 18, padR = 8;
    const plotH = H - padB - padT;
    const slot = (W - padL - padR) / rows.length;
    const bw = Math.min(26, slot * 0.62);

    ctx.font = "18px sans-serif";
    ctx.textBaseline = "alphabetic";
    // 网格 + Y 轴刻度
    [0, 0.5, 1].forEach((k) => {
      const y = padT + plotH * (1 - k);
      ctx.strokeStyle = P.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(W - padR, y);
      ctx.stroke();
      ctx.fillStyle = P.axis;
      ctx.fillText(String(Math.round(max * k)), 4, y + 6);
    });

    rows.forEach((r, i) => {
      const h = r.count > 0 ? Math.max(4, plotH * (r.count / max)) : 0;
      const x = padL + slot * i + (slot - bw) / 2;
      const y = padT + plotH - h;
      if (h > 0) {
        const g = ctx.createLinearGradient(0, y, 0, y + h);
        g.addColorStop(0, P.bar1);
        g.addColorStop(1, P.bar2);
        ctx.fillStyle = g;
        roundTopBar(ctx, x, y, bw, h, 4);
        ctx.font = "17px sans-serif";
        const t = String(r.count);
        const tw = ctx.measureText(t).width;
        // 柱子顶到画布上沿时，把数值压到柱身内部，否则会被裁掉
        let ly = y - 8;
        ctx.fillStyle = P.val;
        if (ly < padT + 12) { ly = y + 17; ctx.fillStyle = "#FFFFFF"; }
        ctx.fillText(t, x + (bw - tw) / 2, ly);
      }
    });

    // 标签统一在柱子下方，按可用宽度自动抽稀
    drawXLabels(ctx, rows, i => padL + slot * i + slot / 2, H - 9, W, P.axis);
  },

  // 横向条形：鱼种构成
  async drawFish() {
    const c = await this.ctxOf("cvFish");
    if (!c) return;
    const { ctx, W, H } = c;
    const P = this.pal();
    const rows = this.data.topFish;
    if (!rows.length) return;
    const max = niceMax(rows[0].c || 1);

    const rowH = 34, nameW = 78, valW = 52;
    ctx.textBaseline = "middle";
    rows.forEach((r, i) => {
      const cy = 10 + i * rowH + rowH / 2;
      ctx.fillStyle = P.val;
      ctx.font = "20px sans-serif";
      let nm = r.n;
      while (ctx.measureText(nm).width > nameW - 6 && nm.length > 1) nm = nm.slice(0, -1);
      ctx.fillText(nm, 0, cy);

      const bx = nameW, bw = W - nameW - valW;
      const bh = 16;
      ctx.fillStyle = P.grid;
      ctx.fillRect(bx, cy - bh / 2, bw, bh);

      const fw = Math.max(4, bw * (r.c / max));
      const g = ctx.createLinearGradient(bx, 0, bx + fw, 0);
      g.addColorStop(0, P.bar1);
      g.addColorStop(1, P.bar2);
      ctx.fillStyle = g;
      ctx.fillRect(bx, cy - bh / 2, fw, bh);

      ctx.fillStyle = P.val;
      ctx.font = "19px sans-serif";
      ctx.fillText(r.c + " 尾", W - valW + 4, cy);
    });
  },

  // 折线：最大单尾走势（kg）
  async drawMax() {
    const c = await this.ctxOf("cvMax");
    if (!c) return;
    const { ctx, W, H } = c;
    const P = this.pal();
    const rows = this.data.months;
    const max = niceMax(Math.max.apply(null, rows.map(r => r.maxw).concat([1])));

    const padL = 34, padB = 30, padT = 16, padR = 12;
    const plotH = H - padB - padT;
    const plotW = W - padL - padR;

    ctx.font = "18px sans-serif";
    ctx.textBaseline = "alphabetic";
    [0, 0.5, 1].forEach((k) => {
      const y = padT + plotH * (1 - k);
      ctx.strokeStyle = P.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(W - padR, y);
      ctx.stroke();
      ctx.fillStyle = P.axis;
      ctx.fillText((max * k).toFixed(1), 2, y + 6);
    });

    const X = i => padL + plotW * (i / (rows.length - 1 || 1));
    const Y = v => padT + plotH * (1 - v / max);

    // 面积填充
    ctx.beginPath();
    ctx.moveTo(X(0), Y(rows[0].maxw));
    rows.forEach((r, i) => ctx.lineTo(X(i), Y(r.maxw)));
    ctx.lineTo(X(rows.length - 1), padT + plotH);
    ctx.lineTo(X(0), padT + plotH);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, padT, 0, padT + plotH);
    g.addColorStop(0, P.line);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = g;
    ctx.fill();
    ctx.globalAlpha = 1;

    // 折线
    ctx.beginPath();
    rows.forEach((r, i) => {
      const x = X(i), y = Y(r.maxw);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = P.line;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.stroke();

    // 节点（留白小圆点，非零点更实一点）
    rows.forEach((r, i) => {
      const x = X(i), y = Y(r.maxw);
      ctx.beginPath();
      ctx.arc(x, y, r.maxw > 0 ? 3.6 : 2.2, 0, Math.PI * 2);
      ctx.fillStyle = r.maxw > 0 ? P.line : P.grid;
      ctx.fill();
      if (r.maxw > 0) {
        ctx.beginPath();
        ctx.arc(x, y, 1.4, 0, Math.PI * 2);
        ctx.fillStyle = "#FFFFFF";
        ctx.fill();
      }
    });

    drawXLabels(ctx, rows, X, H - 9, W, P.axis);
  }
,
  // 转发 / 朋友圈：页面里不写 onShareAppMessage，右上角菜单那两项就是灰的
  onShareAppMessage() { return SHR.friend(SHR.titleOf("/pages/stats/index"), "/pages/stats/index"); },
  onShareTimeline() { return SHR.timeline(SHR.titleOf("/pages/stats/index")); }
}));
