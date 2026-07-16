import type { CSSProperties } from 'react';

import { GRAPH_WORKSPACE, getGraphMajorGridGap } from './graphWorkspaceContract';
import { GRAPH_THEME, graphControlButtonStyle, graphGlassCardStyle } from './graphVisualTokens';

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
  const button = graphControlButtonStyle({
    width: 32,
    height: 30,
    border: 0,
    borderRight: `1px solid ${GRAPH_THEME.controls.border}`,
    background: 'transparent',
    fontSize: 14,
  });
  return (
    <div
      data-testid="graph-navigation-controls"
      style={graphGlassCardStyle({
        position: 'absolute',
        left: 12,
        bottom: 12,
        zIndex: 5,
        display: 'flex',
        overflow: 'hidden',
        borderRadius: 9,
        ...style,
      })}
    >
      <button type="button" aria-label="Zoom in" title="Zoom in" style={button} onClick={onZoomIn}>+</button>
      <button type="button" aria-label="Zoom out" title="Zoom out" style={button} onClick={onZoomOut}>−</button>
      <button type="button" aria-label="Fit all" title="Fit all" style={{ ...button, width: 42, borderRight: 0, fontSize: 10, fontWeight: 700 }} onClick={onFit}>FIT</button>
    </div>
  );
}
