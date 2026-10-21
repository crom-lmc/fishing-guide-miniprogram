# -*- coding: utf-8 -*-
"""处理 AI 生成的路亚假饵图：抹水印 → 品红底抠图 → 去镶边 → 连通域过滤 → 居中缩放。

用法：项目根目录执行  python tools/process-ailure.py
依赖：pillow numpy scipy
"""
from PIL import Image, ImageDraw
import numpy as np
from scipy import ndimage
import os
import glob

SRC = "tools/ai-lure"
OUT = "images/lure"
CANVAS = (200, 200)
PAD_RATIO = 0.04
BAND_RATIO = 0.055
T0, T1 = 60, 150   # 品红底：色距拉得开，阈值可以开大，抠得干净

# 生成图文件名 → 输出拼音名
MAP = [
    ("亮片", "liangpian"), ("米诺", "minuo"), ("VIB", "vib"), ("波扒", "bopa"),
    ("小胖子", "crank"), ("铅头钩", "qiantougou"), ("德州", "dezhou"),
    ("雷蛙", "leizao"), ("胡须佬", "huxulao"), ("铁板", "tieban"),
    ("干式毛钩", "ganshi"), ("若虫", "ruochong"), ("streamer", "streamer"),
]


def sample_bg(im):
    arr = np.asarray(im.convert("RGB")).astype(np.float32)
    w, h = im.size
    pts = np.array([arr[3, 3], arr[3, w - 4], arr[h - 4, 3], arr[h - 4, w - 4]])
    return np.median(pts, axis=0)


def process(src, dst):
    im = Image.open(src).convert("RGBA")
    w, h = im.size
    bg = sample_bg(im)

    band = int(h * BAND_RATIO)
    d = ImageDraw.Draw(im)
    d.rectangle([0, h - band, w, h], fill=tuple(int(v) for v in bg) + (255,))

    arr = np.asarray(im.convert("RGB")).astype(np.float32)
    dist = np.sqrt(((arr - bg) ** 2).sum(axis=2))
    alpha = np.clip((dist - T0) / (T1 - T0), 0, 1) * 255

    a = alpha / 255.0
    edge = (a > 0.12) & (a < 0.985)
    with np.errstate(divide="ignore", invalid="ignore"):
        unmix = (arr - (1 - a[..., None]) * bg) / np.maximum(a[..., None], 1e-3)
    arr[edge] = np.clip(unmix[edge], 0, 255)

    mask = alpha > 40
    lab, n = ndimage.label(mask)
    if n > 1:
        sizes = ndimage.sum(mask, lab, range(1, n + 1))
        keep = int(np.argmax(sizes)) + 1
        alpha[(lab != keep) & mask] = 0

    out = np.dstack([arr.astype(np.uint8), alpha.astype(np.uint8)])
    im = Image.fromarray(out, "RGBA")

    # 用强不透明像素（alpha>90）重新求紧贴框，避免半透明残影把裁切框撑大
    # 导致本体在画布里偏移；弱像素（羽化边）随后再补回留白里
    strong = np.asarray(im.split()[3]) > 90
    ys, xs = np.where(strong)
    if ys.size:
        pad = int(max(ys.max() - ys.min(), xs.max() - xs.min()) * PAD_RATIO) + 4
        im = im.crop((max(0, int(xs.min()) - pad), max(0, int(ys.min()) - pad),
                      min(w, int(xs.max()) + pad), min(h, int(ys.max()) + pad)))
    im.thumbnail(CANVAS, Image.LANCZOS)
    canvas = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
    canvas.paste(im, ((CANVAS[0] - im.width) // 2, (CANVAS[1] - im.height) // 2), im)
    canvas.save(dst, "PNG", optimize=True)
    return os.path.getsize(dst)


def main():
    os.makedirs(OUT, exist_ok=True)
    files = glob.glob(os.path.join(SRC, "*.png"))
    total, missing = 0, []
    for cn, key in MAP:
        hit = next((f for f in files if cn in os.path.basename(f)), None)
        if not hit:
            missing.append(cn)
            continue
        total += process(hit, os.path.join(OUT, key + ".png"))
        print("%-12s %-8s ok" % (key, cn))
    print("--- 共 %d 张，合计 %.1f KB" % (len(MAP) - len(missing), total / 1024.0))
    if missing:
        print("!!! 未找到：", "、".join(missing))


if __name__ == "__main__":
    main()
