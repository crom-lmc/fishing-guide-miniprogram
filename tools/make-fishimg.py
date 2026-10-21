# -*- coding: utf-8 -*-
"""鱼种配图生成器 v3：非对称体型 + 真鱼识别特征，输出透明底 PNG。

用法：在项目根目录执行  python tools/make-fishimg.py
依赖：pillow

v3 相比 v1 的改进（v1 所有鱼共用对称椭圆包络，缩略图下分不出鱼种）：
  1. 背峰/腹峰位置分离（PKB/PKF），头尾收敛指数分开（PHB/PTB/PHF/PTF）
  2. 体型按真鱼长高比定制：草鱼/鳡鱼/鲅鱼细长，鳊鱼高身，泥鳅/黄鳝鳗形
  3. 真鱼特征：鲤鱼头前隆起(hump)、鲈鳜类棘状背鳍(spiny)、
     翘嘴鳜鱼鳡鱼上翘下颌(upjaw)、鲶黄颡类长须(barbel)、黑鱼圆尾横带等
  4. 眼睛嵌入头部、嘴不再有管状突出、背部压暗改柔和渐变带

为什么不用照片：一是版权，二是小程序包体。矢量简笔画 300x200 单张 1~3KB，
33 张合计才几十 KB，而且深浅两种主题下都能看清（照片在深色底上边缘会糊）。
"""
from PIL import Image, ImageDraw
import os
import math

W, H = 300, 200
CY = H * 0.52
OUT = "images/fish"


def hex2rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def shade(h, k):
    r, g, b = hex2rgb(h)
    return "#%02x%02x%02x" % (int(r * k), int(g * k), int(b * k))


def env(t, pk, ph, pt):
    """半边包络：pk=峰位，ph=峰前(头)收敛指数，pt=峰后(尾)收敛指数。"""
    if t <= 0 or t >= 1:
        return 0.0
    return (t / pk) ** ph if t < pk else ((1 - t) / (1 - pk)) ** pt


def lerp(a, b, t):
    return a + (b - a) * t


class Fish:
    def __init__(self, s):
        self.s = s
        self.L = s.get("L", 196)
        self.hb = s.get("H", 46)             # 背部最高
        self.hf = s.get("HF", self.hb * 0.9)  # 腹部最深
        self.pkb = s.get("PKB", 0.42)
        self.pkf = s.get("PKF", 0.50)
        self.phb = s.get("PHB", 0.9)
        self.ptb = s.get("PTB", 0.8)
        self.phf = s.get("PHF", 0.9)
        self.ptf = s.get("PTF", 0.8)
        self.x0 = (W - self.L) / 2 + 10
        self.x1 = self.x0 + self.L

    def t2x(self, t):
        return self.x0 + (self.x1 - self.x0) * t

    def yback(self, t):
        hp = 0.0
        if self.s.get("hump"):
            hp = self.s["hump"] * math.exp(-((t - self.s.get("humpT", 0.3)) ** 2)
                                           / (2 * self.s.get("humpW", 0.14) ** 2))
        return CY - self.hb * env(t, self.pkb, self.phb, self.ptb) - hp

    def ybelly(self, t):
        return CY + self.hf * env(t, self.pkf, self.phf, self.ptf)

    def draw(self):
        s = self.s
        col = hex2rgb(s["c"])
        dark = hex2rgb(s.get("d", shade(s["c"], 0.62)))
        fin = hex2rgb(s.get("f", s["c"]))
        img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        L, x0, x1 = self.L, self.x0, self.x1

        # ---- 背鳍（画在身体后面，让根部被身体盖住）----
        dft, dft2 = 0.36, 0.60
        if s.get("spiny"):
            # 棘状背鳍：一排小三角刺 + 后接软条（鲈、鳜、罗非、鲷类）
            for i in range(5):
                t = 0.30 + i * 0.045
                bx, by = self.t2x(t), self.yback(t) + 8
                hgt = self.hb * 0.34 * (1 - i * 0.10)
                d.polygon([(bx - 4, by), (bx + 4, by), (bx, by - hgt)], fill=fin + (235,))
            fx, fx2 = self.t2x(0.56), self.t2x(0.74)
            d.polygon([(fx, self.yback(0.56) + 8), (fx2, self.yback(0.74) + 8),
                       (lerp(fx, fx2, 0.5), self.yback(0.56) + 8 - self.hb * 0.22)],
                      fill=fin + (225,))
        else:
            d.polygon([(self.t2x(dft), self.yback(dft) + 8),
                       (self.t2x(dft2), self.yback(dft2) + 8),
                       (lerp(self.t2x(dft), self.t2x(dft2), 0.55),
                        self.yback(dft) + 8 - self.hb * 0.42 * s.get("dfin", 0.55))],
                      fill=fin + (235,))

        # ---- 臀鳍 ----
        a1, a2 = 0.68, 0.84
        d.polygon([(self.t2x(a1), self.ybelly(a1) - 8), (self.t2x(a2), self.ybelly(a2) - 8),
                   (lerp(self.t2x(a1), self.t2x(a2), 0.4),
                    self.ybelly(a1) - 8 + self.hf * 0.26)], fill=fin + (215,))

        # ---- 尾鳍 ----
        ty = CY
        if s.get("tail", "fork") == "fork":
            dep = self.hb * 0.72 * s.get("forkD", 1.0)
            d.polygon([(x1 - 4, ty), (x1 + 40, ty - dep), (x1 + 18, ty),
                       (x1 + 40, ty + dep)], fill=fin + (230,))
        elif s["tail"] == "round":
            d.polygon([(x1 - 4, ty - 6), (x1 + 28, ty - self.hb * 0.6), (x1 + 34, ty),
                       (x1 + 28, ty + self.hb * 0.6), (x1 - 4, ty + 6)], fill=fin + (230,))
        elif s["tail"] == "point":
            d.polygon([(x1 - 4, ty - 7), (x1 + 40, ty), (x1 - 4, ty + 7)], fill=fin + (230,))
        else:  # eel
            d.polygon([(x1 - 8, ty - 12), (x1 + 30, ty - 2), (x1 + 30, ty + 5),
                       (x1 - 8, ty + 14)], fill=fin + (220,))

        # ---- 身体（非对称包络）----
        n = 120
        up = [(self.t2x(i / n), self.yback(i / n)) for i in range(n + 1)]
        dn = [(self.t2x(i / n), self.ybelly(i / n)) for i in range(n + 1)]
        d.polygon(up + list(reversed(dn)), fill=col + (255,))

        # ---- 背部压暗（渐变带，柔和）----
        for k in range(4):
            b_up = [(self.t2x(i / n), self.yback(i / n)) for i in range(n + 1)]
            b_dn = [(x, CY + (y - CY) * (0.42 - k * 0.08)) for x, y in b_up]
            sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
            sd = ImageDraw.Draw(sh)
            sd.polygon(b_up + list(reversed(b_dn)), fill=dark + (38,))
            img = Image.alpha_composite(img, sh)
        d = ImageDraw.Draw(img)

        # ---- 斑纹 ----
        pat = s.get("pattern", "none")
        if pat == "bands":
            for i in range(7):
                t = 0.20 + i * 0.115
                if t > 0.88:
                    break
                d.line([(self.t2x(t), self.yback(t) + 3),
                        (self.t2x(t), self.ybelly(t) - 3)], fill=dark + (150,), width=5)
        elif pat == "spots":
            for t, off in [(0.24, -0.1), (0.34, 0.22), (0.46, -0.26), (0.54, 0.15),
                           (0.64, -0.06), (0.72, 0.3), (0.80, -0.16), (0.38, 0.42)]:
                mx = self.t2x(t)
                e = min(env(t, self.pkb, self.phb, self.ptb),
                        env(t, self.pkf, self.phf, self.ptf))
                my = CY + max(self.hb, self.hf) * off * e
                d.ellipse([mx - 3.2, my - 3.2, mx + 3.2, my + 3.2], fill=dark + (185,))
        elif pat == "stripe":
            d.line([(x0 + L * 0.10, CY - self.hb * 0.06),
                    (x1 - L * 0.08, CY + self.hf * 0.06)], fill=dark + (130,), width=4)
        elif pat == "marble":
            for t, off, r in [(0.32, -0.2, 8), (0.50, 0.26, 10), (0.66, -0.08, 7)]:
                mx = self.t2x(t)
                my = CY + max(self.hb, self.hf) * off * 0.6
                d.ellipse([mx - r, my - r * 0.55, mx + r, my + r * 0.55], fill=dark + (110,))

        # ---- 鳃盖弧线 ----
        gx = self.t2x(0.17)
        d.arc([gx - 10, self.yback(0.17) + 2, gx + 10, self.ybelly(0.17) - 2],
              290, 70, fill=dark + (100,), width=2)

        # ---- 胸鳍 ----
        px, py = self.t2x(0.24), self.ybelly(0.24)
        d.ellipse([px - 5, py - 6, px + 18, py + 10], fill=fin + (200,))

        # ---- 眼（嵌入头部，小而自然）----
        et = 0.09
        ex = self.t2x(et)
        ey = CY - self.hb * env(et, self.pkb, self.phb, self.ptb) * 0.45
        er = max(3.0, self.hb * 0.085)
        d.ellipse([ex - er, ey - er, ex + er, ey + er], fill=(240, 238, 232, 255))
        pr = er * 0.52
        d.ellipse([ex - pr + 0.8, ey - pr, ex + pr + 0.8, ey + pr], fill=(20, 22, 28, 255))

        # ---- 嘴（吻部短弧线，不突出）----
        my = CY + self.hf * 0.18
        if s.get("upjaw"):
            d.arc([x0 - 4, my - 14, x0 + L * 0.14, my + 6], 100, 250,
                  fill=dark + (210,), width=3)
        elif s.get("bigmouth"):
            d.arc([x0 - 8, my - 14, x0 + 24, my + 8], 150, 320, fill=dark + (200,), width=3)
        else:
            d.line([(x0 + 1, my), (x0 + L * 0.055, my + 3)], fill=dark + (190,), width=2)

        # ---- 须 ----
        for i in range(s.get("barbel", 0)):
            sy = my + (i - (s["barbel"] - 1) / 2) * 7
            ln = 20 + i * 5
            d.line([(x0 + 2, sy), (x0 - ln, sy + 8 + i * 5)], fill=dark + (190,), width=2)

        return img


# name=文件名（拼音）  cn=中文名（只作注释）  其余为体型/配色参数
# 体型参照真鱼：H=体高(背峰) HF=腹深 L=体长 PKB/PKF=背腹峰位 PHB/PTB/PHF/PTF=头尾收敛
SPECS = [
    # ---- 鲤科 · 中等体型 ----
    dict(name="jiyu",       cn="鲫鱼",     c="#a78bfa", L=186, H=48, HF=42, PKB=0.35, PHB=0.6, PKF=0.46, tail="fork"),
    dict(name="liyu",       cn="鲤鱼",     c="#c9a227", L=206, H=48, HF=42, PKB=0.33, PHB=0.62, PKF=0.47, hump=5, humpT=0.24, barbel=2, tail="fork"),
    dict(name="caoyu",      cn="草鱼",     c="#7fa65c", L=214, H=33, HF=30, PKB=0.46, PHB=1.0, PKF=0.5, tail="fork"),
    dict(name="qingyu",     cn="青鱼",     c="#4a5560", L=212, H=32, HF=29, PKB=0.46, PHB=1.0, PKF=0.5, tail="fork"),
    dict(name="lingyu",     cn="鲮鱼",     c="#22d3ee", L=192, H=38, HF=34, PKB=0.42, PHB=0.85, PKF=0.5, tail="fork"),
    dict(name="junyu",      cn="军鱼",     c="#38bdf8", L=200, H=38, HF=34, PKB=0.44, PHB=0.9, PKF=0.5, tail="fork"),
    dict(name="huaguyu",    cn="花骨鱼",   c="#fb7185", L=188, H=30, HF=27, PKB=0.44, PHB=0.95, PKF=0.5, pattern="spots", barbel=2, tail="fork"),
    dict(name="dinggui",    cn="丁鱥",     c="#2dd4bf", L=186, H=44, HF=40, PKB=0.40, PHB=0.75, PKF=0.48, barbel=2, tail="round"),
    # ---- 高身侧扁 ----
    dict(name="bianyu",     cn="鳊鱼",     c="#9aa7b5", L=176, H=54, HF=48, PKB=0.48, PHB=1.05, PKF=0.50, PHF=1.05, tail="fork"),
    dict(name="heidiao",    cn="黑鲷",     c="#94a3b8", L=186, H=48, HF=42, PKB=0.42, PHB=0.85, PKF=0.5, spiny=True, tail="fork"),
    dict(name="pangpi",     cn="鳑鲏",     c="#c084fc", L=150, H=44, HF=38, PKB=0.44, PHB=0.85, PKF=0.5, pattern="bands", tail="fork"),
    # ---- 细长形（白条族/鳡鱼族）----
    dict(name="qiaozui",    cn="翘嘴",     c="#93b8d8", L=222, H=30, HF=26, PKB=0.50, PHB=1.1, PKF=0.52, upjaw=True, pattern="stripe", tail="fork", forkD=1.2),
    dict(name="baitiao",    cn="白条",     c="#cbd5e1", L=186, H=22, HF=19, PKB=0.48, PHB=1.1, PKF=0.52, pattern="stripe", tail="fork", forkD=1.25),
    dict(name="huangweigui",cn="黄尾鲴",   c="#fbbf24", L=196, H=30, HF=26, PKB=0.46, PHB=1.0, PKF=0.5, tail="fork"),
    dict(name="chiyanzun",  cn="赤眼鳟",   c="#f97316", L=200, H=30, HF=27, PKB=0.46, PHB=1.0, PKF=0.5, pattern="stripe", tail="fork"),
    dict(name="ganyu",      cn="鳡鱼",     c="#84cc16", L=224, H=30, HF=26, PKB=0.48, PHB=1.1, PKF=0.5, upjaw=True, tail="point"),
    dict(name="bayu",       cn="鲅鱼",     c="#64748b", L=220, H=26, HF=22, PKB=0.48, PHB=1.1, PKF=0.5, bigmouth=True, tail="fork", forkD=1.3),
    dict(name="shajianyu",  cn="沙尖鱼",   c="#a3a3a3", L=192, H=20, HF=17, PKB=0.46, PHB=1.05, PKF=0.5, tail="fork"),
    dict(name="maisuiyu",   cn="麦穗鱼",   c="#9ca3af", L=152, H=24, HF=21, PKB=0.42, PHB=0.9, PKF=0.5, tail="fork"),
    dict(name="makouyu",    cn="马口鱼",   c="#e879f9", L=176, H=26, HF=22, PKB=0.44, PHB=1.0, PKF=0.5, bigmouth=True, pattern="bands", tail="fork"),
    # ---- 黑鱼/斑鳢 ----
    dict(name="heiyu",      cn="黑鱼",     c="#3f4a3a", L=212, H=32, HF=29, PKB=0.48, PHB=0.85, PKF=0.52, pattern="bands", bigmouth=True, tail="round"),
    # ---- 鲈形目（棘背鳍）----
    dict(name="guiyu",      cn="鳜鱼",     c="#8d7a4e", L=184, H=44, HF=38, PKB=0.40, PHB=0.72, PKF=0.5, spiny=True, upjaw=True, pattern="spots", tail="round"),
    dict(name="jiazhoulu",  cn="鲈鱼(加州鲈)", c="#5b7f95", L=200, H=40, HF=36, PKB=0.44, PHB=0.9, PKF=0.5, spiny=True, bigmouth=True, pattern="spots", tail="fork"),
    dict(name="hailu",      cn="鲈鱼(海)", c="#0ea5e9", L=204, H=40, HF=36, PKB=0.44, PHB=0.9, PKF=0.5, spiny=True, bigmouth=True, pattern="spots", tail="fork"),
    dict(name="luofeiyu",   cn="罗非鱼",   c="#6b8e8a", L=180, H=52, HF=46, PKB=0.44, PHB=0.85, PKF=0.5, spiny=True, pattern="bands", tail="round"),
    dict(name="shibanyu",   cn="石斑鱼",   c="#78716c", L=188, H=48, HF=42, PKB=0.42, PHB=0.85, PKF=0.5, spiny=True, bigmouth=True, pattern="spots", tail="round"),
    # ---- 鲢鳙 ----
    dict(name="lianyong",   cn="鲢鳙",     c="#8fa3b8", L=202, H=44, HF=38, PKB=0.38, PHB=0.7, PKF=0.5, pattern="spots", tail="fork"),
    # ---- 鲶形目（长须/大口）----
    dict(name="nianyu",     cn="鲶鱼",     c="#8b7355", L=208, H=36, HF=38, PKB=0.26, PHB=0.5, PTB=0.5, PKF=0.30, PHF=0.5, PTF=0.5, barbel=4, bigmouth=True, pattern="marble", tail="round"),
    dict(name="huangsangyu",cn="黄颡鱼",   c="#c9a04a", L=180, H=34, HF=36, PKB=0.28, PHB=0.55, PTB=0.55, PKF=0.32, PHF=0.55, PTF=0.55, barbel=4, bigmouth=True, pattern="marble", tail="fork", forkD=0.85),
    # ---- 鳗形/底栖 ----
    dict(name="niqiu",      cn="泥鳅",     c="#78716c", L=212, H=16, HF=16, PKB=0.30, PHB=0.7, PTB=0.45, PKF=0.34, tail="eel", barbel=4, pattern="marble"),
    dict(name="huangshan",  cn="黄鳝",     c="#ca8a04", L=224, H=14, HF=14, PKB=0.30, PHB=0.7, PTB=0.45, PKF=0.34, tail="eel"),
    dict(name="shatangli",  cn="沙塘鳢",   c="#a16207", L=176, H=42, HF=40, PKB=0.30, PHB=0.65, PTB=0.6, PKF=0.36, PHF=0.65, PTF=0.6, bigmouth=True, pattern="marble", tail="round"),
    # ---- 狗鱼 ----
    dict(name="baibangouyu",cn="白斑狗鱼", c="#4ade80", L=222, H=32, HF=28, PKB=0.46, PHB=1.0, PKF=0.5, bigmouth=True, pattern="spots", tail="fork"),
]


def main():
    os.makedirs(OUT, exist_ok=True)
    total = 0
    for s in SPECS:
        im = Fish(s).draw()
        path = "%s/%s.png" % (OUT, s["name"])
        im.save(path, "PNG", optimize=True)
        size = os.path.getsize(path)
        total += size
        print("%-16s %-8s %5d B" % (s["name"], s["cn"], size))
    print("--- 共 %d 张，合计 %.1f KB" % (len(SPECS), total / 1024.0))


if __name__ == "__main__":
    main()
