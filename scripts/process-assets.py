"""
Reorganize game assets and remove light/white backgrounds for transparency.
Run: python scripts/process-assets.py
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "public" / "assets"
OUT = SRC  # write into new structure under public/assets

MAPPING = {
    "Characters/player-logos.png": "_source/logo.png",
    "Items/resources.png": "_source/icon.png",
    "UI/policy-icons.png": "_source/policy.png",
    "Buildings/decorations.png": "_source/ChatGPT Image 11_30_25 2 thg 7, 2026 (2).png",
    "Tiles/island-map.png": "_source/island-map.png",
}

SKIP_TRANSPARENCY = {"Tiles/island-map.png"}


def make_transparent(img: Image.Image, threshold: int = 232, soften: int = 14) -> Image.Image:
    """Turn near-white / light checkerboard pixels transparent with soft edges."""
    img = img.convert("RGBA")
    pixels = img.load()
    w, h = img.size

    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            if a == 0:
                continue
            brightness = (r + g + b) / 3
            spread = max(r, g, b) - min(r, g, b)
            # White / light gray background
            if r >= threshold and g >= threshold and b >= threshold:
                pixels[x, y] = (r, g, b, 0)
                continue
            # Light neutral fringe (sprite sheet margins)
            if brightness >= threshold - 18 and spread < 28:
                pixels[x, y] = (r, g, b, 0)
                continue
            if brightness >= threshold - soften:
                fade = max(0, min(255, int((threshold - brightness) / soften * 255)))
                pixels[x, y] = (r, g, b, min(a, fade))

    return img


def process_file(src_path: Path, dest_path: Path, transparent: bool) -> None:
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    img = Image.open(src_path)

    if transparent:
        img = make_transparent(img)
        img.save(dest_path, "PNG", optimize=True)
        print(f"  OK (transparent): {dest_path.relative_to(ROOT)}")
    else:
        # Map tile: keep as PNG for consistent serving
        if dest_path.suffix.lower() != ".png":
            dest_path = dest_path.with_suffix(".png")
        img.convert("RGB").save(dest_path, "PNG", optimize=True)
        print(f"  OK (tile): {dest_path.relative_to(ROOT)}")


def main() -> None:
    print("Processing game assets...\n")

    for dest_rel, src_name in MAPPING.items():
        src_path = SRC / src_name
        dest_path = OUT / dest_rel
        if not src_path.exists():
            print(f"  SKIP missing: {src_name}")
            continue
        transparent = dest_rel not in SKIP_TRANSPARENCY
        process_file(src_path, dest_path, transparent)

    # Empty folders for future assets
    for folder in ("NPCs", "Effects", "Music", "Sounds", "Icons"):
        (OUT / folder).mkdir(parents=True, exist_ok=True)
        keep = OUT / folder / ".gitkeep"
        keep.touch(exist_ok=True)

    print("\nDone.")

if __name__ == "__main__":
    main()
