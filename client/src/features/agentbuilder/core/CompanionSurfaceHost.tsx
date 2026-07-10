import type { ReactNode } from 'react';

import { GRAPH_THEME, graphCompanionPanelStyle } from '../../../components/graph/graphVisualTokens';

type CompanionSurfaceHostProps = {
  workspaceView: string;
  minWidth: number;
  hasKnowledgeWorkspaceSelection: boolean;
  hasActiveUaSurface: boolean;
  knowledgeSelectionSurface: ReactNode;
  knowledgeSurface: ReactNode;
  codegraphSurface: ReactNode;
  tradingSurface: ReactNode;
  uaSurface: ReactNode;
  worldsignalSurface: ReactNode;
};

export default function CompanionSurfaceHost({
  workspaceView,
  minWidth,
  hasKnowledgeWorkspaceSelection,
  hasActiveUaSurface,
  knowledgeSelectionSurface,
  knowledgeSurface,
  codegraphSurface,
  tradingSurface,
  uaSurface,
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
          {workspaceView === 'knowledge' &&
            hasKnowledgeWorkspaceSelection &&
            knowledgeSelectionSurface}
          {workspaceView === 'knowledge' &&
            !hasKnowledgeWorkspaceSelection &&
            knowledgeSurface}
          {workspaceView === 'codegraph' && codegraphSurface}
          {workspaceView === 'trading' && tradingSurface}
          {hasActiveUaSurface && uaSurface}
          {workspaceView === 'worldsignal' && worldsignalSurface}
        </div>
      </div>
    </aside>
  );
}
