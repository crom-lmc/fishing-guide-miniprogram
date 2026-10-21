"""生成 tabBar 图标（81×81 PNG）。

为什么用脚本画：手绘/截图裁切很难保证五个图标视觉大小一致、且居中；
这里统一在 4 倍画布上按「81 单位」坐标系绘制，再按墨迹范围归一化居中。

用法：python tools/make-tabicons.py
"""
import math
import os

from PIL import Image, ImageDraw

S = 4                          # 超采样倍数（324 -> 81，抗锯齿）
N = 81 * S
GRAY = (138, 147, 166, 255)    # #8A93A6 未选中
TEAL = (23, 162, 155, 255)     # #17A29B 选中


def canvas():
    im = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    return im, ImageDraw.Draw(im)


def dot(d, x, y, r, c):
    d.ellipse([(x - r) * S, (y - r) * S, (x + r) * S, (y + r) * S], fill=c)


def arc_pts(cx, cy, r, a0, a1, n=48):
    """角度制折线采样。0°=右、90°=下（屏幕坐标 y 向下），顺时针增大。"""
    out = []
    for i in range(n + 1):
        a = math.radians(a0 + (a1 - a0) * i / n)
        out.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return out


def pl(d, pts, w, c, cap=True):
    flat = []
    for (x, y) in pts:
        flat.append(x * S)
        flat.append(y * S)
    d.line(flat, fill=c, width=int(w * S), joint="curve")
    if cap:
        dot(d, pts[0][0], pts[0][1], w / 2, c)
        dot(d, pts[-1][0], pts[-1][1], w / 2, c)


# ---------- 1 出钓指数：仪表盘 ----------
def ic_index(c):
    im, d = canvas()
    pl(d, arc_pts(40.5, 46, 24, 180, 360), 4.4, c)         # 上半圆 = 表盘
    pl(d, [(40.5, 46), (51.5, 32.5)], 4.4, c)              # 指针
    dot(d, 40.5, 46, 3.2, c)
    return im


# ---------- 2 鱼种图鉴：鱼 ----------
def ic_fish(c):
    im, d = canvas()
    d.ellipse([26 * S, 29 * S, 63 * S, 53 * S], outline=c, width=int(4.4 * S))   # 身体
    pl(d, [(27.5, 30), (13, 41), (27.5, 52)], 4.4, c)                            # 尾鳍（V 形缺口）
    dot(d, 54.5, 37.5, 2.3, c)                                                   # 眼
    return im


# ---------- 3 钓法：竿 + 线 + 钩 ----------
def ic_method(c):
    im, d = canvas()
    pl(d, [(13, 70), (54, 19)], 4.8, c)                    # 竿
    pl(d, [(54, 19.5), (54, 40)], 1.9, c)                  # 线
    pl(d, arc_pts(46, 40, 8, 0, 168), 2.8, c)              # 钩（右→下→左，末梢上翘）
    return im


# ---------- 4 饵料：钩 + 饵球 ----------
def ic_bait(c):
    im, d = canvas()
    pl(d, [(33, 14), (33, 44)], 2.2, c)                    # 线
    pl(d, arc_pts(41, 44, 8.5, 180, -30), 3.2, c)          # 钩（左→下→右上勾起）
    dot(d, 40, 52.5, 5.6, c)                               # 饵球（挂在钩弯处）
    return im


# ---------- 5 我的：人像 ----------
def ic_mine(c):
    im, d = canvas()
    d.ellipse([29.5 * S, 15 * S, 51.5 * S, 37 * S], outline=c, width=int(4.4 * S))   # 头
    pl(d, arc_pts(40.5, 64, 22, 190, 350), 4.4, c)                                   # 肩（浅弧）
    return im


ICONS = [("tab-index", ic_index), ("tab-fish", ic_fish), ("tab-method", ic_method),
         ("tab-bait", ic_bait), ("tab-mine", ic_mine)]


def normalize(im, target=54):
    """按墨迹范围裁剪 → 等比缩放到统一视觉尺寸 → 居中。"""
    bb = im.getbbox()
    icon = im.crop(bb)
    w, h = icon.size
    k = (target * S) / max(w, h)
    icon = icon.resize((max(1, int(w * k)), max(1, int(h * k))), Image.LANCZOS)
    out = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    out.paste(icon, (int(N / 2 - icon.size[0] / 2), int(N / 2 - icon.size[1] / 2)), icon)
    return out


if __name__ == "__main__":
    for name, fn in ICONS:
        for suffix, col in (("", GRAY), ("-on", TEAL)):
            im = normalize(fn(col)).resize((81, 81), Image.LANCZOS)
            p = "images/%s%s.png" % (name, suffix)
            im.save(p, "PNG", optimize=True)
            print("%-22s %5d B  bbox=%s" % (p, os.path.getsize(p), im.getbbox()))
