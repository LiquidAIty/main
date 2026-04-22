import { runLLM } from '../../../llm/client';
import { MODEL_REGISTRY, resolveModel } from '../../../llm/models.config';
import type { OpenClaudeProviderResult, OpenClaudeRunRequest } from '../contracts';

const DEFAULT_OPENCLAUDE_MODEL_KEY = 'gpt-5.3-codex';
const FALLBACK_OPENCLAUDE_MODEL_KEY = 'gpt-5.1-chat-latest';

function resolveOpenClaudeModelKey(candidate?: string): string {
  const preferred = (candidate || '').trim();
  if (preferred) {
    resolveModel(preferred);
    return preferred;
  }
  if (MODEL_REGISTRY[DEFAULT_OPENCLAUDE_MODEL_KEY]) {
    return DEFAULT_OPENCLAUDE_MODEL_KEY;
  }
  return FALLBACK_OPENCLAUDE_MODEL_KEY;
}

export function resolveOpenClaudeProviderTarget(request: OpenClaudeRunRequest): {
  modelKey: string;
  provider: 'openai' | 'openrouter';
  providerModelId: string;
} {
  const modelKey = resolveOpenClaudeModelKey(request.modelKey);
  const modelEntry = resolveModel(modelKey);
  const provider = request.provider || modelEntry.provider;
  const providerModelId = (request.providerModelId || modelEntry.id).trim();
  return {
    modelKey,
    provider,
    providerModelId,
  };
}

export async function runOpenClaudeWithCanonicalRuntime(
  request: OpenClaudeRunRequest,
): Promise<OpenClaudeProviderResult> {
  const target = resolveOpenClaudeProviderTarget(request);
  const result = await runLLM(request.task, {
    modelKey: target.modelKey,
    provider: target.provider,
    providerModelId: target.providerModelId,
    temperature: request.temperature,
    maxTokens: request.maxTokens,
    system:
      request.systemPrompt ||
      'You are the OpenClaude worker subsystem running under LiquidAIty runtime control.',
    useResponsesApi: target.provider === 'openai',
  });

  return {
    text: result.text,
    provider: target.provider,
    model: result.model,
    responseId: result.responseId ?? null,
    modelKey: target.modelKey,
    providerModelId: target.providerModelId,
  };
}
