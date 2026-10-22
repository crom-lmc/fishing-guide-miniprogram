// 钓点地图：收藏的钓点只存本机，不上传
const app = getApp();
const TG = require("../../utils/spottag.js");
const TH = require("../../utils/theme.js");

Page(TH.mix({
  data: {
    lat: 34.3416, lng: 108.9398,   // 默认中心（西安），定位成功后以当前位置为准
    markers: [],
    spots: [],
    located: false,
    geoMsg: "",                    // 自动定位失败时的轻提示（不弹窗、不打断）
    shared: null,                  // 好友分享进来的钓点（数据经页面参数传递，不在本机 storage）
    // 「导航到钓点」路线面板（逻辑与 spot 页一致）
    routeVisible: false,
    routeLoading: false,
    routeMode: "driving",
    route: null,
    pline: [],
    mapPts: [],
    routeErr: ""
  },

  onLoad(options) {
    // 生命周期顺序 onLoad → onShow，所以这里只初始化标记位，真正的自动定位在 onShow 里触发
    this.autoLocated = false;       // 是否已尝试过自动定位（含失败，避免每次 onShow 反复打断）
    this.locating = false;          // 防并发：自动定位未返回时用户又点了「我的位置」
    // 从好友的分享卡片进来：钓点数据走 query（本机 storage 不随分享传递），落到 shared 卡片
    const s = this.parseShared(options);
    if (s) this.setData({ shared: s, lat: s.lat, lng: s.lng, located: true });
  },

  // query 值可能已被框架解码，再解一次要容错：含 % 的字符串 decodeURIComponent 可能抛错
  parseShared(options) {
    if (!options || !options.lat || !options.lng) return null;
    const lat = parseFloat(options.lat), lng = parseFloat(options.lng);
    if (!isFinite(lat) || !isFinite(lng)) return null;
    return {
      name: this.qdec(options.name) || "钓点",
      addr: this.qdec(options.addr),
      lat: lat, lng: lng
    };
  },

  qdec(v) {
    if (!v) return "";
    try { return decodeURIComponent(v); } catch (e) { return v; }
  },

  onShow() {
    // 老数据没有 tags/photos/note 字段，统一补齐，WXML 里才不用到处写 `|| []`
    const spots = (app.get(app.KEYS.SPOT, []) || []).map(s => TG.ensure(s));
    this.setData({ spots: spots, markers: this.buildMarkers(spots) });
    if (this.data.shared) return;   // 看好友分享的钓点时，视野停在它上面，别被自动定位抢走
    // 首次进入本页自动定位到当前位置；之后（选点返回、切后台回来）不再重置用户拖动过的视野
    if (!this.autoLocated) this.autoLocate();
  },

  // 自动定位：失败不弹模态、不打断，只在地图下方留一句轻提示
  autoLocate() {
    this.autoLocated = true;
    this.doLocate({ manual: false });
  },

  toMarkers(spots) {
    const co = TH.callout();     // 地图气泡是原生层，不认 CSS 变量，只能按主题取色
    return spots.map((s, i) => ({
      id: i,
      latitude: s.lat,
      longitude: s.lng,
      name: s.name,
      callout: { content: s.name, color: co.color, bgColor: co.bgColor, padding: 6, borderRadius: 6, display: "ALWAYS" }
    }));
  },

  // markers = 已收藏钓点 + （若有）好友分享的钓点；后者用固定 id 999，避免与列表 id 冲突
  buildMarkers(spots) {
    const ms = this.toMarkers(spots);
    const s = this.data.shared;
    if (s) {
      const co = TH.callout();
      ms.push({
        id: 999, latitude: s.lat, longitude: s.lng, name: s.name,
        callout: { content: s.name, color: co.color, bgColor: co.bgColor, padding: 6, borderRadius: 6, display: "ALWAYS" }
      });
    }
    return ms;
  },

  // 手动点「📍 我的位置」：按钮绑定入口
  locate() {
    this.autoLocated = true;
    this.doLocate({ manual: true });
  },

  // 定位实现：走模糊定位（getFuzzyLocation 与 getLocation 互斥，项目只用前者）。接口 2026-10-21 已开通。
  // manual=true 表示用户主动点击：失败要弹窗/提示；false 为进页自动定位：失败只留轻提示。
  doLocate(opts) {
    const manual = !!(opts && opts.manual);
    if (this.locating) return;      // 自动定位还没返回时别重复发起
    this.locating = true;
    if (manual) wx.showLoading({ title: "定位中…", mask: false });

    const done = () => {
      this.locating = false;
      if (manual) wx.hideLoading();
    };

    wx.getFuzzyLocation({
      type: "gcj02",             // 地图组件与路线规划都用 GCJ-02
      success: (r) => {
        done();
        // 模糊坐标只作兜底中心，并把红点标成「大致区域（模糊定位）」——避免误导成“我的准确位置”
        this.setData({ lat: r.latitude, lng: r.longitude, located: true, geoMsg: "" });
        this.placeFuzzyMarker(r.latitude, r.longitude);
        // 再用地图自带的 moveToLocation 吸附到精确位置（scope.userLocation 授权，
        // 与 getFuzzyLocation 互斥的 getLocation 接口审批无关），成功后在 regionchange end 取真实中心
        this.snapExact(manual);
      },
      fail: (e) => {
        done();
        const m = (e && e.errMsg) || "";
        const denied = m.indexOf("auth deny") >= 0 || m.indexOf("authorize") >= 0
          || m.indexOf("permission") >= 0 || m.indexOf("privacy") >= 0;

        if (!manual) {
          // 自动定位失败：不弹窗打断，地图留在默认中心，仅给一句可操作提示
          this.setData({
            geoMsg: denied
              ? "未获得位置权限，点「📍 我的位置」可重新授权"
              : "未能自动定位，点「📍 我的位置」重试"
          });
          return;
        }
        if (denied) {
          wx.showModal({
            title: "需要位置权限",
            content: "定位需要授权位置信息，是否去设置里打开？",
            confirmText: "去设置",
            success: (r) => { if (r.confirm) wx.openSetting(); }
          });
          return;
        }
        wx.showToast({ title: "定位失败，请稍后重试", icon: "none" });
      }
    });
  },

  // 无钓点时放一个诚实的“大致区域”红点（模糊坐标），精确吸附成功后会被替换
  placeFuzzyMarker(lat, lng) {
    if (this.data.spots.length === 0) {
      this.setData({
        markers: [{ id: 0, latitude: lat, longitude: lng, name: "大致区域（模糊定位）" }]
      });
    }
  },

  // 精确吸附：moveToLocation 把视野移到真实位置（蓝点），读中心后置 pendingExact，等地图移动结束再取真实坐标
  snapExact(manual) {
    const ctx = wx.createMapContext("spotMap", this);
    const go = () => ctx.moveToLocation({
      success: () => { this.pendingExact = true; this.scheduleReadCenter(); },
      fail: (e) => this.onSnapFail(e, manual, go)
    });
    // 先确认精确位置授权在：scope.userLocation 与模糊定位是两套授权，缺它时 moveToLocation 可能静默不移动
    wx.getSetting({
      success: (s) => {
        if (s.authSetting["scope.userLocation"]) { go(); }
        else {
          wx.authorize({
            scope: "scope.userLocation",
            success: go,
            fail: () => this.onSnapFail({ errMsg: "authorize:fail" }, manual, go)
          });
        }
      },
      fail: go
    });
  },

  // regionchange 偶发不触发 end 时的兜底：1.2s 后强制读一次中心
  scheduleReadCenter() {
    clearTimeout(this._readTimer);
    this._readTimer = setTimeout(() => this.readExactCenter(), 1200);
  },

  readExactCenter() {
    if (!this.pendingExact) return;
    this.pendingExact = false;
    wx.createMapContext("spotMap", this).getCenterLocation({
      success: (c) => {
        this.setData({ lat: c.latitude, lng: c.longitude });
        if (this.data.spots.length === 0) {
          this.setData({ markers: [{ id: 0, latitude: c.latitude, longitude: c.longitude, name: "我的位置" }] });
        }
        // 成功对齐不再显示提示行：地图上的蓝点本身就是最直观的反馈。
        // geoMsg 只留给「未授权 / 定位失败 / 退化为模糊位置」这类需要用户处理的情况。
        this.setData({ geoMsg: "" });
      },
      fail: () => {}
    });
  },

  // 精确吸附失败：多半是没授权 scope.userLocation（与模糊定位是两套授权），引导用户开一下
  onSnapFail(e, manual, go) {
    const m = (e && e.errMsg) || "";
    if (m.indexOf("auth") >= 0 || m.indexOf("authorize") >= 0) {
      wx.getSetting({
        success: (s) => {
          if (s.authSetting["scope.userLocation"]) {
            this.promptOpenSetting(manual);
          } else {
            wx.authorize({
              scope: "scope.userLocation",
              success: go,
              fail: () => this.promptOpenSetting(manual)
            });
          }
        },
        fail: () => this.fallbackMsg(manual, "精确位置不可用，已用模糊位置（偏差较大）")
      });
    } else {
      this.fallbackMsg(manual, "精确位置不可用，已用模糊位置（偏差较大）");
    }
  },

  promptOpenSetting(manual) {
    wx.showModal({
      title: "需要位置权限",
      content: "精确定位需要授权位置信息，是否去设置里打开？",
      confirmText: "去设置",
      success: (r) => { if (r.confirm) wx.openSetting(); }
    });
  },

  fallbackMsg(manual, msg) {
    if (manual) wx.showToast({ title: msg, icon: "none" });
    else this.setData({ geoMsg: msg });
  },

  // 地图视野变化结束（且刚发起过精确吸附）时，读取真实中心并落到数据上
  onRegionChange(e) {
    const d = (e && e.detail) || {};
    if (d.type === "end" && this.pendingExact) {
      clearTimeout(this._readTimer);
      this.readExactCenter();
    }
  },

  // 微信地图选点：chooseLocation 已于 2026-10-21 审核通过，requiredPrivateInfos 已声明。
  // 失败只剩两种情况——用户取消、用户拒绝位置授权；另留一条兜底，异常时可用地图中心保存。
  addSpot() {
    const saveCenter = () => {
      const ctx = wx.createMapContext("spotMap", this);
      ctx.getCenterLocation({
        success: (r) => this.pushSpot("地图中心钓点", "", r.latitude, r.longitude),
        fail: () => wx.showToast({ title: "获取地图中心失败", icon: "none" })
      });
    };
    wx.chooseLocation({
      success: (r) => this.pushSpot(r.name || "未命名钓点", r.address || "", r.latitude, r.longitude),
      fail: (e) => {
        const m = (e && e.errMsg) || "";
        // 用户主动取消选点：不打扰，直接返回
        if (m.indexOf("cancel") >= 0) { wx.showToast({ title: "已取消选点", icon: "none" }); return; }
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
        // 其他异常（基础库过低、隐私指引未声明位置信息等）：退化为「保存当前地图中心」
        wx.showModal({
          title: "无法使用地图选点",
          content: "选点暂不可用，是否改用当前地图中心保存钓点？可先在地图上拖动对准位置。",
          success: (r) => { if (r.confirm) saveCenter(); }
        });
      }
    });
  },

  // 新钓点带上空的标签/照片/备注字段，详情页就不用再判空
  newSpot(name, addr, lat, lng) {
    return { name: name, addr: addr, lat: lat, lng: lng, id: Date.now(), tags: [], photos: [], note: "" };
  },

  pushSpot(name, addr, lat, lng) {
    const spots = app.get(app.KEYS.SPOT, []) || [];
    spots.unshift(this.newSpot(name, addr, lat, lng));
    app.set(app.KEYS.SPOT, spots);
    this.setData({ spots: spots.map(s => TG.ensure(s)), markers: this.buildMarkers(spots), lat: lat, lng: lng });
    wx.showToast({ title: "已收藏", icon: "success" });
  },

  // 进钓点详情：标签 / 照片墙 / 备注 / 海报都在这页
  openSpot(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: "/pages/spot/index?id=" + id });
  },

  del(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: "删除这个钓点？", confirmColor: "#F87171",
      success: (r) => {
        if (!r.confirm) return;
        const spots = this.data.spots.filter(s => s.id !== id);
        app.set(app.KEYS.SPOT, spots);
        this.setData({ spots: spots, markers: this.buildMarkers(spots) });
      }
    });
  },

  // ---- 导航到钓点（逻辑与 spot 页一致：getFuzzyLocation 起点 → map 云函数算路线 → 面板展示，开始导航走 openLocation）----
  navToSpot(e) {
    this.beginNav(e.currentTarget.dataset.s);
  },

  // 好友分享卡片上的「导航到钓点」
  navShared() {
    this.beginNav(this.data.shared);
  },

  beginNav(target) {
    if (!target || !target.lat || !target.lng) return;
    this._navTarget = target;   // 供 startNav 使用
    wx.getFuzzyLocation({
      type: "gcj02",
      success: (loc) => {
        const from = loc.latitude + "," + loc.longitude;
        const to = target.lat + "," + target.lng;
        this.setData({ routeVisible: true, routeLoading: true, routeErr: "", route: null, pline: [], mapPts: [] });
        this.fetchRoute(from, to, this.data.routeMode);
      },
      fail: () => {
        wx.showToast({ title: "无法获取当前位置，改用地图导航", icon: "none" });
        this.startNav();
      }
    });
  },

  // WXML 表达式不支持模板字符串与 Math，显示文本在 JS 预格式化
  fmtRoute(r) {
    if (!r) return r;
    const d = r.distance || 0, t = r.duration || 0;
    r._dist = d >= 1000 ? (d / 1000).toFixed(1) + " km" : d + " m";
    r._dur = t >= 60 ? Math.floor(t / 60) + " 小时 " + (t % 60) + " 分" : t + " 分钟";
    (r.steps || []).forEach(s => {
      s._dt = s.dist ? "（" + (s.dist >= 1000 ? (s.dist / 1000).toFixed(1) + "km" : s.dist + "m") + "）" : "";
    });
    return r;
  },

  fetchRoute(from, to, mode) {
    this._from = from; this._to = to;
    this.setData({ routeLoading: true, routeErr: "", routeMode: mode });
    wx.cloud.callFunction({
      name: "map",
      data: { action: "direction", from: from, to: to, mode: mode },
      success: (res) => {
        const r = res && res.result;
        if (r && r.ok) {
          const route = this.fmtRoute(r.route);
          const pts = route.polyline || [];
          this.setData({
            route: route,
            pline: pts.length ? [{ points: pts, color: "#3FA9F5CC", width: 6, arrowLine: true }] : [],
            mapPts: pts,
            routeLoading: false
          });
        }
        else this.setData({ routeErr: (r && r.msg) || "路线规划失败", route: null, pline: [], mapPts: [], routeLoading: false });
      },
      fail: () => this.setData({ routeErr: "云函数调用失败，请检查 map 是否已部署", route: null, pline: [], mapPts: [], routeLoading: false })
    });
  },

  switchRouteMode(e) {
    const mode = e.currentTarget.dataset.mode;
    if (mode === this.data.routeMode && this.data.route) return;
    if (!this._from) return;
    this.fetchRoute(this._from, this._to, mode);
  },

  // 真正拉起导航：走微信原生地图（openLocation），由系统选择腾讯/高德等地图 App
  startNav() {
    const t = this._navTarget;
    if (!t) return;
    wx.openLocation({
      latitude: t.lat, longitude: t.lng,
      name: t.name || "钓点", address: t.addr || "", scale: 15
    });
  },

  closeRoute() { this.setData({ routeVisible: false }); },

  // 仅用于 catchtap 阻止冒泡（点面板内不关闭）
  stop() {},

  // ===== 分享到微信 =====
  // 转发给好友/群：onShareAppMessage（任意页面可用，无需申请接口）
  // 「右上角 … → 转发」与钓点行内的「分享」按钮都会走到这里
  onShareAppMessage(e) {
    const d = (e && e.from === "button" && e.target && e.target.dataset) || null;
    if (d && d.lat && d.lng) {
      return {
        title: (d.name || "钓点") + (d.addr ? " · " + d.addr : ""),
        path: this.sharePath({ name: d.name, addr: d.addr, lat: d.lat, lng: d.lng })
      };
    }
    // 菜单转发：分享整个钓点地图页
    return { title: "钓点地图 · 把常去的钓点标在地图上", path: "/pages/map/index" };
  },

  // 钓点数据经 query 传递（本机 storage 不随分享走）；名称/地址截断，防止 path 过长
  sharePath(s) {
    const cut = (v, n) => String(v || "").slice(0, n);
    return "/pages/map/index?name=" + encodeURIComponent(cut(s.name, 20))
      + "&addr=" + encodeURIComponent(cut(s.addr, 40))
      + "&lat=" + s.lat + "&lng=" + s.lng;
  },

  // 分享到朋友圈：仅非 tabBar 页面支持（本页不在 tabBar，可用），顺带把最近收藏的钓点带过去
  onShareTimeline() {
    const s = (this.data.spots || [])[0];
    return {
      title: s ? (s.name || "钓点") + " · 钓点分享" : "钓点地图 · 把常去的钓点标在地图上",
      query: s ? this.sharePath(s).replace("/pages/map/index?", "") : ""
    };
  },

  // 好友分享的钓点：一键收藏（同坐标去重）
  saveShared() {
    const s = this.data.shared;
    if (!s) return;
    const spots = app.get(app.KEYS.SPOT, []) || [];
    const dup = spots.some(x => Math.abs(x.lat - s.lat) < 1e-6 && Math.abs(x.lng - s.lng) < 1e-6);
    if (!dup) {
      spots.unshift(this.newSpot(s.name, s.addr, s.lat, s.lng));
      app.set(app.KEYS.SPOT, spots);
    }
    this.setData({
      shared: null, spots: spots, lat: s.lat, lng: s.lng,
      markers: this.toMarkers(spots)
    });
    wx.showToast({ title: dup ? "已在你的钓点里" : "已收藏到我的钓点", icon: dup ? "none" : "success" });
  },

  // 不收藏，直接关掉分享卡片
  dismissShared() {
    this.setData({ shared: null, markers: this.toMarkers(this.data.spots) });
  }
}));
