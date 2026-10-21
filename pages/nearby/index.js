// 附近水域 / 钓点：按半径查附近的河流、水库、湖泊与钓场，按直线距离排序
const TH = require("../../utils/theme.js");
// 定位：用页面上的地图组件（moveToLocation → 连续读中心），精度即 GPS，无需 getLocation 接口
// 数据：走云函数 weather 的 nearby 分支（腾讯位置服务 key 优先；免 key 时退 OpenStreetMap）
const app = getApp();

const RADIUS = [
  { v: 1000, n: "1 km" },
  { v: 3000, n: "3 km" },
  { v: 8000, n: "8 km" },
  { v: 20000, n: "20 km" }
];

function fmtDist(m) {
  if (m == null) return "";
  return m < 1000 ? Math.round(m) + " m" : (m / 1000).toFixed(1) + " km";
}

// 两点直线距离（米）
function dist(a, b, c, d) {
  const R = 6371000, p = Math.PI / 180;
  const x = (c - a) * p, y = (d - b) * p;
  const h = Math.sin(x / 2) * Math.sin(x / 2)
    + Math.cos(a * p) * Math.cos(c * p) * Math.sin(y / 2) * Math.sin(y / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

Page(TH.mix({
  data: {
    lat: 34.3416, lng: 108.9398,     // 西安默认中心，定位成功后回填
    geoMsg: "",
    locating: false,
    located: false,                   // 是否已拿到真实坐标（决定提示文案）
    radius: 8000,
    radiusOpts: RADIUS,
    markers: [],
    list: [], loading: false, msg: "",
    source: "",
    ver: 0,          // 云函数返回的版本号（v2 才有 nearby 分支）
    cost: 0,         // 本次查询耗时（秒，一位小数），用于判断要不要调大超时
    picked: null     // 微信地图搜索选中的地点（不依赖云函数的那条路）
  },

  onLoad() {
    this._last = null;
  },

  onReady() {
    // 地图组件真正初始化后才响应 moveToLocation，留 300ms 余量
    setTimeout(() => this.locate(true), 300);
  },

  onShow() {
    // 从别的页面返回时保持用户当前拖动的位置，不重复定位；
    // 但要重刷一次气泡配色——marker 的 callout 是原生层，不跟 CSS 变量走
    if (this.data.list && this.data.list.length) this.syncMarkers();
  },

  // 手动定位按钮
  onLocateTap() {
    this.locate(false);
  },

  // 精确定位：moveToLocation 把地图中心移到 GPS 真实位置，再连续读中心点
  // 全程不做模糊定位（getFuzzyLocation 会把坐标打到城市级，精度只有几公里）
  locate(auto) {
    if (this.data.locating) return;
    this._last = null;
    this._from = null;
    this._evtCenter = null;   // 丢掉上一轮拖动留下的中心，免得误判「没动」
    this.setData({
      locating: true,
      geoMsg: auto ? "正在精确定位…" : "正在重新定位…"
    });

    const ctx = wx.createMapContext("nearMap", this);
    // 兜底：8 秒还没结果就把状态说清楚，避免一直转「定位中」
    clearTimeout(this._wd);
    this._wd = setTimeout(() => {
      if (this.data.locating) {
        this.setData({
          locating: false,
          geoMsg: "定位超时。请点「重新定位」，或直接把地图拖到你现在的位置再查询"
        });
      }
    }, 8000);

    const fail = (why) => {
      clearTimeout(this._wd);
      this.setData({
        locating: false,
        geoMsg: (why || "定位不可用") + "。可拖动地图到目标位置，或点「重新定位」"
      });
    };

    const move = () => {
      // 先记下移动前的中心，用于判断「地图到底动没动」
      ctx.getCenterLocation({
        success: (c) => { this._from = c; },
        fail: () => { this._from = null; },
        complete: () => {
          try {
            ctx.moveToLocation({
              success: () => setTimeout(() => this.readCenter(0), 600),
              fail: () => fail("定位失败，可能未获得位置授权")
            });
          } catch (e) {
            fail("定位调用失败");
          }
        }
      });
    };

    wx.getSetting({
      success: (s) => {
        const st = (s && s.authSetting) || {};
        if (st["scope.userLocation"]) return move();
        wx.authorize({
          scope: "scope.userLocation",
          success: move,
          fail: () => fail("未获得位置授权")
        });
      },
      fail: move
    });
  },

  // 统一收口：拿到中心坐标后落库 + 更新提示 + （首次）自动查询
  // src = "locate"（定位触发）/ "drag"（用户拖地图）
  applyCenter(c, src) {
    if (!c || c.latitude == null) return;
    clearTimeout(this._wd);
    this._last = null;

    const f = this._from;
    const notMoved = src === "locate" && !!f
      && Math.abs(f.latitude - c.latitude) < 1e-6
      && Math.abs(f.longitude - c.longitude) < 1e-6;
    const where = c.latitude.toFixed(5) + "°N, " + c.longitude.toFixed(5) + "°E";

    this.setData({
      locating: false,
      located: true,
      lat: c.latitude,
      lng: c.longitude,
      geoMsg: src === "locate"
        ? (notMoved ? "定位未生效（地图中心没变），可拖动地图或点「重新定位」" : "已精确定位 · " + where)
        : "查询中心 " + where + "（点「重新定位」回到我的位置）"
    });

    // 首次定位成功后自动查一次附近水域，省一次点击
    if (src === "locate" && !this._autoQueried) {
      this._autoQueried = true;
      this.search();
    }
  },

  // 连续读中心，两次差 <1e-5（≈1m）才认，避免读到定位动画的中间帧
  readCenter(round) {
    const n = round || 0;
    wx.createMapContext("nearMap", this).getCenterLocation({
      success: (c) => {
        const prev = this._last;
        this._last = c;
        const stable = !!prev
          && Math.abs(prev.latitude - c.latitude) < 1e-5
          && Math.abs(prev.longitude - c.longitude) < 1e-5;
        if (!stable && n < 5) {
          setTimeout(() => this.readCenter(n + 1), 250);
          return;
        }
        this.applyCenter(c, "locate");
      },
      fail: () => {
        // 定位动画期间 getCenterLocation 常会失败；regionchange 若带回 centerLocation 就直接用
        if (this._evtCenter) return this.applyCenter(this._evtCenter, "locate");
        if (n < 4) return setTimeout(() => this.readCenter(n + 1), 300);
        clearTimeout(this._wd);
        this.setData({
          locating: false,
          geoMsg: "地图已移到定位位置，但没取到中心坐标。手动拖动一下地图就能继续查询。"
        });
      }
    });
  },

  // 地图视野变化：end 时把中心当作查询中心；detail.centerLocation 能省一次 API 调用
  onRegionChange(e) {
    const d = (e && e.detail) || {};
    if (d.centerLocation) this._evtCenter = d.centerLocation;
    if (d.type !== "end") return;
    // 定位过程中地图自己移动，算 locate；用户手动拖动算 drag
    const src = this.data.locating ? "locate" : "drag";
    if (d.centerLocation) return this.applyCenter(d.centerLocation, src);
    wx.createMapContext("nearMap", this).getCenterLocation({
      success: (c) => this.applyCenter(c, src),
      fail: () => {}
    });
  },

  pickRadius(e) {
    const v = +e.currentTarget.dataset.v;
    if (v === this.data.radius) return;
    this.setData({ radius: v });
    // 已经查过结果时，按新半径自动重查
    if (this.data.list.length) this.search();
  },

  searchWater() { this.search(); },

  search() {
    if (this.data.loading) return;
    this.setData({ loading: true, msg: "" });

    const t0 = Date.now();
    wx.cloud.callFunction({
      name: "weather",
      data: { action: "nearby", mode: "water", lat: this.data.lat, lng: this.data.lng, radius: this.data.radius },
      success: (r) => {
        const d = (r && r.result) || {};
        const out = {};
        out.loading = false;
        out.ver = d.v || 1;
        out.cost = +(((Date.now() - t0) / 1000).toFixed(1));

        if (!d.ok) {
          out.msg = d.msg || "查询失败，请稍后重试";
          this.setData(out);
          return;
        }
        // 旧版云函数（没有 nearby 分支）会把它当天气请求处理：ok 为真但根本没有 list
        if (!Array.isArray(d.list)) {
          out.msg = "云函数 weather 还是旧版本（缺 nearby 分支）。右键 cloudfunctions/weather → 上传并部署；部署成功后本行会变成列表，页面底部显示「云函数 v2」。";
          this.setData(out);
          return;
        }

        const list = d.list.map((x, i) => ({
          key: "w" + i,
          name: x.name || "未命名",
          type: x.type || "水域",
          lat: x.lat, lng: x.lng,
          dist: x.dist,
          distText: fmtDist(x.dist),
          seg: x.seg || 1
        }));
        out.list = list;
        if (list.length) {
          out.msg = "";
        } else if (d.source === "osm") {
          out.msg = "该半径内没查到水域。当前用 OpenStreetMap 免 key 数据源，城区密集处覆盖一般，换大一点的半径通常就有了；或直接用下面的「微信地图搜索」。";
        } else {
          out.msg = "该半径内没找到水域，换个大点的半径试试";
        }
        out.source = d.source || "";
        this.setData(out);
        this.syncMarkers();
      },
      fail: (e) => {
        const out = {};
        out.loading = false;
        out.cost = +(((Date.now() - t0) / 1000).toFixed(1));
        const m = (e && e.errMsg) || "";
        if (/not (exist|found)|找不到|未找到|-404011/.test(m)) {
          out.msg = "云函数 weather 未部署：请在开发者工具右键 cloudfunctions/weather → 上传并部署";
        } else if (/timeout|超时|timed out/i.test(m)) {
          out.msg = "云函数超时（附近检索要查外部地图数据，默认 3 秒不够）。请在云开发控制台 → 云函数 → weather → 配置 → 超时时间改成 20 秒，再试一次；或先用 8 km 以内半径。";
        } else {
          out.msg = "云函数调用失败：" + m;
        }
        this.setData(out);
      }
    });
  },

  // 结果同步到地图标记
  syncMarkers() {
    const co = TH.callout();
    const ms = this.data.list.map((x, i) => ({
      id: i, latitude: x.lat, longitude: x.lng, width: 20, height: 20,
      callout: {
        content: x.name + (x.distText ? " · " + x.distText : ""),
        color: co.color, bgColor: co.bgColor, padding: 5, borderRadius: 6, display: "BYCLICK"
      }
    }));
    this.setData({ markers: ms });
  },

  // ==== 不依赖云函数的兜底路径：借微信地图选点页自带的搜索 ====
  // wx.chooseLocation 打开的就是微信内置地图，顶部有搜索框，数据由腾讯提供，
  // 无需 key、无需云函数、无需域名白名单，搜「水库 / 河 / 钓场」都能出中文 POI。
  pickPoi() {
    wx.chooseLocation({
      latitude: this.data.lat,
      longitude: this.data.lng,
      success: (r) => {
        if (!r || r.latitude == null) return;
        const name = r.name || r.address || "所选位置";
        const d = dist(this.data.lat, this.data.lng, r.latitude, r.longitude);
        this.setData({
          picked: {
            name: name,
            addr: r.address || "",
            lat: r.latitude,
            lng: r.longitude,
            distText: fmtDist(d)
          },
          lat: r.latitude,
          lng: r.longitude,
          geoMsg: "查询中心 " + r.latitude.toFixed(5) + "°N, " + r.longitude.toFixed(5) + "°E（来自微信地图搜索）"
        });
        wx.showToast({ title: "已选中：" + name, icon: "none" });
      },
      fail: (e) => {
        const m = (e && e.errMsg) || "";
        if (/cancel/i.test(m)) return;   // 用户主动取消，不打扰
        wx.showToast({ title: "打开地图选点失败：" + m, icon: "none" });
      }
    });
  },

  openPicked() {
    const p = this.data.picked;
    if (!p) return;
    wx.openLocation({
      latitude: p.lat, longitude: p.lng, name: p.name, address: p.addr, scale: 16,
      fail: () => wx.showToast({ title: "打开地图失败", icon: "none" })
    });
  },

  savePicked() {
    const p = this.data.picked;
    if (!p) return;
    const spots = app.get(app.KEYS.SPOT, []) || [];
    if (spots.some((s) => Math.abs(s.lat - p.lat) < 1e-6 && Math.abs(s.lng - p.lng) < 1e-6)) {
      wx.showToast({ title: "已在钓点地图里", icon: "none" });
      return;
    }
    spots.unshift({ name: p.name, addr: p.addr, lat: p.lat, lng: p.lng, id: Date.now() });
    app.set(app.KEYS.SPOT, spots);
    wx.showToast({ title: "已收藏为钓点", icon: "success" });
  },

  // 在微信内置地图里看（可一键导航，不依赖高德 App）
  openItem(e) {
    const list = this.data.list;
    const x = list[+e.currentTarget.dataset.i];
    if (!x) return;
    wx.openLocation({
      latitude: x.lat, longitude: x.lng, name: x.name, scale: 16,
      fail: () => wx.showToast({ title: "打开地图失败", icon: "none" })
    });
  },

  // 收藏到「钓点地图」（与地图页共用 fish.spot.v1）
  saveSpot(e) {
    const list = this.data.list;
    const x = list[+e.currentTarget.dataset.i];
    if (!x) return;
    const spots = app.get(app.KEYS.SPOT, []) || [];
    if (spots.some((s) => Math.abs(s.lat - x.lat) < 1e-6 && Math.abs(s.lng - x.lng) < 1e-6)) {
      wx.showToast({ title: "已在钓点地图里", icon: "none" });
      return;
    }
    spots.unshift({
      name: x.name,
      addr: x.type + (x.distText ? " · 直线 " + x.distText : ""),
      lat: x.lat, lng: x.lng, id: Date.now()
    });
    app.set(app.KEYS.SPOT, spots);
    wx.showToast({ title: "已收藏为钓点", icon: "success" });
  }
}));
