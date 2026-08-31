import type { ReactNode } from 'react';

import { GRAPH_THEME, graphCompanionPanelStyle } from '../../../components/graph/graphVisualTokens';

type CompanionSurfaceHostProps = {
  workspaceView: string;
  minWidth: number;
  knowledgeSurface: ReactNode;
  tradingSurface: ReactNode;
  worldsignalSurface: ReactNode;
};

export default function CompanionSurfaceHost({
  workspaceView,
  minWidth,
  knowledgeSurface,
  tradingSurface,
  worldsignalSurface,
}: CompanionSurfaceHostProps) {
  if (workspaceView === 'canvas' || workspaceView === 'chat') {
    return null;
  }

  return (
    <aside
      data-testid="workspace-companion-region"
      data-workspace={workspaceView}
      data-open="true"
      className="h-full relative"
      style={graphCompanionPanelStyle({
        minWidth,
        flex: '1 1 0%',
        overflow: 'hidden',
      })}
    >
      <div className="h-full flex flex-col overflow-hidden min-h-0 relative">
        <div
          className="flex-1 overflow-hidden text-sm min-h-0"
          style={{
            color: GRAPH_THEME.drawer.inputMuted,
            background: 'transparent',
          }}
        >
          {workspaceView === 'knowledge' && knowledgeSurface}
          {workspaceView === 'trading' && tradingSurface}
          {workspaceView === 'worldsignal' && worldsignalSurface}
        </div>
      </div>
    </aside>
  );
}
