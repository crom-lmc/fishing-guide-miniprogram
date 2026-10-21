// 图片地址解析：本地包内图 ↔ 远程图床/云存储 统一入口
// 换图源时只改 utils/config.js 的 FISH_IMG_BASE，页面代码不用动。
const C = require("./config.js");

// 已经是完整地址（http(s):// 或 cloud://）就原样返回
function isAbs(s) { return /^(https?:)?\/\//.test(s) || /^cloud:\/\//.test(s); }

function fishSrc(img) {
  if (!img) return "";
  if (isAbs(img)) return img;
  if (!C.FISH_IMG_BASE) return "/" + img.replace(/^\/+/, "");
  return C.FISH_IMG_BASE.replace(/\/+$/, "") + "/" + img.split("/").pop();
}

// 给一批鱼种补上 _src 字段（列表页用）
function withFishSrc(list) {
  return (list || []).map((f) => Object.assign({}, f, { _src: fishSrc(f.img) }));
}

module.exports = { fishSrc: fishSrc, withFishSrc: withFishSrc };
