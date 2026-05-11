import {
  getUaAgentDefinitionBySurface,
  type UaAgentSurfaceId,
} from '../../../runtime/uaAgentDefinitions';
import UaDashboardCanvas from './real-dashboard/UaDashboardCanvas';

export type UaWorkbenchGraphSource =
  | 'sample_fallback'
  | 'local_ua_json'
  | 'generated_repo_graph';

export type UaWorkbenchAnalysisStatus =
  | 'not_started'
  | 'graph_loaded'
  | 'needs_repo_scan'
  | 'run_pending';

export type UaWorkbenchContext = {
  projectId: string | null;
  repoPath: string;
  workspaceRoot: string;
  graphSource: UaWorkbenchGraphSource;
  analysisStatus: UaWorkbenchAnalysisStatus;
  activeLens: string;
  connectedWorkbenchAgent: boolean;
  selectedNodeId: string | null;
  selectedNodeName: string | null;
};

export default function UaAgentPanelHost({
  surfaceId,
  workbenchContext,
}: {
  surfaceId: UaAgentSurfaceId;
  workbenchContext: UaWorkbenchContext;
}) {
  const agent = getUaAgentDefinitionBySurface(surfaceId);
  if (!agent) return null;

  return (
    <UaDashboardCanvas
      lens={agent.uiLens}
      workbenchContext={workbenchContext}
    />
  );
}
