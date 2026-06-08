import { resolveModel } from '../llm/models.config';
import { ensureAgentConfig, getAgentConfig, type AgentType } from './agentConfigStore';

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
  organizingPrinciple: string | null;
  entityTaxonomy: any | null;
  relationshipTaxonomy: any | null;
  extractionPolicy: any | null;
};

function logRouteResolution(route: string, projectId: string, agentType: RuntimeAgentType, resolvedAgentId: string | null) {
  console.log(
    '[AGENT_RESOLVE] route=%s projectId=%s agentType=%s resolvedAgentId=%s',
    route,
    projectId,
    agentType,
    resolvedAgentId ?? 'null',
  );
}

function normalizeProvider(value: unknown): 'openai' | 'openrouter' | null {
  const provider = String(value ?? '').trim().toLowerCase();
  if (provider === 'openai' || provider === 'openrouter') {
    return provider;
  }
  return null;
}

function deriveProviderFromModelKey(modelKeyRaw: unknown): 'openai' | 'openrouter' | null {
  const modelKey = String(modelKeyRaw ?? '').trim();
  if (!modelKey) return null;

  if (modelKey.includes('/')) {
    return 'openrouter';
  }

  try {
    return resolveModel(modelKey).provider;
  } catch {
    return null;
  }
}

function resolveProviderModelId(
  provider: 'openai' | 'openrouter',
  modelKey: string,
  agentType: RuntimeAgentType,
): string {
  const normalizedModelKey = String(modelKey || '').trim();
  if (!normalizedModelKey) {
    throw new Error(`${agentType}_model_missing`);
  }

  if (normalizedModelKey.includes('/')) {
    return normalizedModelKey;
  }

  try {
    const modelEntry = resolveModel(normalizedModelKey);
    if (modelEntry.provider !== provider) {
      throw new Error(
        `${agentType}_provider_model_mismatch: provider=${provider} model_key=${normalizedModelKey} expects_provider=${modelEntry.provider}`,
      );
    }
    return modelEntry.id;
  } catch (err: any) {
    const msg = String(err?.message || '');
    if (msg.includes('provider_model_mismatch')) {
      throw err;
    }
    // Allow direct provider model IDs without registry entries.
    return normalizedModelKey;
  }
}

export async function resolveAgentConfig(
  projectId: string,
  agentType: RuntimeAgentType,
  route = 'unknown',
): Promise<ResolvedAgentConfig | null> {
  let config = await getAgentConfig(projectId, agentType);
  if (!config) {
    config = await ensureAgentConfig(projectId, agentType);
  }
  if (!config) {
    logRouteResolution(route, projectId, agentType, null);
    return null;
  }

  const systemPrompt = String(config.prompt_template || '').trim();
  const storedModelKey = String(config.model_key || '').trim();
  const storedProvider = normalizeProvider(config.provider);
  const modelKey = storedModelKey;
  const derivedProvider = deriveProviderFromModelKey(modelKey);
  const provider = storedProvider ?? derivedProvider;

  if (!systemPrompt) {
    throw new Error(`${agentType}_prompt_missing`);
  }

  if (!modelKey) {
    throw new Error(`${agentType}_model_missing`);
  }
  if (!provider) {
    throw new Error(`${agentType}_provider_missing`);
  }
  const providerModelId = resolveProviderModelId(provider, modelKey, agentType);
  logRouteResolution(route, projectId, agentType, config.agent_id);
  return {
    agentId: config.agent_id,
    agentType,
    modelKey,
    systemPrompt,
    provider,
    providerModelId,
    responseFormat: config.response_format ?? null,
    topP: typeof config.top_p === 'number' ? config.top_p : null,
    previousResponseId:
      typeof config.previous_response_id === 'string' ? String(config.previous_response_id) : null,
    temperature: typeof config.temperature === 'number' ? config.temperature : null,
    maxTokens: typeof config.max_tokens === 'number' ? config.max_tokens : null,
    tools: Array.isArray(config.tools) ? config.tools : [],
    organizingPrinciple:
      typeof config.organizing_principle === 'string' ? String(config.organizing_principle) : null,
    entityTaxonomy: config.entity_taxonomy ?? null,
    relationshipTaxonomy: config.relationship_taxonomy ?? null,
    extractionPolicy: config.extraction_policy ?? null,
  };
}

export async function resolveKgIngestAgent(projectId: string, route = 'unknown') {
  return resolveAgentConfig(projectId, 'kg_ingest', route);
}

export async function resolveKnowgraphAgent(projectId: string, route = 'unknown') {
  return resolveAgentConfig(projectId, 'knowgraph', route);
}

export async function resolveNeo4jAgent(projectId: string, route = 'unknown') {
  return resolveAgentConfig(projectId, 'neo4j', route);
}

export async function resolveResearchAgent(projectId: string, route = 'unknown') {
  return resolveAgentConfig(projectId, 'research_agent', route);
}
