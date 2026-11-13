"""Pull an equirectangular skybox's floor closer, as if the camera sat lower (2026-11-13, the user picked 1.5).

Rows below the horizon are remapped; rows above it are untouched. The floor (rows below y0, the line where the walls
meet the floor at its highest) follows a floor plane seen from height h/m: an output row at depression angle d samples
the source at atan(m * tan(d)), so every floor tile grows (about m times near the point straight down) and the floor line
rises from its depression t0 to atan(tan(t0) / m). The strip of wall between the horizon and the floor line is squeezed
linearly to fit, so the lower walls look a little shorter (hardly visible at 1.5, visible at 2).

    python -I tools/warp-skybox.py <src.jpg> <out.jpg> [m=1.5] [y0=1340]

y0 is in source pixels for a 2048-row image (scaled for other heights). For assets/ariande-skybox-4096.jpg the floor
starts at about row 1340. Needs Pillow and numpy.
"""
import math
import sys

import numpy as np
from PIL import Image


def bilinear(img, x, y):
    h, w = img.shape[:2]
    x = np.mod(x, w)
    y = np.clip(y, 0, h - 1)
    x0 = np.floor(x).astype(int)
    y0 = np.floor(y).astype(int)
    fx = (x - x0)[..., None]
    fy = (y - y0)[..., None]
    x1 = (x0 + 1) % w
    y1 = np.minimum(y0 + 1, h - 1)
    top = img[y0, x0] * (1 - fx) + img[y0, x1] * fx
    bot = img[y1, x0] * (1 - fx) + img[y1, x1] * fx
    return top * (1 - fy) + bot * fy


def source_rows(h, y0, m):
    """For each output row (centre), the source row it samples."""
    ys = np.arange(h, dtype=np.float64) + 0.5
    src = ys.copy()
    half = h / 2
    deg = lambda y: (y - half) / half * (math.pi / 2)  # depression angle below the horizon (negative above it)
    row = lambda th: half + th / (math.pi / 2) * half
    th0 = deg(y0)
    th0o = math.atan(math.tan(th0) / m)
    th = deg(ys)
    wall = (th > 0) & (th <= th0o)
    floor = th > th0o
    src[wall] = row(th[wall] * (th0 / th0o))
    src[floor] = row(np.arctan(m * np.tan(np.minimum(th[floor], math.pi / 2 - 1e-6))))
    return src


def warp(img, y0, m):
    h, w = img.shape[:2]
    src = source_rows(h, y0, m)
    yy = np.repeat((src - 0.5)[:, None], w, axis=1)
    xx = np.repeat(np.arange(w, dtype=np.float64)[None, :], h, axis=0)
    return bilinear(img, xx, yy)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    src, out = sys.argv[1], sys.argv[2]
    m = float(sys.argv[3]) if len(sys.argv) > 3 else 1.5
    img = np.asarray(Image.open(src).convert("RGB")).astype(np.float64)
    y0 = (float(sys.argv[4]) if len(sys.argv) > 4 else 1340.0) * img.shape[0] / 2048
    res = np.clip(warp(img, y0, m), 0, 255).astype(np.uint8)
    Image.fromarray(res).save(out, quality=90)
    print("wrote %s (m %.2f, floor line at row %d)" % (out, m, y0))
