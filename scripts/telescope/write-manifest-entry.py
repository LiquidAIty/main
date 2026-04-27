#!/usr/bin/env python3
"""
write-manifest-entry.py — Add or update a telescope dataset entry in the curated manifest.

Usage:
    python write-manifest-entry.py \
        --id sagittarius-c \
        --title "Sagittarius C" \
        --object-type "Galactic center star-forming region" \
        --data-source-name "ESA Webb manual download" \
        --telescope JWST \
        --instrument NIRCam \
        --dzi-url "/telescope-tiles/sagittarius-c/sagittarius-c.dzi" \
        --summary "..."

The manifest is a JSON array stored at client/public/telescope-datasets/jwst-curated.json
by default. Existing entries are preserved; entries with a matching --id are updated in place.
"""
import argparse
import json
import os
import sys


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Add or update a telescope dataset manifest entry."
    )
    parser.add_argument("--id", required=True, help="Unique dataset identifier.")
    parser.add_argument("--title", required=True)
    parser.add_argument("--object-type", required=True)
    parser.add_argument("--data-source-name", required=True)
    parser.add_argument("--telescope", required=True)
    parser.add_argument("--instrument", default=None)
    parser.add_argument("--dzi-url", required=True)
    parser.add_argument("--summary", default=None)
    parser.add_argument(
        "--manifest",
        default=os.path.join("client", "public", "telescope-datasets", "jwst-curated.json"),
        help="Path to the manifest JSON file.",
    )
    args = parser.parse_args()

    # --- Load or create manifest ---
    manifest_dir = os.path.dirname(args.manifest)
    if manifest_dir and not os.path.isdir(manifest_dir):
        os.makedirs(manifest_dir, exist_ok=True)
        print(f"[manifest] Created directory: {manifest_dir}")

    entries: list = []
    if os.path.isfile(args.manifest):
        with open(args.manifest, "r", encoding="utf-8") as f:
            raw = json.load(f)
        if not isinstance(raw, list):
            print(f"[manifest] ERROR: Manifest is not a JSON array: {args.manifest}", file=sys.stderr)
            sys.exit(1)
        entries = raw
        print(f"[manifest] Loaded {len(entries)} existing entries from {args.manifest}")
    else:
        print(f"[manifest] Creating new manifest at {args.manifest}")

    # --- Build entry ---
    entry = {
        "id": args.id,
        "title": args.title,
        "objectType": args.object_type,
        "dataSourceName": args.data_source_name,
        "telescope": args.telescope,
        "instrument": args.instrument,
        "filters": [],
        "source": {
            "archive": "manual",
            "productUris": [],
            "officialPageUrl": "",
            "creditLabel": "",
        },
        "image": {
            "kind": "deepZoom",
            "dziUrl": args.dzi_url,
            "thumbUrl": "",
            "width": None,
            "height": None,
        },
        "science": {
            "raDeg": None,
            "decDeg": None,
            "redshift": None,
            "redshiftConfidence": "not_applicable",
            "distanceLabel": None,
            "lookbackTimeLabel": None,
        },
        "solContext": {
            "summary": args.summary or "",
            "suggestedQuestions": [],
            "candidateHuntTypes": [],
        },
    }

    # --- Upsert by id ---
    existing_index = next(
        (i for i, e in enumerate(entries) if e.get("id") == args.id), None
    )
    if existing_index is not None:
        entries[existing_index] = entry
        print(f"[manifest] Updated existing entry: {args.id}")
    else:
        entries.append(entry)
        print(f"[manifest] Appended new entry: {args.id}")

    # --- Validate and write ---
    output = json.dumps(entries, indent=2, ensure_ascii=False)
    # Quick validation round-trip
    json.loads(output)

    with open(args.manifest, "w", encoding="utf-8", newline="\n") as f:
        f.write(output)
        f.write("\n")

    print(f"[manifest] Wrote {len(entries)} entries to {args.manifest}")


if __name__ == "__main__":
    main()
