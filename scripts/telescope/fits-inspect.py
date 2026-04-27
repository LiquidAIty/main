#!/usr/bin/env python3
"""
fits-inspect.py — Inspect FITS file structure and headers.

Reads a FITS file and prints HDU information along with key header values
useful for Telescope mode mapping.
"""

import argparse
import sys
import json
import os

try:
    from astropy.io import fits
except ImportError:
    print("ERROR: astropy is not installed. Run: pip install astropy", file=sys.stderr)
    sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="Inspect a FITS file's structure and header keys.")
    parser.add_argument("--input", required=True, help="Path to input FITS file.")
    parser.add_argument("--json-output", help="Optional path to output results as JSON.")

    args = parser.parse_args()

    if not os.path.exists(args.input):
        print(f"ERROR: Input file not found: {args.input}", file=sys.stderr)
        sys.exit(1)

    target_keys = [
        "TELESCOP", "INSTRUME", "FILTER", "PUPIL", "DATE-OBS", "TARGNAME",
        "RA_V1", "DEC_V1", "CRVAL1", "CRVAL2", "CDELT1", "CDELT2", "NAXIS1", "NAXIS2"
    ]

    results = {
        "file": args.input,
        "hdus": [],
        "primary_header_keys": {}
    }

    print(f"[*] Inspecting FITS: {args.input}")
    
    try:
        with fits.open(args.input, memmap=True) as hdul:
            print(f"[*] Found {len(hdul)} HDUs.")
            
            for i, hdu in enumerate(hdul):
                naxis = hdu.header.get('NAXIS', 0)
                data_shape = tuple(hdu.header.get(f'NAXIS{j}') for j in range(naxis, 0, -1)) if naxis > 0 else None
                data_dtype = f"BITPIX={hdu.header.get('BITPIX')}" if 'BITPIX' in hdu.header else None
                name = hdu.name

                results["hdus"].append({
                    "index": i,
                    "name": name,
                    "shape": data_shape,
                    "dtype": data_dtype
                })

                print(f"  HDU {i}: NAME='{name}' | SHAPE={data_shape} | DTYPE={data_dtype}")

            # Grab key headers from primary HDU (0) or SCI HDU (1 usually)
            # We'll search HDU 0 first, and fallback to SCI if not found
            primary_hdr = hdul[0].header
            sci_hdr = None
            for hdu in hdul:
                if hdu.name == "SCI":
                    sci_hdr = hdu.header
                    break
                    
            print("\n[*] Target Header Keys:")
            for k in target_keys:
                val = None
                if k in primary_hdr:
                    val = primary_hdr.get(k)
                elif sci_hdr and k in sci_hdr:
                    val = sci_hdr.get(k)
                    
                results["primary_header_keys"][k] = val
                print(f"  {k:<10} = {val}")

    except Exception as e:
        print(f"ERROR inspecting FITS: {e}", file=sys.stderr)
        sys.exit(1)

    if args.json_output:
        os.makedirs(os.path.dirname(os.path.abspath(args.json_output)), exist_ok=True)
        with open(args.json_output, "w", encoding="utf-8") as f:
            json.dump(results, f, indent=2)
        print(f"\n[*] JSON output written to: {args.json_output}")

if __name__ == "__main__":
    main()
