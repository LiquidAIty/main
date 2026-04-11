import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import KnowledgeGraphNVL, {
  type KnowledgeGraphNode,
  type KnowledgeGraphRelationship,
} from './knowledge/KnowledgeGraphNVL';

import type {
  AgentCardRuntimeOptions,
  AgentCardRuntimeType,
  RuntimeBinding,
} from '../types/agentgraph';

type AgentType =
  | 'agent_builder'
  | 'llm_chat'
  | 'kg_ingest'
  | 'knowgraph'
  | 'neo4j'
  | 'research_agent';

interface AgentManagerProps {
  projectId: string;
  agentType: AgentType;
  activeTab: string;
  selectedCardId?: string | null;
  graphOwnerOptions?: AgentManagerGraphOwnerOption[];
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
  memoryGraphData?: AgentManagerMemoryGraphData | null;
  onSaveLocalConfig?: (config: AgentManagerLocalConfig) => void;
}

const ACTIVE_RUNTIME_TYPES: AgentCardRuntimeType[] = [
  'assistant_agent',
  'magentic_one',
  'graph_flow',
];

const LEGACY_RUNTIME_TYPES: AgentCardRuntimeType[] = [];

export type AgentManagerGraphOwnerOption = {
  cardId: string;
  title: string;
};

export type AgentManagerLocalConfig = {
  runtime_binding?: RuntimeBinding | null;
  runtime_type?: AgentCardRuntimeType | null;
  runtime_options?: AgentCardRuntimeOptions | null;
  parent_graph_id?: string | null;
  provider?: 'openai' | 'openrouter' | '' | null;
  model_key?: string | null;
  temperature?: number | null;
  max_tokens?: number | null;
  prompt_template?: string | null;
  tools?: unknown[];
  knowledge_sources?: unknown[];
  response_format?: any | null;
};

export type AgentManagerMemoryGraphData = {
  entities: KnowledgeGraphNode[];
  relationships: KnowledgeGraphRelationship[];
};

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

function compactDefinedRuntimeOptions(input: AgentCardRuntimeOptions): AgentCardRuntimeOptions | null {
  const keptEntries = Object.entries(input).filter(([, value]) => value !== null && value !== undefined);
  return keptEntries.length > 0 ? (Object.fromEntries(keptEntries) as AgentCardRuntimeOptions) : null;
}

function getManagedRuntimeOptionKeys(
  runtimeType: AgentCardRuntimeType,
  executionMode: 'single' | 'swarm' = 'single',
): Set<string> {
  const managed = new Set(['provider', 'modelKey', 'temperature', 'maxTokens']);
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
    provider: input.provider === 'openai' || input.provider === 'openrouter' ? input.provider : null,
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
  }

  return compactDefinedRuntimeOptions(normalized);
}

function buildKnowledgeSourceLabel(source: string): string {
  const text = String(source || '').trim();
  if (!text) return 'Knowledge Source';
  const normalized = text.replace(/^https?:\/\//i, '').replace(/^[a-z]+:\/\//i, '');
  if (normalized.length <= 30) return normalized;
  const lastSegment = normalized.split(/[\\/]/).filter(Boolean).pop() || normalized;
  if (lastSegment.length <= 30) return lastSegment;
  return `${lastSegment.slice(0, 27)}…`;
}

function buildFallbackMemoryGraphData(input: {
  selectedCardId?: string | null;
  localConfig?: AgentManagerLocalConfig | null;
  memoryPolicy?: string;
  knowledgeText: string;
}): AgentManagerMemoryGraphData {
  const agentNodeId =
    `agent:${String(input.selectedCardId || input.localConfig?.runtime_binding || 'selected').trim() || 'selected'}`;
  const agentLabel =
    String(input.selectedCardId || input.localConfig?.runtime_binding || 'Agent')
      .trim()
      .replace(/[_-]+/g, ' ') || 'Agent';
  const entities: KnowledgeGraphNode[] = [
    {
      id: agentNodeId,
      rawId: String(input.selectedCardId || input.localConfig?.runtime_binding || '').trim() || undefined,
      label: agentLabel,
      type: 'Agent',
      source: 'mixed',
      scope: 'agent',
    },
    {
      id: `runtime_input:${agentNodeId}`,
      rawId: 'Current user or upstream turn input.',
      label: 'Current Input',
      type: 'Runtime Input',
      source: 'think',
      scope: 'agent',
    },
  ];
  const relationships: KnowledgeGraphRelationship[] = [
    {
      id: `rel:runtime_input:${agentNodeId}`,
      from: `runtime_input:${agentNodeId}`,
      to: agentNodeId,
      type: 'feeds_input',
      source: 'think',
      scope: 'agent',
      evidence_snippet: 'Current turn input is routed into this card at runtime.',
    },
  ];

  const memoryPolicy = String(input.memoryPolicy || '').trim();
  if (memoryPolicy) {
    entities.push({
      id: `memory_policy:${agentNodeId}`,
      rawId: memoryPolicy,
      label: 'Memory Policy',
      type: 'Memory Policy',
      source: 'think',
      scope: 'agent',
    });
    relationships.push({
      id: `rel:memory_policy:${agentNodeId}`,
      from: `memory_policy:${agentNodeId}`,
      to: agentNodeId,
      type: 'shapes_memory',
      source: 'think',
      scope: 'agent',
      evidence_snippet: 'This prompt section shapes how the card carries or constrains memory.',
    });
  }

  parseListText(input.knowledgeText).forEach((source, index) => {
    const sourceNodeId = `knowledge_source:${agentNodeId}:${index}`;
    entities.push({
      id: sourceNodeId,
      rawId: source,
      label: buildKnowledgeSourceLabel(source),
      type: 'Knowledge Source',
      source: 'know',
      scope: 'agent',
      originSource: 'know',
    });
    relationships.push({
      id: `rel:knowledge_source:${agentNodeId}:${index}`,
      from: sourceNodeId,
      to: agentNodeId,
      type: 'grounds_context',
      source: 'know',
      scope: 'agent',
      evidence_snippet: 'Configured knowledge source available to this card.',
    });
  });

  return { entities, relationships };
}

function deriveRuntimeOptions(localConfig: AgentManagerLocalConfig | null | undefined): AgentCardRuntimeOptions {
  const source = localConfig?.runtime_options || {};
  return {
    ...source,
    provider:
      localConfig?.provider === 'openai' || localConfig?.provider === 'openrouter'
        ? localConfig.provider
        : source.provider || null,
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
  provider: 'openai' | 'openrouter' | '';
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
      input.provider === 'openai' || input.provider === 'openrouter'
        ? input.provider
        : input.runtimeOptions.provider || null,
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
      runtimeType === 'assistant_agent' ? cleanString(input.parentGraphId) : null,
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
  activeTab,
  graphOwnerOptions = [],
  localConfig,
  memoryGraphData,
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
  const [provider, setProvider] = useState<'openai' | 'openrouter' | ''>(
    localConfig?.provider === 'openai' || localConfig?.provider === 'openrouter'
      ? localConfig.provider
      : '',
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
  const [knowledgeText, setKnowledgeText] = useState(
    Array.isArray(localConfig?.knowledge_sources) ? localConfig.knowledge_sources.join('\n') : '',
  );
  const [responseFormatText, setResponseFormatText] = useState(
    localConfig?.response_format ? JSON.stringify(localConfig.response_format, null, 2) : '',
  );
  const [runtimeOptionsText, setRuntimeOptionsText] = useState(
    localConfig?.runtime_options ? JSON.stringify(localConfig.runtime_options, null, 2) : '',
  );
  const [selectedMemoryEntityId, setSelectedMemoryEntityId] = useState<string | null>(null);
  const [selectedMemoryRelationshipId, setSelectedMemoryRelationshipId] = useState<string | null>(null);

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
    setProvider(
      localConfig?.provider === 'openai' || localConfig?.provider === 'openrouter'
        ? localConfig.provider
        : '',
    );
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

  const compactMemoryGraph = useMemo(
    () =>
      memoryGraphData ||
      buildFallbackMemoryGraphData({
        selectedCardId,
        localConfig,
        memoryPolicy: promptFields.memoryPolicy,
        knowledgeText,
      }),
    [knowledgeText, localConfig, memoryGraphData, promptFields.memoryPolicy, selectedCardId],
  );
  const memoryEntityById = useMemo(
    () => new Map(compactMemoryGraph.entities.map((entity) => [entity.id, entity] as const)),
    [compactMemoryGraph.entities],
  );
  const memoryRelationshipById = useMemo(
    () =>
      new Map(
        compactMemoryGraph.relationships.map((relationship) => [relationship.id, relationship] as const),
      ),
    [compactMemoryGraph.relationships],
  );
  const selectedMemoryEntity = useMemo(
    () => (selectedMemoryEntityId ? memoryEntityById.get(selectedMemoryEntityId) || null : null),
    [memoryEntityById, selectedMemoryEntityId],
  );
  const selectedMemoryRelationship = useMemo(
    () =>
      selectedMemoryRelationshipId
        ? memoryRelationshipById.get(selectedMemoryRelationshipId) || null
        : null,
    [memoryRelationshipById, selectedMemoryRelationshipId],
  );

  useEffect(() => {
    if (!selectedMemoryEntityId) return;
    if (memoryEntityById.has(selectedMemoryEntityId)) return;
    setSelectedMemoryEntityId(null);
  }, [memoryEntityById, selectedMemoryEntityId]);

  useEffect(() => {
    if (!selectedMemoryRelationshipId) return;
    if (memoryRelationshipById.has(selectedMemoryRelationshipId)) return;
    setSelectedMemoryRelationshipId(null);
  }, [memoryRelationshipById, selectedMemoryRelationshipId]);

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

  const saveConfig = () => {
    if (!onSaveLocalConfig) return;
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

    onSaveLocalConfig(
      buildActiveAgentManagerLocalConfig({
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
      }),
    );
  };

  const runtimeOptionsForSelect = getRuntimeTypeSelectOptions(selectedRuntimeType);
  const fieldLabels = getRuntimeTypeVisibleFieldLabels(selectedRuntimeType, executionMode);
  const showAdvancedRuntimeOptions =
    !['assistant_agent', 'magentic_one', 'graph_flow'].includes(selectedRuntimeType) ||
    Object.entries(localConfig?.runtime_options || {}).some(
      ([key, value]) =>
        !getManagedRuntimeOptionKeys(selectedRuntimeType, executionMode).has(key) &&
        value !== null &&
        value !== undefined,
    );
  const Field = ({
    label,
    children,
  }: {
    label: string;
    children: React.ReactNode;
  }) => (
    <label style={{ display: 'grid', gap: 6 }}>
      <span style={{ color: '#E0DED5', fontSize: 12, fontWeight: 600 }}>{label}</span>
      {children}
    </label>
  );

  const inputStyle: CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid #3A3A3A',
    background: '#181818',
    color: '#FFFFFF',
  };

  const numberValue = (value: number | '') => (value === '' ? '' : String(value));

  if (activeTab === 'Prompt') {
    return (
      <div style={{ display: 'grid', gap: 12 }}>
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
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={saveConfig} style={{ ...inputStyle, width: 'auto', cursor: 'pointer', fontWeight: 600 }}>
            Save Card
          </button>
          <button
            type="button"
            onClick={() => onRunPromptTest?.()}
            disabled={promptTestDisabled}
            style={{ ...inputStyle, width: 'auto', cursor: promptTestDisabled ? 'not-allowed' : 'pointer', fontWeight: 600 }}
          >
            {promptTestBusy ? 'Running...' : 'Run Card'}
          </button>
        </div>
      </div>
    );
  }

  if (activeTab === 'Knowledge') {
    return (
      <div style={{ display: 'grid', gap: 12 }}>
        <div data-testid="agent-memory-graph" style={{ height: 260, minHeight: 260 }}>
          <KnowledgeGraphNVL
            entities={compactMemoryGraph.entities}
            relationships={compactMemoryGraph.relationships}
            minHeight={260}
            selectionEnabled
            selectedEntityId={selectedMemoryEntityId}
            selectedRelationshipId={selectedMemoryRelationshipId}
            onSelectEntity={(entity) => {
              setSelectedMemoryRelationshipId(null);
              setSelectedMemoryEntityId(entity?.id ?? null);
            }}
            onSelectRelationship={(relationship) => {
              setSelectedMemoryEntityId(null);
              setSelectedMemoryRelationshipId(relationship?.id ?? null);
            }}
          />
        </div>

        {selectedMemoryEntity ? (
          <div
            data-testid="agent-memory-selection-entity"
            style={{
              display: 'grid',
              gap: 6,
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid rgba(154, 162, 172, 0.22)',
              background: 'rgba(255,255,255,0.04)',
            }}
          >
            <div style={{ color: '#FFFFFF', fontWeight: 600 }}>{selectedMemoryEntity.label}</div>
            <div style={{ color: '#E0DED5', fontSize: 12, opacity: 0.8 }}>
              {selectedMemoryEntity.type} • {selectedMemoryEntity.source} • {selectedMemoryEntity.scope.replace(/_/g, ' ')}
            </div>
            {selectedMemoryEntity.rawId &&
            selectedMemoryEntity.rawId !== selectedMemoryEntity.label &&
            selectedMemoryEntity.rawId !== selectedMemoryEntity.id ? (
              <div style={{ color: '#E0DED5', fontSize: 12, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                {selectedMemoryEntity.rawId}
              </div>
            ) : null}
          </div>
        ) : null}

        {selectedMemoryRelationship ? (
          <div
            data-testid="agent-memory-selection-relationship"
            style={{
              display: 'grid',
              gap: 6,
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid rgba(154, 162, 172, 0.22)',
              background: 'rgba(255,255,255,0.04)',
            }}
          >
            <div style={{ color: '#FFFFFF', fontWeight: 600 }}>
              {selectedMemoryRelationship.type}
            </div>
            <div style={{ color: '#E0DED5', fontSize: 12, opacity: 0.8 }}>
              {(memoryEntityById.get(selectedMemoryRelationship.from)?.label || selectedMemoryRelationship.from)}
              {' → '}
              {(memoryEntityById.get(selectedMemoryRelationship.to)?.label || selectedMemoryRelationship.to)}
            </div>
            <div style={{ color: '#E0DED5', fontSize: 12, opacity: 0.8 }}>
              {selectedMemoryRelationship.source} • {selectedMemoryRelationship.scope.replace(/_/g, ' ')}
            </div>
            {selectedMemoryRelationship.evidence_snippet ? (
              <div style={{ color: '#E0DED5', fontSize: 12, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                {selectedMemoryRelationship.evidence_snippet}
              </div>
            ) : null}
          </div>
        ) : null}

        <details
          data-testid="agent-knowledge-advanced"
          style={{
            borderRadius: 8,
            border: '1px solid rgba(154, 162, 172, 0.22)',
            background: 'rgba(255,255,255,0.02)',
            padding: '10px 12px',
          }}
        >
          <summary
            style={{
              color: '#E0DED5',
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
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={saveConfig} style={{ ...inputStyle, width: 'auto', cursor: 'pointer', fontWeight: 600 }}>
                Save Card
              </button>
            </div>
          </div>
        </details>
      </div>
    );
  }

  if (activeTab === 'Tools') {
    return (
      <div style={{ display: 'grid', gap: 12 }}>
        <Field label="Tools">
          <textarea
            value={toolsText}
            onChange={(event) => setToolsText(event.target.value)}
            rows={8}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
          />
        </Field>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={saveConfig} style={{ ...inputStyle, width: 'auto', cursor: 'pointer', fontWeight: 600 }}>
            Save Card
          </button>
        </div>
      </div>
    );
  }

  if (activeTab !== 'Runtime') {
    return null;
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
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
            onChange={(event) => setProvider(event.target.value as 'openai' | 'openrouter' | '')}
            style={inputStyle}
          >
            <option value="">Default</option>
            <option value="openai">OpenAI</option>
            <option value="openrouter">OpenRouter</option>
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
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', color: '#E0DED5', fontSize: 12, fontWeight: 600 }}>
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
            borderRadius: 8,
            border: '1px solid rgba(154, 162, 172, 0.22)',
            background: 'rgba(255,255,255,0.04)',
            color: '#E0DED5',
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

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={saveConfig} style={{ ...inputStyle, width: 'auto', cursor: 'pointer', fontWeight: 600 }}>
          Save Card
        </button>
      </div>
    </div>
  );
}

export default AgentManager;
