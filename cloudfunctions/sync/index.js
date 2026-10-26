// 云同步：按 openid 把「渔获日志 / 收藏钓点 / 装备勾选」存到云数据库，换手机也能恢复
// 依赖 wx-server-sdk（package.json 里已声明，必须用「云端安装依赖」方式部署）
// 集合不存在时自动创建；createCollection 不可用或并发报错时，靠 set 失败重试兜底
const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const COL = "userData";

function pick(v, def) {
  return (v === undefined || v === null) ? def : v;
}

// 每条记录必须有 id，否则合并时无法去重
function norm(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((x) => x && x.id != null);
}

async function ensureCollection() {
  try {
    if (typeof db.createCollection === "function") await db.createCollection(COL);
  } catch (e) {
    // -501001 / 已存在：忽略
  }
}

// 通用集合创建兜底（users 资料集合用）
async function ensure(name) {
  try {
    if (typeof db.createCollection === "function") await db.createCollection(name);
  } catch (e) {
    // -501001 / 已存在：忽略
  }
}

// doc.get() 拿到的是文档本身；不存在时会抛错
async function readDoc(coll, openid) {
  try {
    const r = await coll.doc(openid).get();
    const d = (r && r.data) || null;
    if (!d || typeof d !== "object") return null;
    return d;
  } catch (e) {
    return null;
  }
}

function shape(d) {
  if (!d) return null;
  return {
    log: Array.isArray(d.log) ? d.log : [],
    spot: Array.isArray(d.spot) ? d.spot : [],
    gear: pick(d.gear, {}),
    updatedAt: d.updatedAt || 0
  };
}

exports.main = async (event) => {
  try {
    return await handle(event);
  } catch (e) {
    // 不要把原始堆栈抛回客户端，转成一句能看懂的话
    const m = (e && (e.errMsg || e.message)) || "未知错误";
    return { ok: false, msg: "云同步失败：" + m + "（若提示集合不存在，请在云开发控制台手动创建 userData 集合）" };
  }
};

async function handle(event) {
  const wxCtx = cloud.getWXContext();
  const openid = wxCtx.OPENID || wxCtx.FROM_OPENID || "";
  if (!openid) return { ok: false, msg: "取不到用户标识，云同步不可用" };

  const action = (event && event.action) || "pull";
  const coll = db.collection(COL);

  // 上传：本机覆盖云端
  if (action === "push") {
    const payload = {
      log: norm(event.log),
      spot: norm(event.spot),
      gear: pick(event.gear, {}),
      updatedAt: Date.now(),
      ver: 1
    };
    try {
      await coll.doc(openid).set({ data: payload });
    } catch (e) {
      // 集合不存在（-502005）时建一次再重试
      await ensureCollection();
      await coll.doc(openid).set({ data: payload });
    }
    return {
      ok: true,
      updatedAt: payload.updatedAt,
      counts: { log: payload.log.length, spot: payload.spot.length }
    };
  }

  // 拉取 / 状态：返回云端那份（没存过就是 null）
  if (action === "pull" || action === "status") {
    const raw = await readDoc(coll, openid);
    const data = shape(raw);
    return {
      ok: true,
      data: data,
      updatedAt: data ? data.updatedAt : 0,
      counts: {
        log: data ? data.log.length : 0,
        spot: data ? data.spot.length : 0
      }
    };
  }

  // 登录：云开发下无需前端 wx.login，OPENID 由微信在云端给定
  if (action === "login") {
    const openid = wxCtx.OPENID || wxCtx.FROM_OPENID || "";
    if (!openid) return { ok: false, msg: "取不到用户标识，云同步不可用" };
    const users = db.collection("users");
    let rec = null;
    try { const r = await users.doc(openid).get(); rec = (r && r.data) || null; } catch (e) {}
    const now = Date.now();
    if (!rec) {
      await ensure("users");
      const init = { openid: openid, nickname: "微信用户", avatarUrl: "", createdAt: now, lastLoginAt: now };
      await users.doc(openid).set({ data: init });
      rec = init;
    } else {
      await users.doc(openid).update({ data: { lastLoginAt: now } });
    }
    return {
      ok: true,
      openid: openid,
      profile: {
        nickname: (rec && rec.nickname) || "微信用户",
        avatarUrl: (rec && rec.avatarUrl) || ""
      },
      expireAt: now + 7 * 86400000
    };
  }

  // 更新昵称 / 头像（P3 资料编辑）
  if (action === "updateProfile") {
    const openid = wxCtx.OPENID || wxCtx.FROM_OPENID || "";
    if (!openid) return { ok: false, msg: "取不到用户标识" };
    const patch = {};
    if (event.nickname !== undefined) patch.nickname = event.nickname || "微信用户";
    if (event.avatarUrl !== undefined) patch.avatarUrl = event.avatarUrl || "";
    if (!Object.keys(patch).length) return { ok: true };
    try {
      await db.collection("users").doc(openid).update({ data: patch });
    } catch (e) {
      // 文档被清掉时重建
      await ensure("users");
      await db.collection("users").doc(openid).set({
        data: Object.assign({ openid: openid, createdAt: Date.now(), lastLoginAt: Date.now() }, patch)
      });
    }
    return { ok: true };
  }

  return { ok: false, msg: "未知操作：" + action };
};
