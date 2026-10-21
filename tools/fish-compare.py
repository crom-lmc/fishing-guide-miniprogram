# -*- coding: utf-8 -*-
"""生成 v1(旧) vs v3(新) 鱼图对比大图，输出 tools/fish-preview/_compare.png"""
from PIL import Image, ImageDraw, ImageFont
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # 项目根
FISH = ["jiyu", "liyu", "caoyu", "bianyu", "qiaozui",
        "heiyu", "guiyu", "nianyu", "baitiao", "niqiu"]
CN = {"jiyu": "鲫鱼", "liyu": "鲤鱼", "caoyu": "草鱼", "bianyu": "鳊鱼",
      "qiaozui": "翘嘴", "heiyu": "黑鱼", "guiyu": "鳜鱼", "nianyu": "鲶鱼",
      "baitiao": "白条", "niqiu": "泥鳅"}

CELL_W, CELL_H = 240, 130
COLS = 2  # 左旧右新
ROWS = len(FISH)
PAD = 8
HEAD = 34
W = HEAD + COLS * CELL_W + PAD * (COLS + 1)
H = HEAD + ROWS * CELL_H + PAD * (ROWS + 1)

img = Image.new("RGB", (W, H), (18, 20, 26))
d = ImageDraw.Draw(img)
font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 16)
font_s = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 13)
font_h = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 18)

d.text((HEAD + PAD, PAD + 6), "旧版 v1", fill=(200, 205, 215), font=font_h)
d.text((HEAD + PAD + CELL_W + PAD, PAD + 6), "新版 v3", fill=(120, 220, 160), font=font_h)

for r, name in enumerate(FISH):
    y = HEAD + PAD + r * (CELL_H + PAD)
    d.text((PAD + 4, y + CELL_H // 2 - 10), CN[name], fill=(230, 230, 235), font=font)
    for c, base in enumerate(["images/fish", "tools/fish-preview"]):
        x = HEAD + PAD + c * (CELL_W + PAD)
        # 格子底
        d.rectangle([x, y, x + CELL_W - PAD, y + CELL_H - PAD],
                    fill=(30, 33, 42), outline=(55, 60, 72))
        p = os.path.join(ROOT, base, name + ".png")
        if os.path.exists(p):
            im = Image.open(p).convert("RGBA")
            im.thumbnail((CELL_W - PAD - 10, CELL_H - PAD - 10))
            img.paste(im, (x + (CELL_W - PAD - im.width) // 2,
                           y + (CELL_H - PAD - im.height) // 2), im)

out = os.path.join(ROOT, "tools", "fish-preview", "_compare.png")
img.save(out)
print("saved:", out, os.path.getsize(out), "bytes")
