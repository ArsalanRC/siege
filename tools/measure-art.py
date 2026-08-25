#!/usr/bin/env python3
"""
Measure the painted playfield, so the geometry never has to be guessed again.

    python3 tools/measure-art.py

Prints every number `src/engine/table.ts` was built from. Run it whenever the art
changes and paste the output back into that file.

Two geometry bugs on this table were both a number read off a picture by eye: a
roof slope of 73 against a true 84, and three bumper caps placed up to 123 units
from the caps they are painted on. Both looked completely fine in a screenshot.
So this scans pixels instead, and the rule it exists to enforce is simply:
**measure, never estimate.**

The playfield image is 1024 by 1536 and the table is 1024 by 1536 units, so one
pixel is one unit and nothing here needs converting.

Needs Pillow and numpy, which are the only things in this repo that are not
plain TypeScript. That is on purpose: they live in a dev tool, not in the game,
and the game still ships with zero dependencies.
"""

import sys
from pathlib import Path

try:
    import numpy as np
    from PIL import Image
except ImportError:  # pragma: no cover - a dev tool, not part of the build
    sys.exit("needs Pillow and numpy: pip install pillow numpy")

ART = Path(__file__).resolve().parent.parent / "site" / "art" / "playfield.jpg"

# A 54 unit ball. Any channel narrower than this is one no ball has ever gone
# down, whatever the picture suggests.
BALL = 54


def load():
    im = Image.open(ART).convert("RGB")
    rgb = np.asarray(im).astype(np.float32) / 255.0
    mx, mn = rgb.max(axis=2), rgb.min(axis=2)
    v = mx
    s = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    d = np.maximum(mx - mn, 1e-6)
    h = np.zeros_like(mx)
    m = mx == r
    h[m] = ((g - b) / d)[m] % 6
    m = mx == g
    h[m] = ((b - r) / d + 2)[m]
    m = mx == b
    h[m] = ((r - g) / d + 4)[m]
    h *= 60.0
    h[(mx - mn) < 1e-6] = 0
    return rgb, h, s, v


def dilate(mask, k):
    out = mask.copy()
    for dy in range(-k, k + 1):
        for dx in range(-k, k + 1):
            out |= np.roll(np.roll(mask, dy, 0), dx, 1)
    return out


def wood_mask(h, s, v):
    """Bare maple, closed up so the grain and the varnish do not punch holes."""
    raw = (h >= 27) & (h <= 43) & (s >= 0.45) & (s <= 0.80) & (v >= 0.70)
    return ~dilate(~dilate(raw, 3), 3)


def flood(mask, sx, sy):
    """Scanline fill, because scipy is not a dependency and does not need to be."""
    seen = np.zeros(mask.shape, bool)
    height, width = mask.shape
    stack = [(sx, sy)]
    while stack:
        x, y = stack.pop()
        if seen[y, x] or not mask[y, x]:
            continue
        xl = x
        while xl > 0 and mask[y, xl - 1] and not seen[y, xl - 1]:
            xl -= 1
        xr = x
        while xr < width - 1 and mask[y, xr + 1] and not seen[y, xr + 1]:
            xr += 1
        seen[y, xl:xr + 1] = True
        for ny in (y - 1, y + 1):
            if 0 <= ny < height:
                nx = xl
                while nx <= xr:
                    if mask[ny, nx] and not seen[ny, nx]:
                        stack.append((nx, ny))
                        while nx <= xr and mask[ny, nx]:
                            nx += 1
                    nx += 1
    return seen


def hough_circles(rgb, box, rmin, rmax, count):
    """Circle centres, from the gradient direction of the linework.

    Every edge pixel votes for the centre it would belong to at each radius,
    which finds a cap or a lens whether or not its paint is a clean ring. The
    radius reported back is the one whose ring lands on the most linework.
    """
    grey = 0.299 * rgb[:, :, 0] + 0.587 * rgb[:, :, 1] + 0.114 * rgb[:, :, 2]

    def sobel(a, kernel):
        k = np.array(kernel, np.float32)
        out = np.zeros_like(a)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                out += k[dy + 1, dx + 1] * np.roll(np.roll(a, -dy, 0), -dx, 1)
        return out

    gx = sobel(grey, [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]])
    gy = sobel(grey, [[-1, -2, -1], [0, 0, 0], [1, 2, 1]])
    mag = np.hypot(gx, gy)
    thr = np.percentile(mag, 92)
    ey, ex = np.nonzero(mag > thr)
    ux, uy = gx[ey, ex] / mag[ey, ex], gy[ey, ex] / mag[ey, ex]

    height, width = grey.shape
    x0, y0, x1, y1 = box
    keep = (ex >= x0 - rmax) & (ex < x1 + rmax) & (ey >= y0 - rmax) & (ey < y1 + rmax)
    ex, ey, ux, uy = ex[keep], ey[keep], ux[keep], uy[keep]

    acc = np.zeros((height, width), np.float32)
    for r in range(rmin, rmax + 1):
        for sign in (-1, 1):
            cx = np.rint(ex + sign * r * ux).astype(int)
            cy = np.rint(ey + sign * r * uy).astype(int)
            ok = (cx >= 0) & (cx < width) & (cy >= 0) & (cy < height)
            np.add.at(acc, (cy[ok], cx[ok]), 1.0 / r)
    smooth = np.zeros_like(acc)
    for dy in range(-3, 4):
        for dx in range(-3, 4):
            smooth += np.roll(np.roll(acc, dy, 0), dx, 1)
    inside = np.zeros((height, width), bool)
    inside[y0:y1, x0:x1] = True
    smooth[~inside] = 0

    found = []
    for _ in range(count):
        i = int(np.argmax(smooth))
        cy, cx = divmod(i, width)
        best = (rmin, 0.0)
        for r in range(rmin, rmax + 1):
            a = np.linspace(0, 2 * np.pi, max(24, int(2 * np.pi * r)), endpoint=False)
            xs = np.rint(cx + r * np.cos(a)).astype(int)
            ys = np.rint(cy + r * np.sin(a)).astype(int)
            ok = (xs >= 0) & (xs < width) & (ys >= 0) & (ys < height)
            fit = float((mag[ys[ok], xs[ok]] > thr).mean())
            if fit > best[1]:
                best = (r, fit)
        found.append((cx, cy, best[0], best[1]))
        yy, xx = np.ogrid[:height, :width]
        smooth[((yy - cy) ** 2 + (xx - cx) ** 2) < (rmin * 0.9) ** 2] = 0
    return found


def main():
    rgb, h, s, v = load()
    wood = wood_mask(h, s, v)
    play = flood(wood, 500, 1330)  # a seed in the bare wood below the flippers

    print("# playfield boundary, one row in eight. The wall goes here.")
    for y in range(440, 1520, 8):
        xs = np.nonzero(play[y])[0]
        if len(xs):
            print(f"  y={y:4d}  left={xs.min():4d}  right={xs.max():4d}  width={xs.max() - xs.min():4d}")

    print("\n# the castle's underside: the first playfield row in each column")
    for x in range(240, 800, 20):
        ys = np.nonzero(play[:, x])[0]
        print(f"  x={x:4d}  top={ys.min() if len(ys) else -1}")

    print("\n# bumper caps, upper left")
    for cx, cy, r, fit in hough_circles(rgb, (20, 100, 400, 540), 55, 95, 3):
        print(f"  centre=({cx}, {cy})  painted radius={r}  ring fit={fit:.2f}")

    print("\n# slingshot posts")
    for name, box in (("left", (180, 1040, 320, 1240)), ("right", (675, 1050, 815, 1240))):
        print(f"  {name}:")
        for cx, cy, r, fit in hough_circles(rgb, box, 10, 26, 3):
            print(f"    post=({cx}, {cy})  radius={r}  ring fit={fit:.2f}")

    print("\n# shooter lane, across the painted rails at y = 700")
    row = "".join("#" if v[700, x] > 0.45 and s[700, x] < 0.25 else "." for x in range(880, 1024))
    print(f"  bright metal (#) from x=880: {row}")

    print(f"\n# a ball is {BALL} units across. Anything narrower than that above is")
    print("# a painted guide, not a lane, and the wall belongs on the far side of it.")


if __name__ == "__main__":
    main()
