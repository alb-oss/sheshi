#!/usr/bin/env python3
"""Regenerate the Sheshi clasped-hands icon set.

Source (`icons/source-clasp.png`) is the black+red solidarity-grip artwork the user supplied.
It shipped as opaque RGB with a baked transparency checkerboard, so step 1 keys out the light-grey
checker to isolate the clasp; step 2 composites it onto squircle tiles; the dark variant recolours
the black arm to white. Requires Pillow + numpy.  Run from the `branding/` dir: `python3 make-icons.py`
"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SRC = "icons/source-clasp.png"
OUT = "icons/"
WHITE = (255, 255, 255, 255)
DARK = (11, 12, 15, 255)


def isolate(src):
    im = Image.open(src).convert("RGB")
    a = np.asarray(im).astype(np.int16)
    mx, mn = a.max(2), a.min(2)
    light = (mn > 200) & ((mx - mn) < 30)  # light-grey checker / white bg
    alpha = np.where(light, 0, 255).astype(np.uint8)
    clasp = Image.fromarray(np.dstack([np.asarray(im), alpha]), "RGBA")
    clasp.putalpha(clasp.split()[3].filter(ImageFilter.GaussianBlur(1.2)))
    clasp = clasp.crop(clasp.getbbox())
    w, h = clasp.size
    s = max(w, h)
    sq = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    sq.paste(clasp, ((s - w) // 2, (s - h) // 2), clasp)
    return sq


def recolor_white(img):
    arr = np.asarray(img).astype(np.int16).copy()
    r, g, b, al = arr[..., 0], arr[..., 1], arr[..., 2], arr[..., 3]
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    isred = (r > 140) & (g < 120) & (b < 120)
    isdark = (lum < 160) & (~isred) & (al > 40)
    arr[..., 0] = np.where(isdark, 244, r)
    arr[..., 1] = np.where(isdark, 245, g)
    arr[..., 2] = np.where(isdark, 247, b)
    return Image.fromarray(arr.astype(np.uint8), "RGBA")


def squircle(size, bg, full_square=False, radius_frac=0.225):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if full_square:
        d.rectangle([0, 0, size, size], fill=bg)
    else:
        d.rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * radius_frac), fill=bg)
    return img


def icon(size, bg, art, fill=0.78, full_square=False, ss=4):
    S = size * ss
    base = squircle(S, bg, full_square)
    t = int(S * fill)
    base.alpha_composite(art.resize((t, t), Image.LANCZOS), ((S - t) // 2, (S - t) // 2))
    return base.resize((size, size), Image.LANCZOS)


def on_transparent(size, art, fill):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    t = int(size * fill)
    img.alpha_composite(art.resize((t, t), Image.LANCZOS), ((size - t) // 2, (size - t) // 2))
    return img


def main():
    clasp = isolate(SRC)
    clasp_dark = recolor_white(clasp)
    icon(512, WHITE, clasp).save(OUT + "sheshi-icon-light.png")
    icon(512, DARK, clasp_dark).save(OUT + "sheshi-icon-dark.png")
    icon(48, WHITE, clasp).save(OUT + "favicon.png")
    icon(128, WHITE, clasp).save(OUT + "sheshi-mark-128.png")
    icon(180, WHITE, clasp, full_square=True).save(OUT + "apple-touch-icon.png")
    icon(1024, WHITE, clasp, full_square=True).save(OUT + "icon.png")
    on_transparent(1024, clasp, 0.60).save(OUT + "adaptive-icon.png")
    on_transparent(1024, clasp, 0.42).save(OUT + "splash-icon.png")
    for f in sorted(os.listdir(OUT)):
        if f.endswith(".png"):
            print(f, Image.open(OUT + f).size)


if __name__ == "__main__":
    main()
