# Telescope Mode Data Pipeline

This folder contains scripts to discover, download, inspect, and tile JWST deep-zoom datasets directly from the MAST archive.

## Safe Selected-Product Workflow

When adding a new telescope target (e.g., Sagittarius C), follow this workflow to ensure data viability before running the expensive tiling pipeline.

### 1. Scout
Find the best products for a target.
```powershell
python .\scripts\telescope\mast-search-jwst.py --target "Sagittarius C" --instrument NIRCAM --limit 100 --top 25 --json-output .\telescope\sagittarius-c-mast-candidates.json
```

### 2. Download Selected Product
Download the specific FITS product identified by the scout (e.g., an `i2d` mosaic with a known filter like `F212N`).
```powershell
python .\scripts\telescope\mast-download-product.py `
  --data-uri "mast:JWST/product/jw04147-o012_t001_nircam_clear-f212n_i2d.fits" `
  --download-dir .\telescope\mast-downloads\sagittarius-c `
  --expected-filename "jw04147-o012_t001_nircam_clear-f212n_i2d.fits"
```

### 3. Inspect FITS Data
Read the FITS headers and HDU structure to confirm dimensions, instruments, and target data.
```powershell
python .\scripts\telescope\fits-inspect.py `
  --input .\telescope\mast-downloads\sagittarius-c\jw04147-o012_t001_nircam_clear-f212n_i2d.fits `
  --json-output .\telescope\mast-downloads\sagittarius-c\jw04147-o012_t001_nircam_clear-f212n_i2d.inspect.json
```

### 4. Render Preview
Render a fast, downscaled PNG preview using clipping and asinh stretching to ensure the visual data is valid and framing is correct.
```powershell
python .\scripts\telescope\fits-render-preview.py `
  --input .\telescope\mast-downloads\sagittarius-c\jw04147-o012_t001_nircam_clear-f212n_i2d.fits `
  --output .\telescope\previews\sagittarius-c-f212n-preview.png `
  --max-size 1800
```

### 5. Generate DZI Tiles (Future Step)
*(This step requires full-resolution TIFF conversion, which is currently outside the scope of this preview workflow.)*
```powershell
.\scripts\telescope\generate-dzi.ps1 -InputImage <tiff> -OutputBase <base>
```
