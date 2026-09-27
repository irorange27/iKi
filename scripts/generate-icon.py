"""Generate the iKi app icon from the brand artwork.

Source: packages/desktop/assets/icon/source.png (transparent-background art).
The art is composited onto the macOS-style dark squircle and emitted as:

- iki-icon.png   1024x1024 composited icon
- iki-icon.icns  macOS icon set — the name must stay in sync with
                 `packagerConfig.icon` in packages/desktop/forge.config.ts,
                 which @electron/packager resolves as `<name>.icns` on macOS.
"""

import subprocess
import sys
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "packages" / "desktop" / "assets" / "icon"
SOURCE_PATH = OUT_DIR / "source.png"
PNG_PATH = OUT_DIR / "iki-icon.png"

SIZE = 1024
BG = (24, 26, 30)  # near-black, slightly warm
SCALE = SIZE / 1024

# macOS squircle mask path (approximated with rounded corners)
CORNER_R = int(220 * SCALE)
MARGIN = int(40 * SCALE)
# Artwork footprint relative to the canvas; the art keeps a margin inside
# the squircle so the glow is not clipped.
ART_RATIO = 0.78


def build_icon() -> Image.Image:
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    bg = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    d = ImageDraw.Draw(bg)
    d.rounded_rectangle(
        [MARGIN, MARGIN, SIZE - MARGIN, SIZE - MARGIN],
        radius=CORNER_R,
        fill=BG,
    )
    img = Image.alpha_composite(img, bg)

    art = Image.open(SOURCE_PATH).convert("RGBA")
    art_size = int(SIZE * ART_RATIO)
    art = art.resize((art_size, art_size), Image.LANCZOS)
    offset = (SIZE - art_size) // 2
    img.paste(art, (offset, offset), art)
    return img


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

    icns_path = OUT_DIR / "iki-icon.icns"
    subprocess.run(
        ["iconutil", "-c", "icns", "-o", str(icns_path), str(iconset)],
        check=True,
    )
    import shutil

    shutil.rmtree(iconset)
    return icns_path


def main():
    img = build_icon()
    img.save(PNG_PATH, "PNG")
    print(f"PNG saved to {PNG_PATH}")

    if sys.platform == "darwin":
        icns_path = build_icns(PNG_PATH)
        print(f"ICNS saved to {icns_path}")
    else:
        print("Not on macOS, skipping .icns generation")


if __name__ == "__main__":
    main()
