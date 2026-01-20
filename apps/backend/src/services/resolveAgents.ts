import { getAssistAssignments } from './agentBuilderStore';
import {
  getProjectAgent,
  listProjectAgents,
} from './projectAgentsStore';
import { resolveModel } from '../llm/models.config';

export async function resolveKgIngestAgent(projectId: string) {
  const { assist_kg_ingest_agent_id } = await getAssistAssignments(projectId);
  let agent = null;
  if (assist_kg_ingest_agent_id) {
    agent = await getProjectAgent(assist_kg_ingest_agent_id);
  }
  if (!agent) {
    const agents = await listProjectAgents(projectId);
    agent =
      agents.find(
        (a) =>
          a.agent_type === 'kg_ingest' ||
          a.name?.toLowerCase() === 'kg ingest' ||
          a.name?.toLowerCase() === 'knowledge ingest',
      ) || null;
  }
  if (!agent) return null;

  const systemParts: string[] = [];
  if (agent.prompt_template?.trim()) {
    systemParts.push(agent.prompt_template.trim());
  } else {
    if (agent.role_text?.trim()) systemParts.push(agent.role_text.trim());
    if (agent.goal_text?.trim()) systemParts.push(agent.goal_text.trim());
    if (agent.constraints_text?.trim()) systemParts.push(agent.constraints_text.trim());
    if (agent.memory_policy_text?.trim()) systemParts.push(agent.memory_policy_text.trim());
  }
  const systemPrompt = systemParts.join('\n\n').trim();
  const modelKey = agent.model;
  if (!modelKey || !String(modelKey).trim()) {
    console.error('[KG_INGEST] missing model on kg ingest agent', {
      projectId,
      agent_id: agent.agent_id,
    });
    throw new Error('kg_ingest_agent_missing_model');
  }

  if (modelKey.includes('/')) {
    console.error('[KG_INGEST] invalid model key format', {
      projectId,
      agent_id: agent.agent_id,
      modelKey,
    });
    throw new Error(
      `invalid_model_key_format: model key cannot be a provider ID (got: ${modelKey}). Use internal keys like 'kimi-k2-thinking'.`,
    );
  }

  let modelEntry;
  try {
    modelEntry = resolveModel(modelKey);
  } catch (err: any) {
    console.error('[KG_INGEST] model resolution failed', {
      projectId,
      agent_id: agent.agent_id,
      modelKey,
      error: err?.message || String(err),
    });
    throw new Error(`kg_ingest_model_resolution_failed: ${err?.message || 'unknown_error'}`);
  }

  const provider = modelEntry.provider;
  const providerModelId = modelEntry.id;

  return { agentId: agent.agent_id, agent, modelKey, systemPrompt, provider, providerModelId };
}
