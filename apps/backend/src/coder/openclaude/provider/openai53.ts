import { resolveModel } from '../../../llm/models.config';
import type { OpenClaudeRunRequest } from '../contracts';

export function resolveOpenClaudeProviderTarget(request: OpenClaudeRunRequest): {
  modelKey: string;
  provider: 'openai' | 'openrouter';
  providerModelId: string;
} {
  const modelKey = String(request.modelKey || '').trim();
  if (!modelKey) {
    throw new Error('openclaude_model_key_required');
  }
  const modelEntry = resolveModel(modelKey);
  const provider = request.provider;
  if (!provider) {
    throw new Error('openclaude_provider_required');
  }
  if (provider !== modelEntry.provider) {
    throw new Error(
      `openclaude_provider_model_mismatch: provider=${provider} registryProvider=${modelEntry.provider}`,
    );
  }
  const providerModelId = String(request.providerModelId || '').trim();
  if (!providerModelId) {
    throw new Error('openclaude_provider_model_id_required');
  }
  if (providerModelId !== modelEntry.id) {
    throw new Error(
      `openclaude_provider_model_id_mismatch: providerModelId=${providerModelId} registryModelId=${modelEntry.id}`,
    );
  }
  return {
    modelKey,
    provider,
    providerModelId,
  };
}
