// 路线规划面板（公共组件）
// 页面侧：this.selectComponent('#routeNav').open({ lat, lng, name, addr })
// 流程：getFuzzyLocation 取起点 → map 云函数算路线 → 面板展示 → 开始导航走 openLocation
Component({
  // addGlobalClass：让 app.wxss 里的全局类（.btn / .btn.ghost / .small / .muted / .tiny）
  // 能作用到组件内部，否则面板里的两个按钮会掉样式。
  // 主题色变量（--card / --a2 等）定义在 app.wxss 的 page 上，靠继承传进来，不受隔离影响。
  options: { addGlobalClass: true },

  data: {
    visible: false,
    loading: false,
    mode: "driving",
    err: "",
    route: null,
    pline: [],
    mapPts: []
  },

  methods: {
    // 打开面板并规划到目标的路线
    open(target) {
      if (!target || !target.lat || !target.lng) return;
      this._target = target;   // 供 startNav 使用
      wx.getFuzzyLocation({
        type: "gcj02",
        success: (loc) => {
          const from = loc.latitude + "," + loc.longitude;
          const to = target.lat + "," + target.lng;
          this.setData({ visible: true, loading: true, err: "", route: null, pline: [], mapPts: [] });
          this.fetchRoute(from, to, this.data.mode);
        },
        fail: () => {
          // 拿不到定位就不规划了，直接拉起地图，别让用户卡在空白面板上
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
      this.setData({ loading: true, err: "", mode: mode });
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
              loading: false
            });
          } else {
            this.setData({ err: (r && r.msg) || "路线规划失败", route: null, pline: [], mapPts: [], loading: false });
          }
        },
        fail: () => this.setData({
          err: "云函数调用失败，请检查 map 云函数是否已部署",
          route: null, pline: [], mapPts: [], loading: false
        })
      });
    },

    switchMode(e) {
      const mode = e.currentTarget.dataset.mode;
      if (mode === this.data.mode && this.data.route) return;
      if (!this._from) return;
      this.fetchRoute(this._from, this._to, mode);
    },

    // 真正拉起导航：走微信原生地图（openLocation），由系统选择腾讯/高德等地图 App
    startNav() {
      const t = this._target;
      if (!t) return;
      wx.openLocation({
        latitude: t.lat, longitude: t.lng,
        name: t.name || "钓点", address: t.addr || "", scale: 15
      });
    },

    close() { this.setData({ visible: false }); },

    // 仅用于 catchtap 阻止冒泡（点面板内不关闭）
    stop() {}
  }
});
