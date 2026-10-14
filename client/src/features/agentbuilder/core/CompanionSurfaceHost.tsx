import type { ReactNode } from 'react';

import { GRAPH_THEME, graphCompanionPanelStyle } from '../../../components/graph/graphVisualTokens';

type CompanionSurfaceHostProps = {
  workspaceView: string;
  knowledgeSurface: ReactNode;
  tradingSurface: ReactNode;
  worldsignalSurface: ReactNode;
  worldviewSurface?: ReactNode;
};

export default function CompanionSurfaceHost({
  workspaceView,
  knowledgeSurface,
  tradingSurface,
  worldsignalSurface,
  worldviewSurface,
}: CompanionSurfaceHostProps) {
  if (workspaceView === 'canvas' || workspaceView === 'chat') {
    return null;
  }

  return (
    <aside
      data-testid="workspace-companion-region"
      data-workspace={workspaceView}
      data-open="true"
      className="h-full w-full min-w-0 relative"
      style={graphCompanionPanelStyle({
        width: '100%',
        height: '100%',
        minWidth: 0,
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
          {workspaceView === 'worldview' && worldviewSurface}
        </div>
      </div>
    </aside>
  );
}
