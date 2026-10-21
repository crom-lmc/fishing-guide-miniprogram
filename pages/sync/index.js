// 云同步：把本机的渔获日志 / 收藏钓点 / 装备勾选存到云端，换手机或重装后恢复
const TH = require("../../utils/theme.js");
// 依赖云函数 sync（需右键上传并部署）+ 云数据库集合 userData（首次写入自动创建）
const app = getApp();

function fmtTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const p = n => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate())
    + " " + p(d.getHours()) + ":" + p(d.getMinutes());
}

// 按 id 合并：取并集，同 id 时 updatedAt 新的胜出（都没有 updatedAt 则以 local 为准）
function mergeById(local, cloud) {
  const map = {};
  (local || []).forEach((x) => { if (x && x.id != null) map[x.id] = x; });
  (cloud || []).forEach((x) => {
    if (!x || x.id == null) return;
    const old = map[x.id];
    if (!old) { map[x.id] = x; return; }
    const a = old.updatedAt || old.id || 0;
    const b = x.updatedAt || x.id || 0;
    if (b > a) map[x.id] = x;
  });
  return Object.keys(map).map((k) => map[k])
    .sort((p, q) => (q.updatedAt || q.id || 0) - (p.updatedAt || p.id || 0));
}

Page(TH.mix({
  data: {
    localLog: 0, localSpot: 0,
    cloudLog: 0, cloudSpot: 0,
    cloudAt: "", hasCloud: false,
    busy: false, msg: ""
  },

  onShow() {
    this.setData({
      localLog: (app.get(app.KEYS.LOG, []) || []).length,
      localSpot: (app.get(app.KEYS.SPOT, []) || []).length
    });
    this.status();
  },

  call(action, extra) {
    const data = Object.assign({ action: action }, extra || {});
    return new Promise((resolve, reject) => {
      wx.cloud.callFunction({
        name: "sync",
        data: data,
        success: (r) => {
          const d = (r && r.result) || {};
          if (!d.ok) return reject(new Error(d.msg || "同步失败"));
          resolve(d);
        },
        fail: (e) => {
          const m = (e && e.errMsg) || "";
          reject(new Error(/not (exist|found)|找不到|未找到|-404011/.test(m)
            ? "云函数 sync 未部署：请在开发者工具右键 cloudfunctions/sync → 上传并部署"
            : "云同步不可用：" + m));
        }
      });
    });
  },

  status() {
    this.call("pull").then((d) => {
      this.setData({
        hasCloud: !!d.data,
        cloudLog: (d.counts && d.counts.log) || 0,
        cloudSpot: (d.counts && d.counts.spot) || 0,
        cloudAt: d.updatedAt ? "云端更新于 " + fmtTime(d.updatedAt) : "云端还没有数据"
      });
      this._cloud = d.data || null;
    }).catch((e) => {
      this.setData({ msg: e.message || "读取云端状态失败" });
    });
  },

  upload() {
    if (this.data.busy) return;
    this.setData({ busy: true, msg: "上传中…" });
    this.call("push", {
      log: app.get(app.KEYS.LOG, []) || [],
      spot: app.get(app.KEYS.SPOT, []) || [],
      gear: app.get(app.KEYS.GEAR, {}) || {}
    }).then((d) => {
      this.setData({
        busy: false,
        msg: "已上传：" + ((d.counts && d.counts.log) || 0) + " 条日志、"
          + ((d.counts && d.counts.spot) || 0) + " 个钓点",
        cloudLog: (d.counts && d.counts.log) || 0,
        cloudSpot: (d.counts && d.counts.spot) || 0,
        hasCloud: true,
        cloudAt: "云端更新于 " + fmtTime(d.updatedAt || Date.now())
      });
    }).catch((e) => this.setData({ busy: false, msg: e.message || "上传失败" }));
  },

  // 以云端为准覆盖本机
  restore() {
    if (this.data.busy) return;
    const cloud = this._cloud;
    if (!cloud) {
      this.setData({ msg: "云端还没有数据，先点「上传到云端」" });
      return;
    }
    wx.showModal({
      title: "用云端覆盖本机？",
      content: "本机现有的日志和钓点会被云端版本替换（" + (this._cloud.log || []).length
        + " 条日志、" + (this._cloud.spot || []).length + " 个钓点）。",
      confirmText: "覆盖",
      success: (r) => {
        if (!r.confirm) return;
        this.setData({ busy: true, msg: "恢复中…" });
        app.set(app.KEYS.LOG, cloud.log || []);
        app.set(app.KEYS.SPOT, cloud.spot || []);
        if (cloud.gear) app.set(app.KEYS.GEAR, cloud.gear);
        this.setData({
          busy: false,
          localLog: (cloud.log || []).length,
          localSpot: (cloud.spot || []).length,
          msg: "已恢复到本机"
        });
        wx.showToast({ title: "已恢复", icon: "success" });
      }
    });
  },

  // 合并：两边并集，同 id 取更晚修改的那份，然后把合并结果回传云端
  merge() {
    if (this.data.busy) return;
    const cloud = this._cloud;
    if (!cloud) {
      this.setData({ msg: "云端还没有数据，先点「上传到云端」" });
      return;
    }
    this.setData({ busy: true, msg: "合并中…" });
    const log = mergeById(app.get(app.KEYS.LOG, []) || [], cloud.log || []);
    const spot = mergeById(app.get(app.KEYS.SPOT, []) || [], cloud.spot || []);
    app.set(app.KEYS.LOG, log);
    app.set(app.KEYS.SPOT, spot);
    this.call("push", { log: log, spot: spot, gear: app.get(app.KEYS.GEAR, {}) || {} })
      .then(() => {
        this.setData({
          busy: false,
          localLog: log.length,
          localSpot: spot.length,
          cloudLog: log.length,
          cloudSpot: spot.length,
          msg: "已合并：" + log.length + " 条日志、" + spot.length + " 个钓点"
        });
        wx.showToast({ title: "合并完成", icon: "success" });
      })
      .catch((e) => this.setData({ busy: false, msg: e.message || "合并后上传失败" }));
  }
}));
