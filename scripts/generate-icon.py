"""Generate iKi app icon (1024x1024 PNG) and macOS .icns file.

Design: a restrained mark — two simple arcs forming an abstract companion
silhouette on a dark squircle, matching the "restrained, experimental"
brand direction.
"""

import math
import subprocess
import sys
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "assets" / "icon"
PNG_PATH = OUT_DIR / "iki-icon.png"

SIZE = 1024
BG = (24, 26, 30)  # near-black, slightly warm
ACCENT = (190, 208, 230)  # muted slate-blue, calm
SCALE = SIZE / 1024

# macOS squircle mask path (approximated with rounded corners)
CORNER_R = int(220 * SCALE)
MARGIN = int(40 * SCALE)


def squircle_mask(size: int) -> Image.Image:
    """Return an RGBA mask image with macOS-style rounded rect."""
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)
    # Use a very large corner radius for the squircle feel
    d.rounded_rectangle(
        [MARGIN, MARGIN, size - MARGIN, size - MARGIN],
        radius=CORNER_R,
        fill=255,
    )
    return mask


def draw_mark(draw: ImageDraw.Draw, cx: int, cy: int):
    """Two fine arcs + a dot forming a subtle companion symbol."""
    w = int(12 * SCALE)
    arc_w = int(180 * SCALE)
    arc_h = int(80 * SCALE)
    gap = int(120 * SCALE)

    # Upper arc
    top_left = (cx - arc_w, cy - gap - arc_h)
    bottom_right = (cx + arc_w, cy - gap + arc_h)
    draw.arc(top_left + bottom_right, start=200, end=340, fill=ACCENT, width=w)

    # Lower arc — slightly smaller, inverted
    arc_w2 = int(150 * SCALE)
    arc_h2 = int(60 * SCALE)
    top_left2 = (cx - arc_w2, cy + gap - arc_h2)
    bottom_right2 = (cx + arc_w2, cy + gap + arc_h2)
    draw.arc(top_left2 + bottom_right2, start=20, end=160, fill=ACCENT, width=w)

    # Small dot — presence indicator
    dot_r = int(9 * SCALE)
    dot_y = cy - gap - arc_h - int(20 * SCALE)
    draw.ellipse(
        [cx - dot_r, dot_y - dot_r, cx + dot_r, dot_y + dot_r],
        fill=ACCENT,
    )


def build_icns(png_path: Path):
    """Convert PNG to ICNS using macOS iconutil."""
    iconset = OUT_DIR / "iki.iconset"
    iconset.mkdir(parents=True, exist_ok=True)

    sizes = {
        "icon_16x16.png": 16,
        "icon_16x16@2x.png": 32,
        "icon_32x32.png": 32,
        "icon_32x32@2x.png": 64,
        "icon_128x128.png": 128,
        "icon_128x128@2x.png": 256,
        "icon_256x256.png": 256,
        "icon_256x256@2x.png": 512,
        "icon_512x512.png": 512,
        "icon_512x512@2x.png": 1024,
    }

    img = Image.open(png_path)
    for name, size in sizes.items():
        resized = img.resize((size, size), Image.LANCZOS)
        resized.save(iconset / name, "PNG")

    icns_path = OUT_DIR / "iki.icns"
    subprocess.run(
        ["iconutil", "-c", "icns", "-o", str(icns_path), str(iconset)],
        check=True,
    )
    import shutil

    shutil.rmtree(iconset)
    return icns_path


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # Build icon with alpha channel
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Rounded background
    bg = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    bg_draw = ImageDraw.Draw(bg)
    bg_draw.rounded_rectangle(
        [MARGIN, MARGIN, SIZE - MARGIN, SIZE - MARGIN],
        radius=CORNER_R,
        fill=BG,
    )
    img = Image.alpha_composite(img, bg)

    # Draw mark
    draw = ImageDraw.Draw(img)
    cx, cy = SIZE // 2, SIZE // 2
    draw_mark(draw, cx, cy)

    img.save(PNG_PATH, "PNG")
    print(f"PNG saved to {PNG_PATH}")

    if sys.platform == "darwin":
        icns_path = build_icns(PNG_PATH)
        print(f"ICNS saved to {icns_path}")
    else:
        print("Not on macOS, skipping .icns generation")


if __name__ == "__main__":
    main()
