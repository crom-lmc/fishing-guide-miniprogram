// 钓点分享海报：Canvas 2D 合成「照片 + 名称 + 标签 + 备注 + 小程序码」
// 小程序码走云函数 wxacode（wxacode.getUnlimited 必须有 access_token / 云环境，端上拿不到）
const app = getApp();
const TG = require("../../utils/spottag.js");
const TH = require("../../utils/theme.js");

const DW = 600, DH = 880;   // 设计稿尺寸（px）；绘制时按实际显示宽度等比缩放

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 等比裁切填满（aspectFill 的手写版）
function cover(ctx, img, x, y, w, h, r) {
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();
  const s = Math.max(w / img.width, h / img.height);
  const dw = img.width * s, dh = img.height * s;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  ctx.restore();
}

// 按宽度断行，超出行数用省略号收尾
function wrap(ctx, text, maxW, maxLines) {
  const lines = [];
  let line = "";
  const s = String(text || "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (line && ctx.measureText(line + ch).width > maxW) {
      lines.push(line);
      line = ch;
      if (lines.length === maxLines) { line = "…"; break; }
    } else {
      line += ch;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  return lines.slice(0, maxLines);
}

// 单行截断
function clip(ctx, text, maxW) {
  const s = String(text || "");
  if (ctx.measureText(s).width <= maxW) return s;
  let t = s;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
  return t + "…";
}

Page(TH.mix({
  data: { spot: null, msg: "", ready: false, saving: false },

  onLoad(q) {
    const id = +(q && q.id || 0);
    const raw = (app.get(app.KEYS.SPOT, []) || []).filter(s => s.id === id)[0];
    if (!raw) {
      wx.showToast({ title: "钓点不存在", icon: "none" });
      setTimeout(() => wx.navigateBack(), 900);
      return;
    }
    this.setData({ spot: TG.ensure(raw) });
    this.build();
  },

  // ---- 资源准备 ----
  loadQr(spot) {
    return new Promise((resolve) => {
      if (!wx.cloud || !wx.cloud.callFunction) return resolve(null);
      wx.cloud.callFunction({
        name: "wxacode",
        // scene 上限 32 字符，且只能带字母数字和少量符号；用 s+id
        data: { scene: "s" + spot.id, page: "pages/spot/index" },
        success: (r) => {
          const res = (r && r.result) || {};
          if (!res.ok || !res.fileID) return resolve(null);
          wx.cloud.downloadFile({
            fileID: res.fileID,
            success: (d) => resolve(d.tempFilePath),
            fail: () => resolve(null)
          });
        },
        fail: () => resolve(null)
      });
    });
  },

  node() {
    return new Promise((resolve) => {
      wx.createSelectorQuery().in(this)
        .select("#posterCv").fields({ node: true, size: true })
        .exec((res) => resolve((res && res[0]) || null));
    });
  },

  loadImg(canvas, src) {
    return new Promise((resolve) => {
      if (!src) return resolve(null);
      const img = canvas.createImage();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  },

  async build() {
    const spot = this.data.spot;
    if (!spot) return;
    wx.showLoading({ title: "生成海报…", mask: true });

    const qrPath = await this.loadQr(spot);
    const r = await this.node();
    if (!r || !r.node) {
      wx.hideLoading();
      this.setData({ msg: "画布未就绪，请返回重试" });
      return;
    }

    const canvas = r.node;
    this._canvas = canvas;
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const dpr = info.pixelRatio || 2;
    const scale = (r.width || DW) / DW;
    canvas.width = Math.round((r.width || DW) * dpr);
    canvas.height = Math.round((r.height || DH) * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr * scale, dpr * scale);

    const photos = spot.photos || [];
    const imgPhoto = await this.loadImg(canvas, photos[0]);
    const imgQr = await this.loadImg(canvas, qrPath);

    this.paint(ctx, spot, imgPhoto, imgQr);
    wx.hideLoading();
    this.setData({
      ready: true,
      msg: imgQr ? "" : "小程序码未生成（云函数 wxacode 未部署或不可用），海报其余部分不受影响。"
    });
  },

  paint(ctx, spot, imgPhoto, imgQr) {
    ctx.clearRect(0, 0, DW, DH);

    // 背景：竖向渐变 + 顶部一道高光
    const g = ctx.createLinearGradient(0, 0, DW, DH);
    g.addColorStop(0, "#10131B");
    g.addColorStop(1, "#1C2231");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, DW, DH);

    const g2 = ctx.createLinearGradient(0, 0, DW, 140);
    g2.addColorStop(0, "rgba(126,155,250,0.22)");
    g2.addColorStop(1, "rgba(126,155,250,0)");
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, DW, 140);

    // 顶部标题
    ctx.fillStyle = "#8A93A6";
    ctx.font = "22px sans-serif";
    ctx.textBaseline = "alphabetic";
    ctx.fillText("钓鱼指南 · 钓点分享", 32, 46);

    // 照片区
    const PX = 32, PY = 76, PW = 536, PH = 260;
    if (imgPhoto) {
      cover(ctx, imgPhoto, PX, PY, PW, PH, 18);
    } else {
      ctx.save();
      roundRect(ctx, PX, PY, PW, PH, 18);
      ctx.fillStyle = "rgba(255,255,255,0.04)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = 1;
      ctx.setLineDash([8, 8]);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = "#5C6478";
      ctx.font = "22px sans-serif";
      const t = "暂无照片";
      ctx.fillText(t, PX + (PW - ctx.measureText(t).width) / 2, PY + PH / 2);
    }

    // 名称
    let y = PY + PH + 46;
    ctx.fillStyle = "#E6EAF2";
    ctx.font = "bold 36px sans-serif";
    ctx.fillText(clip(ctx, spot.name || "未命名钓点", PW), PX, y);

    // 地址
    if (spot.addr) {
      y += 32;
      ctx.fillStyle = "#8A93A6";
      ctx.font = "20px sans-serif";
      wrap(ctx, spot.addr, PW, 2).forEach((ln) => {
        ctx.fillText(ln, PX, y);
        y += 28;
      });
    }

    // 标签：两行自动换行
    const tags = (spot.tags || []).slice(0, 8);
    if (tags.length) {
      y += 20;
      ctx.font = "20px sans-serif";
      let cx = PX, cy = y;
      tags.forEach((t) => {
        const w = ctx.measureText(t).width + 24;
        if (cx + w > PX + PW) { cx = PX; cy += 40; }
        if (cy > y + 40) return;             // 只画两行
        ctx.fillStyle = "rgba(67,196,191,0.16)";
        roundRect(ctx, cx, cy, w, 32, 16);
        ctx.fill();
        ctx.fillStyle = "#43C4BF";
        ctx.fillText(t, cx + 12, cy + 22);
        cx += w + 10;
      });
      y = Math.min(cy + 40, y + 80);
    }

    // 备注
    if (spot.note) {
      y += 42;
      ctx.fillStyle = "#C9D2E3";
      ctx.font = "20px sans-serif";
      wrap(ctx, spot.note, PW, 3).forEach((ln) => {
        ctx.fillText(ln, PX, y);
        y += 30;
      });
    }

    // 分隔线
    const hy = 700;
    ctx.strokeStyle = "#262B38";
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(PX, hy);
    ctx.lineTo(DW - PX, hy);
    ctx.stroke();

    // 小程序码（白底，提高识别率）
    const QS = 120, QY = hy + 26;
    if (imgQr) {
      ctx.fillStyle = "#FFFFFF";
      roundRect(ctx, PX, QY, QS, QS, 12);
      ctx.fill();
      ctx.drawImage(imgQr, PX + 6, QY + 6, QS - 12, QS - 12);
    } else {
      ctx.save();
      roundRect(ctx, PX, QY, QS, QS, 12);
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.setLineDash([6, 6]);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = "#5C6478";
      ctx.font = "16px sans-serif";
      const t = "小程序码待生成";
      ctx.fillText(t, PX + (QS - ctx.measureText(t).width) / 2, QY + QS / 2);
    }

    // 右侧说明
    ctx.fillStyle = "#E6EAF2";
    ctx.font = "bold 24px sans-serif";
    ctx.fillText("长按识别小程序码", PX + QS + 24, QY + 48);
    ctx.fillStyle = "#8A93A6";
    ctx.font = "18px sans-serif";
    ctx.fillText("查看这个钓点的标签、照片与位置", PX + QS + 24, QY + 80);

    // 页脚
    ctx.fillStyle = "#6B7488";
    ctx.font = "18px sans-serif";
    const foot = "钓鱼指南 · 从入门到上鱼";
    ctx.fillText(foot, DW - PX - ctx.measureText(foot).width, DH - 26);
  },

  // ---- 操作 ----
  save() {
    if (!this._canvas || this.data.saving) return;
    this.setData({ saving: true });
    wx.canvasToTempFilePath({
      canvas: this._canvas,
      success: (r) => {
        this.setData({ saving: false });
        wx.saveImageToPhotosAlbum({
          filePath: r.tempFilePath,
          success: () => wx.showToast({ title: "已保存到相册", icon: "success" }),
          fail: (e) => {
            const m = (e && e.errMsg) || "";
            if (m.indexOf("auth") >= 0 || m.indexOf("deny") >= 0 || m.indexOf("authorize") >= 0) {
              wx.showModal({
                title: "需要相册权限",
                content: "保存海报需要「保存到相册」权限，是否去设置里打开？",
                confirmText: "去设置",
                success: (s) => { if (s.confirm) wx.openSetting(); }
              });
              return;
            }
            wx.showToast({ title: "保存失败，可长按图片保存", icon: "none" });
          }
        });
      },
      fail: () => {
        this.setData({ saving: false });
        wx.showToast({ title: "生成图片失败，请重试", icon: "none" });
      }
    });
  },

  // 长按预览图也能保存到相册，作为权限被拒时的兜底路径
  preview() {
    if (!this._canvas) return;
    wx.canvasToTempFilePath({
      canvas: this._canvas,
      success: (r) => wx.previewImage({ current: r.tempFilePath, urls: [r.tempFilePath] }),
      fail: () => wx.showToast({ title: "生成图片失败", icon: "none" })
    });
  },

  rebuild() {
    if (this.data.saving) return;
    this.setData({ ready: false, msg: "" });
    this.build();
  }
}));
