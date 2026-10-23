// 钓点分享海报：Canvas 2D 合成「照片 + 名称 + 标签 + 备注 + 小程序码」
// 小程序码双通道：
//   1) 云函数 wxacode（wxacode.getUnlimited，需云环境）—— 能带 scene 直达钓点页，优先用；
//   2) 内置 images/wxacode.png —— 小程序后台下载的固定码，2.5s 内没等到云函数就回落。
// 无论哪条通道，海报都能出码，不再出现「小程序码未生成」。
const app = getApp();
const TG = require("../../utils/spottag.js");
const TH = require("../../utils/theme.js");

const DW = 600, DH = 880;   // 设计稿尺寸（px）；绘制时按实际显示宽度等比缩放
const QR_STATIC = "/images/wxacode.png";   // 内置码（无场景值，扫码进小程序首页）
const QR_WAIT = 2500;                      // 等云函数算码的上限，超时直接用内置码

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

// 按宽度断行；超出 maxLines 时在末行补省略号（原来的实现会把省略号整段丢掉）
function wrap(ctx, text, maxW, maxLines) {
  const s = String(text || "");
  const lines = [];
  let line = "";
  let cut = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (line && ctx.measureText(line + ch).width > maxW) {
      if (lines.length === maxLines - 1) { cut = true; break; }
      lines.push(line);
      line = ch;
    } else {
      line += ch;
    }
  }
  if (line) lines.push(line);
  if (cut && lines.length) {
    let last = lines[lines.length - 1];
    while (last.length > 1 && ctx.measureText(last + "…").width > maxW) last = last.slice(0, -1);
    lines[lines.length - 1] = last + "…";
  }
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

// 标签自动换行：返回 rows[r] = [{ t, w }]，w 是胶囊宽度
function wrapTags(ctx, tags, maxW) {
  const rows = [];
  let row = [], used = 0;
  ctx.font = "20px sans-serif";
  (tags || []).slice(0, 10).forEach((t) => {
    const w = ctx.measureText(t).width + 26;
    if (row.length && used + w > maxW) { rows.push(row); row = []; used = 0; }
    if (rows.length >= 2) return;
    row.push({ t: t, w: w });
    used += w + 10;
  });
  if (row.length && rows.length < 2) rows.push(row);
  return rows.slice(0, 2);
}

// 扁圆弧：canvas 的 ellipse 在低版本基础库上不一定有，用 scale 模拟
// 用来画「水面涟漪」，压扁之后才像水面，正圆会像 wifi 图标
function flatArc(ctx, cx, cy, rx, ry, a0, a1, color) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, ry / rx);
  ctx.beginPath();
  ctx.arc(0, 0, rx, a0, a1);
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.restore();
}

// 无照片时的顶部 hero：渐变卡 + 右上柔光 + 右下淡涟漪。
// 原来这里是一块 260 高的「暂无照片」虚线框，卡片上半截全是空的，所以换成有内容的块。
function paintHero(ctx, h, SK) {
  ctx.save();
  roundRect(ctx, h.x, h.y, h.w, h.h, h.r);
  ctx.clip();

  // 底：左蓝右青的斜向渐变
  const g = ctx.createLinearGradient(h.x, h.y, h.x + h.w, h.y + h.h);
  g.addColorStop(0, SK.hero1);
  g.addColorStop(0.6, SK.hero2);
  g.addColorStop(1, SK.hero3);
  ctx.fillStyle = g;
  ctx.fillRect(h.x, h.y, h.w, h.h);

  // 右上角柔光（径向渐变替代高斯模糊，canvas 里没有 blur）
  const gx = h.x + h.w * 0.92, gy = h.y + h.h * 0.04, gr = h.w * 0.8;
  const rg = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
  rg.addColorStop(0, SK.glowC);
  rg.addColorStop(0.55, SK.glowC2);
  rg.addColorStop(1, "rgba(120,190,190,0)");
  ctx.fillStyle = rg;
  ctx.fillRect(h.x, h.y, h.w, h.h);

  // 右下角三道很淡的涟漪
  ctx.lineWidth = 2;
  flatArc(ctx, h.x + h.w - 6, h.y + h.h + 4, 150, 52, 3.28, 6.14, SK.ripple[0]);
  flatArc(ctx, h.x + h.w - 6, h.y + h.h + 4, 230, 80, 3.28, 6.14, SK.ripple[1]);
  flatArc(ctx, h.x + h.w - 6, h.y + h.h + 4, 320, 112, 3.28, 6.14, SK.ripple[2]);
  ctx.restore();

  // 描边偏 0.5px，避免 1px 线被裁成半透明
  roundRect(ctx, h.x + 0.5, h.y + 0.5, h.w - 1, h.h - 1, h.r);
  ctx.strokeStyle = SK.photoPhLine;
  ctx.lineWidth = 1;
  ctx.stroke();
}

// 先量字、再排位、最后按内容收缩高度 —— 固定 880 高度是「下面一大片空白」的根源
function buildPlan(ctx, spot, hasPhoto) {
  const PAD = 32, PW = DW - PAD * 2;
  const plan = { PAD: PAD, PW: PW, photo: null, hero: null, name: null, addr: null, tags: null, note: null, hy: 0, H: 0 };
  const name = spot.name || "未命名钓点";
  const addr = spot.addr || "";
  const note = spot.note || "";
  let y = 76;

  if (hasPhoto) {
    plan.photo = { x: PAD, y: y, w: PW, h: 260, r: 18 };
    y += 260 + 34;
  }

  const IX = hasPhoto ? PAD : PAD + 30;         // 无照片时文字缩进到 hero 卡内
  const IW = hasPhoto ? PW : PW - 60;
  // 名字优先压成一行：46 放不下就 42/38/34 逐级降，实在不行才折两行。
  // 否则「灞河湿地公园东岸老闸口」这类长名会折出孤零零的一个字。
  const sizes = hasPhoto ? [38, 34, 30, 26] : [46, 42, 38, 34, 30];
  let nameSize = sizes[0], nameLines = [];
  for (let i = 0; i < sizes.length; i++) {
    ctx.font = "bold " + sizes[i] + "px sans-serif";
    nameSize = sizes[i];
    nameLines = wrap(ctx, name, IW, 2);
    if (nameLines.length <= 1) break;
  }
  const nameLh = Math.round(nameSize * 1.22);

  ctx.font = "20px sans-serif";
  const addrLines = addr ? wrap(ctx, addr, IW, 2) : [];
  const tagRows = wrapTags(ctx, spot.tags || [], IW);
  const noteLines = note ? wrap(ctx, note, IW - 18, 3) : [];

  if (hasPhoto) {
    plan.name = { x: IX, y: y, size: nameSize, lh: nameLh, lines: nameLines };
    y += nameLh * nameLines.length + 14;
    if (addrLines.length) {
      plan.addr = { x: IX, y: y, lines: addrLines, lh: 28 };
      y += addrLines.length * 28 + 6;
    }
    if (tagRows.length) {
      plan.tags = { rows: tagRows, x: IX, y: y };
      y += tagRows.length * 44 + 8;
    }
  } else {
    let ih = 34 + nameLh * nameLines.length;
    if (addrLines.length) ih += 8 + addrLines.length * 28;
    if (tagRows.length) ih += 18 + tagRows.length * 44;
    ih += 34;
    plan.hero = { x: PAD, y: y, w: PW, h: ih, r: 22 };

    let iy = y + 34;
    plan.name = { x: IX, y: iy, size: nameSize, lh: nameLh, lines: nameLines };
    iy += nameLh * nameLines.length;
    if (addrLines.length) {
      iy += 8;
      plan.addr = { x: IX, y: iy, lines: addrLines, lh: 28 };
      iy += addrLines.length * 28;
    }
    if (tagRows.length) {
      iy += 18;
      plan.tags = { rows: tagRows, x: IX, y: iy };
      iy += tagRows.length * 44;
    }
    y += ih;
  }

  if (noteLines.length) {
    y += 34;
    plan.note = { x: PAD, y: y, lines: noteLines, lh: 30 };
    y += noteLines.length * 30;
  }

  // 页脚：分隔线 + 小程序码 + 说明，整体跟着内容走
  plan.hy = y + 52;
  plan.H = plan.hy + 26 + 120 + 56;
  return plan;
}

Page(TH.mix({
  // 海报页依赖本机钓点数据，朋友圈单页模式读不到
  canTimeline: false,
  // cvH 是画布显示高度（rpx），按内容算出来后再回写，避免固定高度留白
  data: { spot: null, msg: "", ready: false, saving: false, cvH: 792, noPhoto: false },

  onLoad(q) {
    const id = +(q && q.id || 0);
    const raw = (app.get(app.KEYS.SPOT, []) || []).filter(s => s.id === id)[0];
    if (!raw) {
      wx.showToast({ title: "钓点不存在", icon: "none" });
      setTimeout(() => wx.navigateBack(), 900);
      return;
    }
    const spot = TG.ensure(raw);
    this.setData({ spot: spot, noPhoto: !(spot.photos || []).length });
    this.build();
  },

  // 去钓点页补照片后返回：首图变了就重新出图，不用手动点「重新生成」
  onShow() {
    if (!this.data.spot || !this.data.ready) return;
    const id = this.data.spot.id;
    const raw = (app.get(app.KEYS.SPOT, []) || []).filter(s => s.id === id)[0];
    if (!raw) return;
    const oldFirst = (this.data.spot.photos || [])[0] || "";
    const newFirst = (raw.photos || [])[0] || "";
    if (oldFirst === newFirst) return;
    const spot = TG.ensure(raw);
    this.setData({ spot: spot, noPhoto: !(spot.photos || []).length });
    this.rebuild();
  },

  goSpot() {
    if (!this.data.spot) return;
    wx.navigateTo({ url: "/pages/spot/index?id=" + this.data.spot.id });
  },

  // ---- 资源准备 ----
  // 返回 { src, scene }：scene=true 表示这是带 s{id} 的专属码，可写「查看这个钓点」
  loadQr(spot) {
    return new Promise((resolve) => {
      const stat = { src: QR_STATIC, scene: false };
      if (!wx.cloud || !wx.cloud.callFunction) return resolve(stat);

      let done = false;
      let timer = null;
      const fin = (v) => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        resolve(v);
      };
      // 云函数可能未部署 / 冷启动慢 / 配额失败：都别卡住海报，到点用内置码
      timer = setTimeout(() => fin(stat), QR_WAIT);

      wx.cloud.callFunction({
        name: "wxacode",
        // scene 上限 32 字符，且只能带字母数字和少量符号；用 s+id
        data: { scene: "s" + spot.id, page: "pages/spot/index" },
        success: (r) => {
          const res = (r && r.result) || {};
          if (!res.ok || !res.fileID) return fin(stat);
          wx.cloud.downloadFile({
            fileID: res.fileID,
            success: (d) => fin({ src: d.tempFilePath, scene: true }),
            fail: () => fin(stat)
          });
        },
        fail: () => fin(stat)
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

    const qr = await this.loadQr(spot);
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

    // 先用设计稿尺寸建上下文，这一步只为量字、算高度，画不画都行
    canvas.width = Math.round(DW * dpr * scale);
    canvas.height = Math.round(DH * dpr * scale);
    let ctx = canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr * scale, dpr * scale);

    const photos = spot.photos || [];
    const imgPhoto = await this.loadImg(canvas, photos[0]);
    const imgQr = await this.loadImg(canvas, qr.src);

    // 没有照片就走紧凑版（hero 卡），高度按内容收缩
    const plan = buildPlan(ctx, spot, !!imgPhoto);
    const cvH = Math.round((plan.H / DW) * 540);
    await new Promise((res) => this.setData({ cvH: cvH }, res));

    // 改高度会重置上下文状态，必须重新取一次并重设变换
    canvas.height = Math.round(plan.H * dpr * scale);
    ctx = canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr * scale, dpr * scale);

    this.paint(ctx, spot, imgPhoto, imgQr, qr.scene, plan);
    wx.hideLoading();
    this.setData({ ready: true, msg: "", noPhoto: !(spot.photos || []).length });
  },

  paint(ctx, spot, imgPhoto, imgQr, qrScene, plan) {
    // 白天/夜间各自一套色：canvas 不认 CSS 变量，写死深色会在白天模式插一张黑海报
    const SK = TH.canvasSkin();
    const PAD = plan.PAD, H = plan.H;
    ctx.clearRect(0, 0, DW, H);
    ctx.textBaseline = "top";   // 统一从「行顶」算 y，比 alphabetic 好对位

    // 背景：竖向渐变 + 顶部高光
    const g = ctx.createLinearGradient(0, 0, DW, H);
    g.addColorStop(0, SK.bg1);
    g.addColorStop(1, SK.bg2);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, DW, H);

    const g2 = ctx.createLinearGradient(0, 0, DW, 140);
    g2.addColorStop(0, SK.glow);
    g2.addColorStop(1, "rgba(126,155,250,0)");
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, DW, 140);

    // 顶部小标题
    ctx.fillStyle = SK.mu;
    ctx.font = "22px sans-serif";
    ctx.fillText("钓鱼指南 · 钓点分享", PAD, 34);

    if (plan.photo) {
      const p = plan.photo;
      cover(ctx, imgPhoto, p.x, p.y, p.w, p.h, p.r);
      // 底边压暗，图片到深色背景的过渡更自然
      const vg = ctx.createLinearGradient(0, p.y + p.h * 0.55, 0, p.y + p.h);
      vg.addColorStop(0, "rgba(" + SK.fade + ",0)");
      vg.addColorStop(1, "rgba(" + SK.fade + ",0.6)");
      ctx.save();
      roundRect(ctx, p.x, p.y, p.w, p.h, p.r);
      ctx.clip();
      ctx.fillStyle = vg;
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.restore();
    } else {
      paintHero(ctx, plan.hero, SK);
    }

    // 名称
    if (plan.name) {
      const nm = plan.name;
      ctx.fillStyle = SK.tx;
      ctx.font = "bold " + nm.size + "px sans-serif";
      nm.lines.forEach((ln, i) => ctx.fillText(ln, nm.x, nm.y + i * nm.lh));
    }

    // 副标题（类型 · 直线距离 / 地址）
    if (plan.addr) {
      ctx.fillStyle = SK.addr;
      ctx.font = "20px sans-serif";
      plan.addr.lines.forEach((ln, i) => ctx.fillText(ln, plan.addr.x, plan.addr.y + i * plan.addr.lh));
    }

    // 标签胶囊，最多两行
    if (plan.tags) {
      ctx.font = "20px sans-serif";
      plan.tags.rows.forEach((row, ri) => {
        let x = plan.tags.x;
        const ty = plan.tags.y + ri * 44;
        row.forEach((it) => {
          ctx.fillStyle = SK.tagBg;
          roundRect(ctx, x, ty, it.w, 34, 17);
          ctx.fill();
          ctx.fillStyle = SK.tagTx;
          ctx.fillText(it.t, x + 13, ty + 7);
          x += it.w + 10;
        });
      });
    }

    // 备注：左侧竖条，当作引用块
    if (plan.note) {
      const n = plan.note;
      ctx.fillStyle = SK.noteBar;
      roundRect(ctx, n.x, n.y + 3, 4, n.lines.length * n.lh - 8, 2);
      ctx.fill();
      ctx.fillStyle = SK.note;
      ctx.font = "20px sans-serif";
      n.lines.forEach((ln, i) => ctx.fillText(ln, n.x + 18, n.y + i * n.lh));
    }

    // 分隔线
    ctx.strokeStyle = SK.line;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(PAD, plan.hy);
    ctx.lineTo(DW - PAD, plan.hy);
    ctx.stroke();

    // 小程序码（白底，提高识别率）
    const QS = 120, QY = plan.hy + 26;
    if (imgQr) {
      // 白天模式下码图自带白底，垫一张浅灰板 + 细边，才不会「糊」进背景里
      ctx.fillStyle = SK.qrPlate;
      roundRect(ctx, PAD, QY, QS, QS, 12);
      ctx.fill();
      if (SK.qrEdge) {
        roundRect(ctx, PAD + 0.5, QY + 0.5, QS - 1, QS - 1, 12);
        ctx.strokeStyle = SK.qrEdge;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      // 码图自带白底，四周留 4px 白边即可（留太多会缩小码点，反而不易识别）
      ctx.drawImage(imgQr, PAD + 4, QY + 4, QS - 8, QS - 8);
    } else {
      ctx.save();
      roundRect(ctx, PAD, QY, QS, QS, 12);
      ctx.fillStyle = SK.qrPh;
      ctx.fill();
      ctx.strokeStyle = SK.photoPhLine;
      ctx.setLineDash([6, 6]);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = SK.photoPhTx;
      ctx.font = "16px sans-serif";
      const t = "小程序码";
      ctx.fillText(t, PAD + (QS - ctx.measureText(t).width) / 2, QY + QS / 2 - 8);
    }

    // 右侧说明：专属码能带钓点 id，内置码只能进首页，文案要分清
    ctx.fillStyle = SK.tx;
    ctx.font = "bold 24px sans-serif";
    ctx.fillText("长按识别小程序码", PAD + QS + 24, QY + 32);
    ctx.fillStyle = SK.mu;
    ctx.font = "18px sans-serif";
    ctx.fillText(
      qrScene ? "查看这个钓点的标签、照片与位置" : "打开钓鱼指南 · 指数 / 图鉴 / 钓法",
      PAD + QS + 24,
      QY + 70
    );

    // 页脚
    ctx.fillStyle = SK.foot;
    ctx.font = "18px sans-serif";
    const foot = "钓鱼指南 · 从入门到上鱼";
    ctx.fillText(foot, DW - PAD - ctx.measureText(foot).width, H - 44);
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
