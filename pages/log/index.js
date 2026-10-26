// 渔获日志：数据只存本机（与 Web 版 localStorage 一致）
const app = getApp();
const D = require("../../data/fishing-data.js");
const SHR = require("../../utils/share.js");
const C = require("../../utils/config.js");
const V = require("../../utils/vision.js");
const W = require("../../utils/weather.js");
const PL = require("../../utils/place.js");
const TH = require("../../utils/theme.js");
const FP = require("../../utils/file.js");

// 永久照片路径都落在用户目录下（真机 wxfile://usr/…，开发者工具 http://usr/…）。
// chooseMedia 返回的临时路径只在本次会话有效，下次启动就失效，不能当永久路径用。
function isPersistedPhoto(p) {
  const s = String(p || "");
  return s.indexOf("/usr/") >= 0;
}

function today() {
  const d = new Date();
  const p = n => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

function hhmm(ts) {
  const d = new Date(ts);
  const p = n => String(n).padStart(2, "0");
  return p(d.getHours()) + ":" + p(d.getMinutes());
}

// 坐标兜底文案：地名取不到时至少给个能认位置的东西
function fmtCoord(lat, lng) {
  return Number(lat).toFixed(5) + ", " + Number(lng).toFixed(5);
}

// 毫秒 → 「1 小时 23 分 / 45 分钟」
function fmtElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? h + " 小时 " + m + " 分" : (m || 0) + " 分钟";
}

Page(TH.mix({
  data: {
    fishNames: [],
    form: { date: today(), spot: "", hours: "", fish: "", count: "", max: "", note: "", photo: "", lat: null, lng: null },
    list: [],
    stat: { times: 0, total: 0, max: "0.00", perHour: "0.0", hours: "0.0", top: "—" },
    recMsg: "",
    recognizing: false,
    locating: false,         // 静默定位进行中，防止连点
    tip: null,               // 长按标题弹出的完整地址气泡 { text, style }，null 表示不显示
    timer: { on: false, start: 0, text: "", begin: "", spot: "", weather: "" }
  },

  onLoad() {
    this.setData({ fishNames: D.FISH.map(f => f.n) });
    this.restoreTimer();
  },

  onHide() {
    clearInterval(this._tick);   // 后台不跑计时器，回到页面按时间戳重算，不会走偏
  },
  onUnload() {
    clearInterval(this._tick);
  },

  onShow() {
    // 从出钓指数 / 鱼种详情跳进来时带上预填信息
    const pre = wx.getStorageSync("fish.log.prefill");
    if (pre) {
      const form = Object.assign({}, this.data.form);
      if (pre.fish) form.fish = pre.fish;
      if (pre.weather) form.note = "天气 " + pre.weather + " · " + pre.temp + "℃ · " + pre.pres + " hPa · " + pre.wind;
      this.setData({ form: form });
      wx.removeStorageSync("fish.log.prefill");
    }
    this.refresh();
    // 从别的页面回来（页面没被销毁）时恢复计时刷新
    if (this.data.timer && this.data.timer.on) this.tickTimer();
  },

  refresh() {
    const raw = app.get(app.KEYS.LOG, []) || [];
    // 钓点字段拆解（仅用于渲染，不写回存储）：
    //   _md / _week 短日期与星期；_region / _name 按「 · 」拆行政区与楼名，让楼名当主标题更醒目
    const list = raw.map((r) => {
      const d = (r.date || "").split("-");
      const sp = r.spot || "";
      const idx = sp.indexOf(" · ");
      // 星期：手动拼 Date 避免 UTC 解析把日期往前挪一天（中国时区安全）
      const w = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
      const dt = (d[0] && d[1] && d[2]) ? new Date(+d[0], +d[1] - 1, +d[2]) : null;
      return Object.assign({}, r, {
        _day: d[2] || "",
        _month: d[1] ? d[1] + "月" : "",
        _md: (d[1] && d[2]) ? d[1] + "." + d[2] : (r.date || ""),   // B 右上角短日期：10.22
        _week: dt ? w[dt.getDay()] : "",                              // B 右上角星期：周四
        _region: idx >= 0 ? sp.slice(0, idx) : "",
        _name: idx >= 0 ? sp.slice(idx + 3) : sp,
        // 历史记录里可能存着已失效的临时路径（改版前没做持久化），直接不渲染，
        // 否则 image 加载失败会按默认高度占位，卡片下方出现大片空白
        _photo: isPersistedPhoto(r.photo) ? r.photo : ""
      });
    });
    const total = raw.reduce((a, r) => a + (+r.count || 0), 0);
    const max = list.reduce((a, r) => Math.max(a, +r.max || 0), 0);
    const hours = list.reduce((a, r) => a + (+r.hours || 0), 0);
    const freq = {};
    list.forEach(r => { if (r.fish) freq[r.fish] = (freq[r.fish] || 0) + 1; });
    const top = Object.keys(freq).sort((a, b) => freq[b] - freq[a])[0] || "—";

    this.setData({
      list: list,
      stat: {
        times: list.length,
        total: total,
        max: max.toFixed(2),
        perHour: hours > 0 ? (total / hours).toFixed(1) : "0.0",
        hours: hours.toFixed(1),
        top: top
      }
    });
  },

  input(e) {
    const k = e.currentTarget.dataset.k;
    const d = { ["form." + k]: e.detail.value };
    // 手动改钓点名称后，之前定位存的坐标不再对应，一并清掉，避免记录里名称与坐标错位
    if (k === "spot") {
      d["form.lat"] = null;
      d["form.lng"] = null;
    }
    this.setData(d);
  },

  // 钓点：先静默取当前位置直接填上（不跳页）；静默拿不到再跳微信地图选点
  //   1) 精确：隐藏地图 + moveToLocation + 读中心（GPS 级，与首页同一套）
  //   2) 兜底：getFuzzyLocation（城市级，约 1~3km）
  //   3) 都不行：chooseLocation 跳地图选点（原逻辑）
  pickSpot() {
    if (this.data.locating) return;
    this.setData({ locating: true });
    wx.showLoading({ title: "定位中…", mask: true });

    this.silentLocate()
      // 拿到坐标后先查地名，一次填到位，不出现「当前位置」这种占位词
      .then((r) => this.placeOf(r.lat, r.lng)
        .then((place) => ({ lat: r.lat, lng: r.lng, place: place })))
      .then((x) => {
        wx.hideLoading();
        const label = x.place || fmtCoord(x.lat, x.lng);
        this.setData({
          locating: false,
          "form.lat": x.lat,
          "form.lng": x.lng,
          "form.spot": label
        });
        wx.showToast({
          title: x.place ? "已填入：" + label : "已填入坐标（地名未取到）",
          icon: x.place ? "success" : "none"
        });
      })
      .catch(() => {
        wx.hideLoading();
        this.setData({ locating: false });
        this.pickSpotByMap();             // 静默都不行，才跳地图选点
      });
  },

  // 坐标 → 中文地名（走云函数 weather 的逆地理编码）；失败退回「手动选点缓存」的楼名
  placeOf(lat, lng) {
    return W.fetchAll(lat, lng, "gcj02")
      .then((d) => PL.cleanText((d && d.place) || PL.nearbyName(lat, lng, 300) || ""))
      .catch(() => PL.cleanText(PL.nearbyName(lat, lng, 300) || ""));
  },

  // 静默定位：精确优先，拿不到再退模糊定位（都不弹页）
  silentLocate() {
    return this.preciseByMap().catch(() => this.fuzzyByApi());
  },

  // 精确位置：隐藏地图 moveToLocation 后读中心，全程不跳页；已授权才走，缺授权直接 reject 交给下一级
  preciseByMap() {
    return new Promise((resolve, reject) => {
      const ctx = wx.createMapContext("logMap", this);
      wx.getSetting({
        success: (s) => {
          const st = (s && s.authSetting) || {};
          if (!st["scope.userLocation"]) return reject(new Error("no userLocation auth"));
          ctx.moveToLocation({
            success: () => setTimeout(() => this.readLogCenter(0, null, resolve, reject), 600),
            fail: () => reject(new Error("moveToLocation fail"))
          });
        },
        fail: () => reject(new Error("getSetting fail"))
      });
    });
  },

  // 连续读中心，两次差 <1e-5（≈1m）才认，避免读到定位动画的中间帧
  readLogCenter(round, last, resolve, reject) {
    wx.createMapContext("logMap", this).getCenterLocation({
      success: (c) => {
        const stable = last
          && Math.abs(last.latitude - c.latitude) < 1e-5
          && Math.abs(last.longitude - c.longitude) < 1e-5;
        if (!stable && round < 5) {
          setTimeout(() => this.readLogCenter(round + 1, c, resolve, reject), 250);
          return;
        }
        resolve({ lat: c.latitude, lng: c.longitude });
      },
      fail: () => {
        // 定位动画期间读中心常失败：先用 regionchange 带回的中心，再重试
        if (this._evtCenter) {
          return resolve({ lat: this._evtCenter.latitude, lng: this._evtCenter.longitude });
        }
        if (round < 4) {
          setTimeout(() => this.readLogCenter(round + 1, null, resolve, reject), 300);
          return;
        }
        reject(new Error("getCenterLocation fail"));
      }
    });
  },

  // 兜底：模糊定位（城市级）
  fuzzyByApi() {
    return new Promise((resolve, reject) => {
      wx.getFuzzyLocation({
        type: "gcj02",
        success: (r) => resolve({ lat: r.latitude, lng: r.longitude }),
        fail: reject
      });
    });
  },

  // 隐藏地图视野变化：记下中心，读中心失败时当备胎用
  onGeoRegionChange(e) {
    const d = (e && e.detail) || {};
    if (d.centerLocation) { this._evtCenter = d.centerLocation; return; }
    if (d.type === "end") {
      wx.createMapContext("logMap", this).getCenterLocation({
        success: (c) => { this._evtCenter = c; },
        fail: () => {}
      });
    }
  },

  // 兜底方案：跳微信地图选点（chooseLocation 已于 2026-10-21 审核通过），带回名称 + 坐标
  pickSpotByMap() {
    wx.chooseLocation({
      success: (r) => {
        // 记住这个 POI 名：回到「静默定位」路径时，落在附近就直接复用（OSM 逆地理没有楼名）
        PL.savePicked(r.latitude, r.longitude, r.name || "");
        this.setData({
          "form.spot": r.name || r.address || "已选钓点",
          "form.lat": r.latitude,
          "form.lng": r.longitude
        });
        wx.showToast({ title: "已填入钓点", icon: "success" });
      },
      fail: (e) => {
        const m = (e && e.errMsg) || "";
        // 用户取消选点：不打扰
        if (m.indexOf("cancel") >= 0) return;
        // 用户拒绝了位置授权：引导去设置打开
        if (m.indexOf("auth deny") >= 0 || m.indexOf("authorize") >= 0) {
          wx.showModal({
            title: "需要位置权限",
            content: "选择钓点需要授权位置信息，是否去设置里打开？",
            confirmText: "去设置",
            success: (r) => { if (r.confirm) wx.openSetting(); }
          });
          return;
        }
        wx.showToast({ title: "选点不可用，可直接手动填写", icon: "none" });
      }
    });
  },

  // ---- 出钓计时器：开始记时间与当时天气，结束时自动填进表单 ----
  restoreTimer() {
    const t = app.get(app.KEYS.TIMER, null);
    if (!t || !t.on || !t.start) {
      this.setData({ timer: { on: false, start: 0, text: "", begin: "", spot: "", weather: "" } });
      return;
    }
    this.setData({ timer: t });
    this.tickTimer();
  },

  startTimer() {
    const t = { on: true, start: Date.now(), begin: hhmm(Date.now()), spot: "", weather: "", text: "0 分钟" };
    app.set(app.KEYS.TIMER, t);
    this.setData({ timer: t });
    this.tickTimer();
    wx.showToast({ title: "开始计时，去上鱼吧", icon: "success" });

    // 后台静默补上钓点与天气快照，失败也不影响计时
    this.silentLocate().then((r) => {
      const cur = this.data.timer;
      if (!cur.on) return;                     // 期间已经结束，别再写回去
      cur.lat = r.lat;
      cur.lng = r.lng;
      app.set(app.KEYS.TIMER, cur);
      this.setData({ timer: cur });

      return W.fetchAll(r.lat, r.lng, "gcj02").then((d) => {
        const c = (d.weather && d.weather.current) || {};
        const cur2 = this.data.timer;
        if (!cur2.on) return;
        cur2.weather = [
          "气温 " + Math.round(c.temperature_2m || 0) + "℃",
          "气压 " + Math.round(c.pressure_msl || 0) + " hPa",
          "风速 " + Math.round(c.wind_speed_10m || 0) + " km/h"
        ].join(" · ");
        cur2.spot = d.place || fmtCoord(r.lat, r.lng);
        app.set(app.KEYS.TIMER, cur2);
        this.setData({ timer: cur2 });
      });
    }).catch(() => {});
  },

  tickTimer() {
    clearInterval(this._tick);
    const run = () => {
      const t = this.data.timer;
      if (!t || !t.on) return;
      this.setData({ "timer.text": fmtElapsed(Date.now() - t.start) });
    };
    run();
    // 只在页面显示时跑；onHide 会清掉，回来时按时间戳重算，不会走偏
    this._tick = setInterval(run, 30000);
  },

  stopTimer() {
    const t = this.data.timer;
    if (!t || !t.on) return;
    const elapsed = Date.now() - t.start;
    const hours = Math.max(0.1, Math.round((elapsed / 3600000) * 10) / 10);
    const form = Object.assign({}, this.data.form);
    form.hours = String(hours);
    form.date = today();
    if (t.spot) form.spot = t.spot;
    if (t.lat) { form.lat = t.lat; form.lng = t.lng; }

    const bits = [];
    if (t.weather) bits.push(t.weather);
    if (t.begin) bits.push(t.begin + " 下竿");
    bits.push("作钓 " + fmtElapsed(elapsed));
    const seg = bits.join(" · ");
    form.note = form.note ? (form.note + "；" + seg) : seg;

    clearInterval(this._tick);
    app.remove(app.KEYS.TIMER);
    this.setData({
      form: form,
      timer: { on: false, start: 0, text: "", begin: "", spot: "", weather: "" }
    });
    wx.showToast({ title: "作钓 " + hours + " 小时，补完就能保存", icon: "none" });
  },

  cancelTimer() {
    wx.showModal({
      title: "放弃这次计时？",
      content: "不会生成任何记录。",
      confirmText: "放弃",
      success: (r) => {
        if (!r.confirm) return;
        clearInterval(this._tick);
        app.remove(app.KEYS.TIMER);
        this.setData({ timer: { on: false, start: 0, text: "", begin: "", spot: "", weather: "" } });
      }
    });
  },

  // 生成战绩卡片
  goCard(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: "/pages/card/index?id=" + id });
  },

  // 记录带坐标时，点钓点名称复制高德导航链接（小程序内不能直接跳外部 App）
  // 点「查看导航」：直接拉起微信内置地图，里面就能一键导航。
  // 存的坐标本来就是 GCJ-02（火星坐标），与 openLocation 口径一致，不用换算。
  // 点「查看导航」：弹出路线规划面板（距离 / 预计时长 / 沿途指引），
  // 与钓点地图页、钓点详情页用的是同一个公共组件 components/route-nav
  openAmap(e) {
    const d = e.currentTarget.dataset;
    const lat = +d.lat, lng = +d.lng;
    if (!lat || !lng) return;
    const nav = this.selectComponent("#routeNav");
    if (!nav) return;
    nav.open({ lat: lat, lng: lng, name: d.name || "钓点", addr: d.addr || "" });
  },

  // 长按「查看导航」：复制高德链接，方便发给钓友（点击是开地图，长按才是复制）
  copyNav(e) {
    const d = e.currentTarget.dataset;
    if (!d.lat || !d.lng) return;
    const url = "https://uri.amap.com/marker?position=" + d.lng + "," + d.lat
      + "&name=" + encodeURIComponent(d.name || "钓点");
    wx.setClipboardData({ data: url });
  },

  // 点标签选鱼种：已选中的再点一次 = 取消（输入框同步清空）
  pickFish(e) {
    const v = e.currentTarget.dataset.v;
    this.setData({ "form.fish": this.data.form.fish === v ? "" : v });
  },

  choosePhoto() {
    wx.chooseMedia({
      count: 1, mediaType: ["image"], sourceType: ["camera", "album"],
      success: (r) => {
        // 换照片：只清掉「仍然等于 AI 填入值」的字段，用户手改过的保留（与 Web 版同规则）
        const snap = this.recFilled || {};
        const f = Object.assign({}, this.data.form);
        ["fish", "count", "max"].forEach(k => {
          if (snap[k] && String(f[k]) === String(snap[k])) f[k] = "";
        });
        this.recFilled = null;
        const tmp = r.tempFiles[0].tempFilePath;
        this.setData({ form: f, "form.photo": tmp, recMsg: "" });
        // tempFilePath 只在本次会话有效，必须转存到用户目录，否则下次启动图片就废了：
        // 加载失败的 image 会按默认高度占位，卡片下方就出现大片空白。
        FP.savePhoto(tmp).then((saved) => {
          if (this.data.form.photo === tmp) this.setData({ "form.photo": saved });
        }).catch(() => {
          FP.trim();   // 可能是照片太多占满空间，清理旧的再让用户重试
          this.setData({ recMsg: "照片保存失败，请重选一张" });
        });
      }
    });
  },

  // 照片加载不出来（文件被清、路径失效）时隐藏这张图，别让 image 按默认高度撑出空白
  onPhotoErr(e) {
    const id = e.currentTarget.dataset.id;
    if (id == null) return;
    const list = this.data.list.map((x) =>
      x.id === id ? Object.assign({}, x, { _photo: "" }) : x);
    this.setData({ list: list });
  },

  // 点标题：展开 / 收起完整地址（默认单行省略，长地址会被截断）
  // 长按标题：把完整地址复制到剪贴板
  // 长按标题：在标题下方弹出悬浮气泡显示完整地址（触屏没有 hover，「按住」是最接近的手势）。
  // 气泡位置来自元素的 boundingClientRect，用 position:fixed 定位，
  // 这样不会被 .vd 卡片的 overflow:hidden 裁掉。
  showSpotTip(e) {
    const d = e.currentTarget.dataset;
    const full = d.full;
    if (!full) {
      wx.showToast({ title: "这条没记地址", icon: "none" });
      return;
    }
    const win = (wx.getWindowInfo && wx.getWindowInfo()) || wx.getSystemInfoSync() || {};
    const vw = win.windowWidth || 375, vh = win.windowHeight || 667;
    const maxW = vw - 24;
    const put = (rect) => {
      let style;
      if (rect) {
        // 贴着标题左边缘，但不越出屏幕两侧
        const left = Math.max(12, Math.min(rect.left, vw - 200));
        // 下方放得下就放下面，放不下就翻到标题上方（用 bottom 定位，不用预先知道气泡高度）
        style = (vh - rect.bottom > 160)
          ? "left:" + left + "px;top:" + Math.round(rect.bottom + 8) + "px;max-width:" + maxW + "px;"
          : "left:" + left + "px;bottom:" + Math.round(vh - rect.top + 8) + "px;max-width:" + maxW + "px;";
      } else {
        style = "left:12px;top:200px;max-width:" + maxW + "px;";
      }
      this.setData({ tip: { text: full, style: style } });
    };
    wx.createSelectorQuery().in(this).select("#t" + d.id).boundingClientRect()
      .exec((res) => put(res && res[0]));
  },

  hideTip() { this.setData({ tip: null }); },

  // 气泡里的「复制地址」：catchtap 阻止冒泡，不会顺带把气泡关掉
  copyTip() {
    const t = this.data.tip;
    if (!t || !t.text) return;
    wx.setClipboardData({ data: t.text });
    this.hideTip();
  },

  // 🤖 识别鱼获：自动填鱼种 / 尾数 / 最大单尾
  recFish() {
    if (!this.data.form.photo) {
      wx.showToast({ title: "先拍一张或选一张照片", icon: "none" });
      return;
    }
    if (!C.VISION_ENABLED) {
      this.setData({ recMsg: "识别功能待配置：小程序只能请求备案过的 https 域名，不能直接请求 IP。域名就绪后在 utils/config.js 里打开开关。" });
      return;
    }
    if (this.data.recognizing) return;
    this.setData({ recognizing: true, recMsg: "🤖 识别中…" });

    V.recognize(this.data.form.photo)
      .then((o) => {
        const sp = V.cleanSpecies(o.species);
        const cnt = (o.count != null && !isNaN(+o.count)) ? Math.max(0, Math.round(+o.count)) : 0;
        const wgt = (o.maxWeightKg != null && !isNaN(+o.maxWeightKg)) ? Math.max(0, +o.maxWeightKg) : 0;
        const f = Object.assign({}, this.data.form);
        if (sp) f.fish = sp;
        if (cnt) f.count = String(cnt);
        if (wgt) f.max = wgt.toFixed(2);
        this.recFilled = { fish: sp || null, count: cnt ? String(cnt) : null, max: wgt ? wgt.toFixed(2) : null };
        this.setData({ form: f, recognizing: false, recMsg: V.buildRecMsg(o) });
      })
      .catch((e) => {
        this.setData({ recognizing: false, recMsg: "识别失败：" + ((e && e.message) || "未知错误") });
      });
  },

  submit() {
    const f = this.data.form;
    if (!f.count && !f.max) {
      wx.showToast({ title: "至少填渔获数量或最大单尾", icon: "none" });
      return;
    }
    // updatedAt 供云同步合并时判断哪边更新（老记录没有该字段时按 id 兜底）
    const rec = Object.assign({}, f, { id: Date.now(), updatedAt: Date.now() });
    const list = app.get(app.KEYS.LOG, []) || [];
    list.unshift(rec);
    app.set(app.KEYS.LOG, list);
    this.setData({ form: { date: today(), spot: "", hours: "", fish: "", count: "", max: "", note: "", photo: "", lat: null, lng: null } });
    this.refresh();
    wx.showToast({ title: "已记录", icon: "success" });
  },

  del(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: "删除这条记录？", content: "删除后无法恢复。", confirmColor: "#F87171",
      success: (r) => {
        if (!r.confirm) return;
        const list = app.get(app.KEYS.LOG, []) || [];
        const gone = list.filter(x => x.id === id)[0];
        app.set(app.KEYS.LOG, list.filter(x => x.id !== id));
        if (gone && isPersistedPhoto(gone.photo)) FP.removePhoto(gone.photo);
        this.refresh();
      }
    });
  },

  clearAll() {
    wx.showModal({
      title: "清空所有记录？", content: "将删除全部渔获日志，无法恢复。", confirmColor: "#F87171",
      success: (r) => {
        if (!r.confirm) return;
        app.remove(app.KEYS.LOG);
        this.refresh();
      }
    });
  }
,
  // 转发 / 朋友圈：页面里不写 onShareAppMessage，右上角菜单那两项就是灰的
  onShareAppMessage() { return SHR.friend(SHR.titleOf("/pages/log/index"), "/pages/log/index"); },
  onShareTimeline() { return SHR.timeline(SHR.titleOf("/pages/log/index")); }
}));
