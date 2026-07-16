import type { CSSProperties } from 'react';

import { GRAPH_WORKSPACE, getGraphMajorGridGap } from './graphWorkspaceContract';
import { GRAPH_THEME, graphControlButtonStyle, graphControlStackStyle } from './graphVisualTokens';

export function GraphPaperBackground({ zIndex = 0 }: { zIndex?: number }) {
  const majorGap = getGraphMajorGridGap();
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex,
        pointerEvents: 'none',
        background: GRAPH_THEME.background.knowledgeSurface,
        backgroundImage: [
          `linear-gradient(to right, ${GRAPH_THEME.background.gridMinor} ${GRAPH_THEME.graphPaper.lineWidth}px, transparent ${GRAPH_THEME.graphPaper.lineWidth}px)`,
          `linear-gradient(to bottom, ${GRAPH_THEME.background.gridMinor} ${GRAPH_THEME.graphPaper.lineWidth}px, transparent ${GRAPH_THEME.graphPaper.lineWidth}px)`,
          `linear-gradient(to right, ${GRAPH_THEME.background.gridMajor} ${GRAPH_THEME.graphPaper.lineWidth}px, transparent ${GRAPH_THEME.graphPaper.lineWidth}px)`,
          `linear-gradient(to bottom, ${GRAPH_THEME.background.gridMajor} ${GRAPH_THEME.graphPaper.lineWidth}px, transparent ${GRAPH_THEME.graphPaper.lineWidth}px)`,
        ].join(','),
        backgroundSize: [
          `${GRAPH_WORKSPACE.worldGridGap}px ${GRAPH_WORKSPACE.worldGridGap}px`,
          `${GRAPH_WORKSPACE.worldGridGap}px ${GRAPH_WORKSPACE.worldGridGap}px`,
          `${majorGap}px ${majorGap}px`,
          `${majorGap}px ${majorGap}px`,
        ].join(','),
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
