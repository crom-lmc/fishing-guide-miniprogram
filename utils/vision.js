// 拍照识别鱼获（移植自 Web 版 log.js 的 recognizeFish）
// 链路：wx.chooseMedia 临时文件 → base64 → 自建 /api/vision → 智谱 GLM-4V-Flash
// 说明：小程序不允许请求 IP 地址，正式环境需要换成备案过的 https 域名，并在
// mp 后台「开发 → 开发设置 → 服务器域名」里配为 request 合法域名。
const C = require("./config.js");

const SYS = "你是钓鱼助手。用户发一张渔获照片，请识别：1) 鱼种 species（常见名，如鲫鱼/鲤鱼/翘嘴/罗非，多鱼种用顿号分隔）；"
  + "2) 尾数 count（整数，数不清就尽量估并在 note 说明）；3) 最大单尾重量 maxWeightKg（kg，数字，需参照照片里的手/尺/鱼钳估算，无法判断写 0）。"
  + "只输出 JSON，不要其它任何文字，格式：{\"species\":\"\",\"count\":0,\"maxWeightKg\":0,\"confidence\":\"高/中/低\",\"note\":\"\"}。";

// 模型常回「未知 / 无法确定 / unknown」，统一判空
function cleanSpecies(s) {
  if (!s || typeof s !== "string") return "";
  const t = s.trim();
  if (!t) return "";
  const low = t.toLowerCase();
  if (/(未知|无法|不确定|看不清|不清楚|没看|未识别|未能|识别不出|分辨不出|unknown|uncertain|unclear|n\/a|none|null|\?)/.test(low)) return "";
  return t;
}

function readBase64(filePath) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath: filePath,
      encoding: "base64",
      success: (r) => resolve(r.data),
      fail: (e) => reject(new Error("读取照片失败：" + (e.errMsg || "")))
    });
  });
}

// 走云函数：Key 在云端，小程序包里不落地（不需要备案域名）
function recognizeByCloud(b64) {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: "recFish",
      data: { b64: b64 },
      success: (r) => {
        const o = r.result || {};
        if (o.ok === false) reject(new Error(o.msg || "云函数识别失败"));
        else resolve(o);
      },
      fail: (e) => reject(new Error("云函数调用失败：" + (e.errMsg || "")))
    });
  });
}

// 返回 {species, count, maxWeightKg, confidence, note, engine}
function recognize(filePath) {
  // 云函数中转优先：Key 安全 + 免去域名备案
  if (C.VISION_MODE === "cloud") {
    return readBase64(filePath).then(recognizeByCloud);
  }
  return readBase64(filePath).then((b64) => new Promise((resolve, reject) => {
    wx.request({
      url: C.VISION_ENDPOINT,
      method: "POST",
      header: { "content-type": "application/json" },
      timeout: 30000,
      data: {
        model: C.VISION_MODEL,
        messages: [
          { role: "system", content: SYS },
          {
            role: "user",
            content: [
              { type: "text", text: "请识别这张渔获照片的鱼种、尾数和最大单尾重量。" },
              { type: "image_url", image_url: { url: "data:image/jpeg;base64," + b64 } }
            ]
          }
        ]
      },
      success: (r) => {
        if (r.statusCode !== 200) {
          reject(new Error("识别服务返回 " + r.statusCode));
          return;
        }
        const j = r.data || {};
        const content = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "";
        const m = content.match(/\{[\s\S]*\}/);
        if (!m) {
          reject(new Error("模型未返回可解析的结果"));
          return;
        }
        let o;
        try { o = JSON.parse(m[0]); } catch (e) { reject(new Error("结果解析失败")); return; }
        o.engine = "GLM-4V";
        resolve(o);
      },
      fail: (e) => reject(new Error("请求失败：" + (e.errMsg || "")))
    });
  }));
}

// 结果文案：区分「认出鱼种 / 只认出数量重量 / 啥都没认出」三档
function buildRecMsg(o) {
  const sp = cleanSpecies(o.species);
  const cnt = (o.count != null && !isNaN(+o.count)) ? Math.max(0, Math.round(+o.count)) : 0;
  const wgt = (o.maxWeightKg != null && !isNaN(+o.maxWeightKg)) ? Math.max(0, +o.maxWeightKg) : 0;
  const conf = o.confidence || "?";
  if (sp) {
    let s = "🐟 已识别：" + sp;
    if (cnt) s += " ×" + cnt;
    if (wgt) s += "，最大 " + wgt.toFixed(2) + "kg";
    s += "（把握：" + conf + "，请核对）";
    if (o.note) s += " · " + o.note;
    return s;
  }
  if (cnt || wgt) {
    let s = "🤔 识别到 " + (cnt ? cnt + " 尾" : "") + (cnt && wgt ? " / " : "") + (wgt ? wgt.toFixed(2) + "kg" : "")
      + "，但没认出具体鱼种 —— 麻烦手动补一个";
    if (o.note) s += " " + o.note;
    return s;
  }
  return "📷 这张照片没识别出明确的鱼获。换个角度、让鱼更完整清晰、背景干净点，旁边放只手或尺子当参照，再拍一张试试；也可以直接在表单里手动填。";
}

module.exports = { recognize: recognize, cleanSpecies: cleanSpecies, buildRecMsg: buildRecMsg };
