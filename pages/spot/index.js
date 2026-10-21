// 钓点详情：标签 + 照片墙 + 备注 + 分享海报入口
// 数据仍只存本机（fish.spot.v1），照片存 USER_DATA_PATH
const app = getApp();
const TG = require("../../utils/spottag.js");
const F = require("../../utils/file.js");
const TH = require("../../utils/theme.js");

const MAX_PHOTO = 9;

Page(TH.mix({
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
  },

  onLoad(q) {
    const id = +(q && q.id || 0);
    const raw = (app.get(app.KEYS.SPOT, []) || []).filter(s => s.id === id)[0];
    if (!raw) {
      wx.showToast({ title: "钓点不存在或已删除", icon: "none" });
      setTimeout(() => wx.navigateBack(), 900);
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

  openAmap() {
    const s = this.data.spot;
    if (!s) return;
    const url = "https://uri.amap.com/marker?position=" + s.lng + "," + s.lat
      + "&name=" + encodeURIComponent(s.name);
    wx.setClipboardData({
      data: url,
      success: () => wx.showToast({ title: "链接已复制，粘贴到浏览器打开", icon: "none" })
    });
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
