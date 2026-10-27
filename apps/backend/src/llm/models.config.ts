// Graph + less = more: less code that does the same work as more code is more useful.
// Entity names the feature; Relationship explains why this file belongs and what it contributes.
// Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
// Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
// Entity: Card Profiles
// Relationship: This file defines the canonical configured provider/model identities that saved Card profiles may select.
// Entity: IDD
// Relationship: This file projects the exact configured model records consumed by the IDD-backed Card editor selector.
// Entity: Jev Decisions
// Relationship: This file authors the bounded compatibility facts used to build Auto Model candidates without letting Jev invent models or capabilities.
export type Provider = "openai" | "openrouter";

export type ModelEntry = {
  label: string;
  provider: Provider;
  id: string;
  autoModelFacts: AutoModelFacts;
};

export type AutoModelFacts = {
  eligible: boolean;
  contextWindow: number;
  supportsTools: boolean;
  inputModalities: string[];
  reasoningEfforts: string[];
  taskFit: string;
};

export type AutoModelCandidate = {
  id: string;
  provider: Provider;
  accessMode: 'chatgpt-account' | 'openrouter-api';
  modelKey: string;
  providerModelId: string;
  label: string;
  eligible: boolean;
  contextWindow: number;
  supportsTools: boolean;
  inputModalities: string[];
  reasoningEfforts: string[];
  taskFit: string;
};

const solReasoningEfforts = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const lunaReasoningEfforts = ['low', 'medium', 'high', 'xhigh', 'max'];
const ineligible = (taskFit: string): AutoModelFacts => ({
  eligible: false,
  contextWindow: 1,
  supportsTools: false,
  inputModalities: ['text'],
  reasoningEfforts: [],
  taskFit,
});

export type ConfiguredModelOption = {
  provider: Provider;
  key: string;
  label: string;
  providerModelId: string;
  default: boolean;
};

/**
 * The ACTIVE, selectable model catalog. Account-login entries are the currently
 * supported OpenAI GPT-5 family. OpenRouter entries are curated defaults that
 * were ALL confirmed present in the live provider catalog (checked 2026-08-05).
 *
 * No stale/discontinued entries are retained here: anything absent is an
 * unknown key at resolution time and fails honestly.
 */
export const MODEL_REGISTRY: Record<string, ModelEntry> = {
  // --- OpenAI GPT-5.6 family (account-login / OAuth runtime) ---
  "gpt-5.6-sol": {
    label: "GPT-5.6 Sol", provider: "openai", id: "gpt-5.6-sol",
    autoModelFacts: { eligible: true, contextWindow: 272_000, supportsTools: true,
      inputModalities: ['text', 'image'], reasoningEfforts: solReasoningEfforts,
      taskFit: 'Primary high-capability choice for complex implementation, analysis, and long tool-driven work.' },
  },
  "gpt-5.6-terra": {
    label: "GPT-5.6 Terra", provider: "openai", id: "gpt-5.6-terra",
    autoModelFacts: ineligible('Explicitly excluded from Auto Model selection; it remains available only as a saved manual choice.'),
  },
  "gpt-5.6-luna": {
    label: "GPT-5.6 Luna", provider: "openai", id: "gpt-5.6-luna",
    autoModelFacts: { eligible: true, contextWindow: 272_000, supportsTools: true,
      inputModalities: ['text', 'image'], reasoningEfforts: lunaReasoningEfforts,
      taskFit: 'Fast efficient choice for straightforward requests, bounded edits, and routine tool-driven work.' },
  },

  // --- OpenRouter (curated defaults, all confirmed in the live catalog) ---
  "or-google-gemini-2.5-pro": { label: "OpenRouter Gemini 2.5 Pro", provider: "openrouter", id: "google/gemini-2.5-pro", autoModelFacts: ineligible('OpenRouter models are not eligible for the current Auto Model corridor.') },
  "or-deepseek-chat": { label: "OpenRouter DeepSeek Chat", provider: "openrouter", id: "deepseek/deepseek-chat", autoModelFacts: ineligible('OpenRouter models are not eligible for the current Auto Model corridor.') },
  "deepseek/deepseek-v4-pro-0813": { label: "OpenRouter DeepSeek V4 Pro 0813", provider: "openrouter", id: "deepseek/deepseek-v4-pro-0813", autoModelFacts: ineligible('OpenRouter models are not eligible for the current Auto Model corridor.') },
  "deepseek/deepseek-v4-flash-0731": { label: "OpenRouter DeepSeek V4 Flash 0731", provider: "openrouter", id: "deepseek/deepseek-v4-flash-0731", autoModelFacts: ineligible('OpenRouter models are not eligible for the current Auto Model corridor.') },
  "z-ai/glm-5.2": { label: "OpenRouter Z.ai GLM 5.2", provider: "openrouter", id: "z-ai/glm-5.2", autoModelFacts: ineligible('OpenRouter models are not eligible for the current Auto Model corridor.') }
};

export const autoModelCandidates: AutoModelCandidate[] = Object.entries(MODEL_REGISTRY).map(
  ([modelKey, model]) => {
    const accessMode = model.provider === 'openai' ? 'chatgpt-account' : 'openrouter-api';
    return {
      id: `${model.provider}:${accessMode}:${modelKey}`,
      provider: model.provider,
      accessMode,
      modelKey,
      providerModelId: model.id,
      label: model.label,
      ...model.autoModelFacts,
    };
  },
);

/** Materialize the saved-card model choices from the canonical runtime registry.
 * The IDD validates these records before the card editor consumes them. */
export function listConfiguredModelOptions(openaiDefault: string): ConfiguredModelOption[] {
  if (MODEL_REGISTRY[openaiDefault]?.provider !== 'openai') {
    throw new Error('configured_openai_default_unknown');
  }
  return Object.entries(MODEL_REGISTRY).map(([key, model]) => ({
      provider: model.provider,
      key,
      label: model.label,
      providerModelId: model.id,
      default: model.provider === 'openai' && key === openaiDefault,
    }));
}
