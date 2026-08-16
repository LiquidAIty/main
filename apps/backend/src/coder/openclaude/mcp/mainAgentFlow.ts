// Thin backend transport for the Python-owned Mag One roster reader.
// AGE topology, worker eligibility, saved Card configuration, and readiness
// validation remain on Python rails.
import { requestPythonRailsJson } from '../../../services/autogen/autogenOrchestratorClient';

export type ConnectedAgent = {
  cardId: string;
  title: string;
  model: { modelKey: string | null; provider: string | null };
  tools: string[];
  connected: boolean;
  executionReady: boolean;
  readinessState: string;
  readinessReason: string | null;
};

export type DescribeConnectedAgentsResult = {
  projectId: string;
  deckId: string;
  orchestratorCardId: string | null;
  connectedAgents: ConnectedAgent[];
};

type RequestJson = typeof requestPythonRailsJson;

export async function describeConnectedAgents(
  args: { projectId: string; deckId: string },
  request: RequestJson = requestPythonRailsJson,
): Promise<DescribeConnectedAgentsResult> {
  const projectId = String(args.projectId || '').trim();
  const deckId = String(args.deckId || '').trim();
  if (!projectId || !deckId) throw new Error('projectId_and_deckId_required');
  const result = await request(
    `/domain/mag-one/${encodeURIComponent(projectId)}/${encodeURIComponent(deckId)}/agents`,
    { method: 'GET' },
  ) as Partial<DescribeConnectedAgentsResult> & { ok?: boolean };
  if (
    result.ok !== true
    || result.projectId !== projectId
    || result.deckId !== deckId
    || !Array.isArray(result.connectedAgents)
  ) {
    throw new Error('mag_one_connected_agents_response_invalid');
  }
  return {
    projectId: result.projectId,
    deckId: result.deckId,
    orchestratorCardId: typeof result.orchestratorCardId === 'string'
      ? result.orchestratorCardId
      : null,
    connectedAgents: result.connectedAgents,
  };
}
