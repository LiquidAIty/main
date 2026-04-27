import type { SkyTile } from './types';

// ---------------------------------------------------------------------------
// Telescope observation metadata model
// ---------------------------------------------------------------------------

/** Full metadata for a single telescope observation. */
export type TelescopeObservationMeta = {
  title: string;
  mission: string;
  instrument: string;
  target: string;
  coordinates?: { raDeg: number; decDeg: number };
  filters?: string[];
  layers: TelescopeLayer[];
  tileManifest: TelescopeTileSource;
};

/** A visibility-togglable layer within the telescope view. */
export type TelescopeLayer = {
  id: string;
  label: string;
  visible: boolean;
};

/**
 * Tile source descriptor compatible with OpenSeadragon.
 *
 * Supported types:
 *   - `image`  – single full-res URL (OSD fakes a tile pyramid client-side).
 *   - `dzi`    – standard Deep Zoom Image manifest (.dzi XML + tile directory).
 *   - `iiif`   – IIIF Image API endpoint.
 *
 * Future: add `mast` type for MAST archive tile pyramids when the server
 * endpoint is ready. The adapter in `tileSourceFromSkyTile` is the only
 * place that needs to change.
 */
export type TelescopeTileSource =
  | { type: 'image'; url: string }
  | { type: 'dzi'; url: string }
  | { type: 'iiif'; url: string };

// ---------------------------------------------------------------------------
// Adapter — converts current SkyTile data into an OSD-compatible tile source
// ---------------------------------------------------------------------------

/**
 * Convert a `SkyTile` into an OpenSeadragon tile source descriptor.
 *
 * Right now every tile uses a single full-resolution URL from ESA/NASA CDNs,
 * so we return the `image` variant which lets OSD create a client-side tile
 * pyramid from the full image.
 *
 * When real DZI manifests or MAST-derived tile pyramids become available,
 * update this function to detect the source type and return `{ type: 'dzi' }`
 * or `{ type: 'iiif' }` instead. No view code changes required.
 */
export function tileSourceFromSkyTile(tile: SkyTile): TelescopeTileSource {
  if (tile.jwst.dziUrl) {
    return { type: 'dzi', url: tile.jwst.dziUrl };
  }
  // Prefer fullResUrl if available, then displayUrl
  const url = tile.jwst.fullResUrl || tile.jwst.displayUrl;
  return { type: 'image', url };
}

/**
 * Build a full `TelescopeObservationMeta` from a `SkyTile`.
 *
 * The layer list starts with a single "Primary" layer. Multi-layer support
 * (e.g. separate filter bands as overlay layers) can be added later by
 * populating the `layers` array from a richer data source.
 */
export function observationMetaFromSkyTile(tile: SkyTile): TelescopeObservationMeta {
  return {
    title: tile.title,
    mission: tile.jwst.telescope ?? 'JWST',
    instrument: tile.jwst.instrument ?? '',
    target: tile.title,
    coordinates:
      tile.raDeg != null && tile.decDeg != null
        ? { raDeg: tile.raDeg, decDeg: tile.decDeg }
        : undefined,
    filters: undefined, // populated when filter metadata is available
    layers: [{ id: 'primary', label: 'Primary', visible: true }],
    tileManifest: tileSourceFromSkyTile(tile),
  };
}
