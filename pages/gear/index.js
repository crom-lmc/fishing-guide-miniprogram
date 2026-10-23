// 装备清单：勾选状态存本机，与 Web 版同一套 key 语义
const app = getApp();
const D = require("../../data/fishing-data.js");
const SHR = require("../../utils/share.js");
const TH = require("../../utils/theme.js");

Page(TH.mix({
  data: { sections: [], done: 0, total: 0 },

  onShow() { this.render(); },

  render() {
    const ck = app.get(app.KEYS.GEAR, {}) || {};
    const sections = D.GEAR.map(sec => ({
      g: sec.g,
      items: sec.items.map(it => {
        const key = sec.g + "|" + it[0];
        return { key: key, nm: it[0], spec: it[1] === "——" ? "" : it[1], qty: it[2], on: !!ck[key] };
      })
    }));
    const total = sections.reduce((a, s) => a + s.items.length, 0);
    const done = sections.reduce((a, s) => a + s.items.filter(i => i.on).length, 0);
    this.setData({ sections: sections, done: done, total: total });
  },

  toggle(e) {
    const k = e.currentTarget.dataset.k;
    const ck = app.get(app.KEYS.GEAR, {}) || {};
    ck[k] = !ck[k];
    app.set(app.KEYS.GEAR, ck);
    this.render();
  },

  toggleSec(e) {
    const g = e.currentTarget.dataset.g;
    const ck = app.get(app.KEYS.GEAR, {}) || {};
    const sec = this.data.sections.find(s => s.g === g);
    const allOn = sec.items.every(i => ck[i.key]);
    sec.items.forEach(i => { ck[i.key] = !allOn; });
    app.set(app.KEYS.GEAR, ck);
    this.render();
  },

  all() {
    const ck = {};
    D.GEAR.forEach(s => s.items.forEach(it => { ck[s.g + "|" + it[0]] = true; }));
    app.set(app.KEYS.GEAR, ck);
    this.render();
  },

  none() {
    app.set(app.KEYS.GEAR, {});
    this.render();
  }
,
  // 转发 / 朋友圈：页面里不写 onShareAppMessage，右上角菜单那两项就是灰的
  onShareAppMessage() { return SHR.friend(SHR.titleOf("/pages/gear/index"), "/pages/gear/index"); },
  onShareTimeline() { return SHR.timeline(SHR.titleOf("/pages/gear/index")); }
}));
