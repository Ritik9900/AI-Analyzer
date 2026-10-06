"""Generate the app icon at every size Windows needs (pure Pillow + numpy; re-run to tweak the design).

    python packaging/assets/make_icon.py

Writes:
  packaging/electron/build/icon.ico   installer, uninstaller, exe, shortcuts (16-256 px)
  packaging/electron/build/icon.png   1024 px master
  packaging/electron/src/icon.png     window / splash icon (256 px)
  frontend/src/app/icon.png           browser favicon (256 px)
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
S = 2048  # draw at 2x, downsample for smooth edges


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def hex_rgb(h):
    return tuple(int(h[i : i + 2], 16) for i in (1, 3, 5))


def render() -> Image.Image:
    # Background: rounded square with a diagonal navy gradient
    yy, xx = np.mgrid[0:S, 0:S]
    t = ((xx + yy) / (2 * S))[..., None]
    top, bottom = np.array(hex_rgb("#1d4f91")), np.array(hex_rgb("#0b1730"))
    bg = (top * (1 - t) + bottom * t).astype(np.uint8)
    img = Image.fromarray(np.dstack([bg, np.full((S, S), 255, np.uint8)]), "RGBA")

    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=255)
    img.putalpha(mask)

    # Soft highlight in the upper-left
    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([-S * 0.35, -S * 0.45, S * 0.75, S * 0.55], fill=(120, 180, 255, 46))
    glow = glow.filter(ImageFilter.GaussianBlur(S * 0.06))
    img = Image.alpha_composite(img, Image.composite(glow, Image.new("RGBA", (S, S)), mask))

    d = ImageDraw.Draw(img)
    base = S * 0.79
    bar_w = S * 0.135
    bars = [(0.20, 0.20, "#9cc4f2"), (0.385, 0.33, "#c9def8"), (0.57, 0.47, "#ffffff")]
    for x0, h, color in bars:
        x = S * x0
        radius = int(S * 0.035)
        fill = hex_rgb(color) + (235,)
        d.rounded_rectangle([x, base - S * h, x + bar_w, base], radius=radius, fill=fill)
        d.rectangle([x, base - radius, x + bar_w, base], fill=fill)  # square bottom on the baseline

    # Rising trend line with an end marker
    pts = [(0.17, 0.53), (0.36, 0.40), (0.52, 0.46), (0.80, 0.215)]
    pts = [(S * x, S * y) for x, y in pts]
    line_w = int(S * 0.045)
    accent = hex_rgb("#38bdf8")
    shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.line(pts, fill=(5, 15, 35, 110), width=line_w + int(S * 0.02), joint="curve")
    img = Image.alpha_composite(img, shadow.filter(ImageFilter.GaussianBlur(S * 0.012)))
    d = ImageDraw.Draw(img)
    d.line(pts, fill=accent + (255,), width=line_w, joint="curve")
    for x, y in pts[:-1]:
        r = line_w / 2
        d.ellipse([x - r, y - r, x + r, y + r], fill=accent + (255,))
    ex, ey = pts[-1]
    r_ring, r_dot = S * 0.075, S * 0.052
    d.ellipse([ex - r_ring, ey - r_ring, ex + r_ring, ey + r_ring], fill=(255, 255, 255, 255))
    d.ellipse([ex - r_dot, ey - r_dot, ex + r_dot, ey + r_dot], fill=accent + (255,))

    img.putalpha(Image.fromarray(np.minimum(np.array(img.getchannel("A")), np.array(mask))))
    return img.resize((1024, 1024), Image.LANCZOS)


def main() -> None:
    master = render()
    out_build = ROOT / "packaging" / "electron" / "build"
    out_src = ROOT / "packaging" / "electron" / "src"
    out_build.mkdir(parents=True, exist_ok=True)
    out_src.mkdir(parents=True, exist_ok=True)
    master.save(out_build / "icon.png")
    master.save(out_build / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    small = master.resize((256, 256), Image.LANCZOS)
    small.save(out_src / "icon.png")
    small.save(ROOT / "frontend" / "src" / "app" / "icon.png")
    print("icons written")


if __name__ == "__main__":
    main()
