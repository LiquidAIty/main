import { resolveModel } from '../llm/models.config';
import { getAgentConfig, type AgentType } from './v2/agentConfigStore';

export type RuntimeAgentType = AgentType;

export type ResolvedAgentConfig = {
  agentId: string;
  agentType: RuntimeAgentType;
  modelKey: string;
  systemPrompt: string;
  provider: string;
  providerModelId: string;
  responseFormat: any | null;
  topP: number | null;
  previousResponseId: string | null;
  temperature: number | null;
  maxTokens: number | null;
  tools: any[];
};

function logRouteResolution(route: string, projectId: string, agentType: RuntimeAgentType, resolvedAgentId: string | null) {
  console.log('[AGENT_RESOLVE]', {
    route,
    projectId,
    agentType,
    resolvedAgentId,
  });
}

export async function resolveAgentConfig(
  projectId: string,
  agentType: RuntimeAgentType,
  route = 'unknown',
): Promise<ResolvedAgentConfig | null> {
  const config = await getAgentConfig(projectId, agentType);
  if (!config) {
    logRouteResolution(route, projectId, agentType, null);
    return null;
  }

  const systemPrompt = String(config.prompt_template || '').trim();
  const modelKey = String(config.model_key || '').trim();
  logRouteResolution(route, projectId, agentType, config.agent_id);

  if (!systemPrompt) {
    throw new Error(`${agentType}_prompt_missing`);
  }

  if (!modelKey) {
    throw new Error(`${agentType}_model_missing`);
  }
  if (modelKey.includes('/')) {
    throw new Error(
      `invalid_model_key_format: model key cannot be a provider ID (got: ${modelKey}). Use internal keys like 'kimi-k2-thinking'.`,
    );
  }

  let modelEntry;
  try {
    modelEntry = resolveModel(modelKey);
  } catch (err: any) {
    throw new Error(`${agentType}_model_resolution_failed: ${err?.message || 'unknown_error'}`);
  }
  return {
    agentId: config.agent_id,
    agentType,
    modelKey,
    systemPrompt,
    provider: modelEntry.provider,
    providerModelId: modelEntry.id,
    responseFormat: config.response_format ?? null,
    topP: typeof config.top_p === 'number' ? config.top_p : null,
    previousResponseId:
      typeof config.previous_response_id === 'string' ? String(config.previous_response_id) : null,
    temperature: typeof config.temperature === 'number' ? config.temperature : null,
    maxTokens: typeof config.max_tokens === 'number' ? config.max_tokens : null,
    tools: Array.isArray(config.tools) ? config.tools : [],
  };
}

export async function resolveKgIngestAgent(projectId: string, route = 'unknown') {
  return resolveAgentConfig(projectId, 'kg_ingest', route);
}
