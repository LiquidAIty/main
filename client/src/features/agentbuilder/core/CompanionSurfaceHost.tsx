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
  energySurface: ReactNode;
  tradingSurface: ReactNode;
  imageSurface: ReactNode;
  codeSurface: ReactNode;
  videoSurface: ReactNode;
  dataFormulatorSurface: ReactNode;
  uaSurface: ReactNode;
  worldsignalSurface: ReactNode;
  planSurface: ReactNode;
};

export default function CompanionSurfaceHost({
  workspaceView,
  minWidth,
  hasKnowledgeWorkspaceSelection,
  hasActiveUaSurface,
  knowledgeSelectionSurface,
  knowledgeSurface,
  codegraphSurface,
  energySurface,
  tradingSurface,
  imageSurface,
  codeSurface,
  videoSurface,
  dataFormulatorSurface,
  uaSurface,
  worldsignalSurface,
  planSurface,
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
          {workspaceView === 'energy' && energySurface}
          {workspaceView === 'trading' && tradingSurface}
          {workspaceView === 'image' && imageSurface}
          {workspaceView === 'code' && codeSurface}
          {workspaceView === 'video' && videoSurface}
          {workspaceView === 'data-formulator' && dataFormulatorSurface}
          {hasActiveUaSurface && uaSurface}
          {workspaceView === 'worldsignal' && worldsignalSurface}
          {workspaceView === 'plan' && planSurface}
        </div>
      </div>
    </aside>
  );
}
