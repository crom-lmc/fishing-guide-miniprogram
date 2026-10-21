// 本地图片持久化：chooseMedia 拿到的 tempFilePath 只在本次会话有效，
// 必须 FileSystemManager.saveFile 到 USER_DATA_PATH 才能在下次启动后继续显示
const MAX_KEEP = 200;   // 用户目录下的文件不计入 storage 配额，但也不该无限堆积

function extOf(p) {
  const m = String(p || "").match(/\.(jpg|jpeg|png|gif|webp|heic)$/i);
  return m ? "." + m[1].toLowerCase() : ".jpg";
}

function savePhoto(temp) {
  return new Promise((resolve, reject) => {
    const fs = wx.getFileSystemManager();
    if (!fs || !fs.saveFile) return reject(new Error("saveFile 不可用"));
    const dest = wx.env.USER_DATA_PATH + "/p" + Date.now()
      + "_" + Math.floor(Math.random() * 1e6) + extOf(temp);
    fs.saveFile({
      tempFilePath: temp,
      filePath: dest,
      success: (r) => resolve(r.savedFilePath || dest),
      fail: reject
    });
  });
}

function removePhoto(path) {
  try {
    wx.getFileSystemManager().removeSavedFile({ filePath: path, fail: () => {} });
  } catch (e) { /* 文件已不存在，忽略 */ }
}

// 顺手清理超出上限的旧文件（只在新增照片失败时调用，平时不打扰）
function trim() {
  try {
    wx.getFileSystemManager().getSavedFileList({
      success: (r) => {
        const files = (r && r.fileList) || [];
        if (files.length <= MAX_KEEP) return;
        files.sort((a, b) => (a.createTime || 0) - (b.createTime || 0));
        files.slice(0, files.length - MAX_KEEP).forEach(f => removePhoto(f.filePath));
      }
    });
  } catch (e) { /* 忽略 */ }
}

module.exports = { savePhoto: savePhoto, removePhoto: removePhoto, trim: trim };
