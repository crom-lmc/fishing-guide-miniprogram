# -*- coding: utf-8 -*-
"""鱼种配图生成器：按每种鱼的体型参数画侧面简笔图，输出透明底 PNG。

用法：在项目根目录执行  python tools/make-fishimg.py
依赖：pillow

为什么不用照片：一是版权，二是小程序包体。矢量简笔画 300x200 单张 2~6KB，
33 张合计才几十 KB，而且深浅两种主题下都能看清（照片在深色底上边缘会糊）。
"""
from PIL import Image, ImageDraw
import os
import math

W, H = 300, 200
CY = H * 0.52
OUT = "images/fish"


def lerp(a, b, t):
    return a + (b - a) * t


def hex2rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def envelope(t, p):
    """体高包络：t=0 吻端、t=1 尾柄，两头收窄。p 越小鱼越饱满（圆筒），越大越尖瘦。"""
    if t <= 0 or t >= 1:
        return 0.0
    return (1 - (2 * t - 1) ** 2) ** p


def body_poly(x0, x1, hmax, p, back, belly, n=72):
    up, dn = [], []
    for i in range(n + 1):
        t = i / n
        x = lerp(x0, x1, t)
        e = envelope(t, p)
        up.append((x, CY - hmax * back * e))
        dn.append((x, CY + hmax * belly * e))
    return up + list(reversed(dn))


def top_at(t, x0, x1, hmax, p, back):
    """背部某处的 y 坐标，用来贴背鳍"""
    x = lerp(x0, x1, t)
    return x, CY - hmax * back * envelope(t, p)


def bot_at(t, x0, x1, hmax, p, belly):
    x = lerp(x0, x1, t)
    return x, CY + hmax * belly * envelope(t, p)


def fish(spec):
    """画一条鱼，返回 RGBA 图"""
    name = spec["name"]
    L = spec.get("L", 196)
    hmax = spec.get("H", 62)
    p = spec.get("p", 0.62)
    back = spec.get("back", 1.0)
    belly = spec.get("belly", 0.92)
    col = hex2rgb(spec["c"])
    dark = hex2rgb(spec.get("d", shade(spec["c"], 0.62)))
    fin = hex2rgb(spec.get("f", spec["c"]))
    tail = spec.get("tail", "fork")
    dfin = spec.get("dfin", 0.55)
    eye = spec.get("eye", 6)
    barb = spec.get("barbel", 0)
    pat = spec.get("pattern", "none")
    snout = spec.get("snout", 0.12)

    x0 = (W - L) / 2 + 10
    x1 = x0 + L

    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # ---- 鳍（画在身体下面，这样压住的根部自然被身体盖住）----
    fx1, fy1 = top_at(0.34, x0, x1, hmax, p, back)
    fx2, fy2 = top_at(0.62, x0, x1, hmax, p, back)
    dfin_h = hmax * 0.42 * dfin
    d.polygon([(fx1, fy1 + 4), (fx2, fy2 + 4), (lerp(fx1, fx2, 0.55), fy1 - dfin_h)],
              fill=fin + (235,))

    ax1, ay1 = bot_at(0.64, x0, x1, hmax, p, belly)
    ax2, ay2 = bot_at(0.82, x0, x1, hmax, p, belly)
    d.polygon([(ax1, ay1 - 4), (ax2, ay2 - 4), (lerp(ax1, ax2, 0.4), ay1 + hmax * 0.24)],
              fill=fin + (215,))

    # 胸鳍
    px, py = bot_at(0.24, x0, x1, hmax, p, belly)
    d.ellipse([px - 6, py - 4, px + 20, py + 14], fill=fin + (200,))

    # 尾鳍
    ty = CY
    if tail == "fork":
        d.polygon([(x1 - 6, ty), (x1 + 42, ty - hmax * 0.62), (x1 + 20, ty),
                   (x1 + 42, ty + hmax * 0.62)], fill=fin + (230,))
    elif tail == "round":
        d.polygon([(x1 - 6, ty - 6), (x1 + 30, ty - hmax * 0.55), (x1 + 36, ty),
                   (x1 + 30, ty + hmax * 0.55), (x1 - 6, ty + 6)], fill=fin + (230,))
    elif tail == "point":
        d.polygon([(x1 - 6, ty - 8), (x1 + 46, ty), (x1 - 6, ty + 8)], fill=fin + (230,))
    else:  # eel：尾鳍退化成一条后掠的带
        d.polygon([(x1 - 10, ty - 14), (x1 + 34, ty - 2), (x1 + 34, ty + 6),
                   (x1 - 10, ty + 16)], fill=fin + (220,))

    # ---- 身体 ----
    d.polygon(body_poly(x0, x1, hmax, p, back, belly), fill=col + (255,))

    # 背部暗色：叠一层半透明，模拟背深腹浅
    shade_img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shade_img)
    up, dn = [], []
    for i in range(73):
        t = i / 72
        x = lerp(x0, x1, t)
        e = envelope(t, p)
        up.append((x, CY - hmax * back * e))
        dn.append((x, CY - hmax * back * e * 0.18))
    sd.polygon(up + list(reversed(dn)), fill=dark + (150,))
    img = Image.alpha_composite(img, shade_img)
    d = ImageDraw.Draw(img)

    # ---- 斑纹 ----
    if pat == "bands":        # 竖带（黑鱼、鳑鲏）
        for i in range(6):
            t = 0.16 + i * 0.13
            if t > 0.92:
                break
            bx, by = top_at(t, x0, x1, hmax, p, back)
            ex, ey = bot_at(t, x0, x1, hmax, p, belly)
            d.line([(bx, by + 2), (ex, ey - 2)], fill=dark + (170,), width=5)
    elif pat == "spots":      # 散斑（鳜鱼、花骨鱼、石斑）
        pts = [(0.22, -0.1), (0.32, 0.2), (0.44, -0.25), (0.52, 0.15),
               (0.62, -0.05), (0.70, 0.3), (0.80, -0.15), (0.36, 0.4), (0.58, -0.4)]
        for t, off in pts:
            mx = lerp(x0, x1, t)
            e = envelope(t, p)
            my = CY + hmax * off * e
            r = 3.4
            d.ellipse([mx - r, my - r, mx + r, my + r], fill=dark + (190,))
    elif pat == "stripe":     # 体侧一条纵纹（翘嘴、赤眼鳟）
        d.line([(x0 + L * 0.1, CY - hmax * 0.05), (x1 - L * 0.06, CY + hmax * 0.05)],
               fill=dark + (140,), width=4)
    elif pat == "marble":     # 大理石纹（鲶鱼、沙塘鳢）
        for t, off, r in [(0.3, -0.2, 9), (0.5, 0.25, 11), (0.68, -0.1, 8)]:
            mx = lerp(x0, x1, t)
            my = CY + hmax * off * envelope(t, p)
            d.ellipse([mx - r, my - r * 0.6, mx + r, my + r * 0.6], fill=dark + (120,))

    # ---- 鳃盖弧线 ----
    gx, gy = top_at(0.20, x0, x1, hmax, p, back)
    gx2, gy2 = bot_at(0.20, x0, x1, hmax, p, belly)
    d.line([(gx, gy + 3), (gx2, gy2 - 3)], fill=dark + (110,), width=2)

    # ---- 眼 ----
    ex = x0 + L * snout * 1.5
    ey = CY - hmax * back * envelope(snout * 1.5, p) * 0.5
    d.ellipse([ex - eye, ey - eye, ex + eye, ey + eye], fill=(250, 250, 252, 255))
    d.ellipse([ex - eye * 0.45, ey - eye * 0.45, ex + eye * 0.45, ey + eye * 0.45],
              fill=(22, 24, 30, 255))

    # ---- 嘴 ----
    my = CY + hmax * belly * 0.16
    if spec.get("bigmouth"):
        d.arc([x0 - 12, my - 16, x0 + 26, my + 10], 150, 320, fill=dark + (220,), width=3)
    else:
        d.line([(x0, my), (x0 + L * 0.06, my + 4)], fill=dark + (200,), width=3)

    # ---- 须 ----
    for i in range(barb):
        sy = my + (i - (barb - 1) / 2) * 7
        d.line([(x0 + 2, sy), (x0 - 16 - i * 4, sy + 12 + i * 5)],
               fill=dark + (200,), width=2)

    return img


def shade(h, k):
    """把颜色压暗 k 倍"""
    r, g, b = hex2rgb(h)
    return "#%02x%02x%02x" % (int(r * k), int(g * k), int(b * k))


# name=文件名（拼音）  cn=中文名（只作注释）  其余为体型/配色参数
SPECS = [
    dict(name="jiyu",       cn="鲫鱼",     c="#a78bfa", H=58, p=0.55, tail="fork"),
    dict(name="liyu",       cn="鲤鱼",     c="#c9a227", H=62, p=0.5,  tail="fork", barbel=2),
    dict(name="caoyu",      cn="草鱼",     c="#7fa65c", H=56, p=0.42, tail="fork", L=208),
    dict(name="lianyong",   cn="鲢鳙",     c="#8fa3b8", H=64, p=0.5,  tail="fork", pattern="spots"),
    dict(name="qiaozui",    cn="翘嘴",     c="#93b8d8", H=44, p=0.3,  tail="fork", L=214, pattern="stripe", bigmouth=True),
    dict(name="heiyu",      cn="黑鱼",     c="#3f4a3a", H=50, p=0.35, tail="round", L=212, pattern="bands", bigmouth=True),
    dict(name="guiyu",      cn="鳜鱼",     c="#8d7a4e", H=54, p=0.5,  tail="round", pattern="spots", bigmouth=True),
    dict(name="jiazhoulu",  cn="鲈鱼(加州鲈)", c="#5b7f95", H=50, p=0.4, tail="fork", pattern="spots", bigmouth=True),
    dict(name="huangsangyu",cn="黄颡鱼",   c="#c9a04a", H=46, p=0.4,  tail="fork", L=180, barbel=4, bigmouth=True),
    dict(name="bianyu",     cn="鳊鱼",     c="#9aa7b5", H=76, p=0.62, tail="fork", L=176),
    dict(name="qingyu",     cn="青鱼",     c="#4a5560", H=58, p=0.45, tail="fork", L=204),
    dict(name="baitiao",    cn="白条",     c="#cbd5e1", H=32, p=0.28, tail="fork", L=172, pattern="stripe"),
    dict(name="luofeiyu",   cn="罗非鱼",   c="#6b8e8a", H=66, p=0.6,  tail="round", pattern="bands"),
    dict(name="makouyu",    cn="马口鱼",   c="#e879f9", H=34, p=0.3,  tail="fork", L=168, bigmouth=True),
    dict(name="nianyu",     cn="鲶鱼",     c="#8b7355", H=48, p=0.38, tail="round", L=206, back=0.8, belly=1.0, barbel=4, bigmouth=True, pattern="marble", snout=0.16),
    dict(name="huangweigui",cn="黄尾鲴",   c="#fbbf24", H=44, p=0.38, tail="fork", L=186),
    dict(name="chiyanzun",  cn="赤眼鳟",   c="#f97316", H=46, p=0.38, tail="fork", L=196, pattern="stripe"),
    dict(name="ganyu",      cn="鳡鱼",     c="#84cc16", H=40, p=0.26, tail="point", L=220, bigmouth=True, snout=0.14),
    dict(name="junyu",      cn="军鱼",     c="#38bdf8", H=52, p=0.45, tail="fork", L=196),
    dict(name="shatangli",  cn="沙塘鳢",   c="#a16207", H=44, p=0.42, tail="round", L=176, back=0.82, belly=1.0, bigmouth=True, pattern="marble", snout=0.15),
    dict(name="niqiu",      cn="泥鳅",     c="#78716c", H=26, p=0.22, tail="eel",  L=210, barbel=4, pattern="marble", snout=0.1),
    dict(name="huangshan",  cn="黄鳝",     c="#ca8a04", H=22, p=0.2,  tail="eel",  L=214, snout=0.08),
    dict(name="huaguyu",    cn="花骨鱼",   c="#fb7185", H=42, p=0.42, tail="fork", L=184, pattern="spots", barbel=2),
    dict(name="lingyu",     cn="鲮鱼",     c="#22d3ee", H=50, p=0.48, tail="fork", L=186),
    dict(name="baibangouyu",cn="白斑狗鱼", c="#4ade80", H=38, p=0.26, tail="fork", L=218, bigmouth=True, pattern="spots", snout=0.18),
    dict(name="dinggui",    cn="丁鱥",     c="#2dd4bf", H=52, p=0.52, tail="round", L=184),
    dict(name="pangpi",     cn="鳑鲏",     c="#c084fc", H=58, p=0.7,  tail="fork", L=140, pattern="bands"),
    dict(name="maisuiyu",   cn="麦穗鱼",   c="#9ca3af", H=30, p=0.32, tail="fork", L=150),
    dict(name="heidiao",    cn="黑鲷",     c="#94a3b8", H=70, p=0.6,  tail="fork", L=182),
    dict(name="hailu",      cn="鲈鱼(海)", c="#0ea5e9", H=48, p=0.38, tail="fork", L=200, pattern="spots", bigmouth=True),
    dict(name="bayu",       cn="鲅鱼",     c="#64748b", H=38, p=0.28, tail="fork", L=214, bigmouth=True),
    dict(name="shajianyu",  cn="沙尖鱼",   c="#a3a3a3", H=26, p=0.24, tail="fork", L=186),
    dict(name="shibanyu",   cn="石斑鱼",   c="#78716c", H=62, p=0.55, tail="round", L=184, pattern="spots", bigmouth=True),
]


def main():
    os.makedirs(OUT, exist_ok=True)
    total = 0
    for s in SPECS:
        im = fish(s)
        path = "%s/%s.png" % (OUT, s["name"])
        im.save(path, "PNG", optimize=True)
        size = os.path.getsize(path)
        total += size
        print("%-16s %-8s %5d B" % (s["name"], s["cn"], size))
    print("--- 共 %d 张，合计 %.1f KB" % (len(SPECS), total / 1024.0))


if __name__ == "__main__":
    main()
