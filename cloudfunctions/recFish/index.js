// 云函数：识别渔获照片（Key 只存在于云函数环境，小程序包里没有）
// 部署前：云开发控制台 → 云函数 recFish → 配置 → 环境变量，添加 ZHIPU_KEY = 你的智谱 API Key
// 调用方：wx.cloud.callFunction({ name: "recFish", data: { b64: "..." } })
const https = require("https");

const SYS = "你是钓鱼助手。用户发一张渔获照片，请识别：1) 鱼种 species（常见名，如鲫鱼/鲤鱼/翘嘴/罗非，多鱼种用顿号分隔）；"
  + "2) 尾数 count（整数，数不清就尽量估并在 note 说明）；3) 最大单尾重量 maxWeightKg（kg，数字，需参照照片里的手/尺/鱼钳估算，无法判断写 0）。"
  + "只输出 JSON，不要其它任何文字，格式：{\"species\":\"\",\"count\":0,\"maxWeightKg\":0,\"confidence\":\"高/中/低\",\"note\":\"\"}。";

function post(url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname,
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }, headers)
    }, (res) => {
      let data = "";
      res.on("data", (c) => { data += c; });
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/* Key 只走云函数环境变量 ZHIPU_KEY，不再内置默认值。
   部署前：云开发控制台 → 云函数 recFish → 配置 → 环境变量，添加 ZHIPU_KEY。
   代码里不要写死密钥 —— 一旦进版本库（哪怕私有仓库）就很难彻底清除。 */
const DEFAULT_KEY = "";

exports.main = async (event) => {
  const key = process.env.ZHIPU_KEY || DEFAULT_KEY || "";
  if (!key) return { ok: false, msg: "未配置 ZHIPU_KEY" };
  const b64 = event.b64 || "";
  if (!b64) return { ok: false, msg: "缺少图片数据" };

  const payload = JSON.stringify({
    model: "glm-4v-flash",
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
  });

  try {
    const r = await post("https://open.bigmodel.cn/api/paas/v4/chat/completions",
      { Authorization: "Bearer " + key }, payload);
    if (r.status !== 200) return { ok: false, msg: "智谱返回 " + r.status + "：" + String(r.body).slice(0, 160) };
    const j = JSON.parse(r.body);
    const content = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "";
    const m = content.match(/\{[\s\S]*\}/);
    if (!m) return { ok: false, msg: "模型未返回可解析结果" };
    const o = JSON.parse(m[0]);
    o.ok = true;
    o.engine = "GLM-4V";
    return o;
  } catch (e) {
    return { ok: false, msg: "请求失败：" + (e.message || "") };
  }
};
