# -*- coding: utf-8 -*-
"""路亚假饵配图速览：python tools/lure-all.py [cols]"""
from PIL import Image, ImageDraw, ImageFont
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COLN = int(sys.argv[1]) if len(sys.argv) > 1 else 4
NAMES = [("liangpian", "亮片"), ("minuo", "米诺"), ("vib", "VIB"), ("bopa", "波扒"),
         ("crank", "小胖子"), ("qiantougou", "铅头钩+T尾"), ("dezhou", "德州钓组"),
         ("leizao", "雷蛙"), ("huxulao", "胡须佬"), ("tieban", "铁板"),
         ("ganshi", "干式毛钩"), ("ruochong", "若虫"), ("streamer", "Streamer")]

CELL_W, CELL_H, PAD = 200, 150, 8
font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 15)
rows = (len(NAMES) + COLN - 1) // COLN
img = Image.new("RGB", (PAD + COLN * (CELL_W + PAD), PAD + rows * (CELL_H + PAD)), (18, 20, 26))
d = ImageDraw.Draw(img)

for i, (key, cn) in enumerate(NAMES):
    r, c = divmod(i, COLN)
    x, y = PAD + c * (CELL_W + PAD), PAD + r * (CELL_H + PAD)
    d.rectangle([x, y, x + CELL_W, y + CELL_H], fill=(30, 33, 42), outline=(55, 60, 72))
    p = os.path.join(ROOT, "images", "lure", key + ".png")
    if os.path.exists(p):
        im = Image.open(p).convert("RGBA")
        im.thumbnail((CELL_W - 12, CELL_H - 40))
        img.paste(im, (x + (CELL_W - im.width) // 2,
                       y + (CELL_H - 40 - im.height) // 2 + 2), im)
    d.text((x + (CELL_W - len(cn) * 15) // 2, y + CELL_H - 30), cn,
           fill=(225, 225, 232), font=font)

out = os.path.join(ROOT, "tools", "lure-preview.png")
img.save(out)
print("saved: tools/lure-preview.png", img.size)
