#!/usr/bin/env python3
"""
mast-search-jwst.py — MAST JWST Product Scout & Selector

A tool for discovering and categorizing JWST science products from MAST.
"""

import argparse
import sys
import json
import csv
from collections import defaultdict

try:
    from astroquery.mast import Observations
except ImportError:
    print("ERROR: astroquery is not installed. Run: pip install astroquery", file=sys.stderr)
    sys.exit(1)


def detect_preview(filename: str) -> bool:
    """Detect if a file is likely a small visual preview or thumbnail."""
    name = filename.lower()
    return any(
        ext in name for ext in [".jpg", ".jpeg", ".png", "preview", "thumb", "thumbnail"]
    )


def score_and_group_product(prod) -> tuple[float, str, str]:
    """
    Rank product and assign it to a logical group.
    Returns (score, reason_string, group_name).
    """
    score = 0.0
    reasons = []

    filename = str(prod.get("productFilename", "")).lower()
    dp_type = str(prod.get("dataproduct_type", "")).lower()
    calib_level = prod.get("calib_level", 0)
    filters = str(prod.get("filters", ""))
    size_bytes = prod.get("size", 0) or 0
    size_mb = size_bytes / (1024 * 1024)

    is_preview = detect_preview(filename)
    is_fits = filename.endswith(".fits")
    is_i2d = "i2d" in filename or "mosaic" in filename
    has_filter = filters and filters.upper() not in ["NONE", "CLEAR", "UNKNOWN", "N/A", "NULL", "--"]
    
    try:
        calib_num = int(calib_level)
    except (ValueError, TypeError):
        calib_num = 0

    # Base scoring
    if "JWST" in str(prod.get("obs_collection", "")).upper():
        score += 10
        reasons.append("JWST")

    if "NIRCAM" in str(prod.get("instrument_name", "")).upper():
        score += 5
        reasons.append("NIRCam")

    if dp_type == "image":
        score += 5
        reasons.append("image")

    if is_fits:
        score += 3
        reasons.append("FITS")

    if is_i2d:
        score += 15
        reasons.append("mosaic/i2d")

    if has_filter:
        score += 5
        reasons.append(f"filter({filters})")

    size_boost = min(size_mb / 100, 20)  # Max 20 points for 2GB+
    if size_boost > 0:
        score += size_boost
        reasons.append(f"size(>100MB)")

    # Grouping
    group = "unknown"
    if is_preview:
        group = "previews_or_small_visuals"
        score -= 20
        reasons.append("-preview")
    elif calib_num < 3 or "raw" in filename:
        group = "raw_or_calibration_products"
        score -= 10
        reasons.append("-raw/calib<3")
    elif calib_num >= 3 and is_i2d and is_fits and size_mb > 50:
        group = "best_tiling_candidates"
        score += 10
        reasons.append("+best_candidate")
    elif calib_num >= 3 and is_fits and has_filter:
        group = "likely_filter_images"
        score += 2
    elif dp_type == "image" and is_fits:
        group = "likely_filter_images"

    return score, ", ".join(reasons), group


def main():
    parser = argparse.ArgumentParser(description="Scout MAST for JWST products.")
    parser.add_argument("--target", help="Target name (e.g., 'Sagittarius C')")
    parser.add_argument("--ra", type=float, help="Right Ascension in degrees")
    parser.add_argument("--dec", type=float, help="Declination in degrees")
    parser.add_argument("--radius-deg", type=float, default=0.05, help="Search radius in degrees")
    parser.add_argument("--instrument", help="Filter by instrument (e.g., NIRCAM)")
    parser.add_argument("--limit", type=int, default=100, help="Limit number of astroquery results fetched")
    parser.add_argument("--top", type=int, default=25, help="Number of ranked products to display/output")
    parser.add_argument("--json-output", type=str, help="Path to write JSON output")
    parser.add_argument("--csv-output", type=str, help="Path to write CSV output")
    
    args = parser.parse_args()

    if not args.target and (args.ra is None or args.dec is None):
        print("ERROR: Must provide either --target or both --ra and --dec.", file=sys.stderr)
        sys.exit(1)

    print(f"[*] Querying MAST Observations...")
    
    from astropy.coordinates import SkyCoord
    import astropy.units as u

    if args.target:
        print(f"    Target: {args.target}, Radius={args.radius_deg}°")
        obs_table = Observations.query_object(args.target, radius=args.radius_deg * u.deg)
    else:
        print(f"    Coordinates: RA={args.ra}, Dec={args.dec}, Radius={args.radius_deg}°")
        coord = SkyCoord(ra=args.ra, dec=args.dec, unit=(u.deg, u.deg))
        obs_table = Observations.query_region(coord, radius=args.radius_deg * u.deg)

    if args.instrument:
        inst_upper = args.instrument.upper()
        mask = [inst_upper in str(i).upper() for i in obs_table["instrument_name"]]
        obs_table = obs_table[mask]

    jwst_mask = ["JWST" in str(c).upper() for c in obs_table["obs_collection"]]
    obs_table = obs_table[jwst_mask]

    print(f"[*] Found {len(obs_table)} JWST observations. Fetching product lists...")
    if len(obs_table) == 0:
        print("No JWST observations found.")
        sys.exit(0)

    products_table = Observations.get_product_list(obs_table)
    print(f"[*] Found {len(products_table)} data products associated with observations.")

    candidates = []
    for prod in products_table:
        score, reason, group = score_and_group_product(prod)
        size_mb = prod.get('size', 0) / (1024 * 1024) if prod.get('size') else 0
        
        candidates.append({
            "score": score,
            "group": group,
            "target_name": str(prod.get("target_name", "")),
            "obs_id": str(prod.get("obs_id", "")),
            "instrument_name": str(prod.get("instrument_name", "")),
            "filters": str(prod.get("filters", "")),
            "dataproduct_type": str(prod.get("dataproduct_type", "")),
            "calib_level": str(prod.get("calib_level", "")),
            "productType": str(prod.get("productType", "")),
            "productFilename": str(prod.get("productFilename", "")),
            "extension": str(prod.get("extension", "")),
            "sizeMb": round(size_mb, 2),
            "dataURI": str(prod.get("dataURI", "")),
            "reason": reason
        })

    candidates.sort(key=lambda x: x["score"], reverse=True)
    top_candidates = candidates[:args.top]

    # Output to stdout
    print(f"\n{'='*150}")
    print(f"{'RANK':<4} | {'SCORE':<5} | {'GROUP':<25} | {'SIZE(MB)':<8} | {'FILTERS':<15} | {'FILENAME':<45} | {'REASON'}")
    print(f"{'-'*150}")
    
    for i, c in enumerate(top_candidates):
        filename = c["productFilename"]
        if len(filename) > 43: filename = filename[:40] + "..."
        filters = c["filters"]
        if len(filters) > 13: filters = filters[:10] + "..."
        group = c["group"]
        if len(group) > 23: group = group[:20] + "..."
            
        print(f"{i+1:<4} | {c['score']:<5.1f} | {group:<25} | {c['sizeMb']:<8.1f} | {filters:<15} | {filename:<45} | {c['reason']}")

    print(f"{'='*150}\n")

    # Final recommendations
    best_download = next((c for c in top_candidates if c["group"] == "best_tiling_candidates"), None)
    if not best_download:
        best_download = top_candidates[0] if top_candidates else None
        
    best_preview = next((c for c in top_candidates if c["group"] == "previews_or_small_visuals"), None)
    
    print("[FINAL RECOMMENDATIONS]")
    if best_download:
        print(f"Best next download candidate: {best_download['productFilename']} (Score: {best_download['score']:.1f}, Size: {best_download['sizeMb']} MB)")
    if best_preview:
        print(f"Best preview candidate: {best_preview['productFilename']} (Score: {best_preview['score']:.1f}, Size: {best_preview['sizeMb']} MB)")
    print("Likely render path: FITS -> rendered TIFF/PNG -> DZI")

    # Exports
    if args.json_output:
        for i, c in enumerate(top_candidates):
            c["rank"] = i + 1
        with open(args.json_output, 'w', encoding='utf-8') as f:
            json.dump(top_candidates, f, indent=2)
        print(f"\n[*] Wrote top {len(top_candidates)} results to JSON: {args.json_output}")

    if args.csv_output:
        for i, c in enumerate(top_candidates):
            c["rank"] = i + 1
        with open(args.csv_output, 'w', encoding='utf-8', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=top_candidates[0].keys())
            writer.writeheader()
            writer.writerows(top_candidates)
        print(f"[*] Wrote top {len(top_candidates)} results to CSV: {args.csv_output}")

if __name__ == "__main__":
    main()
