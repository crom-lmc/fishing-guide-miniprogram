# -*- coding: utf-8 -*-
"""生成图鉴鱼图速览大图：python tools/fish-all.py [pkg|ai|cmp]
   pkg = images/fish（已处理的透明底成品，默认）
   ai  = tools/ai-fish（AI 生成原图）
   cmp = 左 AI 原图 / 右 成品，对比抠图效果
"""
from PIL import Image, ImageDraw, ImageFont
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CN = {"jiyu": "鲫鱼", "liyu": "鲤鱼", "caoyu": "草鱼", "qingyu": "青鱼",
      "lingyu": "鲮鱼", "junyu": "军鱼", "huaguyu": "花骨鱼", "dinggui": "丁鱥",
      "bianyu": "鳊鱼", "heidiao": "黑鲷", "pangpi": "鳑鲏", "qiaozui": "翘嘴",
      "baitiao": "白条", "huangweigui": "黄尾鲴", "chiyanzun": "赤眼鳟",
      "ganyu": "鳡鱼", "bayu": "鲅鱼", "shajianyu": "沙尖鱼", "maisuiyu": "麦穗鱼",
      "makouyu": "马口鱼", "heiyu": "黑鱼", "guiyu": "鳜鱼", "jiazhoulu": "加州鲈",
      "hailu": "花鲈", "luofeiyu": "罗非鱼", "shibanyu": "石斑鱼", "lianyong": "鲢鳙",
      "nianyu": "鲶鱼", "huangsangyu": "黄颡鱼", "niqiu": "泥鳅", "huangshan": "黄鳝",
      "shatangli": "沙塘鳢", "baibangouyu": "白斑狗鱼"}

MODE = sys.argv[1] if len(sys.argv) > 1 else "pkg"
COLS = int(sys.argv[2]) if len(sys.argv) > 2 else 4
DIRS = {"ai": "tools/ai-fish", "pkg": "images/fish"}
# 列数多时缩小格子，避免图太高被预览面板截断
CELL_W, CELL_H, PAD = (190, 130, 8) if COLS <= 4 else (180, 118, 6)
font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 15)


def one_path(base, name):
    p = os.path.join(ROOT, base, "%s.png" % name)
    if os.path.exists(p):
        return p
    hits = [f for f in os.listdir(os.path.join(ROOT, base))
            if f.endswith(".png") and CN[name] in f]
    return os.path.join(ROOT, base, hits[0]) if hits else None


def cell(img, x, y, path, tile_bg=None):
    d = ImageDraw.Draw(img)
    d.rectangle([x, y, x + CELL_W, y + CELL_H],
                fill=tile_bg or (30, 33, 42), outline=(55, 60, 72))
    if not path:
        return
    im = Image.open(path).convert("RGBA")
    im.thumbnail((CELL_W - 10, CELL_H - 34))
    # 垂直居中：图片区高度 = CELL_H - 34（底部留给文字）
    img.paste(im, (x + (CELL_W - im.width) // 2,
                   y + (CELL_H - 34 - im.height) // 2 + 2), im)


def label(img, x, y, text):
    d = ImageDraw.Draw(img)
    d.text((x + (CELL_W - len(text) * 15) // 2, y + CELL_H - 26), text,
           fill=(225, 225, 232), font=font)


def build(cols, items):
    rows = (len(items) + cols - 1) // cols
    img = Image.new("RGB", (PAD + cols * (CELL_W + PAD), PAD + rows * (CELL_H + PAD)),
                    (18, 20, 26))
    for i, (path, text) in enumerate(items):
        r, c = divmod(i, cols)
        x, y = PAD + c * (CELL_W + PAD), PAD + r * (CELL_H + PAD)
        cell(img, x, y, path)
        label(img, x, y, text)
    return img


names = list(CN.keys())

if MODE == "cmp":
    items = []
    for n in names:
        items.append((one_path(DIRS["ai"], n), CN[n]))
        items.append((one_path(DIRS["pkg"], n), CN[n]))
    out = "tools/fish-preview/_cmp_aifish.png"
elif MODE == "ai":
    out = "tools/fish-preview/_all_aifish.png"
    items = [(one_path(DIRS["ai"], n), CN[n]) for n in names]
else:
    out = "tools/fish-preview/_pkg.png"
    items = [(one_path(DIRS["pkg"], n), CN[n]) for n in names]

img = build(COLS, items)
img.save(os.path.join(ROOT, out))
print("saved:", out)
