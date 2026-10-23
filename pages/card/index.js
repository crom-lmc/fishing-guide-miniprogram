// 渔获战绩卡片：把一条日志画成一张图，可保存相册 / 预览 / 分享给钓友
const TH = require("../../utils/theme.js");
// 用 Canvas 2D（type="2d"），绘制尺寸按 dpr 放大后 scale，保证高清
const app = getApp();

const QR_STATIC = "/images/wxacode.png";   // 内置小程序码（扫码进小程序首页）
// 注意：这里不再放死颜色。卡片是「保存到相册 / 发群」用的图，
// 白天模式下也必须跟应用外观一致，所以颜色在 paint 里用 TH.canvasSkin() 现取。
const FOOT_H = 104;                        // 底部码区高度，绘制与画布高度都用它

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 按最大宽度截断文本（末尾加 …）
function clip(ctx, text, maxW) {
  let s = String(text || "");
  if (ctx.measureText(s).width <= maxW) return s;
  while (s.length > 1 && ctx.measureText(s + "…").width > maxW) s = s.slice(0, -1);
  return s + "…";
}

Page(TH.mix({
  // 战绩卡片依赖本机记录，朋友圈单页模式读不到
  canTimeline: false,
  data: { rec: null, err: "", img: "", cvH: 800 },

  onLoad(q) {
    const id = +(q.id || 0);
    const list = app.get(app.KEYS.LOG, []) || [];
    const rec = list.filter((r) => +r.id === id)[0] || null;
    if (!rec) {
      this.setData({ err: "没找到这条记录，它可能已被删除。" });
      return;
    }
    this._rec = rec;

    // 按有没有备注决定画布高度：没备注就别留一大块空白
    // 预估行数（640rpx 宽，13px 字号，一行约 18 个汉字），最多两行
    const note = String(rec.note || "");
    const lines = note ? Math.min(2, Math.ceil(note.length / 18)) : 0;
    // 470/400 是内容区高度，+40 给底部的小程序码区留位置（绘制用的是 px，1px = 2rpx）
    const hPx = (lines ? 470 + (lines - 1) * 20 : 400) + 40;
    this.setData({ rec: rec, cvH: hPx * 2 });
  },

  onReady() {
    // 画布节点要等页面渲染完才拿得到
    if (!this._rec) return;
    setTimeout(() => this.draw(), 120);
  },

  draw() {
    const q = wx.createSelectorQuery();
    q.in(this).select("#cardCv").fields({ node: true, size: true }).exec((res) => {
      const info = (res && res[0]) || null;
      if (!info || !info.node) {
        this.setData({ err: "画布不可用，请升级微信版本后重试。" });
        return;
      }
      const canvas = info.node;
      const ctx = canvas.getContext("2d");
      const sys = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const dpr = sys.pixelRatio || 2;
      canvas.width = info.width * dpr;
      canvas.height = info.height * dpr;
      ctx.scale(dpr, dpr);
      this._canvas = canvas;

      const W = info.width, H = info.height;
      // 小程序码要先加载成图片对象才能画；加载失败也照常出卡片，只是底部少个码
      const img = canvas.createImage();
      const go = (qr) => this.paint(ctx, W, H, this._rec || {}, qr);
      img.onload = () => go(img);
      img.onerror = () => go(null);
      img.src = QR_STATIC;
    });
  },

  paint(ctx, W, H, r, imgQr) {
    const SK = TH.canvasSkin();
    const A1 = SK.acc1, A2 = SK.acc2;   // 强调色也按主题（白天用深一档，白底上才看得清）
    // 背景
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, SK.bg1);
    bg.addColorStop(1, SK.bg2);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // 顶部渐变条
    const bar = ctx.createLinearGradient(0, 0, W, 0);
    bar.addColorStop(0, A1);
    bar.addColorStop(1, A2);
    ctx.fillStyle = bar;
    ctx.fillRect(0, 0, W, 6);

    // 标题 + 日期
    ctx.fillStyle = SK.tx;
    ctx.font = "bold 20px sans-serif";
    ctx.fillText("渔获战绩", 28, 54);
    ctx.fillStyle = SK.mu;
    ctx.font = "13px sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(clip(ctx, r.date || "", W / 2), W - 28, 52);
    ctx.textAlign = "left";

    // 主卡片
    ctx.fillStyle = SK.card;
    roundRect(ctx, 20, 74, W - 40, 170, 16);
    ctx.fill();

    // 鱼种（大字）
    const grad = ctx.createLinearGradient(28, 0, W - 28, 0);
    grad.addColorStop(0, A1);
    grad.addColorStop(1, A2);
    ctx.fillStyle = grad;
    ctx.font = "bold 34px sans-serif";
    ctx.fillText(clip(ctx, r.fish || "未记录鱼种", W - 70), 40, 130);

    // 三个数字
    const cells = [
      { k: "数量", v: (r.count || 0) + " 尾" },
      { k: "最大单尾", v: (+r.max || 0).toFixed(2) + " kg" },
      { k: "作钓时长", v: (r.hours || 0) + " h" }
    ];
    const cw = (W - 80) / 3;
    cells.forEach((c, i) => {
      const x = 40 + i * cw;
      ctx.fillStyle = SK.mu;
      ctx.font = "12px sans-serif";
      ctx.fillText(c.k, x, 168);
      ctx.fillStyle = SK.tx;
      ctx.font = "bold 18px sans-serif";
      ctx.fillText(c.v, x, 194);
    });

    // 效率
    const h = +r.hours || 0, n = +r.count || 0;
    if (h > 0 && n > 0) {
      ctx.fillStyle = A2;
      ctx.font = "13px sans-serif";
      ctx.fillText("平均 " + (n / h).toFixed(1) + " 尾/小时", 40, 226);
    }

    // 钓点
    ctx.fillStyle = SK.mu;
    ctx.font = "13px sans-serif";
    ctx.fillText("钓点", 28, 280);
    ctx.fillStyle = SK.tx;
    ctx.font = "15px sans-serif";
    ctx.fillText(clip(ctx, r.spot || "未填写", W - 56), 28, 304);

    // 备注（最多两行）
    if (r.note) {
      ctx.fillStyle = SK.mu;
      ctx.font = "12px sans-serif";
      ctx.fillText("备注", 28, 344);
      ctx.fillStyle = SK.note;
      ctx.font = "13px sans-serif";
      const words = String(r.note);
      const maxW = W - 56;
      let line = "", lines = [];
      for (let i = 0; i < words.length; i++) {
        const t = line + words[i];
        if (ctx.measureText(t).width > maxW) { lines.push(line); line = words[i]; }
        else line = t;
        if (lines.length >= 2) break;
      }
      if (lines.length < 2 && line) lines.push(clip(ctx, line, maxW));
      lines.forEach((ln, i) => ctx.fillText(ln, 28, 368 + i * 20));
    }

    // 页脚：分隔线 + 左侧文案 + 右下小程序码
    const hrY = H - FOOT_H;
    ctx.fillStyle = SK.line;
    ctx.fillRect(28, hrY, W - 56, 1);

    const QS = 64;
    const qx = W - 28 - QS;
    const qy = hrY + 20;
    if (imgQr) {
      // 白天模式垫浅灰板 + 细边，白底二维码才不会糊进背景
      ctx.fillStyle = SK.qrPlate;
      roundRect(ctx, qx, qy, QS, QS, 10);
      ctx.fill();
      if (SK.qrEdge) {
        roundRect(ctx, qx + 0.5, qy + 0.5, QS - 1, QS - 1, 10);
        ctx.strokeStyle = SK.qrEdge;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      // 码图自带白底，只留 2px 白边，避免码点被缩小
      ctx.drawImage(imgQr, qx + 2, qy + 2, QS - 4, QS - 4);
    } else {
      ctx.save();
      roundRect(ctx, qx, qy, QS, QS, 10);
      ctx.fillStyle = SK.qrPh;
      ctx.fill();
      ctx.restore();
    }

    ctx.fillStyle = SK.tx;
    ctx.font = "bold 15px sans-serif";
    ctx.fillText("钓鱼指南", 28, qy + 24);
    ctx.fillStyle = SK.mu;
    ctx.font = "12px sans-serif";
    ctx.fillText(clip(ctx, "扫码看指数 / 图鉴 / 钓法", qx - 28 - 12), 28, qy + 46);

    ctx.fillStyle = SK.foot;
    ctx.font = "11px sans-serif";
    ctx.fillText("记录每一次出钓", 28, qy + 64);
  },

  // 生成临时图片（Canvas → 文件）
  gen(cb) {
    if (!this._canvas) {
      wx.showToast({ title: "卡片还没画好", icon: "none" });
      return;
    }
    wx.canvasToTempFilePath({
      canvas: this._canvas,
      success: (r) => {
        this.setData({ img: r.tempFilePath });
        cb && cb(r.tempFilePath);
      },
      fail: () => wx.showToast({ title: "生成图片失败", icon: "none" })
    });
  },

  save() {
    this.gen((p) => {
      wx.saveImageToPhotosAlbum({
        filePath: p,
        success: () => wx.showToast({ title: "已保存到相册", icon: "success" }),
        fail: (e) => {
          const m = (e && e.errMsg) || "";
          if (/auth|deny|authorize|privacy/i.test(m)) {
            wx.showModal({
              title: "需要相册权限",
              content: "保存图片需要「保存到相册」权限，是否去设置里打开？",
              confirmText: "去设置",
              success: (s) => { if (s.confirm) wx.openSetting(); }
            });
          } else {
            wx.showToast({ title: "保存失败：" + m, icon: "none" });
          }
        }
      });
    });
  },

  preview() {
    this.gen((p) => wx.previewImage({ urls: [p], current: p }));
  }
}));
