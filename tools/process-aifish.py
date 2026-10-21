# -*- coding: utf-8 -*-
"""把 AI 生成的鱼图处理成小程序可用的透明底缩略图。

处理流程：
  1. 抹掉底部水印带（生成图右下角带「AI生成」字样）
  2. 按背景色（#262a33 深蓝灰）抠图，边缘做 alpha 羽化，避免锯齿和黑边
  3. 裁到鱼体最小外接框 + 留白，等比缩放居中贴到 240x160 透明画布
  4. 输出 images/fish/<拼音>.png

用法：项目根目录执行  python tools/process-aifish.py
依赖：pillow numpy
"""
from PIL import Image, ImageDraw
import numpy as np
from scipy import ndimage
import os
import glob

SRC = "tools/ai-fish"
OUT = "images/fish"
CANVAS = (240, 160)
PAD_RATIO = 0.04      # 裁切后留白比例
BAND_RATIO = 0.055    # 底部水印带高度比例
T0, T1 = 26, 62       # alpha 硬阈值 / 羽化上限（颜色距离）

# 个别图需要更狠的抠图阈值：
#   青鱼/黑鱼/鲅鱼/罗非鱼为品红底重生成版（深色鱼与深底抠不开），阈值可以开大
OVERRIDE = {
    "qingyu": (60, 150), "heiyu": (60, 150), "bayu": (60, 150),
    "luofeiyu": (60, 150),
}

# 拼音文件名 → 生成图文件名里的中文关键字（顺序敏感，长词在前）
MAP = [
    ("jiyu", "鲫鱼"), ("liyu", "鲤鱼"), ("caoyu", "草鱼"), ("qingyu", "青鱼"),
    ("lingyu", "鲮鱼"), ("junyu", "军鱼"), ("huaguyu", "花骨鱼"),
    ("dinggui", "丁鱥"), ("bianyu", "鳊鱼"), ("heidiao", "黑鲷"),
    ("pangpi", "鳑鲏"), ("qiaozui", "翘嘴"), ("baitiao", "白条"),
    ("huangweigui", "黄尾鲴"), ("chiyanzun", "赤眼鳟"), ("ganyu", "鳡鱼"),
    ("bayu", "鲅鱼"), ("shajianyu", "沙尖鱼"), ("maisuiyu", "麦穗鱼"),
    ("makouyu", "马口鱼"), ("heiyu", "黑鱼"), ("guiyu", "鳜鱼"),
    ("jiazhoulu", "加州鲈"), ("hailu", "花鲈"), ("luofeiyu", "罗非鱼"),
    ("shibanyu", "石斑鱼"), ("lianyong", "鲢鳙"), ("nianyu", "鲶鱼"),
    ("huangsangyu", "黄颡鱼"), ("niqiu", "泥鳅"), ("huangshan", "黄鳝"),
    ("shatangli", "沙塘鳢"), ("baibangouyu", "白斑狗鱼"),
]


def sample_bg(im):
    """四角采样背景色取中位数，避开边角噪点"""
    w, h = im.size
    arr = np.asarray(im.convert("RGB")).astype(np.int16)
    pts = [arr[3, 3], arr[3, w - 4], arr[h - 4, 3], arr[h - 4, w - 4]]
    return np.median(np.array(pts), axis=0)


def key_of(src):
    """由生成图文件名反查拼音 key（OVERRIDE 用）"""
    base = os.path.basename(src)
    for key, cn in MAP:
        if cn in base:
            return key
    return ""


def process(src, dst):
    im = Image.open(src).convert("RGBA")
    w, h = im.size
    bg = sample_bg(im)
    t0, t1 = OVERRIDE.get(key_of(src), (T0, T1))

    # 1) 抹掉底部水印带
    band = int(h * BAND_RATIO)
    d = ImageDraw.Draw(im)
    d.rectangle([0, h - band, w, h], fill=tuple(int(v) for v in bg) + (255,))

    # 2) 按背景色抠图 + 羽化
    arr = np.asarray(im.convert("RGB")).astype(np.float32)
    dist = np.sqrt(((arr - bg) ** 2).sum(axis=2))
    alpha = np.clip((dist - t0) / (t1 - t0), 0, 1) * 255

    # 2a) 去镶边：半透明像素 = 鱼体色与背景色的混合，按 alpha 反推鱼体原色
    #     （品红底尤其需要，否则鱼鳍边缘会留粉色镶边）
    a = alpha / 255.0
    edge = (a > 0.12) & (a < 0.985)
    with np.errstate(divide="ignore", invalid="ignore"):
        unmix = (arr - (1 - a[..., None]) * bg) / np.maximum(a[..., None], 1e-3)
    arr[edge] = np.clip(unmix[edge], 0, 255)

    # 2b) 连通域过滤：只保留最大的鱼体，清掉残影/光晕碎片
    mask = alpha > 40
    lab, n = ndimage.label(mask)
    if n > 1:
        sizes = ndimage.sum(mask, lab, range(1, n + 1))
        keep = int(np.argmax(sizes)) + 1
        alpha[(lab != keep) & mask] = 0

    out = np.dstack([arr.astype(np.uint8), alpha.astype(np.uint8)])
    im = Image.fromarray(out, "RGBA")

    # 3) 裁到鱼体外接框 + 留白
    bbox = im.split()[3].getbbox()
    if not bbox:
        raise RuntimeError("抠图结果为空: " + src)
    pad = int(max(bbox[2] - bbox[0], bbox[3] - bbox[1]) * PAD_RATIO)
    box = (max(0, bbox[0] - pad), max(0, bbox[1] - pad),
           min(w, bbox[2] + pad), min(h, bbox[3] + pad))
    im = im.crop(box)

    # 4) 等比缩放居中贴到画布
    im.thumbnail(CANVAS, Image.LANCZOS)
    canvas = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
    canvas.paste(im, ((CANVAS[0] - im.width) // 2, (CANVAS[1] - im.height) // 2), im)

    # 5) 调色板量化（保留 alpha）：照片 24bit PNG 太大，压到 ~64 色基本看不出差别
    try:
        q = canvas.quantize(colors=96, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.FLOYDSTEINBERG)
        q.save(dst, "PNG", optimize=True)
    except Exception:
        canvas.save(dst, "PNG", optimize=True)
    return os.path.getsize(dst)


def main():
    os.makedirs(OUT, exist_ok=True)
    files = glob.glob(os.path.join(SRC, "*.png"))
    total = 0
    missing = []
    for key, cn in MAP:
        hit = None
        for f in files:
            if cn in os.path.basename(f):
                hit = f
                break
        if not hit:
            missing.append(cn)
            continue
        size = process(hit, os.path.join(OUT, key + ".png"))
        total += size
        print("%-14s %-6s %6d B" % (key, cn, size))
    print("--- 共 %d 张，合计 %.1f KB" % (len(MAP) - len(missing), total / 1024.0))
    if missing:
        print("!!! 未找到生成图：", "、".join(missing))


if __name__ == "__main__":
    main()
