import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import KnowledgeGraphFramework from './knowledge/KnowledgeGraphFramework';
import KnowledgeGraphErrorBoundary from './knowledge/KnowledgeGraphErrorBoundary';

import type {
  AgentCardRuntimeOptions,
  AgentCardRuntimeType,
  RuntimeBinding,
} from '../types/agentgraph';
import {
  GRAPH_THEME,
  graphDrawerButtonStyle,
  graphDrawerInputStyle,
  graphDrawerSectionStyle,
} from './graph/graphVisualTokens';

type AgentType =
  | 'agent_builder'
  | 'llm_chat'
  | 'research_agent';

interface AgentManagerProps {
  projectId: string;
  /** Saved deck the selected card belongs to (runtime-assignment reads/writes). */
  deckId?: string;
  agentType: AgentType;
  activeTab: string;
  selectedCardId?: string | null;
  cardName?: string;
  cardSubtext?: string;
  onChangeCardName?: (value: string) => void;
  onChangeCardSubtext?: (value: string) => void;
  promptPreviewPlanText?: string;
  onGraphRefresh?: () => void;
  onLastRun?: (lastRun: {
    agentType: AgentType;
    request: any;
    responseOrError: any;
    elapsedMs: number;
    provider?: string | null;
    model?: string | null;
    endpoint?: string | null;
    requestId?: string | null;
    finishReason?: string | null;
    usage?: any | null;
  }) => void;
  promptTestInput?: string;
  onChangePromptTestInput?: (value: string) => void;
  onRunPromptTest?: () => void;
  promptTestBusy?: boolean;
  promptTestDisabled?: boolean;
  localConfig?: AgentManagerLocalConfig | null;
  onSaveLocalConfig?: (config: AgentManagerLocalConfig) => void | Promise<void>;
}

const ACTIVE_RUNTIME_TYPES: AgentCardRuntimeType[] = [
  'assistant_agent',
  'local_coder',
  'magentic_one',
  'graph_flow',
];

const LEGACY_RUNTIME_TYPES: AgentCardRuntimeType[] = [];

export type AgentManagerLocalConfig = {
  runtime_binding?: RuntimeBinding | null;
  runtime_type?: AgentCardRuntimeType | null;
  runtime_options?: AgentCardRuntimeOptions | null;
  parent_graph_id?: string | null;
  provider?: ModelProviderChoice | null;
  model_key?: string | null;
  temperature?: number | null;
  max_tokens?: number | null;
  prompt_template?: string | null;
  tools?: unknown[];
  knowledge_sources?: unknown[];
  response_format?: any | null;
};

// Read-only capability metadata from the Python Mag One tool registry, served by
// GET /api/tools/manifest. The registry is the source of truth; this is never a
// hardcoded frontend tool list.
type ToolCapabilityManifestEntry = {
  id: string;
  displayName: string;
  description: string;
  agentCompatibility: string[];
  inputSchemaSummary?: string;
};


type SaveCardStatus = 'idle' | 'saving' | 'saved' | 'failed';

function parsePromptTemplate(template: string): {
  role: string;
  goal: string;
  constraints: string;
  ioSchema: string;
  memoryPolicy: string;
} {
  if (!template || template.trim() === '') {
    return { role: '', goal: '', constraints: '', ioSchema: '', memoryPolicy: '' };
  }
  const normalizedTemplate = template.replace(/\r\n/g, '\n');

  if (!normalizedTemplate.includes('[ROLE]')) {
    return {
      role: template,
      goal: '',
      constraints: '',
      ioSchema: '',
      memoryPolicy: '',
    };
  }

  const parsed = {
    role: '',
    goal: '',
    constraints: '',
    ioSchema: '',
    memoryPolicy: '',
  };
  const tagRegex = /\[(ROLE|GOAL|CONSTRAINTS|IO_SCHEMA|MEMORY_POLICY)\]/gi;
  const tags: Array<{ key: string; start: number; end: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(normalizedTemplate)) !== null) {
    tags.push({
      key: String(match[1] || '').toUpperCase(),
      start: match.index,
      end: tagRegex.lastIndex,
    });
  }

  for (let index = 0; index < tags.length; index += 1) {
    const current = tags[index];
    const next = tags[index + 1];
    const value = normalizedTemplate
      .slice(current.end, next ? next.start : normalizedTemplate.length)
      .trim();
    if (current.key === 'ROLE') parsed.role = value;
    else if (current.key === 'GOAL') parsed.goal = value;
    else if (current.key === 'CONSTRAINTS') parsed.constraints = value;
    else if (current.key === 'IO_SCHEMA') parsed.ioSchema = value;
    else if (current.key === 'MEMORY_POLICY') parsed.memoryPolicy = value;
  }

  return parsed;
}

function serializePromptFields(fields: {
  role: string;
  goal: string;
  constraints: string;
  ioSchema: string;
  memoryPolicy: string;
}): string {
  return `# LIQUIDAITY_PROMPT_V1
[ROLE]
${fields.role}

[GOAL]
${fields.goal}

[CONSTRAINTS]
${fields.constraints}

[IO_SCHEMA]
${fields.ioSchema}

[MEMORY_POLICY]
${fields.memoryPolicy}`;
}

function parseListText(value: string): string[] {
  const text = String(value || '').trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter(Boolean);
    }
  } catch {
    // fall back below
  }
  return text
    .split(/[\r\n,]+/)
    .map((entry) => entry.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean);
}

function parseJsonValue(
  value: string,
  fallback: any = null,
): any | null {
  const text = String(value || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function normalizeRuntimeType(value: unknown): AgentCardRuntimeType {
  const next = String(value || '').trim().toLowerCase() as AgentCardRuntimeType;
  if (ACTIVE_RUNTIME_TYPES.includes(next) || LEGACY_RUNTIME_TYPES.includes(next)) {
    return next;
  }
  return 'assistant_agent';
}

function cleanString(value: unknown): string | null {
  const text = String(value || '').trim();
  return text ? text : null;
}

function cleanNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// Local SLM graph worker, selectable as a card provider. The actual model id comes
// from the card's Model field (default below); provider routes to the local endpoint.
export const LOCAL_MODEL_PROVIDER = 'local_openai_compatible';
export const LOCAL_MODEL_LABEL = 'Local Gemma Worker';
export const LOCAL_MODEL_DEFAULT_KEY = 'local-gemma-slm';

export type ModelProviderChoice = 'openai' | 'openrouter' | 'local_openai_compatible' | '';

/** Keep a recognized model provider (incl. the local SLM), else null. */
function normalizeModelProvider(
  value: unknown,
): 'openai' | 'openrouter' | 'local_openai_compatible' | null {
  return value === 'openai' || value === 'openrouter' || value === LOCAL_MODEL_PROVIDER
    ? value
    : null;
}

function compactDefinedRuntimeOptions(input: AgentCardRuntimeOptions): AgentCardRuntimeOptions | null {
  const keptEntries = Object.entries(input).filter(([, value]) => value !== null && value !== undefined);
  return keptEntries.length > 0 ? (Object.fromEntries(keptEntries) as AgentCardRuntimeOptions) : null;
}

function getManagedRuntimeOptionKeys(
  runtimeType: AgentCardRuntimeType,
  executionMode: 'single' | 'swarm' = 'single',
): Set<string> {
  const managed = new Set(['provider', 'modelKey', 'temperature', 'maxTokens']);
  if (runtimeType === 'local_coder') {
    managed.add('localCoderMode');
    managed.add('localCoderAccess');
    return managed;
  }
  if (runtimeType === 'assistant_agent') {
    managed.add('executionMode');
    managed.add('swarmMaxWorkers');
    managed.add('swarmWorkerPromptTemplate');
    managed.add('useSocietyOfMindConsolidation');
    return managed;
  }
  if (runtimeType === 'magentic_one') {
    managed.add('maxTurns');
    managed.add('maxStalls');
    managed.add('finalAnswerPrompt');
    return managed;
  }
  if (runtimeType === 'graph_flow') {
    managed.add('useSocietyOfMindConsolidation');
    return managed;
  }
  if (executionMode === 'swarm') {
    managed.add('executionMode');
    managed.add('swarmMaxWorkers');
    managed.add('swarmWorkerPromptTemplate');
    managed.add('useSocietyOfMindConsolidation');
  }
  return managed;
}

function compactRuntimeOptions(
  runtimeType: AgentCardRuntimeType,
  input: AgentCardRuntimeOptions,
): AgentCardRuntimeOptions | null {
  const managedKeys = getManagedRuntimeOptionKeys(
    runtimeType,
    input.executionMode === 'swarm' ? 'swarm' : 'single',
  );
  const passthrough = Object.fromEntries(
    Object.entries(input).filter(
      ([key, value]) => !managedKeys.has(key) && value !== null && value !== undefined,
    ),
  ) as AgentCardRuntimeOptions;
  const commonBase = {
    provider: normalizeModelProvider(input.provider),
    modelKey: cleanString(input.modelKey),
    temperature: cleanNumber(input.temperature),
    maxTokens: cleanNumber(input.maxTokens),
  } satisfies AgentCardRuntimeOptions;

  let normalized: AgentCardRuntimeOptions = {
    ...passthrough,
    ...commonBase,
  };

  if (runtimeType === 'assistant_agent') {
    normalized = {
      ...normalized,
      executionMode: input.executionMode === 'swarm' ? 'swarm' : 'single',
      swarmMaxWorkers:
        input.executionMode === 'swarm' ? cleanNumber(input.swarmMaxWorkers) : null,
      swarmWorkerPromptTemplate:
        input.executionMode === 'swarm' ? cleanString(input.swarmWorkerPromptTemplate) : null,
      useSocietyOfMindConsolidation:
        input.executionMode === 'swarm'
          ? input.useSocietyOfMindConsolidation === false
            ? false
            : true
          : null,
    };
  } else if (runtimeType === 'magentic_one') {
    normalized = {
      ...normalized,
      maxTurns: cleanNumber(input.maxTurns),
      maxStalls: cleanNumber(input.maxStalls),
      finalAnswerPrompt: cleanString(input.finalAnswerPrompt),
    };
  } else if (runtimeType === 'graph_flow') {
    normalized = {
      ...normalized,
      useSocietyOfMindConsolidation:
        input.useSocietyOfMindConsolidation === false ? false : true,
    };
  } else if (runtimeType === 'local_coder') {
    normalized = {
      ...normalized,
      localCoderMode: input.localCoderMode === 'terminal' ? 'terminal' : 'headless',
      localCoderAccess:
        input.localCoderAccess === 'patch'
          ? 'patch'
          : input.localCoderAccess === 'test'
            ? 'test'
            : 'read',
    };
  }

  return compactDefinedRuntimeOptions(normalized);
}

function deriveRuntimeOptions(localConfig: AgentManagerLocalConfig | null | undefined): AgentCardRuntimeOptions {
  const source = localConfig?.runtime_options || {};
  return {
    ...source,
    provider: normalizeModelProvider(localConfig?.provider) ?? source.provider ?? null,
    modelKey: localConfig?.model_key || source.modelKey || null,
    temperature:
      typeof localConfig?.temperature === 'number' ? localConfig.temperature : source.temperature ?? null,
    maxTokens:
      typeof localConfig?.max_tokens === 'number' ? localConfig.max_tokens : source.maxTokens ?? null,
    executionMode:
      source.executionMode === 'swarm' ? 'swarm' : source.executionMode === 'single' ? 'single' : 'single',
  };
}

function getRuntimeTypeLabel(runtimeType: AgentCardRuntimeType): string {
  if (runtimeType === 'assistant_agent') return 'Assist';
  if (runtimeType === 'local_coder') return 'Coder';
  if (runtimeType === 'magentic_one') return 'Magentic';
  if (runtimeType === 'graph_flow') return 'Legacy Workflow (compat)';
  return `Legacy: ${runtimeType}`;
}

export function getRuntimeTypeVisibleFieldLabels(
  runtimeType: AgentCardRuntimeType,
  executionMode: 'single' | 'swarm' = 'single',
): string[] {
  if (runtimeType === 'assistant_agent') {
    return executionMode === 'swarm'
      ? [
          'Runtime Type',
          'Provider',
          'Model',
          'Temperature',
          'Max Tokens',
          'Execution Mode',
          'Swarm Max Workers',
          'Swarm Worker Prompt Template',
        ]
      : [
          'Runtime Type',
          'Provider',
          'Model',
          'Temperature',
          'Max Tokens',
          'Execution Mode',
        ];
  }
  if (runtimeType === 'local_coder') {
    return [
      'Runtime Type',
      'Provider',
      'Model',
      'Temperature',
      'Max Tokens',
      'Local Mode',
      'Local Access',
    ];
  }
  if (runtimeType === 'magentic_one') {
    return [
      'Runtime Type',
      'Provider',
      'Model',
      'Temperature',
      'Max Tokens',
      'Max Turns',
      'Max Stalls',
      'Final Answer Prompt',
    ];
  }
  if (runtimeType === 'graph_flow') {
    return [
      'Runtime Type',
      'Provider',
      'Model',
      'Temperature',
      'Max Tokens',
      'Consolidate Result',
    ];
  }
  return ['Runtime Type'];
}

function getRuntimeTypeSelectOptions(
  runtimeType: AgentCardRuntimeType,
): Array<{ value: AgentCardRuntimeType; label: string; disabled: boolean }> {
  const activeOptions = ACTIVE_RUNTIME_TYPES.map((value) => ({
    value,
    label: getRuntimeTypeLabel(value),
    disabled: false,
  }));

  if (ACTIVE_RUNTIME_TYPES.includes(runtimeType)) {
    return activeOptions;
  }

  return [
    ...activeOptions,
    {
      value: runtimeType,
      label: getRuntimeTypeLabel(runtimeType),
      disabled: true,
    },
  ];
}

export function buildActiveAgentManagerLocalConfig(input: {
  runtimeBinding: RuntimeBinding | '';
  runtimeType: AgentCardRuntimeType | '';
  runtimeOptions: AgentCardRuntimeOptions;
  parentGraphId: string;
  provider: ModelProviderChoice;
  modelKey: string;
  temperature: number | '';
  maxTokens: number | '';
  promptTemplate: string;
  toolsText: string;
  knowledgeText: string;
  responseFormatText: string;
  existingResponseFormat?: any;
}): AgentManagerLocalConfig {
  const runtimeType = normalizeRuntimeType(input.runtimeType);
  const runtimeOptions = compactRuntimeOptions(runtimeType, {
    ...input.runtimeOptions,
    provider:
      normalizeModelProvider(input.provider) ?? input.runtimeOptions.provider ?? null,
    modelKey: input.modelKey || input.runtimeOptions.modelKey || null,
    temperature:
      typeof input.temperature === 'number' ? input.temperature : input.runtimeOptions.temperature ?? null,
    maxTokens: typeof input.maxTokens === 'number' ? input.maxTokens : input.runtimeOptions.maxTokens ?? null,
  });

  return {
    runtime_binding: input.runtimeBinding || null,
    runtime_type: runtimeType,
    runtime_options: runtimeOptions,
    parent_graph_id:
      runtimeType === 'assistant_agent' || runtimeType === 'local_coder'
        ? cleanString(input.parentGraphId)
        : null,
    provider: input.provider,
    model_key: input.modelKey || null,
    temperature: typeof input.temperature === 'number' ? input.temperature : null,
    max_tokens: typeof input.maxTokens === 'number' ? input.maxTokens : null,
    prompt_template: input.promptTemplate,
    tools: parseListText(input.toolsText),
    knowledge_sources: parseListText(input.knowledgeText),
    response_format: parseJsonValue(input.responseFormatText, input.existingResponseFormat ?? null),
  };
}

export function AgentManager({
  projectId,
  deckId,
  activeTab,
  cardName,
  cardSubtext,
  onChangeCardName,
  onChangeCardSubtext,
  localConfig,
  selectedCardId,
  onChangePromptTestInput,
  onRunPromptTest,
  onSaveLocalConfig,
  promptTestBusy,
  promptTestDisabled,
  promptTestInput,
}: AgentManagerProps) {
  const runtimeType = normalizeRuntimeType(localConfig?.runtime_type);
  const runtimeOptions = useMemo(() => deriveRuntimeOptions(localConfig), [localConfig]);
  const promptFields = useMemo(
    () => parsePromptTemplate(String(localConfig?.prompt_template || '')),
    [localConfig?.prompt_template],
  );
  const [promptText, setPromptText] = useState(String(localConfig?.prompt_template || ''));
  const [role, setRole] = useState(promptFields.role);
  const [goal, setGoal] = useState(promptFields.goal);
  const [constraints, setConstraints] = useState(promptFields.constraints);
  const [ioSchema, setIoSchema] = useState(promptFields.ioSchema);
  const [memoryPolicy, setMemoryPolicy] = useState(promptFields.memoryPolicy);
  const [selectedRuntimeType, setSelectedRuntimeType] = useState<AgentCardRuntimeType>(runtimeType);
  const [provider, setProvider] = useState<ModelProviderChoice>(
    normalizeModelProvider(localConfig?.provider) ?? '',
  );
  const [modelKey, setModelKey] = useState(String(localConfig?.model_key || ''));
  const [temperature, setTemperature] = useState<number | ''>(
    typeof localConfig?.temperature === 'number' ? localConfig.temperature : '',
  );
  const [maxTokens, setMaxTokens] = useState<number | ''>(
    typeof localConfig?.max_tokens === 'number' ? localConfig.max_tokens : '',
  );
  const [executionMode, setExecutionMode] = useState<'single' | 'swarm'>(
    runtimeOptions.executionMode === 'swarm' ? 'swarm' : 'single',
  );
  const [swarmMaxWorkers, setSwarmMaxWorkers] = useState<number | ''>(
    typeof runtimeOptions.swarmMaxWorkers === 'number' ? runtimeOptions.swarmMaxWorkers : '',
  );
  const [swarmWorkerPromptTemplate, setSwarmWorkerPromptTemplate] = useState(
    String(runtimeOptions.swarmWorkerPromptTemplate || ''),
  );
  const [maxTurns, setMaxTurns] = useState<number | ''>(
    typeof runtimeOptions.maxTurns === 'number' ? runtimeOptions.maxTurns : '',
  );
  const [maxStalls, setMaxStalls] = useState<number | ''>(
    typeof runtimeOptions.maxStalls === 'number' ? runtimeOptions.maxStalls : '',
  );
  const [finalAnswerPrompt, setFinalAnswerPrompt] = useState(
    String(runtimeOptions.finalAnswerPrompt || ''),
  );
  const [useSocietyOfMindConsolidation, setUseSocietyOfMindConsolidation] = useState(
    runtimeOptions.useSocietyOfMindConsolidation !== false,
  );
  const [parentGraphId, setParentGraphId] = useState(String(localConfig?.parent_graph_id || ''));
  const [toolsText, setToolsText] = useState(
    Array.isArray(localConfig?.tools) ? localConfig.tools.join('\n') : '',
  );
  // Real Mag One tool capability manifest (registry-backed; best-effort fetch).
  const [toolManifest, setToolManifest] = useState<ToolCapabilityManifestEntry[]>([]);

  const [knowledgeText, setKnowledgeText] = useState(
    Array.isArray(localConfig?.knowledge_sources) ? localConfig.knowledge_sources.join('\n') : '',
  );
  const [responseFormatText, setResponseFormatText] = useState(
    localConfig?.response_format ? JSON.stringify(localConfig.response_format, null, 2) : '',
  );
  const [runtimeOptionsText, setRuntimeOptionsText] = useState(
    localConfig?.runtime_options ? JSON.stringify(localConfig.runtime_options, null, 2) : '',
  );
  const [cardNameDraft, setCardNameDraft] = useState(String(cardName || ''));
  const [cardSubtextDraft, setCardSubtextDraft] = useState(String(cardSubtext || ''));
  const [saveCardStatus, setSaveCardStatus] = useState<SaveCardStatus>('idle');
  const [saveCardPressed, setSaveCardPressed] = useState(false);
  const [saveCardErrorMessage, setSaveCardErrorMessage] = useState<string | null>(null);
  const saveCardStatusTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setPromptText(String(localConfig?.prompt_template || ''));
    setRole(promptFields.role);
    setGoal(promptFields.goal);
    setConstraints(promptFields.constraints);
    setIoSchema(promptFields.ioSchema);
    setMemoryPolicy(promptFields.memoryPolicy);
  }, [localConfig?.prompt_template, promptFields]);

  useEffect(() => {
    setSelectedRuntimeType(runtimeType);
    setProvider(normalizeModelProvider(localConfig?.provider) ?? '');
    setModelKey(String(localConfig?.model_key || ''));
    setTemperature(typeof localConfig?.temperature === 'number' ? localConfig.temperature : '');
    setMaxTokens(typeof localConfig?.max_tokens === 'number' ? localConfig.max_tokens : '');
    setExecutionMode(runtimeOptions.executionMode === 'swarm' ? 'swarm' : 'single');
    setSwarmMaxWorkers(
      typeof runtimeOptions.swarmMaxWorkers === 'number' ? runtimeOptions.swarmMaxWorkers : '',
    );
    setSwarmWorkerPromptTemplate(String(runtimeOptions.swarmWorkerPromptTemplate || ''));
    setMaxTurns(typeof runtimeOptions.maxTurns === 'number' ? runtimeOptions.maxTurns : '');
    setMaxStalls(typeof runtimeOptions.maxStalls === 'number' ? runtimeOptions.maxStalls : '');
    setFinalAnswerPrompt(String(runtimeOptions.finalAnswerPrompt || ''));
    setUseSocietyOfMindConsolidation(runtimeOptions.useSocietyOfMindConsolidation !== false);
    setParentGraphId(String(localConfig?.parent_graph_id || ''));
    setToolsText(Array.isArray(localConfig?.tools) ? localConfig.tools.join('\n') : '');
    setKnowledgeText(
      Array.isArray(localConfig?.knowledge_sources) ? localConfig.knowledge_sources.join('\n') : '',
    );
    setResponseFormatText(
      localConfig?.response_format ? JSON.stringify(localConfig.response_format, null, 2) : '',
    );
    setRuntimeOptionsText(
      localConfig?.runtime_options ? JSON.stringify(localConfig.runtime_options, null, 2) : '',
    );
  }, [localConfig, runtimeOptions, runtimeType]);

  // Fetch the real Mag One tool capability manifest once. Best-effort: the
  // freeform Tools field still works if the Python rails manifest is unavailable.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/tools/manifest', { credentials: 'include' });
        if (!response.ok) return;
        const data = await response.json();
        const tools = Array.isArray(data?.tools) ? data.tools : [];
        if (!cancelled) setToolManifest(tools as ToolCapabilityManifestEntry[]);
      } catch {
        // ignore — capability list is additive metadata only
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setCardNameDraft(String(cardName || ''));
    setCardSubtextDraft(String(cardSubtext || ''));
  }, [selectedCardId]);

  useEffect(() => {
    setSaveCardStatus('idle');
    setSaveCardPressed(false);
    setSaveCardErrorMessage(null);
    if (saveCardStatusTimerRef.current != null) {
      window.clearTimeout(saveCardStatusTimerRef.current);
      saveCardStatusTimerRef.current = null;
    }
  }, [selectedCardId]);

  useEffect(() => {
    return () => {
      if (saveCardStatusTimerRef.current != null) {
        window.clearTimeout(saveCardStatusTimerRef.current);
      }
    };
  }, []);

  const updatePromptFields = (
    field: 'role' | 'goal' | 'constraints' | 'ioSchema' | 'memoryPolicy',
    value: string,
  ) => {
    const nextFields = {
      role,
      goal,
      constraints,
      ioSchema,
      memoryPolicy,
      [field]: value,
    };
    setRole(nextFields.role);
    setGoal(nextFields.goal);
    setConstraints(nextFields.constraints);
    setIoSchema(nextFields.ioSchema);
    setMemoryPolicy(nextFields.memoryPolicy);
    setPromptText(serializePromptFields(nextFields));
  };

  const buildSaveLocalConfigPayload = (): AgentManagerLocalConfig => {
    const parsedRuntimeOptions = parseJsonValue(
      runtimeOptionsText,
      localConfig?.runtime_options ?? {},
    );
    const nextRuntimeOptions: AgentCardRuntimeOptions = {
      ...(parsedRuntimeOptions && typeof parsedRuntimeOptions === 'object' && !Array.isArray(parsedRuntimeOptions)
        ? (parsedRuntimeOptions as AgentCardRuntimeOptions)
        : {}),
      provider: provider || null,
      modelKey: cleanString(modelKey),
      temperature: typeof temperature === 'number' ? temperature : null,
      maxTokens: typeof maxTokens === 'number' ? maxTokens : null,
    };

    if (selectedRuntimeType === 'assistant_agent') {
      nextRuntimeOptions.executionMode = executionMode;
      nextRuntimeOptions.swarmMaxWorkers =
        executionMode === 'swarm' && typeof swarmMaxWorkers === 'number' ? swarmMaxWorkers : null;
      nextRuntimeOptions.swarmWorkerPromptTemplate =
        executionMode === 'swarm' ? cleanString(swarmWorkerPromptTemplate) : null;
      nextRuntimeOptions.useSocietyOfMindConsolidation =
        executionMode === 'swarm' ? useSocietyOfMindConsolidation : null;
    } else if (selectedRuntimeType === 'magentic_one') {
      nextRuntimeOptions.maxTurns = typeof maxTurns === 'number' ? maxTurns : null;
      nextRuntimeOptions.maxStalls = typeof maxStalls === 'number' ? maxStalls : null;
      nextRuntimeOptions.finalAnswerPrompt = cleanString(finalAnswerPrompt);
    } else if (selectedRuntimeType === 'graph_flow') {
      nextRuntimeOptions.useSocietyOfMindConsolidation = useSocietyOfMindConsolidation;
    }

    return buildActiveAgentManagerLocalConfig({
      runtimeBinding: localConfig?.runtime_binding || '',
      runtimeType: selectedRuntimeType,
      runtimeOptions: nextRuntimeOptions,
      parentGraphId,
      provider,
      modelKey,
      temperature,
      maxTokens,
      promptTemplate: promptText,
      toolsText,
      knowledgeText,
      responseFormatText,
      existingResponseFormat: localConfig?.response_format ?? null,
    });
  };

  const runSaveConfig = useCallback(async () => {
    if (!onSaveLocalConfig || saveCardStatus === 'saving') return;
    const savePayload = buildSaveLocalConfigPayload();
    if (saveCardStatusTimerRef.current != null) {
      window.clearTimeout(saveCardStatusTimerRef.current);
      saveCardStatusTimerRef.current = null;
    }
    setSaveCardStatus('saving');
    setSaveCardErrorMessage(null);
    try {
      await Promise.resolve(onSaveLocalConfig(savePayload));
      setSaveCardStatus('saved');
      saveCardStatusTimerRef.current = window.setTimeout(() => {
        setSaveCardStatus('idle');
        saveCardStatusTimerRef.current = null;
      }, 1100);
    } catch (error) {
      const nextMessage =
        error instanceof Error && error.message
          ? error.message
          : 'Save failed. Try again.';
      setSaveCardStatus('failed');
      setSaveCardErrorMessage(nextMessage);
    }
  }, [onSaveLocalConfig, saveCardStatus, localConfig?.runtime_options, runtimeOptionsText, provider, modelKey, temperature, maxTokens, selectedRuntimeType, executionMode, swarmMaxWorkers, swarmWorkerPromptTemplate, useSocietyOfMindConsolidation, maxTurns, maxStalls, finalAnswerPrompt, localConfig?.runtime_binding, parentGraphId, promptText, toolsText, knowledgeText, responseFormatText, localConfig?.response_format]);

  const saveButtonBusy = saveCardStatus === 'saving';
  const saveButtonDisabled = saveButtonBusy || !onSaveLocalConfig;
  const inputStyle: CSSProperties = graphDrawerInputStyle();
  const actionButtonStyle: CSSProperties = graphDrawerButtonStyle();
  const formScopeClassName = 'agent-manager-glass-form';
  const scopedFocusStyles = `
    @keyframes agent-manager-save-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    .${formScopeClassName} input,
    .${formScopeClassName} textarea,
    .${formScopeClassName} select {
      outline: none !important;
      transition: border-color 160ms ease, background-color 160ms ease;
    }
    .${formScopeClassName} input::placeholder,
    .${formScopeClassName} textarea::placeholder {
      color: rgba(255,255,255,0.28);
    }
    .${formScopeClassName} input:focus,
    .${formScopeClassName} textarea:focus,
    .${formScopeClassName} select:focus,
    .${formScopeClassName} input:focus-visible,
    .${formScopeClassName} textarea:focus-visible,
    .${formScopeClassName} select:focus-visible {
      outline: none !important;
      border-color: ${GRAPH_THEME.drawer.inputBorderFocus};
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.02);
      background: ${GRAPH_THEME.drawer.inputBackground};
    }
  `;
  const saveButtonStatus = saveButtonBusy
    ? 'saving'
    : saveCardStatus === 'saved'
      ? 'saved'
      : saveCardStatus === 'failed'
        ? 'failed'
        : saveCardPressed
          ? 'pressed'
          : 'idle';
  const saveButtonText =
    saveButtonStatus === 'saving'
      ? 'Saving...'
      : saveButtonStatus === 'saved'
        ? 'Saved'
        : saveButtonStatus === 'failed'
          ? 'Save Failed'
          : 'Save Card';
  const saveButtonStyle: CSSProperties = {
    ...actionButtonStyle,
    transform: saveButtonStatus === 'pressed' ? 'translateY(1px) scale(0.985)' : 'translateY(0) scale(1)',
    boxShadow:
      saveButtonStatus === 'pressed'
        ? 'inset 0 2px 8px rgba(0,0,0,0.34), inset 0 0 0 1px rgba(74,226,223,0.32)'
        : saveButtonStatus === 'saved'
          ? '0 0 0 1px rgba(116,255,201,0.45), 0 0 14px rgba(116,255,201,0.24)'
          : saveButtonStatus === 'failed'
            ? '0 0 0 1px rgba(255,108,108,0.5), 0 0 14px rgba(255,108,108,0.2)'
            : saveButtonStatus === 'saving'
              ? '0 0 0 1px rgba(74,226,223,0.34), 0 0 10px rgba(74,226,223,0.2)'
              : actionButtonStyle.boxShadow,
    borderColor:
      saveButtonStatus === 'saved'
        ? 'rgba(116,255,201,0.64)'
        : saveButtonStatus === 'failed'
          ? 'rgba(255,108,108,0.7)'
          : saveButtonStatus === 'saving'
            ? 'rgba(74,226,223,0.58)'
            : actionButtonStyle.borderColor,
    color:
      saveButtonStatus === 'saved'
        ? '#d9ffef'
        : saveButtonStatus === 'failed'
          ? '#ffd7d7'
          : actionButtonStyle.color,
    cursor: saveButtonDisabled ? (saveButtonBusy ? 'progress' : 'not-allowed') : 'pointer',
    opacity: saveButtonDisabled ? 0.8 : 1,
    transition:
      'transform 90ms ease, box-shadow 160ms ease, border-color 140ms ease, color 140ms ease, opacity 140ms ease',
  };

  const renderSaveCardButton = () => (
    <button
      type="button"
      onPointerDown={() => {
        if (saveButtonDisabled) return;
        setSaveCardPressed(true);
      }}
      onPointerUp={() => setSaveCardPressed(false)}
      onPointerCancel={() => setSaveCardPressed(false)}
      onPointerLeave={() => setSaveCardPressed(false)}
      onKeyDown={(event) => {
        if (saveButtonDisabled) return;
        if (event.key === 'Enter' || event.key === ' ') {
          setSaveCardPressed(true);
        }
      }}
      onKeyUp={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          setSaveCardPressed(false);
        }
      }}
      onBlur={() => setSaveCardPressed(false)}
      onClick={() => {
        void runSaveConfig();
      }}
      disabled={saveButtonDisabled}
      aria-busy={saveButtonBusy}
      data-save-state={saveButtonStatus}
      style={saveButtonStyle}
    >
      {saveButtonBusy ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
          <span
            aria-hidden
            style={{
              width: 11,
              height: 11,
              borderRadius: 999,
              border: '1.5px solid rgba(255,255,255,0.32)',
              borderTopColor: 'rgba(255,255,255,0.95)',
              display: 'inline-block',
              animation: 'agent-manager-save-spin 700ms linear infinite',
            }}
          />
          {saveButtonText}
        </span>
      ) : (
        saveButtonText
      )}
    </button>
  );

  const renderSaveCardFeedback = () => {
    if (saveCardStatus !== 'failed') return null;
    return (
      <div
        role="status"
        aria-live="polite"
        style={{
          color: 'rgba(255,162,162,0.95)',
          fontSize: 11.5,
          fontWeight: 600,
          lineHeight: 1.35,
        }}
      >
        {saveCardErrorMessage || 'Save failed. Changes were not persisted.'}
      </div>
    );
  };

  const runtimeOptionsForSelect = getRuntimeTypeSelectOptions(selectedRuntimeType);
  const fieldLabels = getRuntimeTypeVisibleFieldLabels(selectedRuntimeType, executionMode);
  const showAdvancedRuntimeOptions =
    !['assistant_agent', 'local_coder', 'magentic_one', 'graph_flow'].includes(selectedRuntimeType) ||
    Object.entries(localConfig?.runtime_options || {}).some(
      ([key, value]) =>
        !getManagedRuntimeOptionKeys(selectedRuntimeType, executionMode).has(key) &&
        value !== null &&
        value !== undefined,
    );
  const Field = useMemo(
    () =>
      function AgentManagerField({
        label,
        children,
      }: {
        label: string;
        children: React.ReactNode;
      }) {
        return (
          <label style={{ display: 'grid', gap: 4 }}>
            <span
              style={{
                color: 'rgba(255,255,255,0.55)',
                fontSize: 10.5,
                fontWeight: 500,
                letterSpacing: 0.1,
              }}
            >
              {label}
            </span>
            {children}
          </label>
        );
      },
    [],
  );

  const numberValue = (value: number | '') => (value === '' ? '' : String(value));
  const showCardHeaderFields = Boolean(onChangeCardName || onChangeCardSubtext);
  const renderCardHeaderFields = () => {
    if (!showCardHeaderFields) return null;
    return (
      <>
        <Field label="Name">
          <input
            value={cardNameDraft}
            onChange={(event) => {
              const nextValue = event.target.value;
              setCardNameDraft(nextValue);
              onChangeCardName?.(nextValue);
            }}
            placeholder="Enter agent name"
            style={inputStyle}
          />
        </Field>
        <Field label="Subtext">
          <input
            value={cardSubtextDraft}
            onChange={(event) => {
              const nextValue = event.target.value;
              setCardSubtextDraft(nextValue);
              onChangeCardSubtext?.(nextValue);
            }}
            placeholder="Enter subtitle text"
            style={inputStyle}
          />
        </Field>
      </>
    );
  };

  if (activeTab === 'Prompt') {
    return (
      <div className={formScopeClassName} style={{ display: 'grid', gap: 8 }}>
        <style>{scopedFocusStyles}</style>
        {renderCardHeaderFields()}
        <Field label="Role">
          <textarea value={role} onChange={(event) => updatePromptFields('role', event.target.value)} rows={4} style={{ ...inputStyle, resize: 'vertical' }} />
        </Field>
        <Field label="Goal">
          <textarea value={goal} onChange={(event) => updatePromptFields('goal', event.target.value)} rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
        </Field>
        <Field label="Constraints">
          <textarea value={constraints} onChange={(event) => updatePromptFields('constraints', event.target.value)} rows={4} style={{ ...inputStyle, resize: 'vertical' }} />
        </Field>
        <Field label="IO Schema">
          <textarea value={ioSchema} onChange={(event) => updatePromptFields('ioSchema', event.target.value)} rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
        </Field>
        <Field label="Memory Policy">
          <textarea value={memoryPolicy} onChange={(event) => updatePromptFields('memoryPolicy', event.target.value)} rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
        </Field>
        <Field label="Prompt Test Input">
          <textarea
            value={String(promptTestInput || '')}
            onChange={(event) => onChangePromptTestInput?.(event.target.value)}
            rows={4}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        </Field>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {renderSaveCardButton()}
          <button
            type="button"
            onClick={() => onRunPromptTest?.()}
            disabled={promptTestDisabled}
            style={graphDrawerButtonStyle({
              opacity: promptTestDisabled ? 0.52 : 1,
              cursor: promptTestDisabled ? 'not-allowed' : 'pointer',
            })}
          >
            {promptTestBusy ? 'Running...' : 'Run Card'}
          </button>
        </div>
        {renderSaveCardFeedback()}
      </div>
    );
  }

  if (activeTab === 'Knowledge') {
    return (
      <div className={formScopeClassName} style={{ display: 'grid', gap: 8 }}>
        <style>{scopedFocusStyles}</style>
        <div data-testid="agent-memory-graph" style={{ height: 260, minHeight: 260 }}>
          <KnowledgeGraphErrorBoundary
            fallback={
              <div
                style={{
                  height: 260,
                  minHeight: 260,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: GRAPH_THEME.drawer.inputMuted,
                  fontSize: 12,
                  ...graphDrawerSectionStyle({ borderRadius: 8 }),
                }}
              >
                Knowledge preview unavailable.
              </div>
            }
          >
            <KnowledgeGraphFramework projection={undefined} minHeight={260} />
          </KnowledgeGraphErrorBoundary>
        </div>

        <details
          data-testid="agent-knowledge-advanced"
          style={{
            padding: '10px 12px',
            ...graphDrawerSectionStyle({
              borderRadius: 8,
            }),
          }}
        >
          <summary
            style={{
              color: GRAPH_THEME.drawer.inputMuted,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              userSelect: 'none',
            }}
          >
            Advanced
          </summary>
          <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
            <Field label="Knowledge Sources">
              <textarea
                value={knowledgeText}
                onChange={(event) => setKnowledgeText(event.target.value)}
                rows={8}
                style={{ ...inputStyle, resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
              />
            </Field>
            <Field label="Response Format JSON">
              <textarea
                value={responseFormatText}
                onChange={(event) => setResponseFormatText(event.target.value)}
                rows={10}
                style={{ ...inputStyle, resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
              />
            </Field>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {renderSaveCardButton()}
            </div>
            {renderSaveCardFeedback()}
          </div>
        </details>
      </div>
    );
  }

  if (activeTab === 'Tools') {
    const attachedToolIds = toolsText
      .split(/[\n,]+/)
      .map((entry) => entry.trim())
      .filter(Boolean);
    // Only capabilities the registry marks compatible with this card's runtime.
    const compatibleCapabilities = toolManifest.filter(
      (entry) =>
        Array.isArray(entry.agentCompatibility) &&
        entry.agentCompatibility.includes(selectedRuntimeType),
    );
    const toggleTool = (id: string) => {
      const current = toolsText
        .split(/[\n,]+/)
        .map((entry) => entry.trim())
        .filter(Boolean);
      const next = current.includes(id)
        ? current.filter((entry) => entry !== id)
        : [...current, id];
      setToolsText(next.join('\n'));
    };
    return (
      <div className={formScopeClassName} style={{ display: 'grid', gap: 8 }}>
        <style>{scopedFocusStyles}</style>
        {compatibleCapabilities.length > 0 ? (
          <div style={{ display: 'grid', gap: 6 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: GRAPH_THEME.drawer.inputText,
              }}
            >
              Available capabilities
            </div>
            {compatibleCapabilities.map((entry) => {
              const attached = attachedToolIds.includes(entry.id);
              return (
                <div
                  key={entry.id}
                  style={{
                    display: 'flex',
                    gap: 10,
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    padding: '8px 10px',
                    border: `1px solid ${GRAPH_THEME.drawer.inputBorder}`,
                    borderRadius: 8,
                  }}
                >
                  <div style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: GRAPH_THEME.drawer.inputText,
                      }}
                    >
                      {entry.displayName}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: GRAPH_THEME.drawer.inputMuted,
                        lineHeight: 1.4,
                      }}
                    >
                      {entry.description}
                    </div>
                    <div style={{ fontSize: 10, color: GRAPH_THEME.drawer.inputMuted }}>
                      Does not run automatically · {attached ? 'Attached' : 'Available'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleTool(entry.id)}
                    style={{
                      ...inputStyle,
                      width: 'auto',
                      flex: '0 0 auto',
                      cursor: 'pointer',
                      fontSize: 11,
                      padding: '4px 10px',
                    }}
                  >
                    {attached ? 'Detach' : 'Attach'}
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}
        <Field label="Tools">
          <textarea
            value={toolsText}
            onChange={(event) => setToolsText(event.target.value)}
            rows={8}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
          />
        </Field>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {renderSaveCardButton()}
        </div>
        {renderSaveCardFeedback()}
      </div>
    );
  }

  if (activeTab === 'Task') {
    if (selectedRuntimeType !== 'magentic_one') {
      return (
        <div className={formScopeClassName} style={{ display: 'grid', gap: 8 }}>
          <style>{scopedFocusStyles}</style>
          <div style={{ color: GRAPH_THEME.drawer.inputMuted, fontSize: 12, lineHeight: 1.5 }}>
            Task objects apply to the Magentic-One orchestrator card.
          </div>
        </div>
      );
    }
    return (
      <div className={formScopeClassName} style={{ display: 'grid', gap: 8 }}>
        <style>{scopedFocusStyles}</style>
        {/* Regular native Mag One keeps its OWN internal Task Ledger. It is never
            forced into an output contract, exposed as a PlanFlow projection, or
            gated behind approval — so there is nothing to edit here. */}
        <Field label="Task Ledger">
          <div style={{ color: GRAPH_THEME.drawer.inputMuted, fontSize: 12, lineHeight: 1.5 }}>
            Mag One runs as regular native Magentic-One and keeps its own internal Task
            Ledger (team composition, facts, plan, agent responsibilities) while it works.
            It is not forced into an output shape or gated behind approval, so there is
            nothing to configure here. Mag One receives a Markdown orchestration prompt and
            returns its result.
          </div>
        </Field>
      </div>
    );
  }

  if (activeTab !== 'Runtime') {
    return null;
  }

  return (
    <div className={formScopeClassName} style={{ display: 'grid', gap: 8 }}>
      <style>{scopedFocusStyles}</style>
      <Field label="Runtime Type">
        <select
          aria-label="Runtime Type"
          value={selectedRuntimeType}
          onChange={(event) => setSelectedRuntimeType(normalizeRuntimeType(event.target.value))}
          style={inputStyle}
        >
          {runtimeOptionsForSelect.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
      </Field>

      {fieldLabels.includes('Provider') ? (
        <Field label="Provider">
          <select
            aria-label="Provider"
            value={provider}
            onChange={(event) => {
              const next = event.target.value as ModelProviderChoice;
              setProvider(next);
              // Selecting the local SLM fills its default model id so the card saves a
              // resolvable model; switching away clears that default again.
              if (next === LOCAL_MODEL_PROVIDER && !modelKey.trim()) {
                setModelKey(LOCAL_MODEL_DEFAULT_KEY);
              } else if (next !== LOCAL_MODEL_PROVIDER && modelKey.trim() === LOCAL_MODEL_DEFAULT_KEY) {
                setModelKey('');
              }
            }}
            style={inputStyle}
          >
            <option value="">Default</option>
            <optgroup label="Cloud models">
              <option value="openai">OpenAI</option>
              <option value="openrouter">OpenRouter</option>
            </optgroup>
            <optgroup label="Local models">
              <option value={LOCAL_MODEL_PROVIDER}>{LOCAL_MODEL_LABEL}</option>
            </optgroup>
          </select>
        </Field>
      ) : null}

      {fieldLabels.includes('Model') ? (
        <Field label="Model">
          <input aria-label="Model" value={modelKey} onChange={(event) => setModelKey(event.target.value)} style={inputStyle} />
        </Field>
      ) : null}

      {fieldLabels.includes('Temperature') ? (
        <Field label="Temperature">
          <input
            aria-label="Temperature"
            type="number"
            step="0.1"
            value={numberValue(temperature)}
            onChange={(event) => setTemperature(event.target.value === '' ? '' : Number(event.target.value))}
            style={inputStyle}
          />
        </Field>
      ) : null}

      {fieldLabels.includes('Max Tokens') ? (
        <Field label="Max Tokens">
          <input
            aria-label="Max Tokens"
            type="number"
            step="1"
            value={numberValue(maxTokens)}
            onChange={(event) => setMaxTokens(event.target.value === '' ? '' : Number(event.target.value))}
            style={inputStyle}
          />
        </Field>
      ) : null}

      {fieldLabels.includes('Execution Mode') ? (
        <Field label="Execution Mode">
          <select
            aria-label="Execution Mode"
            value={executionMode}
            onChange={(event) => setExecutionMode(event.target.value === 'swarm' ? 'swarm' : 'single')}
            style={inputStyle}
          >
            <option value="single">Single</option>
            <option value="swarm">Swarm</option>
          </select>
        </Field>
      ) : null}

      {fieldLabels.includes('Swarm Max Workers') ? (
        <Field label="Swarm Max Workers">
          <input
            aria-label="Swarm Max Workers"
            type="number"
            step="1"
            min="2"
            value={numberValue(swarmMaxWorkers)}
            onChange={(event) => setSwarmMaxWorkers(event.target.value === '' ? '' : Number(event.target.value))}
            style={inputStyle}
          />
        </Field>
      ) : null}

      {fieldLabels.includes('Swarm Worker Prompt Template') ? (
        <Field label="Swarm Worker Prompt Template">
          <textarea
            aria-label="Swarm Worker Prompt Template"
            value={swarmWorkerPromptTemplate}
            onChange={(event) => setSwarmWorkerPromptTemplate(event.target.value)}
            rows={4}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        </Field>
      ) : null}

      {fieldLabels.includes('Max Turns') ? (
        <Field label="Max Turns">
          <input
            aria-label="Max Turns"
            type="number"
            step="1"
            value={numberValue(maxTurns)}
            onChange={(event) => setMaxTurns(event.target.value === '' ? '' : Number(event.target.value))}
            style={inputStyle}
          />
        </Field>
      ) : null}

      {fieldLabels.includes('Max Stalls') ? (
        <Field label="Max Stalls">
          <input
            aria-label="Max Stalls"
            type="number"
            step="1"
            value={numberValue(maxStalls)}
            onChange={(event) => setMaxStalls(event.target.value === '' ? '' : Number(event.target.value))}
            style={inputStyle}
          />
        </Field>
      ) : null}

      {fieldLabels.includes('Final Answer Prompt') ? (
        <Field label="Final Answer Prompt">
          <textarea
            aria-label="Final Answer Prompt"
            value={finalAnswerPrompt}
            onChange={(event) => setFinalAnswerPrompt(event.target.value)}
            rows={4}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        </Field>
      ) : null}


      {fieldLabels.includes('Consolidate Result') ? (
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', color: GRAPH_THEME.drawer.inputMuted, fontSize: 12, fontWeight: 600 }}>
          <input
            aria-label="Consolidate Result"
            type="checkbox"
            checked={useSocietyOfMindConsolidation}
            onChange={(event) => setUseSocietyOfMindConsolidation(event.target.checked)}
          />
          Consolidate Result
        </label>
      ) : null}

      {selectedRuntimeType === 'graph_flow' ? (
        <div
          style={{
            padding: '10px 12px',
            ...graphDrawerSectionStyle({
              borderRadius: 8,
            }),
            color: GRAPH_THEME.drawer.inputMuted,
            fontSize: 12,
            lineHeight: 1.5,
          }}
        >
          This is a legacy compatibility runtime. New orchestration structure should live in the visible graph connections between Assist cards, not in a special workflow card type.
        </div>
      ) : null}

      {showAdvancedRuntimeOptions ? (
        <Field label="Advanced Runtime Options JSON">
          <textarea
            aria-label="Advanced Runtime Options JSON"
            value={runtimeOptionsText}
            onChange={(event) => setRuntimeOptionsText(event.target.value)}
            rows={8}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
          />
        </Field>
      ) : null}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {renderSaveCardButton()}
      </div>
      {renderSaveCardFeedback()}
    </div>
  );
}

export default AgentManager;
