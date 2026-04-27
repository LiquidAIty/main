#!/usr/bin/env python3
"""
fits-render-preview.py — Render a FITS image to a low-res PNG preview.

Provides a safe way to preview massive FITS data products by clipping,
stretching, and downscaling without loading the full tiling pipeline.
"""

import argparse
import sys
import os

try:
    from astropy.io import fits
    import numpy as np
    from PIL import Image
except ImportError:
    print("ERROR: Missing dependencies. Run: pip install astropy numpy Pillow", file=sys.stderr)
    sys.exit(1)


def asinh_stretch(image, a=0.1):
    """Apply an asinh stretch to enhance faint details."""
    return np.arcsinh(image / a) / np.arcsinh(1.0 / a)

def main():
    parser = argparse.ArgumentParser(description="Render a FITS image into a PNG preview.")
    parser.add_argument("--input", required=True, help="Path to input FITS file.")
    parser.add_argument("--output", default="./telescope/previews/sagittarius-c-preview.png", help="Path for output PNG.")
    parser.add_argument("--hdu", default="SCI", help="HDU name or index to extract (default 'SCI').")
    parser.add_argument("--max-size", type=int, default=1800, help="Max pixel size of longest edge for preview.")
    parser.add_argument("--stretch", choices=["linear", "asinh"], default="asinh", help="Stretch algorithm.")
    parser.add_argument("--percentile-low", type=float, default=0.5, help="Lower percentile for clipping.")
    parser.add_argument("--percentile-high", type=float, default=99.7, help="Upper percentile for clipping.")

    args = parser.parse_args()

    if not os.path.exists(args.input):
        print(f"ERROR: Input FITS not found: {args.input}", file=sys.stderr)
        sys.exit(1)

    print(f"[*] Opening {args.input}...")
    try:
        with fits.open(args.input) as hdul:
            img_data = None
            
            # Try finding the requested HDU by name
            for hdu in hdul:
                if hdu.name == args.hdu and hdu.is_image and hdu.data is not None and len(hdu.data.shape) >= 2:
                    print(f"[*] Found image data in HDU '{args.hdu}'")
                    img_data = hdu.data
                    break
                    
            # Fallback: find first 2D numeric image data
            if img_data is None:
                print(f"[*] HDU '{args.hdu}' not found or empty. Searching for first valid 2D image HDU...")
                for hdu in hdul:
                    if hdu.is_image and hdu.data is not None and len(hdu.data.shape) >= 2:
                        print(f"[*] Using fallback HDU '{hdu.name}'")
                        img_data = hdu.data
                        break

            if img_data is None:
                print("ERROR: No suitable image data found in FITS file.", file=sys.stderr)
                sys.exit(1)

            # If image has >2 dimensions (e.g. data cubes), take the first slice
            if len(img_data.shape) > 2:
                print(f"[*] Data is {len(img_data.shape)}D {img_data.shape}. Extracting first 2D slice.")
                # This simplistic slice assumes shape like (C, Y, X)
                img_data = img_data[0] 

            # Load into memory as float32
            img_float = np.array(img_data, dtype=np.float32)
            print(f"[*] Original Source Shape: {img_float.shape}")

    except Exception as e:
        print(f"ERROR reading FITS: {e}", file=sys.stderr)
        sys.exit(1)

    print("[*] Processing pixels (NaN/Inf replacement)...")
    np.nan_to_num(img_float, copy=False, nan=0.0, posinf=0.0, neginf=0.0)

    print(f"[*] Computing clipping percentiles ({args.percentile_low} to {args.percentile_high})...")
    # Subsample heavily for faster percentile calculation on huge images
    sample = img_float[::10, ::10]
    p_low, p_high = np.percentile(sample, (args.percentile_low, args.percentile_high))
    
    print(f"[*] Clipping to range [{p_low:.4f}, {p_high:.4f}]...")
    img_float = np.clip(img_float, p_low, p_high)

    # Normalize to 0-1
    denom = p_high - p_low
    if denom > 0:
        img_float = (img_float - p_low) / denom
    else:
        img_float = np.zeros_like(img_float)

    print(f"[*] Applying {args.stretch} stretch...")
    if args.stretch == "asinh":
        img_float = asinh_stretch(img_float, a=0.1)
    
    # Scale to 0-255 uint8
    img_uint8 = np.clip(img_float * 255.0, 0, 255).astype(np.uint8)

    print(f"[*] Downscaling to max edge {args.max_size}...")
    pil_img = Image.fromarray(img_uint8)
    
    # Calculate new size maintaining aspect ratio
    w, h = pil_img.size
    if max(w, h) > args.max_size:
        if w > h:
            new_w = args.max_size
            new_h = int(h * (args.max_size / w))
        else:
            new_h = args.max_size
            new_w = int(w * (args.max_size / h))
            
        pil_img = pil_img.resize((new_w, new_h), Image.Resampling.LANCZOS)
        print(f"[*] Resized to {new_w}x{new_h}")
    else:
        print(f"[*] Image already smaller than max-size, keeping at {w}x{h}")

    # Save
    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    pil_img.save(args.output, format="PNG")
    print(f"[*] Preview rendered and saved to: {args.output}")


if __name__ == "__main__":
    main()
