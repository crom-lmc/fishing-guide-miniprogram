// 生成小程序码（wxacode.getUnlimited）
// 为什么必须走云函数：该接口要 access_token，端上拿不到；云函数里 cloud.openapi 直接带凭证。
// 生成的码上传到云存储，返回 fileID（image 组件可直接用 cloud:// 的 fileID）
const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// scene 只允许 32 字符内的可见字符，且不能带 ? & = # 等
function cleanScene(s) {
  return String(s || "").replace(/[^0-9A-Za-z_\-]/g, "").slice(0, 32);
}

exports.main = async (event) => {
  const scene = cleanScene(event.scene);
  const page = String(event.page || "pages/spot/index").replace(/^\//, "");
  const width = Math.min(1280, Math.max(280, +event.width || 430));

  if (!scene) return { ok: false, msg: "scene 为空" };

  try {
    const r = await cloud.openapi.wxacode.getUnlimited({
      scene: scene,
      page: page,
      width: width,
      autoColor: false,
      is_hyaline: false,
      lineColor: { r: 30, g: 40, b: 60 }
    });

    // 不同版本 SDK 返回结构不一致：有直接给 buffer 的，也有 { buffer, contentType }
    const buf = r && (r.buffer || r);
    if (!buf || !buf.length) return { ok: false, msg: "接口未返回图片数据" };

    const up = await cloud.uploadFile({
      cloudPath: "wxacode/" + Date.now() + "_" + Math.random().toString(36).slice(2, 8) + ".png",
      fileContent: buf
    });

    return { ok: true, fileID: up.fileID };
  } catch (e) {
    return { ok: false, msg: (e && (e.errMsg || e.message)) || "生成小程序码失败" };
  }
};
