// 钓点详情：标签 + 照片墙 + 备注 + 分享海报入口
// 数据仍只存本机（fish.spot.v1），照片存 USER_DATA_PATH
const app = getApp();
const TG = require("../../utils/spottag.js");
const F = require("../../utils/file.js");
const TH = require("../../utils/theme.js");

const MAX_PHOTO = 9;

Page(TH.mix({
  // 钓点只存本机，朋友圈打开是单页模式（读不到 storage，也不能跳转），分享过去只会是一张空页
  canTimeline: false,
  data: {
    id: 0,
    spot: null,
    markers: [],
    tags: [],
    groups: [],
    photos: [],
    note: "",
    custom: "",
    syncMsg: ""
    // 「导航到钓点」路线面板已抽成公共组件 components/route-nav，状态由组件自己维护
  },

  onLoad(q) {
    // 两条进入路径：页面跳转带 ?id=12；扫小程序码带 ?scene=s12（云函数 wxacode 用的格式）
    let id = +(q && q.id || 0);
    if (!id && q && q.scene) {
      const m = /^s(\d+)$/.exec(decodeURIComponent(q.scene));
      if (m) id = +m[1];
    }
    const raw = (app.get(app.KEYS.SPOT, []) || []).filter(s => s.id === id)[0];
    if (!raw) {
      if (q && q.scene) {
        // 扫码进来的：本机没有这条钓点（数据只存在分享者手机），别让用户卡在空白页
        wx.showModal({
          title: "钓点不在本机",
          content: "钓点数据只保存在分享者的手机上。可以先在「钓点地图」里自己标一个常去的位置。",
          confirmText: "去地图",
          cancelText: "回首页",
          success: (r) => {
            if (r.confirm) wx.redirectTo({ url: "/pages/map/index" });
            else wx.switchTab({ url: "/pages/index/index" });
          }
        });
      } else {
        wx.showToast({ title: "钓点不存在或已删除", icon: "none" });
        setTimeout(() => wx.navigateBack(), 900);
      }
      return;
    }
    const s = TG.ensure(raw);
    const co = TH.callout();
    this.setData({
      id: id,
      spot: s,
      tags: s.tags,
      groups: TG.groupsOf(s.tags),
      photos: s.photos,
      note: s.note,
      markers: [{
        id: 0, latitude: s.lat, longitude: s.lng, name: s.name,
        callout: { content: s.name, color: co.color, bgColor: co.bgColor, padding: 6, borderRadius: 6, display: "ALWAYS" }
      }]
    });
    wx.setNavigationBarTitle({ title: s.name.slice(0, 12) || "钓点详情" });
  },

  // 离开页面（含右上角返回、切 tab）都落盘，不依赖用户点保存
  onHide() { this.save(); },
  onUnload() { this.save(); },

  save() {
    const id = this.data.id;
    if (!id) return;
    const spots = app.get(app.KEYS.SPOT, []) || [];
    const i = spots.findIndex(s => s.id === id);
    if (i < 0) return;
    spots[i] = Object.assign({}, spots[i], {
      tags: this.data.tags,
      photos: this.data.photos,
      note: this.data.note
    });
    app.set(app.KEYS.SPOT, spots);
  },

  // ---- 标签 ----
  tapTag(e) {
    const g = e.currentTarget.dataset.g;
    const v = e.currentTarget.dataset.v;
    const tags = TG.toggle(this.data.tags, g, v);
    this.setData({ tags: tags, groups: TG.groupsOf(tags) });
    this.save();
  },

  inputCustom(e) { this.setData({ custom: e.detail.value }); },

  addCustom() {
    const v = String(this.data.custom || "").trim();
    if (!v) return;
    if (v.length > 8) { wx.showToast({ title: "自定义标签最多 8 个字", icon: "none" }); return; }
    if (this.data.tags.indexOf(v) >= 0) {
      wx.showToast({ title: "已经有这个标签了", icon: "none" });
      return;
    }
    const tags = this.data.tags.concat([v]);
    this.setData({ tags: tags, groups: TG.groupsOf(tags), custom: "" });
    this.save();
  },

  // ---- 照片墙 ----
  addPhoto() {
    const left = MAX_PHOTO - this.data.photos.length;
    if (left <= 0) { wx.showToast({ title: "最多 " + MAX_PHOTO + " 张", icon: "none" }); return; }
    if (this._adding) return;
    this._adding = true;
    wx.chooseMedia({
      count: left, mediaType: ["image"], sizeType: ["compressed"],
      sourceType: ["album", "camera"],
      success: (r) => {
        const temps = (r.tempFiles || []).map(f => f.tempFilePath);
        if (!temps.length) { this._adding = false; return; }
        wx.showLoading({ title: "保存中…", mask: true });
        Promise.all(temps.map(t => F.savePhoto(t).catch(() => null)))
          .then((list) => {
            wx.hideLoading();
            this._adding = false;
            const ok = list.filter(Boolean);
            if (!ok.length) {
              F.trim();
              wx.showToast({ title: "照片保存失败，可能空间不足", icon: "none" });
              return;
            }
            const photos = this.data.photos.concat(ok);
            this.setData({ photos: photos });
            this.save();
            wx.showToast({ title: "已添加 " + ok.length + " 张", icon: "success" });
          });
      },
      fail: () => { this._adding = false; }
    });
  },

  previewPhoto(e) {
    const i = +e.currentTarget.dataset.i;
    wx.previewImage({ current: this.data.photos[i], urls: this.data.photos });
  },

  // 长按删照片：与「点击看大图」分开，避免误删
  delPhoto(e) {
    const i = +e.currentTarget.dataset.i;
    const p = this.data.photos[i];
    if (!p) return;
    wx.showModal({
      title: "删除这张照片？", content: "只从本机删除，无法恢复。", confirmColor: "#F87171",
      success: (r) => {
        if (!r.confirm) return;
        const photos = this.data.photos.slice();
        photos.splice(i, 1);
        F.removePhoto(p);
        this.setData({ photos: photos });
        this.save();
      }
    });
  },

  // ---- 备注 ----
  inputNote(e) { this.setData({ note: e.detail.value }); },
  saveNote() {
    this.save();
    wx.showToast({ title: "已保存", icon: "success" });
  },

  // ---- 其它 ----
  goPoster() {
    this.save();
    wx.navigateTo({ url: "/pages/poster/index?id=" + this.data.id });
  },

  // ---- 导航到钓点 ----
  // 路线面板已抽成公共组件 components/route-nav（与钓点地图页、渔获日志页共用），
  // 这里只负责把目标交给组件：getFuzzyLocation 起点 → map 云函数算路线 → 面板展示 → openLocation
  navToSpot() {
    const s = this.data.spot;
    if (!s) return;
    const nav = this.selectComponent("#routeNav");
    if (nav) nav.open({ lat: s.lat, lng: s.lng, name: s.name, addr: s.addr });
  },

  // 分享给钓友：必须分享到地图页 + query 带坐标。
  // 钓点只存本机，好友设备上没有这条记录，直接分享 /pages/spot/index?id= 只会显示「钓点不存在」
  onShareAppMessage() {
    const s = this.data.spot || {};
    const tagText = (this.data.tags || []).slice(0, 3).join(" / ");
    const cut = (v, n) => String(v || "").slice(0, n);
    return {
      title: (s.name || "钓点") + (tagText ? " · " + tagText : ""),
      path: "/pages/map/index?name=" + encodeURIComponent(cut(s.name, 20))
        + "&addr=" + encodeURIComponent(cut(s.addr, 40))
        + "&lat=" + s.lat + "&lng=" + s.lng
    };
  }
}));
