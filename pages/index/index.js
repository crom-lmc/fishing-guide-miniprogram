// 出钓指数
const S = require("../../utils/score.js");
const W = require("../../utils/weather.js");
const T = require("../../utils/target.js");
const M = require("../../utils/moon.js");
const SUN = require("../../utils/sun.js");
const TH = require("../../utils/theme.js");
const PL = require("../../utils/place.js");
const SHR = require("../../utils/share.js");
const app = getApp();

const WEATHER = [
  { k: "sunny", n: "晴" }, { k: "pcloudy", n: "多云" }, { k: "cloudy", n: "阴" },
  { k: "drizzle", n: "小雨/阵雨" }, { k: "rain", n: "中雨" }, { k: "heavy", n: "大雨/暴雨" },
  { k: "thunder", n: "雷雨" }, { k: "fog", n: "雾" }, { k: "snow", n: "雪" }
];
const WIND = [
  { k: "0", n: "0 无风" }, { k: "1", n: "1 软风" }, { k: "2", n: "2 轻风" }, { k: "3", n: "3 微风" },
  { k: "4", n: "4 和风" }, { k: "5", n: "5 清风" }, { k: "6", n: "6+ 不宜" }
];
const DIR = [
  { k: "ne", n: "东北" }, { k: "e", n: "东" }, { k: "se", n: "东南" }, { k: "s", n: "南" },
  { k: "sw", n: "西南" }, { k: "w", n: "西" }, { k: "nw", n: "西北" }, { k: "n", n: "北" }, { k: "none", n: "静风" }
];
const TIME = [
  { k: "dawn", n: "清晨" }, { k: "am", n: "上午" }, { k: "noon", n: "正午" },
  { k: "pm", n: "下午" }, { k: "dusk", n: "傍晚" }, { k: "night", n: "夜间" }
];
const SEASON = [{ k: 0, n: "春" }, { k: 1, n: "夏" }, { k: 2, n: "秋" }, { k: 3, n: "冬" }];
const WTYPE = [
  { k: "pond", n: "池塘/黑坑" }, { k: "lake", n: "湖泊/水库" }, { k: "river", n: "河流/河道" },
  { k: "wild", n: "野塘/野水库" }, { k: "sea", n: "海钓" }
];

Page(TH.mix({
  data: {
    weatherOpts: WEATHER, windOpts: WIND, dirOpts: DIR, timeOpts: TIME, seasonOpts: SEASON, wtypeOpts: WTYPE,
    f: { w: "cloudy", t: 22, p: 1012, wi: "2", dr: "none", tm: "am", se: 0, wt: "lake" },
    result: null,
    bars: [],
    condText: "",
    geoMsg: "",
    geoLoading: false,
    // 参数区默认折叠：进页面会自动定位取天气，不需要手动填；只有自动获取失败才展开
    advOpen: false,
    geoReady: false,                // 是否已成功填入实时天气（决定摘要行的标题文案）
    // 结果/时机两块默认也收起，首屏只留分数与结论；点箭头才展开明细
    resOpen: false,
    sunOpen: false,
    condBrief: "",                  // 折叠状态下的一行条件摘要（不含水域，水域单独常显）
    lat: 34.3416, lng: 108.9398,   // 隐藏地图（精确定位用）的初始中心，定位成功后回填真实坐标
    // 逐时适钓（未来 24 小时）
    hourly: null, hTicks: [], hBest: "", hPres: "", hTemp: "", hLegend: [],
    // 今日推荐目标鱼 + 月相 + 日出日落（全是本地计算，不请求接口）
    targets: [], tgWeak: false, moon: null, sun: null,
    // slider 是原生组件，颜色不认 CSS 变量，只能按主题下发
    skin: { a1: "#7E9BFA", a2: "#43C4BF", track: "#2A3040" },
    // 首页底部一行诊断：显示云函数版本 / 数据来源 / 气压口径，便于确认新版本是否真的生效
    wxInfoText: ""
  },

  onLoad() {
    const saved = app.get(app.KEYS.PARAM, null);
    let f = Object.assign({}, this.data.f);
    if (saved && saved.w) {
      f = Object.assign(f, saved);
    } else {
      // 首次进入：季节与时段按当前时间推断（与 Web 版同口径）
      f.se = S.curSeasonIndex();
      f.tm = S.curTimeKey();
    }
    this.applyF(f);
    // 首次进入自动定位取天气：延迟一点，等隐藏的地图组件初始化完
    // （组件未就绪时 preciseLocate 会失败，自动落到 fuzzyLocate，城市级坐标查天气也够用）
    clearTimeout(this._autoTimer);
    this._autoTimer = setTimeout(() => {
      if (!this._weatherAt) this.autoWeather();
    }, 600);
  },

  onUnload() {
    clearTimeout(this._autoTimer);
    clearTimeout(this._geoTimer);
    clearTimeout(this._plTimer);
    clearTimeout(this._geoReadTimer);
  },

  // 折叠区开关：展开后可手动改天气/气温/气压/风力/风向/时段/季节
  toggleAdv() {
    this._userToggled = true;       // 用户手动开过之后，自动结果就不再改动展开状态
    this.setData({ advOpen: !this.data.advOpen });
  },

  // 结果卡：折叠只留分数+评级+一句结论，展开看 7 项因素条
  toggleRes() { this.setData({ resOpen: !this.data.resOpen }); },

  // 今日时机卡：折叠成一行（日出｜日落｜月相），展开看黄金窗口 + 目标鱼
  toggleSun() { this.setData({ sunOpen: !this.data.sunOpen }); },

  // 每次切回首页：时段随时钟刷新（季节只在用户没手动选过时刷新），避免上午打开、下午还停在「上午」
  onShow() {
    // 时段/季节随时钟刷新；日出日落与「当前处于哪个窗口」同样会随时间推进，每次回前台都重算
    const f = Object.assign({}, this.data.f);
    if (!this.manualTime && f.tm !== S.curTimeKey()) { f.tm = S.curTimeKey(); }
    if (!this.manualSeason && f.se !== S.curSeasonIndex()) { f.se = S.curSeasonIndex(); }
    // 无条件重算：时段/季节可能已跨点、主题可能刚在「我的」页切过（因素条/逐时柱/图例
    // 都是 JS 里算好的色值，不会自己跟着 CSS 变量变）、天气也可能在别处刷新过
    this.applyF(f);   // 内部已含 refreshSun()
    // 距上次成功取到天气超过 30 分钟，回前台时静默刷新一次，别让页面停在旧天气上
    if (this._weatherAt && Date.now() - this._weatherAt > 30 * 60 * 1000 && !this.data.geoLoading) {
      this.autoWeather();
    }
  },

  // 条件变更的唯一入口：任何一处改了 f 都必须走这里，改完立刻重算分数。
  // 以前是每个入口各自 setData + compute，分散在 8 处，漏一处就会出现「参数变了分数没跟着变」。
  applyF(patch, extra) {
    const f = Object.assign({}, this.data.f, patch || {});
    this.setData(Object.assign({ f: f }, extra || {}));
    this.compute();
    return f;
  },

  pick(e) {
    const key = e.currentTarget.dataset.k;
    const val = e.currentTarget.dataset.v;
    if (key === "se") this.manualSeason = true;   // 手动选过就不再自动覆盖
    if (key === "tm") this.manualTime = true;
    const p = {};
    p[key] = (key === "se") ? +val : val;
    this.applyF(p);
  },

  // slider 拖动过程中每帧都会回调，全部走 applyF，拖动时分数实时跟着变
  sliderTemp(e) { this.applyF({ t: e.detail.value }); },
  sliderPres(e) { this.applyF({ p: e.detail.value }); },

  compute() {
    const f = this.data.f;
    const res = S.calcScore(f);
    const lv = S.level(res.score, res.hardStop, f.w);
    const pl = S.plan(f);

    // 因素条：与 Web 版顺序一致（气压/气温/天气/风力/季节/时段/风向）
    const LV = TH.levelTx();      // 按当前主题取「可读」语义色，白底上不能用亮绿亮黄
    const order = ["pres", "temp", "weather", "wind", "season", "time", "dir"];
    const bars = order.map(k => {
      const v = res.r[k];
      return {
        nm: S.FACTOR_LABEL[k],
        pct: Math.max(3, Math.round(v * 100)),
        val: Math.round(v * 100),
        color: v >= .75 ? LV.good : (v >= .5 ? LV.warn : LV.bad)
      };
    });

    // condText 用于「出钓方案」卡底部（含水域）；condBrief 是折叠状态下的一行摘要（不含水域，水域单独常显）
    const condText = [
      S.WNAME[f.w], f.t + "℃", f.p + " hPa", f.wi + " 级 " + S.DIRNAME[f.dr],
      S.TIMENAME[f.tm], S.SEASONNAME[f.se] + "季", S.WTYPE[f.wt]
    ].join(" · ");
    const condBrief = [
      S.WNAME[f.w], f.t + "℃", f.p + " hPa", f.wi + " 级 " + S.DIRNAME[f.dr],
      S.TIMENAME[f.tm], S.SEASONNAME[f.se] + "季"
    ].join(" · ");

    // 今日推荐目标鱼：只按当前气温 / 季节 / 水域从图鉴数据算
    const seName = S.SEASONNAME[f.se] || "";
    const tgBg = TH.vivid(), tgTx = TH.levelTx();
    const targets = T.recommend(f.t, seName, f.wt, 3)
      .map(x => Object.assign({}, x, { bg: tgBg[x.lv], color: tgTx[x.lv] }));
    const moon = M.phaseOf(new Date());
    // 极端温度（<-10℃ 或 >40℃）下没有真正的合适对象，提示改期而不是硬推三条低分鱼
    const tgWeak = targets.length > 0 && targets[0].score < 30;
    // slider 的 activeColor / 轨道色只能下发，跟着主题走
    const lightNow = TH.get() === "light";
    const skin = lightNow
      ? { a1: "#4F74E8", a2: "#17A29B", track: "#E2E7F0" }
      : { a1: "#7E9BFA", a2: "#43C4BF", track: "#2A3040" };

    this.setData({
      skin: skin,
      result: {
        score: res.score, hardStop: res.hardStop, lv: lv.lv, type: lv.type, adv: lv.adv, plan: pl,
        // 大号分数/评级文字用语义色，按主题取（白天要压暗，否则白底上发飘）
        tone: lv.type === "good" ? LV.good : (lv.type === "warn" ? LV.warn : LV.bad)
      },
      bars: bars,
      condText: condText,
      condBrief: condBrief,
      targets: targets,
      tgWeak: tgWeak,
      moon: moon
    });
    this.refreshSun();
    app.set(app.KEYS.PARAM, f);
    this.computeHourly();
  },

  // 日出日落 / 黄金窗口：按当前地图中心（定位后即真实坐标）本地推算，随季节与时间变化
  refreshSun() {
    const s = SUN.of(new Date(), this.data.lat, this.data.lng);
    this.setData({ sun: s });
  },

  // 逐时适钓：未来 24 小时（对应 Web 版「逐时适钓 · 未来 24 小时」图表）
  // 只受「季节」「水域」影响，其余每小时取各自的实时/预报值，与顶部滑块无关
  computeHourly() {
    const H = this.hourly;
    if (!H || !H.time || !H.time.length) return;

    const f = this.data.f;
    const p2 = n => String(n).padStart(2, "0");
    const d = new Date();
    const nowKey = d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate())
      + "T" + p2(d.getHours()) + ":00";

    // 从「当前小时」开始取 24 条；Open-Meteo 的 time 是本地时间，直接字符串比即可
    let i0 = H.time.indexOf(nowKey);
    if (i0 < 0) {
      i0 = 0;
      for (let i = 0; i < H.time.length; i++) {
        if (H.time[i] >= nowKey) { i0 = i; break; }
      }
    }
    const n = Math.min(24, H.time.length - i0);
    if (n <= 0) return;

    const rows = [];
    const params = [];
    for (let k = 0; k < n; k++) {
      const i = i0 + k;
      const pres = H.pressure_msl[i];
      const p = {
        w: S.wxCodeToKey(H.weather_code[i]),
        t: Math.round(H.temperature_2m[i]),
        p: Math.round(pres),
        wi: String(S.kmhToLevel(H.wind_speed_10m[i])),
        dr: S.degToDirKey(H.wind_direction_10m[i]),
        tm: S.timeKeyOfHour(+H.time[i].slice(11, 13)),
        se: f.se,
        wt: f.wt
      };
      const res = S.calcScore(p);
      params.push(p);
      const lt = TH.levelTx();
      rows.push({
        hh: H.time[i].slice(11, 16),
        s: res.score,
        pct: Math.max(5, res.score),            // 极低分也留一点高度，否则柱子看不见
        color: res.score >= 75 ? lt.good
          : res.score >= 60 ? lt.mid
            : res.score >= 45 ? lt.warn : lt.bad,
        pres: Math.round(pres * 10) / 10
      });
    }
    this.hourlyParams = params;

    // 时间轴刻度：每 4 小时一个
    const ticks = [];
    for (let k = 0; k < n; k += 4) {
      ticks.push({ hh: rows[k].hh, left: ((k + 0.5) / n * 100).toFixed(2) });
    }

    // 最佳窗口：3 小时滑动平均最高
    let bi = 0, bs = -1;
    for (let k = 0; k + 2 < n; k++) {
      const avg = (rows[k].s + rows[k + 1].s + rows[k + 2].s) / 3;
      if (avg > bs) { bs = avg; bi = k; }
    }
    const hBest = rows[bi].hh + "–" + rows[Math.min(bi + 2, n - 1)].hh + "（均 " + Math.round(bs) + " 分）";

    // 气压摘要：当前值、12h 变化、24h 区间
    const ps = rows.map(r => r.pres);
    const pCur = rows[0].pres;
    const diff = Math.round(rows[Math.min(12, n - 1)].pres - pCur);
    const pmin = Math.min.apply(null, ps);
    const pmax = Math.max.apply(null, ps);
    const trend = diff >= 3 ? "明显回升" : diff >= 1 ? "小幅回升"
      : diff <= -3 ? "明显下降" : diff <= -1 ? "小幅回落" : "基本平稳";
    const hPres = "气压 " + trend + "（12h " + (diff > 0 ? "+" : "") + diff + " hPa，当前 "
      + Math.round(pCur) + " hPa，今日区间 " + Math.round(pmin) + "–" + Math.round(pmax) + "）";

    // 气温区间
    const temps = [];
    for (let k = 0; k < n; k++) temps.push(H.temperature_2m[i0 + k]);
    const hTemp = "气温 今日 " + Math.round(Math.min.apply(null, temps))
      + "–" + Math.round(Math.max.apply(null, temps)) + "℃";

    // 图例色块与柱子同源，避免换了主题之后图例和柱子对不上
    const lt2 = TH.levelTx();
    const hLegend = [
      { c: lt2.good, t: "很好 ≥75" },
      { c: lt2.mid, t: "不错 60-74" },
      { c: lt2.warn, t: "一般 45-59" },
      { c: lt2.bad, t: "差 <45" }
    ];

    this.setData({ hourly: rows, hTicks: ticks, hBest: hBest, hPres: hPres, hTemp: hTemp, hLegend: hLegend },
      () => {
        // 首次显示时节点可能尚未完成布局，延到下一帧再取尺寸，避免拿到 0
        if (wx.nextTick) wx.nextTick(() => this.drawPressureCurve(rows));
        else this.drawPressureCurve(rows);
      });
  },

  // 气压曲线：在柱子上层用 canvas 叠一根折线（右轴，按本段气压区间归一化）
  drawPressureCurve(rows) {
    if (!rows || !rows.length) return;
    wx.createSelectorQuery().in(this)
      .select("#pcurve").fields({ node: true, size: true }).exec((res) => {
        const r = res && res[0];
        if (!r || !r.node) return;
        const canvas = r.node;
        const ctx = canvas.getContext("2d");
        const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
        const dpr = info.pixelRatio || 2;
        const W = r.width, H = r.height;
        if (!W || !H) return;

        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, W, H);

        const ps = rows.map(x => x.pres);
        let pmin = Math.min.apply(null, ps);
        let pmax = Math.max.apply(null, ps);
        if (pmax - pmin < 1) pmax = pmin + 1;   // 气压几乎不变时给个最小跨度，避免曲线贴边

        const pad = H * 0.12;
        const X = i => (i + 0.5) / rows.length * W;
        const Y = v => pad + (1 - (v - pmin) / (pmax - pmin)) * (H - pad * 2);

        // 气压曲线配色：暗色用淡紫，白底上淡紫几乎看不见，换成深一档的紫
        const lineC = TH.get() === "light" ? "rgba(124,92,224,0.95)" : "rgba(199,178,255,0.95)";

        ctx.beginPath();
        rows.forEach((row, i) => {
          const x = X(i), y = Y(row.pres);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = lineC;
        ctx.lineWidth = 2;
        ctx.lineJoin = "round";
        ctx.stroke();

        // 曲线节点小圆点，便于看出每小时气压
        ctx.fillStyle = lineC;
        rows.forEach((row, i) => {
          ctx.beginPath();
          ctx.arc(X(i), Y(row.pres), 1.6, 0, Math.PI * 2);
          ctx.fill();
        });
      });
  },

  // 点柱子把该小时参数回填到上方面板（与 Web 版一致：点柱子回填该小时参数）
  pickHour(e) {
    const i = +e.currentTarget.dataset.i;
    const p = (this.hourlyParams || [])[i];
    if (!p) return;
    // 回填的是某个具体时刻，之后不再让时钟自动覆盖时段/季节
    this.manualSeason = true;
    this.manualTime = true;
    this.applyF(p);
    wx.showToast({ title: "已回填 " + ((this.data.hourly || [])[i] || {}).hh + " 的参数", icon: "none" });
  },

  // 定位结果文案：拿到地名就显示「陕西省西安市未央区」+ 坐标辅助；地名取不到就只显示坐标
  // 明确标出这一坐标是「精确定位」（地图组件中心对齐，几十米级）还是降级后的「模糊定位」（城市级，可差数公里）
  geoText(p, place) {
    // 4 位小数 ≈ 11m，够区分同一片水域的不同岸线；3 位只有百米级，看着像「只定位到区」
    const coord = p.lat.toFixed(4) + "°N, " + p.lng.toFixed(4) + "°E";
    const how = p.fuzzy ? "，模糊定位" : "，精确定位";
    place = PL.cleanText(place);
    if (!place) return coord + how;
    return place + how + " " + coord;
  },

  // 定位：优先精确（地图组件中心对齐），失败才退模糊定位
  locate() {
    return this.preciseLocate().catch(() => this.fuzzyLocate());
  },

  // 精确定位：不用 wx.getLocation（未开通，且与已开通的 getFuzzyLocation 互斥），
  // 改用地图组件的 moveToLocation —— 只依赖 scope.userLocation 授权（与「钓点地图」页同一套，实测可用），
  // 视野对齐真实位置后读组件中心，即 GPS 精度坐标。
  preciseLocate() {
    return new Promise((resolve, reject) => {
      let done = false;
      // settle 后立刻作废回调句柄，防止迟到的 regionchange / getCenterLocation 再动一次状态
      const finish = (fn, arg) => {
        if (done) return;
        done = true;
        clearTimeout(this._plTimer);
        this._geoResolve = null;
        this._geoReject = null;
        fn(arg);
      };
      const ok = (v) => finish(resolve, v);
      const no = (e) => finish(reject, e);

      const ctx = wx.createMapContext("geoMap", this);
      const start = () => {
        // 判断「地图是否真的动了」的基准，必须锁定为【首次进入时的默认中心】，不能取 this.data.lat/lng：
        // 精确定位成功后下面第 461 行会把 data.lat/lng 刷成真实位置，
        // 于是下一次 moveToLocation 到位后，中心与「上一次的位置」完全相同，
        // 会被 readGeoCenter 的 geo:notmoved 防御误判成失败 → 降级 fuzzyLocate；
        // 再下一次基准又变成那个模糊位置，于是「一次精确、一次模糊」严格交替。
        // 基准固定住，这个交替就消失了（地图已在真实位置时，中心 ≠ 默认中心，判定为真的动过）。
        if (!this._defaultCenter) this._defaultCenter = { lat: this.data.lat, lng: this.data.lng };
        this._geoFrom = this._defaultCenter;
        this._lastCenter = null;
        ctx.moveToLocation({
          success: () => {
            this._geoResolve = ok;
            this._geoReject = no;
            clearTimeout(this._geoReadTimer);
            // regionchange end 偶发不触发，兜底 1.2s 后强制读（readGeoCenter 内部还会等稳定）
            this._geoReadTimer = setTimeout(() => this.readGeoCenter(0), 1200);
          },
          fail: (e) => no(e || { errMsg: "moveToLocation:fail" })
        });
      };
      // 6 秒还没结果就放弃精确定位：授权弹窗被忽略、地图组件未就绪、回调不来，
      // 都会让 Promise 一直悬着、页面永远停在「定位中」。超时后交给 fuzzyLocate 兜底。
      this._plTimer = setTimeout(() => no({ errMsg: "geo:timeout" }), 6000);
      // 先确认 scope.userLocation 授权在，否则低版本可能“回调成功但其实没移动”
      wx.getSetting({
        success: (s) => {
          if (s.authSetting["scope.userLocation"]) start();
          else wx.authorize({ scope: "scope.userLocation", success: start, fail: no });
        },
        fail: start
      });
    });
  },

  onGeoRegionChange(e) {
    const d = (e && e.detail) || {};
    if (d.type === "end" && this._geoResolve) {
      clearTimeout(this._geoReadTimer);
      // 移动结束再等一拍，避开动画最后一帧
      this._geoReadTimer = setTimeout(() => this.readGeoCenter(0), 120);
    }
  },

  // 连续读中心，两次结果稳定（≤1m）才认账 —— 避免读到 moveToLocation 动画中间帧导致坐标偏移
  readGeoCenter(round) {
    if (!this._geoResolve) return;
    const r = round || 0;
    wx.createMapContext("geoMap", this).getCenterLocation({
      success: (c) => {
        const prev = this._lastCenter;
        this._lastCenter = { lat: c.latitude, lng: c.longitude };
        const stable = !!prev && Math.abs(prev.lat - c.latitude) < 1e-5 && Math.abs(prev.lng - c.longitude) < 1e-5;
        if (!stable && r < 6) {                    // 还在动：250ms 后再读，最多 6 轮（约 1.5s）
          this._geoReadTimer = setTimeout(() => this.readGeoCenter(r + 1), 250);
          return;
        }
        const resolve = this._geoResolve, reject = this._geoReject;
        this._geoResolve = null;
        this._geoReject = null;
        this._lastCenter = null;
        // 防御：中心与定位前完全一致 = 地图没动（隐藏组件未初始化），拿到的是默认中心，判失败交模糊兜底
        const from = this._geoFrom || { lat: 0, lng: 0 };
        if (Math.abs(c.latitude - from.lat) < 1e-6 && Math.abs(c.longitude - from.lng) < 1e-6) {
          reject({ errMsg: "geo:notmoved" });
          return;
        }
        this.setData({ lat: c.latitude, lng: c.longitude });
        resolve({ lat: c.latitude, lng: c.longitude, fuzzy: false });
      },
      fail: (e) => {
        const reject = this._geoReject;
        this._geoResolve = null;
        this._geoReject = null;
        this._lastCenter = null;
        if (reject) reject(e || { errMsg: "getCenterLocation:fail" });
      }
    });
  },

  // 手动校准位置：微信地图选点（chooseLocation 已开通）。
  // 这是唯一能拿到「楼名级」地名的途径——坐标与名称都来自腾讯地图 POI，
  // 自动定位只能给到 GPS 坐标 + 省市区地名。
  pickLocation() {
    if (this.data.geoLoading) return;
    // 故意不传 latitude / longitude：
    //   传了的话绿钉会落在「上一次算出来的坐标」上，而蓝点是系统 GPS 的真实位置，
    //   两者来源不同（地图定位偏网络/基站，选点页用系统 GPS），就差出几十米，看着像“没在一起”。
    //   不传则默认以当前真实位置为中心，绿钉与蓝点重合，符合“进来就在我这儿”的直觉。
    wx.chooseLocation({
      success: (r) => {
        const lat = r.latitude, lng = r.longitude;
        const place = r.name || r.address || "";
        // 记住这个 POI 名：以后自动定位落在这附近（300m 内）就直接复用，
        // 这样「广联达西安数字建筑研发大厦 / 凯瑞H座」这种楼名不会被 OSM 逆地理带偏
        PL.savePicked(lat, lng, r.name || "");
        const tk = (this._geoToken = (this._geoToken || 0) + 1);
        this.setData({ lat: lat, lng: lng, geoMsg: "已选点，正在获取实时天气…", geoLoading: true });
        this.armWatchdog(tk, 10, "天气获取超时，请稍后重试或直接手动填参数。");
        W.fetchAll(lat, lng, "gcj02").then((res) => {
          if (this._geoToken !== tk) return;
          clearTimeout(this._geoTimer);
          this.hourly = res.weather.hourly || null;
          const f = W.toParams(res.weather.current, this.data.f.se, this.data.f.wt);
          this._weatherAt = Date.now();
          this.applyF(f, {
            lat: lat, lng: lng,
            geoReady: true,
            geoLoading: false,
          geoMsg: "已填入实时天气（" + (place ? place + "，" : "")
            + lat.toFixed(4) + "°N, " + lng.toFixed(4) + "°E）",
          wxInfoText: this.wxInfoTextOf(res)
        });
        }).catch((e) => {
          if (this._geoToken !== tk) return;
          clearTimeout(this._geoTimer);
          const patch = { geoLoading: false, geoMsg: (e && e.message) || "天气获取失败，请稍后重试。" };
          if (!this._userToggled) patch.advOpen = true;
          this.setData(patch);
        });
      },
      fail: (e) => {
        const m = (e && e.errMsg) || "";
        if (m.indexOf("cancel") >= 0) return;
        if (m.indexOf("auth") >= 0 || m.indexOf("authorize") >= 0) {
          wx.showModal({
            title: "需要位置权限",
            content: "地图选点需要授权位置信息，是否去设置里打开？",
            confirmText: "去设置",
            success: (s) => { if (s.confirm) wx.openSetting(); }
          });
          return;
        }
        wx.showToast({ title: "选点不可用，请稍后重试", icon: "none" });
      }
    });
  },

  // 兜底：模糊定位（城市级，偏差可达数公里）；只在精确路径失败（拒授权/组件未就绪）时才用，文案会标注
  fuzzyLocate() {
    return new Promise((resolve, reject) => {
      if (!wx.getFuzzyLocation) {
        reject(new Error("当前微信版本不支持定位，请手动填写。"));
        return;
      }
      // 统一取 gcj02：地图组件中心、chooseLocation 都是 gcj02，坐标体系必须一致，
      // 否则「精确定位」和「地图选点」两条路径的坐标互相偏 400~500m，逆地理编码直接跑偏
      wx.getFuzzyLocation({
        type: "gcj02",
        success: (pos) => resolve({ lat: pos.latitude, lng: pos.longitude, fuzzy: true }),
        fail: reject
      });
    });
  },

  // 自动定位 + 拉实时天气，填入面板（对应 Web 版「自动取当前位置天气」）
  // 定位/取天气的看门狗：真机上出现过授权弹窗被忽略、云函数回调迟迟不来，
  // 页面就一直卡在「定位中…」。到点强制收尾，并作废这次的后续回调（token 自增）。
  armWatchdog(tk, sec, msg) {
    clearTimeout(this._geoTimer);
    this._geoTimer = setTimeout(() => {
      if (this._geoToken !== tk) return;        // 已有新一次调用接管，不用管
      this._geoToken = tk + 1;                  // 作废本次的迟到回调
      const patch = { geoLoading: false, geoMsg: msg };
      if (!this._userToggled) patch.advOpen = true;
      this.setData(patch);
    }, sec * 1000);
  },

  // 首页「📍 刷新」按钮：force=true 跳过 10 分钟缓存，确保部署新云函数后立即拿到新数据
  refresh() { this.autoWeather(true); },

  autoWeather(force) {
    if (this.data.geoLoading) return;
    // getFuzzyLocation 已于 2026-10-21 在公众平台开通；接口与 getLocation 互斥，项目只走模糊定位（查天气精度足够）
    const tk = (this._geoToken = (this._geoToken || 0) + 1);
    this.setData({ geoMsg: "正在定位…", geoLoading: true });
    // 定位最多 6s（preciseLocate 内部会自己超时降级），天气再给 6s，共 12s 兜底
    this.armWatchdog(tk, 12, "定位超时。可点下方「位置不准？地图选点」手动指定，或直接展开参数手动填。");

    this.locate()
      .then((p) => {
        if (this._geoToken !== tk) return null;
        this.setData({ geoMsg: "已定位，正在获取实时天气…" });
        // 一次云函数调用同时拿天气和地名（Open-Meteo/BigDataCloud 均无备案域名，只能走云函数代理）；
        // 地名取不到只影响展示（降级为只显示坐标），不影响天气填入
        return W.fetchAll(p.lat, p.lng, "gcj02", force).then((r) => ({ j: r.weather, p: p, place: r.place, wxInfo: r }));
      })
      .then((r) => {
        if (!r || this._geoToken !== tk) return;
        clearTimeout(this._geoTimer);
        const j = r.j, p = r.p;
        // 手动选过点且当前就在附近 → 用当时那个楼名。腾讯 POI 才有「广联达西安数字建筑研发大厦 /
        // 凯瑞H座」这种楼名；OSM 逆地理在这种写字楼片区只能给到「某某管委会 / 某某产业园」。
        const place = PL.nearbyName(p.lat, p.lng, 300) || r.place;
        // 逐时数据留着画未来 24 小时曲线（列式：time / temperature_2m / pressure_msl / ...）
        this.hourly = j.hourly || null;
        const f = W.toParams(j.current, this.data.f.se, this.data.f.wt);
        this._weatherAt = Date.now();
        const extra = {
          lat: p.lat, lng: p.lng,   // 同步给日出日落计算，卡片随之切到当地
          geoReady: true,
          geoLoading: false,
          // 降级到模糊定位时主动引导校准：城市级坐标取到的天气可能和你在的水库差好几公里
          geoMsg: p.fuzzy
            ? "已填入实时天气（" + this.geoText(p, place) + "），偏差较大，建议点「位置不准？地图选点」校准。"
            : "已填入实时天气（" + this.geoText(p, place) + "），如有偏差可手动修正。"
        };
        // 自动填成功就收起参数区（用户手动展开过则保持展开，不打断操作）
        extra.wxInfoText = this.wxInfoTextOf(r.wxInfo);
        if (!this._userToggled) extra.advOpen = false;
        this.applyF(f, extra);
      })
      .catch((e) => {
        if (this._geoToken !== tk) return;      // 已被看门狗或新一次调用接管
        clearTimeout(this._geoTimer);
        let msg = (e && e.message) || "";
        if (!msg) {
          const em = (e && e.errMsg) || "";
          if (em.indexOf("auth") >= 0 || em.indexOf("deny") >= 0 || em.indexOf("permission") >= 0) {
            msg = "未授权位置权限：右上角「…」→ 设置 → 位置信息，允许后重试。";
          } else if (em.indexOf("timeout") >= 0) {
            msg = "定位超时，没拿到位置。可点「位置不准？地图选点」手动指定。";
          } else {
            msg = "定位或天气接口不可用，请手动填写。";
          }
        }
        const patch = { geoMsg: msg, geoLoading: false };
        // 自动失败 = 参数没填准，必须展开让用户手动选（用户手动开过就不再动它）
        if (!this._userToggled) patch.advOpen = true;
        this.setData(patch);
      });
  },

  reset() {
    this.manualSeason = false;
    this.manualTime = false;
    const f = { w: "cloudy", t: 22, p: 1012, wi: "2", dr: "none", tm: S.curTimeKey(), se: S.curSeasonIndex(), wt: "lake" };
    this.applyF(f, { geoReady: false });   // 重置回默认参数，等下次自动定位才会重新填实时值
  },

  // 把云函数返回的数据源信息拼成一行可读文字，显示在首页底部，方便确认新版本是否真的生效：
  // 例如「腾讯实况 · 气压已换算海平面 · 云函数 v5」。pressure_src=unknown 时说明拿到的仍是旧口径（站压），
  // 一眼就能看出 v5 是否部署成功、气压换算有没有跑起来。
  wxInfoTextOf(info) {
    if (!info) return "";
    const src = info.weather_src === "open-meteo" ? "Open-Meteo" : "腾讯实况";
    const psrc = info.pressure_src === "msl-converted" ? "气压已换算海平面"
      : info.pressure_src === "open-meteo" ? "气压取 Open-Meteo"
      : info.pressure_src === "unknown" ? "气压口径未知(疑似旧版)" : "";
    const v = info.v ? "云函数 v" + info.v : "";
    return [src, psrc, v].filter(Boolean).join(" · ");
  },

  // 把当前条件直接带进渔获日志
  goLog() {
    const f = this.data.f;
    wx.setStorageSync("fish.log.prefill", {
      weather: S.WNAME[f.w], temp: f.t, pres: f.p, wind: f.wi + " 级 " + S.DIRNAME[f.dr]
    });
    wx.navigateTo({ url: "/pages/log/index" });
  },

  goFish() { wx.switchTab({ url: "/pages/fish/list" }); },

  // ===== 分享 =====
  // 「转发给朋友」只认 onShareAppMessage，没定义这个函数菜单项就是灰的；
  // 「分享到朋友圈」在此基础上还要求有 onShareTimeline。二者与备案、认证无关。
  // 标题带上当前分数和等级，朋友点开前就知道今天值不值得跑一趟。
  shareTitle() {
    const r = this.data.result;
    return (r && r.score != null)
      ? "出钓指数 " + r.score + " 分 · " + (r.lv || "")
      : "钓鱼指南 · 今日出钓指数";
  },

  onShareAppMessage() {
    return SHR.friend(this.shareTitle(), "/pages/index/index");
  },

  onShareTimeline() {
    return SHR.timeline(this.shareTitle());
  },

  // 点「今日时机」里的目标鱼 → 直接进图鉴详情
  openFish(e) {
    const n = e.currentTarget.dataset.n;
    if (!n) return;
    wx.navigateTo({ url: "/pages/fish/detail?n=" + encodeURIComponent(n) });
  }
}));
