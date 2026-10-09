import type { SavedCardConfiguration } from '../types/agentgraph';
import {
  assertUniqueCanonicalPromptSections,
  buildCardConfigurationFromEditorFields,
  parseCardPromptTemplate,
  serializeCardPromptFields,
  type CardEditorConfiguration,
  type CardPromptFields,
} from '../features/agentbuilder/cardConfigurationEditor';

export type CardInspectorSubagentModel = NonNullable<SavedCardConfiguration['subagentModel']>;
export type CardInspectorSubagentType = NonNullable<SavedCardConfiguration['subagentType']>;
export type CardInspectorScript = NonNullable<SavedCardConfiguration['script']>;
export type CardInspectorAccessMode = NonNullable<CardEditorConfiguration['access_mode']>;

export const DEFAULT_CARD_INSPECTOR_SUBAGENT_MODEL: CardInspectorSubagentModel = {
  provider: 'openai',
  accessMode: 'chatgpt-account',
  modelKey: 'gpt-5.6-luna',
  providerModelId: 'gpt-5.6-luna',
};

export function blankCardInspectorScript(): CardInspectorScript {
  return {
    source: '',
    version: 1,
    author: {},
    sourceHash: '',
    compiledHash: '',
    paletteFingerprint: '',
    compiled: {},
    lastValidation: {
      status: 'blank', errors: [], toolHandles: [],
    },
  };
}

export function cardInspectorSubagentAccessMode(
  provider: string,
): CardInspectorSubagentModel['accessMode'] {
  return provider === 'openrouter' ? 'openrouter-api'
    : provider === 'openai' ? 'chatgpt-account'
    : 'openai-api';
}

export function cardInspectorListDraft(value: unknown[] | null | undefined): string {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string').join('\n')
    : '';
}

export function blankCardInspectorPromptParts(): CardPromptFields & Record<string, string> {
  return {
    role: '',
    goal: '',
    constraints: '',
    ioSchema: '',
    memoryPolicy: '',
    outputExpectations: '',
    connectedAgents: '',
  };
}

export function cardInspectorPromptDraft(localConfig: CardEditorConfiguration): {
  promptText: string;
  promptParts: CardPromptFields & Record<string, string>;
} {
  const promptText = localConfig.prompt_template || '';
  const parsedPrompt = parseCardPromptTemplate(promptText);
  const legacyOutputExpectations = typeof localConfig.output_contract === 'string'
    ? localConfig.output_contract
    : localConfig.output_contract == null
      ? ''
      : JSON.stringify(localConfig.output_contract, null, 2);
  return {
    promptText,
    promptParts: {
      ...parsedPrompt,
      outputExpectations: parsedPrompt.outputExpectations || legacyOutputExpectations,
    },
  };
}

export function buildCardInspectorDraftPayload({
  localConfig,
  provider,
  accessMode,
  modelKey,
  providerModelId,
  orchestratorEnabled,
  autoToolsEnabled,
  autoModelEnabled,
  orchestratorTouched,
  subagentModel,
  subagentTouched,
  subagentType,
  subagentTypeTouched,
  scriptDraft,
  promptText,
  promptParts,
  promptPartsTouched,
  toolsText,
  skillsText,
  toolsetsText,
  mcpConnectionIdsText,
}: {
  localConfig: CardEditorConfiguration;
  provider: NonNullable<CardEditorConfiguration['provider']>;
  accessMode: CardInspectorAccessMode;
  modelKey: string;
  providerModelId?: string | null;
  orchestratorEnabled: boolean;
  autoToolsEnabled: boolean;
  autoModelEnabled: boolean;
  orchestratorTouched: boolean;
  subagentModel: CardInspectorSubagentModel;
  subagentTouched: boolean;
  subagentType: CardInspectorSubagentType;
  subagentTypeTouched: boolean;
  scriptDraft: CardInspectorScript;
  promptText: string;
  promptParts: CardPromptFields & Record<string, string>;
  promptPartsTouched: Record<string, boolean>;
  toolsText: string;
  skillsText: string;
  toolsetsText: string;
  mcpConnectionIdsText: string;
}): CardEditorConfiguration {
  const originalPrompt = parseCardPromptTemplate(promptText);
  const migrateLegacyOutput = Boolean(
    localConfig.output_contract != null
    && !originalPrompt.outputExpectations
    && promptParts.outputExpectations,
  );
  const serializedPrompt = serializeCardPromptFields(
    promptParts,
    promptText,
    migrateLegacyOutput
      ? { ...promptPartsTouched, outputExpectations: true }
      : promptPartsTouched,
  );
  assertUniqueCanonicalPromptSections(serializedPrompt);
  const editedConfig = buildCardConfigurationFromEditorFields({
    runtime: localConfig.runtime,
    provider,
    accessMode,
    modelKey,
    promptTemplate: serializedPrompt,
    toolsText,
    skillsText,
    toolsetsText,
    mcpConnectionIdsText,
  });
  const retainedRuntimeOptions: SavedCardConfiguration = {
    ...(localConfig.runtime_options || {}),
  };
  const runtimeMode = localConfig.runtime.mode;
  if (runtimeMode === 'magentic_one') {
    delete retainedRuntimeOptions.autoTools;
    delete retainedRuntimeOptions.autoModel;
  }
  const runtimeOptions: SavedCardConfiguration = {
    ...retainedRuntimeOptions,
    ...(runtimeMode !== 'magentic_one' ? {
      autoTools: autoToolsEnabled,
      autoModel: autoModelEnabled,
    } : {}),
    ...(
      runtimeMode === 'magentic_one'
        ? { subagentType: 'none' as const }
        : subagentTypeTouched
          ? { subagentType }
          : {}
    ),
    ...(providerModelId !== undefined ? { providerModelId } : {}),
    ...(
      runtimeMode === 'delegate'
      && (orchestratorTouched || localConfig.runtime_options?.orchestrator !== undefined)
        ? { orchestrator: orchestratorEnabled }
        : {}
    ),
    ...(subagentTouched ? { subagentModel } : {}),
    ...(
      localConfig.runtime_options?.script || scriptDraft.source.trim()
        ? { script: scriptDraft }
        : {}
    ),
  };
  return {
    ...localConfig,
    ...editedConfig,
    runtime_options: Object.keys(runtimeOptions).length
      ? runtimeOptions
      : localConfig.runtime_options,
    // Card role is presentation metadata. Stable model instructions live only
    // in prompt_template, including the editable [ROLE] block.
    role: localConfig.role,
    output_contract: undefined,
  };
}
