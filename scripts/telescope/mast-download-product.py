#!/usr/bin/env python3
"""
mast-download-product.py — Single MAST product downloader.

Downloads exactly one product from the MAST archive given its dataURI.
Writes a sidecar metadata JSON file next to the downloaded FITS file.
"""

import argparse
import sys
import os
import json
from datetime import datetime

try:
    from astroquery.mast import Observations
except ImportError:
    print("ERROR: astroquery is not installed. Run: pip install astroquery", file=sys.stderr)
    sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="Download exactly one MAST product by URI.")
    parser.add_argument("--data-uri", required=True, help="Exact dataURI (e.g., mast:JWST/product/...)")
    parser.add_argument("--download-dir", default="./telescope/mast-downloads/sagittarius-c", help="Directory to save the downloaded file.")
    parser.add_argument("--expected-filename", help="Optional expected filename. If not provided, inferred from URI.")
    parser.add_argument("--force", action="store_true", help="Force download even if file exists locally.")

    args = parser.parse_args()

    # Determine filename
    if args.expected_filename:
        filename = args.expected_filename
    else:
        # Extract filename from URI, e.g. mast:JWST/product/some_file.fits -> some_file.fits
        filename = args.data_uri.split("/")[-1]

    os.makedirs(args.download_dir, exist_ok=True)
    local_path = os.path.join(args.download_dir, filename)
    sidecar_path = local_path + ".meta.json"

    print(f"[*] Target URI: {args.data_uri}")
    print(f"[*] Target Path: {local_path}")

    if os.path.exists(local_path) and not args.force:
        print("[*] File already exists locally. Skipping download. Use --force to override.")
    else:
        print("[*] Downloading file from MAST (this may take a while for large products)...")
        # Observations.download_file downloads the URI directly.
        # It usually returns a status list or the local file path.
        # We specify local_path explicitly.
        try:
            status = Observations.download_file(args.data_uri, local_path=local_path)
            if status[0] == "ERROR":
                print(f"ERROR downloading file: {status}", file=sys.stderr)
                sys.exit(1)
        except Exception as e:
            print(f"ERROR downloading file: {e}", file=sys.stderr)
            sys.exit(1)
        
        print("[*] Download complete.")

    if not os.path.exists(local_path):
        print(f"ERROR: Expected local file was not found after download: {local_path}", file=sys.stderr)
        sys.exit(1)

    # Write sidecar JSON
    size_bytes = os.path.getsize(local_path)
    meta = {
        "filename": filename,
        "dataURI": args.data_uri,
        "downloadedAt": datetime.utcnow().isoformat() + "Z",
        "localPath": local_path,
        "sizeBytes": size_bytes,
        "sizeMb": round(size_bytes / (1024 * 1024), 2)
    }

    with open(sidecar_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)

    print(f"[*] Wrote sidecar metadata: {sidecar_path}")
    print(f"[*] File Size: {meta['sizeMb']} MB")

if __name__ == "__main__":
    main()
