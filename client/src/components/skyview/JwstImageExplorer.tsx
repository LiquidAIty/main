import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SkyTile, TelescopeViewportState } from './types';

const INITIAL_IMAGE_VIEWPORT_STATE: Omit<TelescopeViewportState, 'selectedTileId'> = {
  scale: 1,
  x: 0,
  y: 0,
  rotationDeg: 0,
};

type JwstImageExplorerProps = {
  tile: SkyTile;
};

export default function JwstImageExplorer({
  tile,
}: JwstImageExplorerProps): React.ReactElement {
  const dragStartRef = useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
    viewport: Omit<TelescopeViewportState, 'selectedTileId'>;
  } | null>(null);
  const [viewport, setViewport] = useState<Omit<TelescopeViewportState, 'selectedTileId'>>(
    INITIAL_IMAGE_VIEWPORT_STATE,
  );
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
    setViewport(INITIAL_IMAGE_VIEWPORT_STATE);
  }, [tile.id]);

  const debugViewport = useMemo(
    () =>
      `scale: ${viewport.scale} | x: ${Math.round(viewport.x)} | y: ${Math.round(
        viewport.y,
      )} | rotationDeg: ${viewport.rotationDeg}`,
    [viewport],
  );

  const updateScale = useCallback((multiplier: number) => {
    setViewport((prev) => ({
      ...prev,
      scale: Math.min(5, Math.max(0.6, Number((prev.scale * multiplier).toFixed(3)))),
    }));
  }, []);

  const resetViewport = useCallback(() => {
    setViewport(INITIAL_IMAGE_VIEWPORT_STATE);
  }, []);

  const rotateViewport = useCallback((deltaDeg: number) => {
    setViewport((prev) => ({
      ...prev,
      rotationDeg: (prev.rotationDeg + deltaDeg + 360) % 360,
    }));
  }, []);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStartRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      viewport,
    };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const dragStart = dragStartRef.current;
    if (!dragStart || dragStart.pointerId !== event.pointerId) return;
    setViewport({
      ...dragStart.viewport,
      x: dragStart.viewport.x + event.clientX - dragStart.clientX,
      y: dragStart.viewport.y + event.clientY - dragStart.clientY,
    });
  };

  const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragStartRef.current?.pointerId === event.pointerId) {
      dragStartRef.current = null;
    }
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    updateScale(event.deltaY < 0 ? 1.12 : 0.88);
  };

  const hasDisplayImage = Boolean(tile.jwst.displayUrl) && !imageFailed;

  return (
    <section className="jwst-explorer" data-testid="jwst-image-explorer">
      <header className="jwst-explorer-head">
        <div>
          <div className="skyview-kicker">JWST Image Explorer</div>
          <h3>{tile.title}</h3>
        </div>
        {/* Source link removed — metadata is available in the inspect drawer */}
      </header>

      <div
        className="jwst-stage"
        data-testid="jwst-image-stage"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onWheel={handleWheel}
        role="img"
        aria-label={`${tile.title} viewport`}
      >
        {hasDisplayImage ? (
          <img
            src={tile.jwst.displayUrl}
            alt={`${tile.jwst.title} JWST`}
            draggable={false}
            onError={() => setImageFailed(true)}
            style={{
              transform: `translate(-50%, -50%) translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale}) rotate(${viewport.rotationDeg}deg)`,
            }}
          />
        ) : (
          <div className="jwst-stage-placeholder">
            <strong>Display image pending.</strong>
            <span>Open official source.</span>
          </div>
        )}
      </div>

      <div className="jwst-controls" data-testid="jwst-image-controls">
        <button type="button" onClick={resetViewport}>
          Reset
        </button>
        <button type="button" onClick={() => rotateViewport(-15)}>
          Rotate Left
        </button>
        <button type="button" onClick={() => rotateViewport(15)}>
          Rotate Right
        </button>
        <button type="button" onClick={() => updateScale(1.2)}>
          Zoom In
        </button>
        <button type="button" onClick={() => updateScale(0.84)}>
          Zoom Out
        </button>
        {/* TODO: Ask Sol about this view */}
        <button type="button" disabled title="TODO: Ask Sol about this view">
          Ask Sol
        </button>
        {/* TODO: Save current view */}
        <button type="button" disabled title="TODO: Save current view">
          Save View
        </button>
        {/* TODO: Share current view */}
        <button type="button" disabled title="TODO: Share current view">
          Share Snapshot
        </button>
      </div>

      <div className="jwst-debug" data-testid="jwst-viewport-debug">
        {debugViewport}
      </div>
      {/* TODO: Create annotation node from current view */}
      {/* TODO: Convert current view to React Flow canvas snapshot later */}
    </section>
  );
}
