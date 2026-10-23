// 功能开关
// 位置接口均已于 2026-10-21 在公众平台开通：
//   getFuzzyLocation（模糊位置）—— 首页查天气、地图「我的位置」用；
//   chooseLocation（微信地图选点）—— 「添加钓点」精确选点用，与 getFuzzyLocation 不互斥。
// getLocation（精确位置）未开通，且与 getFuzzyLocation 互斥，项目不使用，勿在 requiredPrivateInfos 里加。
const LOCATION_ENABLED = true;

// 拍照识别鱼获：走自建 /api/vision（服务端反代智谱 GLM-4V-Flash）
// 小程序不能请求 IP 地址，正式环境必须换成备案过的 https 域名并配为 request 合法域名。
// 域名就绪后：把这里改成 true，并把 VISION_ENDPOINT 换成你的域名。
const VISION_ENABLED = true;
// "cloud"：走云函数 recFish（推荐，Key 存云端 + 免备案域名）
// "http" ：走自建 /api/vision 反代（需要备案过的 https 域名并配 request 合法域名）
const VISION_MODE = "cloud";
const VISION_ENDPOINT = "https://120.53.9.119/api/vision";
const VISION_MODEL = "glm-4v-flash";

// 云开发环境 ID（云开发控制台 → 概览里复制，形如 xxx-1a2b3c）
// 留空表示暂不启用云开发；填上后 app.js 会自动 wx.cloud.init
const CLOUD_ENV = "";

// 鱼种配图来源（默认留空 = 用小程序包内 images/fish/*.webp，33 张共 76KB）
// 三种写法：
//   1. ""                        → 本地包内图片，无需任何配置（默认）
//   2. "cloud://xxx.tcb.qcloud.la/fish"  → 微信云开发存储，不占包体、免域名白名单、免备案（推荐换网络图时用）
//   3. "https://你的已备案域名/img/fish"  → 自建/CDN 图床，必须先到公众平台把它配成 downloadFile 合法域名
// 注意：配了远程图但图没传齐时，页面会自动退回首字头像，不会开天窗。
const FISH_IMG_BASE = "";

// 默认解锁全部图鉴鱼种（演示/看图标效果用）。
// 设为 false 时解锁以渔获日志为准 —— 钓到过该鱼种才解锁。
const UNLOCK_ALL = false;

module.exports = {
  CLOUD_ENV: CLOUD_ENV,
  FISH_IMG_BASE: FISH_IMG_BASE,
  LOCATION_ENABLED: LOCATION_ENABLED,
  VISION_ENABLED: VISION_ENABLED,
  VISION_MODE: VISION_MODE,
  VISION_ENDPOINT: VISION_ENDPOINT,
  VISION_MODEL: VISION_MODEL,
  UNLOCK_ALL: UNLOCK_ALL
};
