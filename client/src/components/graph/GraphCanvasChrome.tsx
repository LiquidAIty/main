import type { CSSProperties } from 'react';

import { GRAPH_WORKSPACE, getGraphMajorGridGap } from './graphWorkspaceContract';
import { GRAPH_THEME, graphControlButtonStyle, graphControlStackStyle } from './graphVisualTokens';

export function GraphPaperBackground({ zIndex = 0, viewport = { x: 0, y: 0, zoom: 1 } }: {
  zIndex?: number;
  viewport?: { x: number; y: number; zoom: number };
}) {
  const majorGap = getGraphMajorGridGap() * viewport.zoom;
  const minorGap = GRAPH_WORKSPACE.worldGridGap * viewport.zoom;
  const lineWidth = GRAPH_THEME.graphPaper.lineWidth * viewport.zoom;
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex,
        pointerEvents: 'none',
        backgroundColor: GRAPH_THEME.surface.base,
        backgroundImage: [
          `linear-gradient(to right, ${GRAPH_THEME.background.gridMinor} ${lineWidth}px, transparent ${lineWidth}px)`,
          `linear-gradient(to bottom, ${GRAPH_THEME.background.gridMinor} ${lineWidth}px, transparent ${lineWidth}px)`,
          `linear-gradient(to right, ${GRAPH_THEME.background.gridMajor} ${lineWidth}px, transparent ${lineWidth}px)`,
          `linear-gradient(to bottom, ${GRAPH_THEME.background.gridMajor} ${lineWidth}px, transparent ${lineWidth}px)`,
          GRAPH_THEME.background.agentSurface,
        ].join(','),
        backgroundSize: [
          `${minorGap}px ${minorGap}px`,
          `${minorGap}px ${minorGap}px`,
          `${majorGap}px ${majorGap}px`,
          `${majorGap}px ${majorGap}px`,
          'auto, auto, auto',
        ].join(','),
        backgroundPosition: [...Array(4).fill(`${viewport.x}px ${viewport.y}px`), '0 0, 0 0, 0 0'].join(','),
      }}
    />
  );
}

export function GraphNavigationControls({
  onZoomIn,
  onZoomOut,
  onFit,
  style,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  style?: CSSProperties;
}) {
  const button = graphControlButtonStyle({ borderBottom: `1px solid ${GRAPH_THEME.controls.border}` });
  return (
    <div
      data-testid="graph-navigation-controls"
      style={{
        ...graphControlStackStyle,
        left: 'auto',
        right: 16,
        bottom: 16,
        ...style,
      }}
    >
      <button type="button" aria-label="Zoom in" title="Zoom in" style={button} onClick={onZoomIn}>+</button>
      <button type="button" aria-label="Zoom out" title="Zoom out" style={button} onClick={onZoomOut}>−</button>
      <button type="button" aria-label="Fit view" title="Fit view" style={{ ...graphControlButtonStyle() }} onClick={onFit}>
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path d="M2.25 5.25V2.25h3M8.75 2.25h3v3M11.75 8.75v3h-3M5.25 11.75h-3v-3" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}
