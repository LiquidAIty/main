import { getAssistAssignments } from './agentBuilderStore';
import {
  getProjectAgentByProjectId,
} from './projectAgentsStore';
import { resolveModel } from '../llm/models.config';

export async function resolveKgIngestAgent(projectId: string) {
  // RESOLUTION PATH LOGGING
  console.log('[KG_RESOLVE] Starting resolution for projectId=%s', projectId);
  
  const assignments = await getAssistAssignments(projectId);
  console.log('[KG_RESOLVE] Assignments loaded:', {
    assist_kg_ingest_agent_id: assignments.assist_kg_ingest_agent_id,
    assist_main_agent_id: assignments.assist_main_agent_id,
  });
  
  const { assist_kg_ingest_agent_id } = assignments;
  
  if (!assist_kg_ingest_agent_id) {
    console.error('[KG_RESOLVE] FAILED: assist_kg_ingest_agent_id not set');
    throw new Error('kg_ingest_agent_missing_assist_assignment');
  }
  
  console.log('[KG_RESOLVE] Looking up agent by projectId=%s agent_type=kg_ingest', assist_kg_ingest_agent_id);
  const agent = await getProjectAgentByProjectId(assist_kg_ingest_agent_id, 'kg_ingest');
  
  if (!agent) {
    console.error('[KG_RESOLVE] FAILED: Agent row not found for projectId=%s agent_type=kg_ingest', assist_kg_ingest_agent_id);
    return null;
  }
  
  console.log('[KG_RESOLVE] Agent found:', {
    agent_id: agent.agent_id,
    agent_type: agent.agent_type,
    model: agent.model,
    prompt_template_len: agent.prompt_template?.length || 0,
  });

  const systemParts: string[] = [];
  if (agent.prompt_template?.trim()) {
    systemParts.push(agent.prompt_template.trim());
  }
  const systemPrompt = systemParts.join('\n\n').trim();
  const modelKey = agent.model;
  
  if (!systemPrompt) {
    console.error('[KG_RESOLVE] FAILED: prompt_template missing or empty');
    throw new Error('kg_ingest_prompt_missing');
  }
  
  if (!modelKey || !String(modelKey).trim()) {
    console.error('[KG_RESOLVE] FAILED: model missing', {
      projectId,
      agent_id: agent.agent_id,
    });
    throw new Error('kg_ingest_model_missing');
  }

  if (modelKey.includes('/')) {
    console.error('[KG_RESOLVE] FAILED: invalid model key format', {
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
    console.error('[KG_RESOLVE] FAILED: model resolution failed', {
      projectId,
      agent_id: agent.agent_id,
      modelKey,
      error: err?.message || String(err),
    });
    throw new Error(`kg_ingest_model_resolution_failed: ${err?.message || 'unknown_error'}`);
  }

  const provider = modelEntry.provider;
  const providerModelId = modelEntry.id;
  
  console.log('[KG_RESOLVE] SUCCESS:', {
    projectId,
    assignedAgentId: assist_kg_ingest_agent_id,
    agentId: agent.agent_id,
    provider,
    modelKey,
    prompt_len: systemPrompt.length,
  });

  return { agentId: agent.agent_id, agent, modelKey, systemPrompt, provider, providerModelId };
}
