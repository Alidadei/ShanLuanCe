# -*- coding: utf-8 -*-
"""生成 PWA 图标：宣纸底 + 朱砂印章「巡」字（与 UI 品牌一致）。"""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

IMG = Path(__file__).resolve().parent.parent / "img"
IMG.mkdir(exist_ok=True)

PAPER = (250, 248, 242)      # 宣纸
CINNABAR = (184, 68, 44)     # 朱砂
CINNABAR_DEEP = (150, 53, 29)
INK = (34, 50, 43)

FONT = "C:/Windows/Fonts/simkai.ttf"


def make_icon(size: int, maskable: bool = False) -> Image.Image:
    img = Image.new("RGB", (size, size), PAPER)
    d = ImageDraw.Draw(img)

    # maskable 图标安全区：内容限制在中央 80%
    scale = 0.62 if maskable else 0.78
    seal = int(size * scale)
    x0 = (size - seal) // 2
    y0 = (size - seal) // 2
    r = int(seal * 0.18)

    # 印章投影
    sh = int(size * 0.012)
    d.rounded_rectangle([x0 + sh, y0 + sh, x0 + seal + sh, y0 + seal + sh], radius=r,
                        fill=(28, 44, 36, 40))
    # 朱砂方章
    d.rounded_rectangle([x0, y0, x0 + seal, y0 + seal], radius=r, fill=CINNABAR)
    # 内描边（印章双框）
    inset = int(seal * 0.045)
    d.rounded_rectangle([x0 + inset, y0 + inset, x0 + seal - inset, y0 + seal - inset],
                        radius=int(r * 0.75), outline=PAPER, width=max(2, int(size * 0.008)))

    # 「巡」字
    fs = int(seal * 0.62)
    font = ImageFont.truetype(FONT, fs)
    bbox = d.textbbox((0, 0), "山", font=font)
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text((x0 + (seal - w) / 2 - bbox[0], y0 + (seal - h) / 2 - bbox[1]), "山",
           font=font, fill=PAPER)

    # 底部小字「山」点缀（仅非 maskable 大图）
    if not maskable and size >= 192:
        f2 = ImageFont.truetype(FONT, int(size * 0.075))
        b2 = d.textbbox((0, 0), "山峦册", font=f2)
        d.text(((size - (b2[2] - b2[0])) / 2, y0 + seal + size * 0.015),
               "山峦册", font=f2, fill=INK)

    return img


for s in (192, 512):
    make_icon(s).save(IMG / f"icon-{s}.png")
make_icon(512, maskable=True).save(IMG / "icon-maskable-512.png")
make_icon(180).save(IMG / "apple-touch-icon.png")
print("[ok] 图标已生成：icon-192 / icon-512 / icon-maskable-512 / apple-touch-icon")
