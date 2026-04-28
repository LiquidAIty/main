import React, { useEffect, useImperativeHandle, useRef, useState } from 'react';
import OpenSeadragon from 'openseadragon';
import type { TelescopeTileSource } from './telescopeMetadata';

// ---------------------------------------------------------------------------
// TelescopeCanvas — OpenSeadragon deep-zoom surface with full-bleed fallback
// ---------------------------------------------------------------------------

export type TelescopeCanvasHandle = {
  zoomIn: () => void;
  zoomOut: () => void;
  home: () => void;
  rotateTo: (deg: number) => void;
  getRotation: () => number;
  setNavigationEnabled: (enabled: boolean) => void;
};

type TelescopeCanvasProps = {
  tileSource: TelescopeTileSource;
  fallbackUrl?: string;
};

/**
 * Wraps OpenSeadragon in a React component.
 *
 * The viewer fills its container via `position: absolute; inset: 0`.
 * No default OSD controls are rendered — the parent provides the
 * shared graphVisualTokens control strip.
 *
 * The image becomes the surface: dark background, grab cursor, no graph paper.
 *
 * Demo fallback: when a DZI source is selected but the tile pyramid is not
 * available, a full-bleed `fallbackUrl` image is shown behind OSD so the
 * stage never looks empty.
 */
const TelescopeCanvas = React.forwardRef<TelescopeCanvasHandle, TelescopeCanvasProps>(
  function TelescopeCanvas({ tileSource, fallbackUrl }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewerRef = useRef<OpenSeadragon.Viewer | null>(null);
    const [osdReady, setOsdReady] = useState(false);

    // --- Viewer lifecycle ---------------------------------------------------

    useEffect(() => {
      if (!containerRef.current) return;

      const viewer = OpenSeadragon({
        element: containerRef.current,
        prefixUrl: '', // no built-in button images
        showNavigationControl: false,
        showNavigator: false,
        showSequenceControl: false,
        showZoomControl: false,
        showHomeControl: false,
        showFullPageControl: false,
        showRotationControl: false,
        animationTime: 0.3,
        blendTime: 0.15,
        springStiffness: 12,
        visibilityRatio: 0.5,
        minZoomLevel: 0.4,
        maxZoomLevel: 20,
        gestureSettingsMouse: {
          clickToZoom: false,
          dblClickToZoom: true,
          scrollToZoom: true,
          flickEnabled: false,
        },
        gestureSettingsTouch: {
          pinchToZoom: true,
          flickEnabled: true,
          clickToZoom: false,
          dblClickToZoom: true,
          scrollToZoom: false,
        },
        // Dark background — the image IS the surface
        // (OSD draws this behind tiles where no image data exists)
        backgroundColor: '#020408',
      });

      viewerRef.current = viewer;

      return () => {
        viewer.destroy();
        viewerRef.current = null;
      };
    }, []);

    // --- Load tile source when it changes -----------------------------------

    useEffect(() => {
      const viewer = viewerRef.current;
      if (!viewer) return;

      setOsdReady(false);

      const onOpen = () => setOsdReady(true);
      const onOpenFailed = () => setOsdReady(false);
      viewer.addHandler('open', onOpen);
      viewer.addHandler('open-failed', onOpenFailed);

      /*
       * Map our TelescopeTileSource union into OSD's tile source format.
       *
       * `image` → OSD "simple image" (full-res URL, client-side tiling).
       * `dzi`   → standard .dzi XML manifest + /files/ directory.
       * `iiif`  → IIIF Image API info.json endpoint.
       *
       * Future MAST tile sources: add a new branch here.
       */
      let osdSource: OpenSeadragon.TileSourceOptions | string;

      switch (tileSource.type) {
        case 'dzi':
          osdSource = tileSource.url;
          break;
        case 'iiif':
          osdSource = tileSource.url;
          break;
        case 'image':
        default:
          osdSource = { type: 'image', url: tileSource.url };
          break;
      }

      viewer.open(osdSource);

      return () => {
        viewer.removeHandler('open', onOpen);
        viewer.removeHandler('open-failed', onOpenFailed);
      };
    }, [tileSource]);

    // --- Imperative handle for parent controls ------------------------------

    useImperativeHandle(ref, () => ({
      zoomIn() {
        viewerRef.current?.viewport.zoomBy(1.3);
        viewerRef.current?.viewport.applyConstraints();
      },
      zoomOut() {
        viewerRef.current?.viewport.zoomBy(1 / 1.3);
        viewerRef.current?.viewport.applyConstraints();
      },
      home() {
        viewerRef.current?.viewport.goHome();
      },
      rotateTo(deg: number) {
        viewerRef.current?.viewport.setRotation(deg);
      },
      getRotation(): number {
        return viewerRef.current?.viewport.getRotation() ?? 0;
      },
      setNavigationEnabled(enabled: boolean) {
        const viewer = viewerRef.current;
        if (!viewer) return;
        viewer.setMouseNavEnabled(enabled);
      },
    }));

    // --- Render -------------------------------------------------------------

    const hasFallback = Boolean(fallbackUrl);

    return (
      <div
        data-testid="telescope-osd-container"
        style={{
          position: 'absolute',
          inset: 0,
          cursor: 'grab',
          background: '#020408',
        }}
      >
        {hasFallback && (
          <img
            src={fallbackUrl}
            alt=""
            draggable={false}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              objectPosition: 'center center',
              display: 'block',
              zIndex: 0,
            }}
          />
        )}
        <div
          ref={containerRef}
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 1,
          }}
        />
      </div>
    );
  },
);

export default TelescopeCanvas;
