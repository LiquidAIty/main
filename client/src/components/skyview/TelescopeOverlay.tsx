import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  GRAPH_THEME,
  graphControlButtonStyle,
  graphControlStackStyle,
} from '../graph/graphVisualTokens';
import RightGlassDrawer from '../graph/RightGlassDrawer';
import { skyTiles } from './skyTiles';
import type { SkyTile } from './types';
import TelescopeCanvas, { type TelescopeCanvasHandle } from './TelescopeCanvas';
import { tileSourceFromSkyTile, observationMetaFromSkyTile } from './telescopeMetadata';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SAGITTARIUS_C_ID = 'sagittarius-c';
const FIRST_TILE_ID =
  skyTiles.find((t) => t.id === SAGITTARIUS_C_ID)?.id ?? skyTiles[0]?.id ?? '';


// ---------------------------------------------------------------------------
// TelescopeOverlay — full-surface deep-zoom image canvas
// ---------------------------------------------------------------------------

export default function TelescopeOverlay(): React.ReactElement {
  const canvasRef = useRef<TelescopeCanvasHandle>(null);

  const [selectedTileId, setSelectedTileId] = useState(FIRST_TILE_ID);
  const [controlsLocked, setControlsLocked] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [failedImageIds, setFailedImageIds] = useState<Set<string>>(() => new Set());


  // --- Derived data --------------------------------------------------------

  const selectedTile = useMemo<SkyTile>(
    () => skyTiles.find((t) => t.id === selectedTileId) ?? skyTiles[0],
    [selectedTileId],
  );

  const tileSource = useMemo(() => tileSourceFromSkyTile(selectedTile), [selectedTile]);

  const meta = useMemo(() => observationMetaFromSkyTile(selectedTile), [selectedTile]);

  // Context blob for Sol / agent integration (hidden div)
  const selectedContext = useMemo(
    () => ({
      title: selectedTile.title,
      objectType: selectedTile.objectType,
      telescope: selectedTile.jwst.telescope,
      instrument: selectedTile.jwst.instrument,
      distanceLabel: selectedTile.jwst.distanceLabel,
      redshift: selectedTile.jwst.redshift,
      summary: selectedTile.jwst.summary,
      aiContextSummary: selectedTile.aiContextSummary,
    }),
    [selectedTile],
  );

  // --- Actions -------------------------------------------------------------

  const selectTile = useCallback((tileId: string) => {
    setSelectedTileId(tileId);
  }, []);

  const handleZoomIn = useCallback(() => {
    canvasRef.current?.zoomIn();
  }, []);

  const handleZoomOut = useCallback(() => {
    canvasRef.current?.zoomOut();
  }, []);

  const handleHome = useCallback(() => {
    canvasRef.current?.home();
  }, []);

  const handleResetView = useCallback(() => {
    canvasRef.current?.home();
    canvasRef.current?.rotateTo(0);
  }, []);

  const handleRotateLeft = useCallback(() => {
    const current = canvasRef.current?.getRotation() ?? 0;
    canvasRef.current?.rotateTo(current - 15);
  }, []);

  const handleRotateRight = useCallback(() => {
    const current = canvasRef.current?.getRotation() ?? 0;
    canvasRef.current?.rotateTo(current + 15);
  }, []);

  const toggleLock = useCallback(() => {
    setControlsLocked((prev) => {
      const next = !prev;
      canvasRef.current?.setNavigationEnabled(!next);
      return next;
    });
  }, []);

  const markImageFailed = (tileId: string) => {
    setFailedImageIds((current) => {
      const next = new Set(current);
      next.add(tileId);
      return next;
    });
  };

  // --- Compact label -------------------------------------------------------

  const compactLabel = [
    selectedTile.title,
    selectedTile.jwst.telescope?.includes('Webb')
      ? 'James Webb Space Telescope (JWST)'
      : selectedTile.jwst.telescope,
    selectedTile.objectType,
  ]
    .filter(Boolean)
    .join(' · ');

  // --- Render --------------------------------------------------------------

  return (
    <div className="telescope-overlay" data-testid="telescope-overlay">
      <style>{`
        .telescope-overlay {
          position: absolute; inset: 0; z-index: 12;
          background: #020408; color: #F5F7FA;
          overflow: hidden;
        }
        .telescope-main {
          position: absolute; inset: 0;
          overflow: hidden; background: #020408;
        }
        .telescope-label {
          position: absolute; left: 64px; top: 13px; right: 220px;
          z-index: 5; width: fit-content;
          max-width: min(720px, calc(100% - 300px));
          padding: 5px 9px;
          border: 1px solid rgba(167,176,186,0.16);
          border-radius: 999px;
          background: rgba(11,14,18,0.54);
          color: rgba(245,247,250,0.86);
          font-size: 10px; line-height: 1.25;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
        }

        /* --- Drawer thumbnail strip --- */
        .telescope-strip {
          min-width: 0; display: grid;
          grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
          gap: 6px; overflow-y: auto; overflow-x: hidden;
          scrollbar-width: none;
        }
        .telescope-strip::-webkit-scrollbar { display: none; }
        .telescope-thumb {
          border: 1px solid rgba(167,176,186,0.13);
          border-radius: 7px;
          background: rgba(17,22,29,0.54);
          color: #F5F7FA; padding: 0; overflow: hidden;
          text-align: left; cursor: pointer;
          display: grid; grid-template-rows: 56px minmax(0, 1fr);
        }
        .telescope-thumb:hover,
        .telescope-thumb.active {
          border-color: rgba(55,173,170,0.48);
          background: rgba(17,28,32,0.84);
        }
        .telescope-thumb-media {
          min-height: 0; background: #020408;
          display: flex; align-items: center; justify-content: center;
          overflow: hidden;
        }
        .telescope-thumb-media img {
          width: 100%; height: 100%; object-fit: cover; display: block;
        }
        .telescope-thumb-fallback {
          width: 100%; height: 100%;
          display: flex; align-items: center; justify-content: center;
          color: rgba(167,176,186,0.72);
          font-family: 'IBM Plex Mono', monospace;
          font-size: 11px; letter-spacing: 0.12em;
          background: radial-gradient(circle at 40% 40%, rgba(55,173,170,0.18), transparent 36%),
                      linear-gradient(135deg, rgba(17,22,29,0.96), rgba(2,4,8,0.98));
        }
        .telescope-thumb-body {
          min-width: 0; padding: 4px 6px;
        }
        .telescope-thumb-title {
          color: #F5F7FA; font-weight: 700; font-size: 10px;
          line-height: 1.1; white-space: nowrap;
          overflow: hidden; text-overflow: ellipsis;
        }

        /* --- Drawer metadata rows --- */
        .telescope-meta-section {
          display: grid; gap: 6px; padding: 8px 0;
          border-bottom: 1px solid rgba(167,176,186,0.12);
        }
        .telescope-meta-section:last-child { border-bottom: none; }
        .telescope-meta-row {
          display: flex; justify-content: space-between;
          align-items: baseline; gap: 8px;
        }
        .telescope-meta-key {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 10px; color: #A7B0BA;
          letter-spacing: 0.06em; text-transform: uppercase;
          white-space: nowrap; flex-shrink: 0;
        }
        .telescope-meta-value {
          font-size: 11px; color: #F5F7FA;
          text-align: right; word-break: break-word;
          min-width: 0;
        }
        .telescope-drawer-heading {
          font-size: 11px; font-weight: 700; color: #A7B0BA;
          letter-spacing: 0.08em; text-transform: uppercase;
          padding: 4px 0; margin-top: 4px;
        }

        @media (max-width: 960px) {
          .telescope-label { right: 12px; max-width: calc(100% - 84px); }
        }
      `}</style>

      {/* Hidden context for Sol / agent system */}
      <div
        hidden
        data-testid="telescope-sol-context"
        data-context={JSON.stringify(selectedContext)}
      />

      <div className="telescope-main">
        {/* Compact label bar */}
        <div className="telescope-label" title={compactLabel}>
          {compactLabel}
        </div>

        {/* ── OpenSeadragon deep-zoom surface ────────────────────────────── */}
        <TelescopeCanvas
          ref={canvasRef}
          tileSource={tileSource}
          fallbackUrl={selectedTile.jwst.displayUrl}
        />


        {/* ── Shared vertical control strip ──────────────────────────────── */}
        <div
          data-no-surface-promote="true"
          style={{
            ...graphControlStackStyle,
            left: 12,
            bottom: 12,
          }}
          data-testid="telescope-controls"
        >
          <button
            type="button"
            aria-label="Zoom in"
            title="Zoom in"
            onClick={handleZoomIn}
            style={graphControlButtonStyle({
              borderBottom: `1px solid ${GRAPH_THEME.controls.border}`,
            })}
          >
            +
          </button>
          <button
            type="button"
            aria-label="Zoom out"
            title="Zoom out"
            onClick={handleZoomOut}
            style={graphControlButtonStyle({
              borderBottom: `1px solid ${GRAPH_THEME.controls.border}`,
            })}
          >
            -
          </button>
          <button
            type="button"
            aria-label="Fit view"
            title="Fit view"
            onClick={handleHome}
            style={graphControlButtonStyle({
              borderBottom: `1px solid ${GRAPH_THEME.controls.border}`,
            })}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path
                d="M2.25 5.25V2.25h3M8.75 2.25h3v3M11.75 8.75v3h-3M5.25 11.75h-3v-3"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.25"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            type="button"
            aria-label="Reset view"
            title="Reset view"
            onClick={handleResetView}
            style={graphControlButtonStyle({
              borderBottom: `1px solid ${GRAPH_THEME.controls.border}`,
            })}
          >
            0
          </button>
          <button
            type="button"
            aria-label="Rotate left"
            title="Rotate left"
            onClick={handleRotateLeft}
            style={graphControlButtonStyle({
              borderBottom: `1px solid ${GRAPH_THEME.controls.border}`,
            })}
          >
            ↺
          </button>
          <button
            type="button"
            aria-label="Rotate right"
            title="Rotate right"
            onClick={handleRotateRight}
            style={graphControlButtonStyle({
              borderBottom: `1px solid ${GRAPH_THEME.controls.border}`,
            })}
          >
            ↻
          </button>
          <button
            type="button"
            aria-label="Inspect"
            title="Inspect panel"
            onClick={() => setDrawerOpen((prev) => !prev)}
            style={graphControlButtonStyle({
              borderBottom: `1px solid ${GRAPH_THEME.controls.border}`,
              color: drawerOpen
                ? GRAPH_THEME.accent.primary
                : GRAPH_THEME.controls.text,
            })}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <rect
                x="2" y="2" width="10" height="10" rx="1.5"
                fill="none" stroke="currentColor" strokeWidth="1.25"
              />
              <line
                x1="8.5" y1="2" x2="8.5" y2="12"
                stroke="currentColor" strokeWidth="1.25"
              />
            </svg>
          </button>
          <button
            type="button"
            aria-label={controlsLocked ? 'Unlock interaction' : 'Lock interaction'}
            title={controlsLocked ? 'Unlock interaction' : 'Lock interaction'}
            onClick={toggleLock}
            style={graphControlButtonStyle({
              color: controlsLocked
                ? GRAPH_THEME.accent.primary
                : GRAPH_THEME.controls.text,
            })}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path
                d="M4.5 6V4.75a2.5 2.5 0 1 1 5 0V6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.25"
                strokeLinecap="round"
              />
              <rect
                x="3" y="6" width="8" height="6" rx="1.5"
                fill="none" stroke="currentColor" strokeWidth="1.25"
              />
            </svg>
          </button>
        </div>

        {/* ── Right glass inspect drawer ─────────────────────────────────── */}
        <RightGlassDrawer
          isOpen={drawerOpen}
          title="Images"
          onClose={() => setDrawerOpen(false)}
          onOpen={() => setDrawerOpen(true)}
          dataTestId="telescope-inspect-drawer"
          defaultWidth={340}
          minWidth={280}
          maxWidth={520}
          storageKey="telescope-inspect-width"
          top={48}
          right={12}
          bottom={12}
          zIndex={20}
        >
          {/* ── Metadata ──────────────────────────────────────────────── */}
          <div className="telescope-meta-section">
            <div className="telescope-meta-row">
              <span className="telescope-meta-key">Title</span>
              <span className="telescope-meta-value">{meta.title}</span>
            </div>
            <div className="telescope-meta-row">
              <span className="telescope-meta-key">Type</span>
              <span className="telescope-meta-value">{selectedTile.objectType}</span>
            </div>
            <div className="telescope-meta-row">
              <span className="telescope-meta-key">Mission</span>
              <span className="telescope-meta-value">{meta.mission}</span>
            </div>
            {meta.instrument ? (
              <div className="telescope-meta-row">
                <span className="telescope-meta-key">Instrument</span>
                <span className="telescope-meta-value">{meta.instrument}</span>
              </div>
            ) : null}
            {meta.coordinates ? (
              <div className="telescope-meta-row">
                <span className="telescope-meta-key">Coords</span>
                <span className="telescope-meta-value">
                  {meta.coordinates.raDeg.toFixed(4)}° RA, {meta.coordinates.decDeg.toFixed(4)}° Dec
                </span>
              </div>
            ) : null}
            {selectedTile.jwst.distanceLabel ? (
              <div className="telescope-meta-row">
                <span className="telescope-meta-key">Distance</span>
                <span className="telescope-meta-value">{selectedTile.jwst.distanceLabel}</span>
              </div>
            ) : null}
            {selectedTile.jwst.redshift != null ? (
              <div className="telescope-meta-row">
                <span className="telescope-meta-key">Redshift</span>
                <span className="telescope-meta-value">z = {selectedTile.jwst.redshift}</span>
              </div>
            ) : null}
            {selectedTile.jwst.creditLabel ? (
              <div className="telescope-meta-row">
                <span className="telescope-meta-key">Credit</span>
                <span className="telescope-meta-value">{selectedTile.jwst.creditLabel}</span>
              </div>
            ) : null}
          </div>

          {/* ── Thumbnail selector ────────────────────────────────────── */}
          <div className="telescope-drawer-heading">Observations</div>
          <div
            className="telescope-strip"
            data-testid="telescope-tile-strip"
            aria-label="Telescope image selector"
          >
            {skyTiles.map((tile) => {
              const isActive = tile.id === selectedTile.id;
              const hasThumb =
                Boolean(tile.jwst.thumbUrl) && !failedImageIds.has(tile.id);
              return (
                <button
                  key={tile.id}
                  type="button"
                  className={`telescope-thumb ${isActive ? 'active' : ''}`}
                  data-testid={`telescope-tile-${tile.id}`}
                  aria-pressed={isActive}
                  onClick={() => selectTile(tile.id)}
                >
                  <div className="telescope-thumb-media">
                    {hasThumb ? (
                      <img
                        src={tile.jwst.thumbUrl}
                        alt={`${tile.title} thumbnail`}
                        draggable={false}
                        loading="lazy"
                        onError={() => markImageFailed(tile.id)}
                      />
                    ) : (
                      <div className="telescope-thumb-fallback" aria-hidden="true">
                        JWST
                      </div>
                    )}
                  </div>
                  <div className="telescope-thumb-body">
                    <div className="telescope-thumb-title">{tile.title}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </RightGlassDrawer>
      </div>
    </div>
  );
}
