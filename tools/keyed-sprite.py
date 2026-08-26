#!/usr/bin/env python3
"""
Turn a flattened generated image back into a sprite with a real alpha channel.

    python3 tools/keyed-sprite.py in.jpeg site/art/nova/lens.png [width]

Gemini renders the asset on a genuinely transparent canvas and then hands you a
**JPEG** when you press download, and a JPEG has no alpha channel at all. The
transparent region arrives flattened to a flat colour instead, so the sprite
would be drawn as a coloured tile sitting on the playfield.

## Why this floods from the border rather than keying a colour

The obvious fix is to make every pixel near the background colour transparent.
That is wrong here and the lamp lens shows why: its glass dome carries a bright
near-white specular highlight, and a global colour key punches a hole straight
through the middle of it. The background is the region *connected to the edge of
the frame*, which is a different question and the one worth asking.

So it floods inward from the border and stops at the subject. Interior highlights
survive because nothing connects them to the edge.

## The halo

JPEG blends the subject's edge into the background over two or three pixels, and
those in-between pixels are outside the flood's tolerance, so they stay opaque
and the sprite gets a pale outline. On a dark playfield that outline is the most
visible thing on the board. The alpha is therefore eroded by a pixel and the last
few are ramped, which costs nothing and removes it.

Needs Pillow and numpy, same as measure-art.py, and for the same reason: they
live in a dev tool and the game still ships with zero dependencies.
"""

import sys
from collections import deque
from pathlib import Path

try:
    import numpy as np
    from PIL import Image
except ImportError:  # pragma: no cover - a dev tool, not part of the build
    sys.exit("needs Pillow and numpy: pip install pillow numpy")

# How far a pixel may sit from the sampled background and still count as it.
# Generous, because JPEG puts noise into what was a perfectly flat region.
TOLERANCE = 34

# Far enough from the background to be the part itself rather than its shadow.
STRONG = 90


def background_colour(rgb):
    """The corners agree on it, so take the median of all four."""
    h, w, _ = rgb.shape
    corners = np.stack([rgb[0, 0], rgb[0, w - 1], rgb[h - 1, 0], rgb[h - 1, w - 1]])
    return np.median(corners, axis=0)


def flood_from_border(near_bg):
    """Every background-coloured pixel reachable from the edge of the frame."""
    h, w = near_bg.shape
    seen = np.zeros((h, w), bool)
    q = deque()

    for x in range(w):
        for y in (0, h - 1):
            if near_bg[y, x] and not seen[y, x]:
                seen[y, x] = True
                q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if near_bg[y, x] and not seen[y, x]:
                seen[y, x] = True
                q.append((x, y))

    while q:
        x, y = q.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and near_bg[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                q.append((nx, ny))
    return seen


def erode(mask, rounds):
    """Pull the opaque edge in, which is what takes the JPEG halo off."""
    out = mask.copy()
    for _ in range(rounds):
        shifted = out.copy()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            shifted &= np.roll(np.roll(out, dy, 0), dx, 1)
        out = shifted
    return out


def main():
    if len(sys.argv) < 3:
        sys.exit("usage: keyed-sprite.py in.jpeg out.png [width] [--circle]")

    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    circle = "--circle" in sys.argv
    # Some assets come back full-bleed, with the part filling the frame and no
    # background at all. There is nothing to key there, and flooding from the
    # border would eat into the part itself, so the circle mask does the whole
    # job on its own.
    nokey = "--nokey" in sys.argv

    src, dst = Path(args[0]), Path(args[1])
    width = int(args[2]) if len(args) > 2 else 320

    im = Image.open(src).convert("RGB")
    rgb = np.asarray(im).astype(np.int16)
    bg = background_colour(rgb)
    distance = np.abs(rgb - bg).max(axis=2)

    if nokey:
        opaque = np.ones(distance.shape, bool)
    else:
        opaque = erode(~flood_from_border(distance <= TOLERANCE), 2)

    # The SUBJECT, as opposed to everything the key merely kept.
    #
    # These images arrive with a soft drop shadow under the part, and a JPEG has
    # no alpha to record it as partial, so it flattens to opaque grey. The key
    # cannot tell that from the part itself, and the result on a dark playfield
    # is twenty-one lamp lenses each wearing a pale halo bigger than the lens.
    # The handover already warned about this in the other direction: a soft drop
    # shadow inside a sprite reads as opaque, so threshold high before trusting
    # a silhouette. This is that threshold.
    strong = np.ones(distance.shape, bool) if nokey else distance > STRONG
    ys, xs = np.nonzero(strong)
    if not len(xs):
        sys.exit("nothing survived the key: the whole frame read as background")
    box = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)

    # Outside the subject's own bounds is shadow by definition, so drop it.
    keep = np.zeros_like(opaque)
    keep[box[1]:box[3], box[0]:box[2]] = True
    opaque &= keep

    if circle:
        # A round part is exactly a circle, and saying so beats hoping the key
        # traced one. Anything outside the inscribed circle is shadow or halo.
        h, w = opaque.shape
        cy, cx = (box[1] + box[3]) / 2, (box[0] + box[2]) / 2
        r = min(box[2] - box[0], box[3] - box[1]) / 2
        yy, xx = np.ogrid[:h, :w]
        opaque &= ((yy - cy) ** 2 + (xx - cx) ** 2) <= r * r

    alpha = (opaque * 255).astype(np.uint8)
    # Ramp the last edge pixels rather than leaving a hard cut, so the sprite has
    # an antialiased outline instead of a staircase.
    soft = erode(opaque, 1)
    alpha[opaque & ~soft] = 150

    out = Image.fromarray(np.dstack([np.asarray(im), alpha]), "RGBA")
    ys, xs = np.nonzero(alpha > 8)
    out = out.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))

    height = round(out.height * width / out.width)
    out.resize((width, height), Image.LANCZOS).save(dst, optimize=True)

    print(f"{src.name} -> {dst}")
    print(f"  background {tuple(int(c) for c in bg)}")
    print(f"  key kept {(distance > TOLERANCE).mean() * 100:.1f}%, subject is {strong.mean() * 100:.1f}%")
    print(f"  {'masked to its circle, ' if circle else ''}written at {width}x{height}")


if __name__ == "__main__":
    main()
