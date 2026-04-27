#!/usr/bin/env python3
"""
tile-image.py — Generate Deep Zoom Image (DZI) tiles using pyvips.

Usage:
    python tile-image.py --input IMAGE --output-base BASE [--tile-size 512] [--quality 88]

Requires:
    pip install pyvips
    libvips must be installed (pyvips is a Python binding for it).
      - Windows: download from https://github.com/libvips/build-win64-mxe/releases
        and add the bin/ folder to PATH.
      - macOS:   brew install vips
      - Linux:   apt install libvips-dev
"""
import argparse
import os
import sys


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate DZI tiles from a source image using pyvips."
    )
    parser.add_argument("--input", required=True, help="Path to the source image.")
    parser.add_argument("--output-base", required=True, help="Output base path (without .dzi).")
    parser.add_argument("--tile-size", type=int, default=512, help="Tile size in pixels (default 512).")
    parser.add_argument("--quality", type=int, default=88, help="JPEG quality (default 88).")
    args = parser.parse_args()

    # --- Validate input ---
    if not os.path.isfile(args.input):
        print(f"[tile-image] ERROR: Input file not found: {args.input}", file=sys.stderr)
        sys.exit(1)

    # --- Import pyvips ---
    try:
        import pyvips
    except ImportError:
        print(
            "[tile-image] ERROR: pyvips is not installed.\n"
            "  Install with: pip install pyvips\n"
            "  libvips must also be installed on the system.\n"
            "  See: https://www.libvips.org/install.html",
            file=sys.stderr,
        )
        sys.exit(1)

    # --- Ensure output directory exists ---
    output_dir = os.path.dirname(args.output_base)
    if output_dir and not os.path.isdir(output_dir):
        os.makedirs(output_dir, exist_ok=True)
        print(f"[tile-image] Created directory: {output_dir}")

    # --- Load and tile ---
    print(f"[tile-image] Input:       {os.path.abspath(args.input)}")
    print(f"[tile-image] Output base: {os.path.abspath(args.output_base)}")
    print(f"[tile-image] Tile size:   {args.tile_size}")
    print(f"[tile-image] Quality:     {args.quality}")

    image = pyvips.Image.new_from_file(args.input, access="sequential")
    print(f"[tile-image] Image size:  {image.width} x {image.height}")

    image.dzsave(
        args.output_base,
        layout="dz",
        tile_size=args.tile_size,
        suffix=f".jpg[Q={args.quality}]",
    )

    # --- Validate output ---
    dzi_path = f"{args.output_base}.dzi"
    tile_dir = f"{args.output_base}_files"

    if not os.path.isfile(dzi_path):
        print(f"[tile-image] ERROR: Expected .dzi file not found: {dzi_path}", file=sys.stderr)
        sys.exit(1)

    if not os.path.isdir(tile_dir):
        print(f"[tile-image] ERROR: Expected tile folder not found: {tile_dir}", file=sys.stderr)
        sys.exit(1)

    tile_count = sum(len(files) for _, _, files in os.walk(tile_dir))
    dzi_size = os.path.getsize(dzi_path)

    print()
    print("[tile-image] SUCCESS")
    print(f"[tile-image]   .dzi file:   {dzi_path} ({dzi_size} bytes)")
    print(f"[tile-image]   tile folder: {tile_dir} ({tile_count} tiles)")


if __name__ == "__main__":
    main()
