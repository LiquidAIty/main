import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  NativeGraphProjectionSurface,
  type GraphProjectionV1,
} from './knowledge/NativeAuthorityGraphSurface';

import type {
  AgentCardRuntimeOptions,
  CardRuntime,
} from '../types/agentgraph';
import HermesSkillGraph from '../features/agentbuilder/HermesSkillGraph';
import { CardScriptEditor } from '../features/agentbuilder/CardScriptEditor';
import {
  applyNativeHermesOperation,
  loadNativeHermesCard,
  loadNativeHermesLearningDetail,
  testNativeHermesMcp,
  type NativeHermesCardView,
} from '../features/agentbuilder/nativeHermesCard';
import AdaptiveCardTerminal, {
  usesAdaptiveCardTerminal,
  type CardTerminalObservation,
} from '../features/agentbuilder/console/AdaptiveCardTerminal';
import CardSubagentsTab from '../features/agentbuilder/team/CardTeamTab';

type ModelOption = { key: string; label: string; providerModelId: string };
type SavedSubagentModel = NonNullable<AgentCardRuntimeOptions['subagentModel']>;
type SavedTeamConfig = NonNullable<AgentCardRuntimeOptions['team']>;
type SavedCardScript = NonNullable<AgentCardRuntimeOptions['script']>;
const DEFAULT_SUBAGENT_MODEL: SavedSubagentModel = {
  provider: 'openai',
  accessMode: 'chatgpt-account',
  modelKey: 'gpt-5.6-luna',
  providerModelId: 'gpt-5.6-luna',
};

function defaultTeamConfig(
  model: SavedSubagentModel = DEFAULT_SUBAGENT_MODEL,
  mode: SavedTeamConfig['mode'] = 'off',
): SavedTeamConfig {
  return {
    mode,
    maxWorkers: 2,
    retryLimit: 1,
    workerModel: { ...model },
    leadModel: { ...model },
  };
}

function blankCardScript(): SavedCardScript {
  return {
    enabled: false,
    source: '',
    version: 1,
    author: {},
    sourceHash: '',
    compiledHash: '',
    paletteFingerprint: '',
    compiled: {},
    lastValidation: {
      status: 'blank', executionTested: false, errors: [], toolHandles: [],
    },
    nativeSupport: { available: false, active: false, executor: null },
    rollback: {},
  };
}

function subagentAccessMode(provider: string): SavedSubagentModel['accessMode'] {
  return provider === 'openrouter' ? 'openrouter-api'
    : provider === 'openai' ? 'chatgpt-account'
    : 'openai-api';
}
export type InputDictionaryEditorOption = { value: string; label: string; when?: Record<string, string> };
export type InputDictionaryEditorField = {
  name: string;
  label: string;
  path: string;
  control: 'select' | 'catalog-select' | 'catalog-multiselect' | 'number' | 'integer' | 'text';
  allowUnset?: boolean;
  catalog?: string;
  filteredBy?: string;
  minimum?: number;
  maximum?: number;
  step?: number;
  blockedRuntimeBindings?: string[];
  blockedRuntimeTypes?: string[];
  help?: string;
  options?: InputDictionaryEditorOption[];
};

export function parseCardEditorOptions(payload: unknown): {
  fields: InputDictionaryEditorField[];
  modelsByProvider: Record<string, ModelOption[]>;
} {
  if (!payload || typeof payload !== 'object') {
    throw new Error('runtime_options_invalid');
  }
  const document = payload as Record<string, unknown>;
  if (!Array.isArray(document.fields)) {
    throw new Error('runtime_options_invalid');
  }
  const fields = document.fields.filter((field): field is InputDictionaryEditorField => (
    Boolean(field)
    && typeof field === 'object'
    && typeof (field as InputDictionaryEditorField).name === 'string'
    && typeof (field as InputDictionaryEditorField).label === 'string'
    && typeof (field as InputDictionaryEditorField).control === 'string'
  ));
  const catalogs = document.catalogs && typeof document.catalogs === 'object'
    ? document.catalogs as Record<string, unknown>
    : {};
  const models = Array.isArray(catalogs['configured-models'])
    ? catalogs['configured-models']
    : [];
  const modelsByProvider: Record<string, ModelOption[]> = {};
  for (const rawModel of models) {
    if (!rawModel || typeof rawModel !== 'object') continue;
    const model = rawModel as Record<string, unknown>;
    const provider = String(model.provider || '').trim();
    const key = String(model.key || '').trim();
    const label = String(model.label || '').trim();
    const providerModelId = String(model.providerModelId || '').trim();
    if (!provider || !key || !label || !providerModelId) continue;
    (modelsByProvider[provider] ||= []).push({ key, label, providerModelId });
  }
  return { fields, modelsByProvider };
}
export type ToolDescriptor = {
  name: string;
  kind?: 'tool' | 'agent';
  sourceIds?: string[];
  title?: string;
  description?: string;
};
export type DisplayedToolRow = ToolDescriptor & {
  availability: 'available' | 'disabled' | 'stale';
};

export type InputDictionaryToolReference = {
  canonicalId: string;
  kind?: 'tool' | 'agent';
  sourceIds: string[];
  namespace?: string;
  displayName?: string;
  shortDescription?: string;
  availability: 'available' | 'disabled';
  access: 'read' | 'write';
};

export type InputDictionaryToolPage = {
  references: InputDictionaryToolReference[];
  selectedKnownReferences: InputDictionaryToolReference[];
  unresolvedSelectedIds: string[];
  namespaces: string[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
};

export function buildInputDictionarySelectedRows(
  selectedReferences: InputDictionaryToolReference[],
  unresolvedSelectedIds: string[],
): DisplayedToolRow[] {
  const known = selectedReferences.map((reference) => ({
      name: reference.canonicalId,
      kind: reference.kind,
      sourceIds: reference.sourceIds,
      title: reference.displayName || reference.canonicalId,
      description: reference.shortDescription,
      availability: reference.availability,
    }));
  const knownNames = new Set(known.map((reference) => reference.name));
  return [
    ...known,
    ...unresolvedSelectedIds
      .filter((canonicalId) => !knownNames.has(canonicalId))
      .map((canonicalId) => ({ name: canonicalId, availability: 'stale' as const })),
  ];
}

export function buildDisplayedToolRows(
  toolCatalog: ToolDescriptor[],
  savedToolNames: string[],
): DisplayedToolRow[] {
  const catalogByName = new Map<string, ToolDescriptor>();
  for (const tool of toolCatalog) {
    if (catalogByName.has(tool.name)) throw new Error(`duplicate_idd_tool:${tool.name}`);
    catalogByName.set(tool.name, tool);
  }
  const savedNames = Array.from(new Set(savedToolNames));
  const savedNameSet = new Set(savedNames);
  const rows: DisplayedToolRow[] = savedNames.map((name) => {
    const registered = catalogByName.get(name);
    return registered
      ? { ...registered, availability: 'available' }
      : { name, availability: 'stale' };
  });

  for (const tool of toolCatalog) {
    if (savedNameSet.has(tool.name)) continue;
    rows.push({ ...tool, availability: 'available' });
    savedNameSet.add(tool.name);
  }

  return rows;
}

export function toggleSavedToolAssignment(
  savedToolNames: string[],
  name: string,
  checked: boolean,
): string[] {
  if (checked) return savedToolNames.includes(name) ? savedToolNames : [...savedToolNames, name];
  return savedToolNames.filter((savedName) => savedName !== name);
}
type AgentType =
  | 'agent_builder'
  | 'llm_chat'
  | 'kg_ingest'
  | 'knowgraph'
  | 'neo4j'
  | 'research_agent';

interface AgentManagerProps {
  cardId?: string;
  cardKind?: string;
  projectId?: string;
  deckId?: string;
  agentType: AgentType;
  activeTab: string;
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
  onRunCard?: () => void;
  onLearnCard?: () => void;
  onStopCard?: () => void;
  onRejoinCard?: () => void;
  onClearInvocation?: () => void;
  onOpenCoderTerminal?: () => void;
  onOpenMainChat?: () => void;
  terminalContent?: React.ReactNode;
  onRemoveGraphReference?: (authority: string, nativeId: string) => void;
  onMoveGraphReference?: (
    authority: string,
    nativeId: string,
    direction: -1 | 1,
  ) => void;
  runBusy?: boolean;
  runDisabled?: boolean;
  showTaskComposer?: boolean;
  runResult?: StandaloneCardTestResult | null;
  runInputs?: RetainedRunInputs | null;
  loadedGraphContext?: Array<{
    reference: {
      authority: string;
      nativeId: string;
      reason: string;
      order: number;
      boundedExpansion: number;
      resultLimit: number;
      required: boolean;
    };
    resolvedReferences: Array<Record<string, unknown>>;
    resolvedContextMarkdown: string;
    graphProjection: GraphProjectionV1;
    resolved: boolean;
    ready: boolean;
    observedAt?: string;
    error?: string;
  }>;
  saveDeckStatusMessage?: string | null;
  openDeckRevision?: string | null;
  cardName?: string;
  cardSubtext?: string;
  onChangeCardName?: (value: string) => void;
  onChangeCardSubtext?: (value: string) => void;
  localConfig?: AgentManagerLocalConfig | null;
  onSaveLocalConfig?: (config: AgentManagerLocalConfig) => void | Promise<void>;
  registerCardLeave?: (save: (() => Promise<boolean>) | null) => void;
}

export type AgentManagerLocalConfig = {
  runtime: CardRuntime;
  runtime_options?: AgentCardRuntimeOptions | null;
  parent_graph_id?: string | null;
  role?: string | null;
  output_contract?: unknown;
  workspace_root?: string | null;
  provider?: 'openai' | 'openrouter' | 'local_openai_compatible' | '' | null;
  access_mode?: 'chatgpt-account' | 'openai-api' | 'openrouter-api' | '' | null;
  model_key?: string | null;
  reasoning_effort?: 'low' | 'medium' | 'high' | 'xhigh' | null;
  temperature?: number | null;
  max_tokens?: number | null;
  max_turns?: number | null;
  prompt_template?: string | null;
  tools?: unknown[];
  skills?: unknown[];
  toolsets?: unknown[];
  mcp_connection_ids?: unknown[];
};

export type StandaloneCardTestResult = {
  status: string;
  state?: string | null;
  runId?: string | null;
  correlationId?: string | null;
  cardId?: string | null;
  nativeRootId?: string | null;
  nativeRunId?: string | number | null;
  tasksCompleted?: number;
  tasksTotal?: number;
  activeWorkers?: number;
  teamReceipt?: {
    schemaVersion: string;
    source: string;
    mode: 'auto';
    maxWorkers: number;
    retryLimit: number;
    maxRetries: number;
    workerProvider: string;
    workerModel: string;
    leadProvider: string;
    leadModel: string;
    maxDepth: number;
  } | null;
  resultReady?: boolean;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  reasoningTokens?: number;
  costUsd?: number;
  output: string;
  error: string | null;
  terminal?: CardTerminalObservation | null;
  observationError?: string | null;
  toolCallCount?: number | null;
  tools: string[];
  provider?: string | null;
  model?: string | null;
  runtimeLabel?: string | null;
  invocation?: {
    ephemeral: boolean;
    cardRevisionId: string;
    cardRevision: number;
    cardRevisionSha256: string;
    runtimeOwner: string;
    resolvedNativeReads?: Array<Record<string, unknown>>;
    resolvedGraphProjection?: GraphProjectionV1;
    idf: {
      actualGraphData: Record<string, any>;
      stableSavedCardContext: Record<string, any>;
      selectedToolsAndGrants: Record<string, any>;
      dynamicContext: Record<string, any>;
    };
    inputSummary?: Record<string, any>;
    inputFile?: Record<string, any>;
    cardIdentity: { cardId: string; title?: string };
  } | null;
  receipt?: Record<string, unknown> | null;
  nativeEvents?: Array<Record<string, unknown>>;
};

export type RetainedRunInputs = {
  available: boolean;
  runId: string;
  message?: string;
  idf?: {
    actualGraphData: Record<string, any>;
    stableSavedCardContext: Record<string, any>;
    selectedToolsAndGrants: Record<string, any>;
    dynamicContext: Record<string, any>;
  };
  inputSummary?: Record<string, any>;
  idfText?: string;
};

export function selectKnowledgeGraphProjection(
  loaded: GraphProjectionV1,
  materialized?: GraphProjectionV1,
): { projection: GraphProjectionV1; modelBound: boolean } {
  if (materialized && Array.isArray(materialized.nodes) && Array.isArray(materialized.edges)) {
    return { projection: materialized, modelBound: true };
  }
  return { projection: loaded, modelBound: false };
}

type SaveCardStatus = 'idle' | 'saving' | 'saved' | 'failed';

type PromptFields = {
  role: string;
  goal: string;
  constraints: string;
  ioSchema: string;
  memoryPolicy: string;
};

const PROMPT_HEADINGS: Record<string, keyof PromptFields> = {
  ROLE: 'role', GOAL: 'goal', CONSTRAINTS: 'constraints',
  IO_SCHEMA: 'ioSchema', INPUT_SCHEMA: 'ioSchema', MEMORY_POLICY: 'memoryPolicy',
};

function promptFieldRanges(template: string) {
  // Parse explicit document syntax only. Unknown and repeated sections stay intact.
  const headings = [...template.matchAll(/^\[([A-Z_ ]+)\][ \t]*(?:\r?\n|$)/gm)];
  const ranges: Array<{ key: keyof PromptFields; start: number; end: number }> = [];
  const seen = new Set<keyof PromptFields>();
  headings.forEach((heading, index) => {
    const key = PROMPT_HEADINGS[heading[1]];
    if (!key || seen.has(key)) return;
    seen.add(key);
    const start = heading.index! + heading[0].length;
    const end = headings[index + 1]?.index ?? template.length;
    const body = template.slice(start, end);
    const leading = body.match(/^\s*/)?.[0].length || 0;
    const trailing = body.match(/\s*$/)?.[0].length || 0;
    ranges.push({ key, start: start + leading, end: Math.max(start + leading, end - trailing) });
  });
  if (!headings.length && template) ranges.push({ key: 'role', start: 0, end: template.length });
  return ranges;
}

function parsePromptTemplate(template: string): PromptFields {
  const fields: PromptFields = { role: '', goal: '', constraints: '', ioSchema: '', memoryPolicy: '' };
  for (const range of promptFieldRanges(template)) fields[range.key] = template.slice(range.start, range.end);
  return fields;
}

function serializePromptFields(fields: PromptFields, original = ''): string {
  const ranges = promptFieldRanges(original);
  const previous = parsePromptTemplate(original);
  let result = original;
  for (const range of [...ranges].reverse()) {
    if (fields[range.key] !== previous[range.key]) {
      result = result.slice(0, range.start) + fields[range.key] + result.slice(range.end);
    }
  }
  const newline = original.includes('\r\n') ? '\r\n' : '\n';
  for (const [heading, key] of Object.entries(PROMPT_HEADINGS)) {
    if (heading === 'INPUT_SCHEMA' || ranges.some((range) => range.key === key) || !fields[key]) continue;
    result += `${result ? newline + newline : ''}[${heading}]${newline}${fields[key]}`;
  }
  return result;
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
    // fall back to newline/comma parsing
  }
  return text
    .split(/[\r\n,]+/)
    .map((entry) => entry.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean);
}

export function buildActiveAgentManagerLocalConfig(input: {
  runtime: CardRuntime;
  provider: NonNullable<AgentManagerLocalConfig['provider']>;
  accessMode: 'chatgpt-account' | 'openai-api' | 'openrouter-api' | '';
  modelKey: string;
  reasoningEffort: 'low' | 'medium' | 'high' | 'xhigh' | '';
  temperature: number | '';
  maxTokens: number | '';
  maxTurns: number | '';
  promptTemplate: string;
  toolsText: string;
  skillsText: string;
  toolsetsText: string;
  mcpConnectionIdsText: string;
}): AgentManagerLocalConfig {
  return {
    runtime: input.runtime,
    provider: input.provider,
    access_mode: input.accessMode,
    model_key: input.modelKey || null,
    reasoning_effort: input.reasoningEffort || null,
    temperature: typeof input.temperature === 'number' ? input.temperature : null,
    max_tokens: typeof input.maxTokens === 'number' ? input.maxTokens : null,
    max_turns: typeof input.maxTurns === 'number' ? input.maxTurns : null,
    prompt_template: input.promptTemplate,
    tools: parseListText(input.toolsText),
    skills: parseListText(input.skillsText),
    toolsets: parseListText(input.toolsetsText),
    mcp_connection_ids: parseListText(input.mcpConnectionIdsText),
  };
}

export function hasHermesModelDrift(
  savedCardModel: unknown,
  nativeProfileModel: unknown,
): boolean {
  const saved = String(savedCardModel || '').trim();
  const native = String(nativeProfileModel || '').trim();
  return Boolean(saved && native && saved !== native);
}

export function AgentManager({
  cardId = '',
  cardKind,
  projectId = '',
  deckId = '',
  activeTab,
  promptTestInput,
  onChangePromptTestInput,
  onRunCard,
  onLearnCard,
  onStopCard,
  onRejoinCard,
  onClearInvocation,
  onOpenCoderTerminal,
  onOpenMainChat,
  onRemoveGraphReference,
  onMoveGraphReference,
  runBusy = false,
  runDisabled = false,
  showTaskComposer = true,
  terminalContent,
  runResult = null,
  runInputs = null,
  loadedGraphContext = [],
  saveDeckStatusMessage = null,
  openDeckRevision = null,
  cardName = '',
  onChangeCardName,
  localConfig,
  onSaveLocalConfig,
  registerCardLeave,
}: AgentManagerProps) {
  const adaptiveTerminal = usesAdaptiveCardTerminal(cardKind, localConfig?.runtime);
  const isLocalConfigMode = Boolean(localConfig && onSaveLocalConfig);
  const [saveCardStatus, setSaveCardStatus] = useState<SaveCardStatus>('idle');
  const [saveCardErrorMessage, setSaveCardErrorMessage] = useState<string | null>(null);
  const cardSaveInFlightRef = useRef(false);
  const runtimeKind = localConfig?.runtime.kind;
  const runtimeMode = localConfig?.runtime.mode;
  const [cardNameDraft, setCardNameDraft] = useState(cardName);
  const [provider, setProvider] = useState<NonNullable<AgentManagerLocalConfig['provider']>>('');
  const [accessMode, setAccessMode] = useState<
    'chatgpt-account' | 'openai-api' | 'openrouter-api' | ''
  >('');
  const [modelKey, setModelKey] = useState('');
  const [subagentModel, setSubagentModel] = useState<SavedSubagentModel>(DEFAULT_SUBAGENT_MODEL);
  const [teamTouched, setTeamTouched] = useState(false);
  const [delegationRole, setDelegationRole] = useState<NonNullable<AgentCardRuntimeOptions['delegationRole']>>('off');
  const [delegationTouched, setDelegationTouched] = useState(false);
  const [subagentTouched, setSubagentTouched] = useState(false);
  const [memoryProviderDraft, setMemoryProviderDraft] = useState<'builtin' | 'honcho' | null>(null);
  const [automaticLearningDraft, setAutomaticLearningDraft] = useState<boolean | null>(null);
  const learningEditsRef = useRef(new Map<string, string>());
  const [teamConfig, setTeamConfig] = useState<SavedTeamConfig>(defaultTeamConfig());
  const [scriptDraft, setScriptDraft] = useState<SavedCardScript>(blankCardScript);
  const scriptDraftCacheRef = useRef<Map<string, SavedCardScript>>(new Map());
  const dirtyScriptCardsRef = useRef<Set<string>>(new Set());
  const [reasoningEffort, setReasoningEffort] = useState<
    'low' | 'medium' | 'high' | 'xhigh' | ''
  >('');
  const [modelsByProvider, setModelsByProvider] = useState<Record<string, ModelOption[]>>({});
  const [cardEditorFields, setCardEditorFields] = useState<InputDictionaryEditorField[]>([]);
  const [runtimeOptionsStatus, setRuntimeOptionsStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [toolDictionaryPage, setToolDictionaryPage] = useState<InputDictionaryToolPage>({
    references: [],
    selectedKnownReferences: [],
    unresolvedSelectedIds: [],
    namespaces: [],
    total: 0,
    offset: 0,
    limit: 100,
    hasMore: false,
  });
  const [toolDictionaryQuery, setToolDictionaryQuery] = useState('');
  const [toolDictionaryNamespace, setToolDictionaryNamespace] = useState('');
  const [toolDictionaryOffset, setToolDictionaryOffset] = useState(0);
  const [showSelectedToolsOnly, setShowSelectedToolsOnly] = useState(false);
  const [toolDictionaryBusy, setToolDictionaryBusy] = useState(true);
  const [toolOptionsError, setToolOptionsError] = useState(false);
  const [temperature, setTemperature] = useState<number | ''>('');
  const [maxTokens, setMaxTokens] = useState<number | ''>('');
  const [maxTurns, setMaxTurns] = useState<number | ''>('');
  const [promptText, setPromptText] = useState('');
  const [outputExpectations, setOutputExpectations] = useState('');
  const [outputExpectationsTouched, setOutputExpectationsTouched] = useState(false);
  const [promptParts, setPromptParts] = useState({
    role: '',
    goal: '',
    constraints: '',
    ioSchema: '',
    memoryPolicy: '',
  });
  const [promptPartsTouched, setPromptPartsTouched] = useState(false);
  const [toolsText, setToolsText] = useState('');
  const [disabledToolsText, setDisabledToolsText] = useState('');
  const [skillsText, setSkillsText] = useState('');
  const [toolsetsText, setToolsetsText] = useState('');
  const [mcpConnectionIdsText, setMcpConnectionIdsText] = useState('');
  const [nativeHermesState, setNativeHermesState] = useState<NativeHermesCardView | null>(null);
  const [nativeHermesStatus, setNativeHermesStatus] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [nativeHermesError, setNativeHermesError] = useState<string | null>(null);
  const [nativeSoulDraft, setNativeSoulDraft] = useState('');
  const [nativeDisabledSkills, setNativeDisabledSkills] = useState<string[]>([]);
  const [nativeEnabledToolsets, setNativeEnabledToolsets] = useState<string[]>([]);
  const [nativeEnabledMcpServers, setNativeEnabledMcpServers] = useState<string[]>([]);
  const [nativeLearningDetail, setNativeLearningDetail] = useState<{
    kind: 'memory' | 'skill';
    id: string;
    label: string;
    content: string;
  } | null>(null);
  const [nativeLearningDraft, setNativeLearningDraft] = useState('');
  const [nativeLearningStatus, setNativeLearningStatus] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [nativeLearningError, setNativeLearningError] = useState<string | null>(null);
  const [nativeMcpChecks, setNativeMcpChecks] = useState<Record<string, {
    status: 'checking' | 'connected' | 'failed';
    toolCount: number;
    error: string | null;
  }>>({});
  const [inputFileTransferError, setInputFileTransferError] = useState<string | null>(null);
  const draftDirtyRef = useRef(false);
  const loadedGraphProjection = useMemo<GraphProjectionV1>(() => {
    const nodes = new Map<string, GraphProjectionV1['nodes'][number]>();
    const edges = new Map<string, GraphProjectionV1['edges'][number]>();
    for (const context of loadedGraphContext) {
      for (const node of context.graphProjection.nodes) nodes.set(node.id, node);
      for (const edge of context.graphProjection.edges) edges.set(edge.id, edge);
    }
    return {
      schemaVersion: 'native-card-context.v1',
      authority: 'mixed',
      projectId: loadedGraphContext[0]?.graphProjection.projectId || '',
      nodes: [...nodes.values()],
      edges: [...edges.values()].filter(
        (edge) => nodes.has(edge.source) && nodes.has(edge.target),
      ),
      counts: { nodes: nodes.size, edges: edges.size },
    };
  }, [loadedGraphContext]);
  const materializedGraphProjection = runResult?.invocation?.resolvedGraphProjection;
  const selectedKnowledgeProjection = selectKnowledgeGraphProjection(
    loadedGraphProjection,
    materializedGraphProjection,
  );
  const knowledgeGraphProjection = selectedKnowledgeProjection.projection;
  const knowledgeProjectionIsMaterialized = selectedKnowledgeProjection.modelBound;

  const exportRuntimeInput = useCallback(async (
    extension: '.idf',
    contents: string,
  ) => {
    setInputFileTransferError(null);
    const requestedName = window.prompt(
      `Choose the exported ${extension} filename`,
      '',
    );
    if (requestedName == null) return;
    const filename = requestedName.trim();
    if (!filename || !filename.toLowerCase().endsWith(extension)) {
      setInputFileTransferError(`Export filename must end with ${extension}.`);
      return;
    }
    const picker = (window as Window & {
      showSaveFilePicker?: (options: Record<string, unknown>) => Promise<{
        createWritable: () => Promise<{
          write: (value: string) => Promise<void>;
          close: () => Promise<void>;
        }>;
      }>;
    }).showSaveFilePicker;
    if (!picker) {
      setInputFileTransferError('Named export is unavailable in this browser. No fallback copy was created.');
      return;
    }
    try {
      const handle = await picker({
        suggestedName: filename,
        types: [{
          description: 'Run input',
          accept: { 'application/json': [extension] },
        }],
      });
      const writable = await handle.createWritable();
      await writable.write(contents);
      await writable.close();
    } catch (error) {
      if ((error as { name?: string })?.name !== 'AbortError') {
        setInputFileTransferError(error instanceof Error ? error.message : 'Named export failed.');
      }
    }
  }, []);

  useEffect(() => {
    setCardNameDraft(cardName);
    setInputFileTransferError(null);
  }, [cardId, cardName]);

  useEffect(() => {
    let active = true;
    setRuntimeOptionsStatus('loading');
    setCardEditorFields([]);
    setModelsByProvider({});
    void fetch('/api/coder/card-editor/options')
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok || payload?.ok !== true) {
          throw new Error('runtime_options_unavailable');
        }
        const parsed = parseCardEditorOptions(payload);
        if (active) {
          setCardEditorFields(parsed.fields);
          setModelsByProvider(parsed.modelsByProvider);
          setRuntimeOptionsStatus('ready');
        }
      })
      .catch(() => {
        if (active) {
          setCardEditorFields([]);
          setModelsByProvider({});
          setRuntimeOptionsStatus('failed');
        }
      });
    return () => {
      active = false;
    };
  }, [projectId, deckId, cardId]);

  useEffect(() => {
    if (!isLocalConfigMode || !localConfig) return;
    draftDirtyRef.current = false;
    setTeamTouched(false);
    setDelegationTouched(false);
    setDelegationRole(localConfig.runtime_options?.delegationRole || 'off');
    setSubagentTouched(false);
    setProvider(localConfig.provider || '');
    setAccessMode(
      localConfig.access_mode === 'chatgpt-account'
      || localConfig.access_mode === 'openai-api'
      || localConfig.access_mode === 'openrouter-api'
        ? localConfig.access_mode
        : '',
    );
    setModelKey(localConfig.model_key || '');
    const savedSubagentModel = localConfig.runtime_options?.subagentModel;
    setSubagentModel(
      localConfig.runtime.kind === 'hermes' && savedSubagentModel
        ? savedSubagentModel
        : DEFAULT_SUBAGENT_MODEL,
    );
    const parentModel: SavedSubagentModel | null = (
      localConfig.runtime.kind === 'hermes'
      && localConfig.provider
      && localConfig.model_key
    ) ? {
        provider: localConfig.provider,
        accessMode: localConfig.access_mode === 'openrouter-api'
          || localConfig.access_mode === 'openai-api'
          || localConfig.access_mode === 'chatgpt-account'
          ? localConfig.access_mode
          : subagentAccessMode(localConfig.provider),
        modelKey: localConfig.model_key,
        providerModelId: localConfig.runtime_options?.providerModelId || localConfig.model_key,
      } : null;
    setTeamConfig(
      localConfig.runtime.kind === 'hermes' && localConfig.runtime_options?.team
        ? structuredClone(localConfig.runtime_options.team)
        : defaultTeamConfig(parentModel || savedSubagentModel || DEFAULT_SUBAGENT_MODEL),
    );
    const savedScript = localConfig.runtime_options?.script
      ? structuredClone(localConfig.runtime_options.script)
      : blankCardScript();
    const cachedScript = scriptDraftCacheRef.current.get(cardId);
    const preserveUnsavedScript = Boolean(
      cachedScript
      && dirtyScriptCardsRef.current.has(cardId)
      && (
        cachedScript.source !== savedScript.source
        || cachedScript.enabled !== savedScript.enabled
      ),
    );
    if (preserveUnsavedScript && cachedScript) {
      setScriptDraft(structuredClone(cachedScript));
    } else {
      scriptDraftCacheRef.current.set(cardId, structuredClone(savedScript));
      dirtyScriptCardsRef.current.delete(cardId);
      setScriptDraft(savedScript);
    }
    setReasoningEffort(localConfig.reasoning_effort || '');
    setTemperature(typeof localConfig.temperature === 'number' ? localConfig.temperature : '');
    setMaxTokens(typeof localConfig.max_tokens === 'number' ? localConfig.max_tokens : '');
    setMaxTurns(typeof localConfig.max_turns === 'number' ? localConfig.max_turns : '');
    setPromptText(localConfig.prompt_template || '');
    setOutputExpectations(typeof localConfig.output_contract === 'string' ? localConfig.output_contract
      : localConfig.output_contract == null ? '' : JSON.stringify(localConfig.output_contract, null, 2));
    setOutputExpectationsTouched(false);
    const parsedPrompt = parsePromptTemplate(localConfig.prompt_template || '');
    setPromptParts({
      ...parsedPrompt,
      role: parsedPrompt.role || String(localConfig.role || ''),
    });
    setPromptPartsTouched(false);
    setToolsText(
      Array.isArray(localConfig.tools)
        ? localConfig.tools
            .filter((entry): entry is string => typeof entry === 'string')
            .join('\n')
        : '',
    );
    setDisabledToolsText(
      Array.isArray(localConfig.runtime_options?.disabledTools)
        ? localConfig.runtime_options.disabledTools
            .filter((entry): entry is string => typeof entry === 'string')
            .join('\n')
        : '',
    );
    setSkillsText(
      Array.isArray(localConfig.skills)
        ? localConfig.skills.filter((entry): entry is string => typeof entry === 'string').join('\n')
        : '',
    );
    setToolsetsText(
      Array.isArray(localConfig.toolsets)
        ? localConfig.toolsets.filter((entry): entry is string => typeof entry === 'string').join('\n')
        : '',
    );
    setMcpConnectionIdsText(
      Array.isArray(localConfig.mcp_connection_ids)
        ? localConfig.mcp_connection_ids
            .filter((entry): entry is string => typeof entry === 'string')
            .join('\n')
        : '',
    );
  }, [isLocalConfigMode, localConfig]);

  const acceptNativeReadback = useCallback((state: NativeHermesCardView | null) => {
    setNativeHermesState(state);
    setAutomaticLearningDraft(null);
    if (!state) {
      setNativeSoulDraft('');
      setNativeDisabledSkills([]);
      setNativeEnabledToolsets([]);
      setNativeEnabledMcpServers([]);
      setNativeLearningDetail(null);
      setNativeLearningDraft('');
      setNativeLearningStatus('idle');
      setNativeLearningError(null);
      return;
    }
    setMemoryProviderDraft(state.native.honcho ? (state.native.honcho.selected ? 'honcho' : 'builtin') : null);
    setNativeSoulDraft(state.native.soul);
    setNativeDisabledSkills(
      state.native.skills.filter((item) => !item.enabled).map((item) => item.name),
    );
    setNativeEnabledToolsets(
      state.native.toolsets.filter((item) => item.enabled).map((item) => item.name),
    );
    setNativeEnabledMcpServers(
      state.native.mcpServers.filter((item) => item.enabled).map((item) => item.name),
    );
  }, []);

  useEffect(() => {
    if (
      !isLocalConfigMode
      || localConfig?.runtime.kind !== 'hermes'
      || !projectId
      || !deckId
      || !cardId
    ) {
      acceptNativeReadback(null);
      setNativeHermesStatus('idle');
      setNativeHermesError(null);
      return;
    }
    const controller = new AbortController();
    acceptNativeReadback(null);
    setNativeHermesStatus('loading');
    setNativeHermesError(null);
    setNativeLearningDetail(null);
    setNativeLearningDraft('');
    setNativeLearningStatus('idle');
    setNativeLearningError(null);
    void loadNativeHermesCard({ projectId, deckId, cardId, signal: controller.signal })
      .then((state) => {
        if (controller.signal.aborted) return;
        acceptNativeReadback(state);
        setNativeHermesStatus('ready');
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        acceptNativeReadback(null);
        setNativeHermesStatus('failed');
        setNativeHermesError(error instanceof Error ? error.message : 'Native Hermes profile unavailable.');
      });
    return () => controller.abort();
  // Native readback is identity-scoped and deliberately independent from
  // unsaved Card drafts. Card save never mutates the bound profile.
  }, [isLocalConfigMode, projectId, deckId, cardId, acceptNativeReadback]);


  const markDraftDirty = () => {
    draftDirtyRef.current = true;
  };

  const updateScriptDraft = (next: SavedCardScript) => {
    const saved = localConfig?.runtime_options?.script || null;
    const changed = !saved
      ? Boolean(next.source.trim() || next.enabled)
      : next.source !== saved.source || next.enabled !== saved.enabled;
    const nextDraft = {
      ...next,
      version: changed ? Number(saved?.version || 0) + 1 : Number(saved?.version || next.version || 1),
      author: changed ? { kind: 'user', id: 'card-editor' } : (next.author || {}),
      rollback: changed && saved ? {
        version: saved.version,
        sourceHash: saved.sourceHash || '',
        compiledHash: saved.compiledHash || '',
        enabled: saved.enabled,
      } : (next.rollback || {}),
    };
    scriptDraftCacheRef.current.set(cardId, structuredClone(nextDraft));
    if (changed) dirtyScriptCardsRef.current.add(cardId);
    else dirtyScriptCardsRef.current.delete(cardId);
    setScriptDraft(nextDraft);
    markDraftDirty();
  };

  const buildCurrentLocalPayload = useCallback((): AgentManagerLocalConfig => {
    if (!localConfig) throw new Error('card_config_missing');
    const editedConfig = buildActiveAgentManagerLocalConfig({
      runtime: localConfig.runtime,
      provider,
      accessMode,
      modelKey,
      reasoningEffort,
      temperature,
      maxTokens,
      maxTurns,
      promptTemplate: promptPartsTouched ? serializePromptFields(promptParts, promptText) : promptText,
      toolsText,
      skillsText,
      toolsetsText,
      mcpConnectionIdsText,
    });
    return {
      ...localConfig,
      ...editedConfig,
      runtime_options: {
        ...(localConfig.runtime_options || {}),
        toolCatalogPolicy: runtimeKind === 'hermes'
          ? (localConfig.runtime_options?.toolCatalogPolicy === 'all_healthy' ? 'all_healthy' : 'selected')
          : 'selected',
        disabledTools: runtimeKind === 'hermes'
          && localConfig.runtime_options?.toolCatalogPolicy === 'all_healthy'
          ? parseListText(disabledToolsText)
          : [],
        ...(subagentTouched ? { subagentModel } : {}),
        ...(teamTouched ? { team: teamConfig } : {}),
        ...(delegationTouched ? { delegationRole } : {}),
        ...(
          localConfig.runtime_options?.script || scriptDraft.source.trim() || scriptDraft.enabled
            ? { script: scriptDraft }
            : {}
        ),
      },
      role: promptParts.role !== (parsePromptTemplate(localConfig.prompt_template || '').role || String(localConfig.role || ''))
        ? promptParts.role : localConfig.role,
      output_contract: outputExpectationsTouched ? outputExpectations : localConfig.output_contract,
    };
  }, [
    localConfig,
    runtimeKind,
    runtimeMode,
    cardId,
    provider,
    accessMode,
    modelKey,
    subagentModel,
    subagentTouched,
    teamConfig,
    teamTouched,
    delegationRole,
    delegationTouched,
    scriptDraft,
    reasoningEffort,
    temperature,
    maxTokens,
    maxTurns,
    promptParts,
    promptPartsTouched,
    outputExpectations,
    outputExpectationsTouched,
    promptText,
    toolsText,
    disabledToolsText,
    skillsText,
    toolsetsText,
    mcpConnectionIdsText,
  ]);

  const runSaveConfig = useCallback(async () => {
    if (!isLocalConfigMode || !localConfig || !onSaveLocalConfig) return false;
    if (saveCardStatus === 'saving') return false;
    const payload = buildCurrentLocalPayload();
    setSaveCardStatus('saving');
    setSaveCardErrorMessage(null);
    try {
      await Promise.resolve(onSaveLocalConfig(payload));
      draftDirtyRef.current = false;
      setSaveCardStatus('saved');
      return true;
    } catch (error) {
      setSaveCardStatus('failed');
      setSaveCardErrorMessage(
        error instanceof Error && error.message ? error.message : 'Save failed.',
      );
      return false;
    }
  }, [
    isLocalConfigMode,
    localConfig,
    onSaveLocalConfig,
    saveCardStatus,
    buildCurrentLocalPayload,
    openDeckRevision,
  ]);

  const openNativeLearningNode = useCallback(async (nodeId: string) => {
    if (!projectId || !deckId || !cardId) return;
    setNativeLearningStatus('loading');
    setNativeLearningError(null);
    try {
      const detail = await loadNativeHermesLearningDetail({ projectId, deckId, cardId, nodeId });
      setNativeLearningDetail(detail);
      setNativeLearningDraft(learningEditsRef.current.get(nodeId) ?? detail.content);
      setNativeLearningStatus('ready');
    } catch (error) {
      setNativeLearningStatus('failed');
      setNativeLearningError(error instanceof Error ? error.message : 'Native learning node unavailable.');
    }
  }, [projectId, deckId, cardId]);

  const checkNativeMcpServer = useCallback(async (serverName: string) => {
    if (!projectId || !deckId || !cardId) return;
    setNativeMcpChecks((current) => ({
      ...current,
      [serverName]: { status: 'checking', toolCount: 0, error: null },
    }));
    try {
      const result = await testNativeHermesMcp({ projectId, deckId, cardId, serverName });
      setNativeMcpChecks((current) => ({
        ...current,
        [serverName]: {
          status: result.ok ? 'connected' : 'failed',
          toolCount: result.tools.length,
          error: result.error,
        },
      }));
    } catch (error) {
      setNativeMcpChecks((current) => ({
        ...current,
        [serverName]: {
          status: 'failed',
          toolCount: 0,
          error: error instanceof Error ? error.message : 'Connection check failed.',
        },
      }));
    }
  }, [projectId, deckId, cardId]);

  const saveOnCardLeave = useCallback(async (): Promise<boolean> => {
    if (cardSaveInFlightRef.current) return false;
    cardSaveInFlightRef.current = true;
    try {
      if (!(await runSaveConfig())) return false;
      if (nativeHermesState && projectId && deckId && cardId) {
        const profile = nativeHermesState.native;
        const changes: Record<string, unknown> = {};
        if (automaticLearningDraft !== null && profile.backgroundReview
          && automaticLearningDraft !== profile.backgroundReview.enabled) {
          changes.background_review = {
            enabled: automaticLearningDraft,
            provider: profile.backgroundReview.provider,
            model: profile.backgroundReview.model,
            max_input_tokens: profile.backgroundReview.maxInputTokens,
          };
        }
        const sameSet = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
        if (nativeSoulDraft !== profile.soul) changes.soul = nativeSoulDraft;
        if (!sameSet(nativeDisabledSkills, profile.skills.filter((item) => !item.enabled).map((item) => item.name))) {
          changes.disabled_skills = nativeDisabledSkills;
        }
        if (!sameSet(nativeEnabledToolsets, profile.toolsets.filter((item) => item.enabled).map((item) => item.name))) {
          changes.enabled_toolsets = nativeEnabledToolsets;
        }
        if (!sameSet(nativeEnabledMcpServers, profile.mcpServers.filter((item) => item.enabled).map((item) => item.name))) {
          changes.enabled_mcp_servers = nativeEnabledMcpServers;
        }
        if (profile.honcho && memoryProviderDraft !== null
          && memoryProviderDraft !== (profile.honcho.selected ? 'honcho' : 'builtin')) {
          changes.memory_provider = memoryProviderDraft;
        }
        let latestReadback: NativeHermesCardView | null = null;
        for (const [field, value] of Object.entries(changes)) {
          const readback = await applyNativeHermesOperation({ projectId, deckId, cardId,
            change: { method: 'profiles.configure', params: { [field]: value } } });
          latestReadback = readback;
        }
        if (latestReadback) acceptNativeReadback(latestReadback);
        for (const [id, content] of learningEditsRef.current) {
          await applyNativeHermesOperation({ projectId, deckId, cardId,
            change: { method: 'learning.edit', params: { id, content } } });
          learningEditsRef.current.delete(id);
        }
      }
      return true;
    } catch (error) {
      setSaveCardStatus('failed');
      setSaveCardErrorMessage(error instanceof Error ? error.message : 'Could not save Card.');
      return false;
    } finally {
      cardSaveInFlightRef.current = false;
    }
  }, [runSaveConfig, nativeHermesState, projectId, deckId, cardId, nativeSoulDraft,
    nativeDisabledSkills, nativeEnabledToolsets, nativeEnabledMcpServers, memoryProviderDraft,
    automaticLearningDraft, acceptNativeReadback]);

  useEffect(() => {
    registerCardLeave?.(saveOnCardLeave);
    return () => registerCardLeave?.(null);
  }, [registerCardLeave, saveOnCardLeave]);

  const availableModels = provider ? modelsByProvider[provider] || [] : [];
  const subagentCatalogOptions = Object.entries(modelsByProvider).flatMap(([catalogProvider, models]) => (
    models.map((model) => ({ provider: catalogProvider, ...model }))
  ));

  const editorField = (name: string) => cardEditorFields.find((field) => field.name === name);
  const providerField = editorField('provider');
  const accessModeField = editorField('accessMode');
  const modelKeyField = editorField('modelKey');
  const reasoningEffortField = editorField('reasoningEffort');
  const temperatureField = editorField('temperature');
  const maxTokensField = editorField('maxTokens');
  const maxTurnsField = editorField('maxTurns');
  const providerOptions = (providerField?.options || []).filter(
    (option) => (modelsByProvider[option.value] || []).length > 0,
  );
  const accessModeOptions = accessModeField?.options || [];
  const runtimeDictionaryReady = Boolean(
    runtimeOptionsStatus === 'ready'
    && providerField
    && accessModeField
    && modelKeyField
    && reasoningEffortField
    && temperatureField
    && maxTokensField
    && maxTurnsField,
  );
  const completeHealthyCatalog = runtimeKind === 'hermes'
    && localConfig?.runtime_options?.toolCatalogPolicy === 'all_healthy';
  const disabledToolNames = parseListText(disabledToolsText);
  const savedToolNames = parseListText(toolsText);
  const selectedToolRows = buildInputDictionarySelectedRows(
    toolDictionaryPage.selectedKnownReferences,
    toolDictionaryPage.unresolvedSelectedIds,
  );
  const availableToolRows = toolDictionaryPage.references.filter((reference) =>
    !savedToolNames.includes(reference.canonicalId)
    && (!showSelectedToolsOnly || (
      completeHealthyCatalog
        ? reference.access === 'read'
          ? !disabledToolNames.includes(reference.canonicalId)
          : savedToolNames.includes(reference.canonicalId)
        : savedToolNames.includes(reference.canonicalId)
    )),
  );
  const toggleTool = (name: string, checked: boolean, access: 'read' | 'write' = 'write') => {
    if (completeHealthyCatalog && access === 'read') {
      setDisabledToolsText(toggleSavedToolAssignment(disabledToolNames, name, !checked).join('\n'));
    } else {
      setToolsText(toggleSavedToolAssignment(savedToolNames, name, checked).join('\n'));
    }
    markDraftDirty();
  };

  useEffect(() => {
    if (!isLocalConfigMode || !localConfig) return;
    const controller = new AbortController();
    setToolDictionaryBusy(true);
    setToolOptionsError(false);
    const timer = window.setTimeout(() => {
      void (async () => {
        setToolDictionaryBusy(true);
        try {
          const params = new URLSearchParams({
            query: toolDictionaryQuery,
            offset: String(toolDictionaryOffset),
            limit: '100',
          });
          if (toolDictionaryNamespace) params.set('namespace', toolDictionaryNamespace);
          if (!completeHealthyCatalog && savedToolNames.length) params.set('selectedIds', savedToolNames.join(','));
          const response = await fetch(`/api/coder/input-data-dictionary/tools?${params}`, {
            signal: controller.signal,
          });
          const payload = await response.json();
          if (!response.ok || !payload?.ok || !Array.isArray(payload.references)) {
            throw new Error('Tool options unavailable');
          }
          setToolDictionaryPage({
            references: payload.references,
            selectedKnownReferences: Array.isArray(payload.selectedKnownReferences) ? payload.selectedKnownReferences : [],
            unresolvedSelectedIds: Array.isArray(payload.unresolvedSelectedIds) ? payload.unresolvedSelectedIds : [],
            namespaces: Array.isArray(payload.namespaces) ? payload.namespaces : [],
            total: Number.isFinite(payload.total) ? payload.total : 0,
            offset: Number.isFinite(payload.offset) ? payload.offset : toolDictionaryOffset,
            limit: Number.isFinite(payload.limit) ? payload.limit : 100,
            hasMore: payload.hasMore === true,
          });
        } catch (error) {
          if (!controller.signal.aborted) {
            setToolOptionsError(true);
            setToolDictionaryPage((current) => ({
              ...current,
              references: [],
              selectedKnownReferences: [],
              unresolvedSelectedIds: savedToolNames,
              total: 0,
              offset: 0,
              hasMore: false,
            }));
          }
        } finally {
          if (!controller.signal.aborted) setToolDictionaryBusy(false);
        }
      })();
    }, 150);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    isLocalConfigMode,
    localConfig,
    savedToolNames.join('\u0000'),
    disabledToolNames.join('\u0000'),
    completeHealthyCatalog,
    toolDictionaryNamespace,
    toolDictionaryOffset,
    toolDictionaryQuery,
  ]);

  const renderSectionBody = (sectionTab: string) => {
    if (sectionTab === 'Terminal') {
      if (localConfig?.runtime.kind === 'hermes' && localConfig.runtime.mode === 'main' && onOpenMainChat) {
        return <>{terminalContent || null}
          <button type="button" data-testid="open-main-chat" onClick={onOpenMainChat}>
            Open Main chat
          </button>
        </>;
      }
      // The Terminal composer is rendered below the shared Card controls. Keep a
      // concrete section body here so non-Main Cards do not hit the legacy
      // empty-section guard before their real Run controls are mounted.
      return <>{terminalContent || null}</>;
    }
    if (sectionTab === 'Prompt') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {onChangeCardName ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {onChangeCardName ? (
                <div>
                  <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
                    Name
                  </label>
                  <input
                    type="text"
                    value={cardNameDraft}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      setCardNameDraft(nextValue);
                      onChangeCardName(nextValue);
                    }}
                    placeholder="Enter agent name"
                    style={{
                      width: '100%',
                      padding: 8,
                      background: '#2B2B2B',
                      color: '#FFF',
                      border: '1px solid #3A3A3A',
                      borderRadius: 8,
                    }}
                  />
                </div>
              ) : null}

            </div>
          ) : null}
          <div>
            <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
              Role
            </label>
            <textarea
              aria-label="Role"
              value={promptParts.role}
              onChange={(event) => {
                setPromptParts((current) => ({ ...current, role: event.target.value }));
                setPromptPartsTouched(true);
                markDraftDirty();
              }}
              rows={5}
              style={{
                width: '100%',
                padding: 10,
                background: '#2B2B2B',
                color: '#FFF',
                border: '1px solid #3A3A3A',
                borderRadius: 8,
                fontFamily: 'monospace',
                fontSize: 13,
                resize: 'vertical',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
              Goal
            </label>
            <textarea
              aria-label="Goal"
              value={promptParts.goal}
              onChange={(event) => {
                setPromptParts((current) => ({ ...current, goal: event.target.value }));
                setPromptPartsTouched(true);
                markDraftDirty();
              }}
              rows={5}
              style={{
                width: '100%',
                padding: 10,
                background: '#2B2B2B',
                color: '#FFF',
                border: '1px solid #3A3A3A',
                borderRadius: 8,
                fontFamily: 'monospace',
                fontSize: 13,
                resize: 'vertical',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
              Constraints
            </label>
            <textarea
              aria-label="Constraints"
              value={promptParts.constraints}
              onChange={(event) => {
                setPromptParts((current) => ({ ...current, constraints: event.target.value }));
                setPromptPartsTouched(true);
                markDraftDirty();
              }}
              rows={5}
              style={{
                width: '100%',
                padding: 10,
                background: '#2B2B2B',
                color: '#FFF',
                border: '1px solid #3A3A3A',
                borderRadius: 8,
                fontFamily: 'monospace',
                fontSize: 13,
                resize: 'vertical',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
              Input schema
            </label>
            <textarea
              aria-label="Input schema"
              value={promptParts.ioSchema}
              onChange={(event) => {
                setPromptParts((current) => ({ ...current, ioSchema: event.target.value }));
                setPromptPartsTouched(true);
                markDraftDirty();
              }}
              rows={5}
              style={{
                width: '100%',
                padding: 10,
                background: '#2B2B2B',
                color: '#FFF',
                border: '1px solid #3A3A3A',
                borderRadius: 8,
                fontFamily: 'monospace',
                fontSize: 13,
                resize: 'vertical',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
              Output expectations
            </label>
            <textarea
              aria-label="Output expectations"
              value={outputExpectations}
              onChange={(event) => {
                setOutputExpectations(event.target.value);
                setOutputExpectationsTouched(true);
                markDraftDirty();
              }}
              rows={5}
              style={{
                width: '100%',
                padding: 10,
                background: '#2B2B2B',
                color: '#FFF',
                border: '1px solid #3A3A3A',
                borderRadius: 8,
                fontFamily: 'monospace',
                fontSize: 13,
                resize: 'vertical',
              }}
            />
          </div>

        </div>
      );
    }
    if (sectionTab === 'Script' && localConfig) {
      return (
        <CardScriptEditor
          cardId={cardId}
          runtimeKind={localConfig.runtime.kind}
          script={scriptDraft}
          toolCatalogPolicy={runtimeKind === 'hermes'
            ? (localConfig?.runtime_options?.toolCatalogPolicy === 'all_healthy' ? 'all_healthy' : 'selected')
            : 'selected'}
          selectedTools={savedToolNames}
          disabledTools={disabledToolNames}
          onChange={updateScriptDraft}
        />
      );
    }

    if (sectionTab === 'Skills') {
      return (
        <section
          data-testid="native-learning-graph"
          style={{ display: 'grid', gap: 12, padding: 10, border: '1px solid #3A4A4F', borderRadius: 8, background: '#202827' }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
            <div>
              <div style={{ color: '#E0DED5', fontSize: 12, fontWeight: 600 }}>Skills</div>
            </div>

          </div>
          {runtimeKind !== 'hermes' ? (
            <div role="status" style={{ color: '#91A9B8', fontSize: 11 }}>
              SkillGraph is available only for Cards bound to a native Hermes profile.
            </div>
          ) : nativeHermesStatus === 'failed' ? (
            <div role="alert" style={{ color: '#FFA2A2', fontSize: 11 }}>
              {nativeHermesError || 'Native profile learning is unavailable.'}
            </div>
          ) : nativeHermesState ? (
            <>
              <section aria-label="Skills">

                <div style={{ display: 'grid', gap: 5, marginTop: 8 }}>
                  {nativeHermesState.native.skills.map((skill) => {
                    const enabled = !nativeDisabledSkills.includes(skill.name);
                    return (
                      <label key={skill.name} style={{ color: '#B8C8CD', fontSize: 11 }}>
                        <input
                          type="checkbox"
                          checked={enabled}
                          onChange={(event) => setNativeDisabledSkills((current) => (
                            event.target.checked
                              ? current.filter((name) => name !== skill.name)
                              : Array.from(new Set([...current, skill.name]))
                          ))}
                        />{' '}
                        {skill.name}
                      </label>
                    );
                  })}

                </div>
              </section>
              {nativeHermesState.native.backgroundReview ? (
                <label style={{ color: '#B8C8CD', fontSize: 12 }}>
                  <input type="checkbox" aria-label="Automatic learning"
                    checked={automaticLearningDraft ?? nativeHermesState.native.backgroundReview.enabled}
                    onChange={(event) => setAutomaticLearningDraft(event.target.checked)} />{' '}
                  Automatic learning
                </label>
              ) : null}
              <HermesSkillGraph graph={nativeHermesState.native.learning.graph}
                profile={nativeHermesState.binding.profile}
                onOpenNode={(id) => void openNativeLearningNode(id)} />
              {runtimeMode === 'main' && nativeHermesState.native.honcho ? (
                <section
                  data-testid="main-honcho-status"
                  style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', padding: 8, border: '1px solid #42565C', borderRadius: 6 }}
                >
                  <div style={{ display: 'grid', gap: 3 }}>
                    <strong style={{ color: '#D5E4E8', fontSize: 11.5 }}>Memory</strong>
                    <span style={{ color: '#80969F', fontSize: 10.5 }}>
                      {nativeHermesState.native.honcho.configurationStatus === 'not_configured'
                        ? 'Not configured'
                        : nativeHermesState.native.honcho.connectionStatus === 'configured_unreachable'
                          ? 'Configured but unreachable'
                          : nativeHermesState.native.honcho.connectionStatus === 'connected'
                            ? 'Connected'
                            : 'Configured; connection not checked'}
                    </span>

                  </div>
                  <select
                    aria-label="Memory provider"
                    value={memoryProviderDraft || 'builtin'}
                    onChange={(event) => setMemoryProviderDraft(event.target.value as 'builtin' | 'honcho')}
                  >
                    <option value="builtin">Built-in only</option>
                    <option value="honcho">External</option>
                  </select>
                </section>
              ) : null}

              {nativeLearningStatus === 'loading' ? <div style={{ color: '#80969F' }}>Opening native node…</div> : null}
              {nativeLearningStatus === 'failed' ? (
                <div role="alert" style={{ color: '#FFA2A2' }}>{nativeLearningError}</div>
              ) : null}
              {nativeLearningDetail ? (
                <section style={{ display: 'grid', gap: 6, padding: 8, border: '1px solid #42565C', borderRadius: 6 }}>
                  <strong>{nativeLearningDetail.kind}: {nativeLearningDetail.label}</strong>
                  <textarea
                    aria-label="Native learning node content"
                    value={nativeLearningDraft}
                    onChange={(event) => {
                      setNativeLearningDraft(event.target.value);
                      learningEditsRef.current.set(nativeLearningDetail.id, event.target.value);
                    }}
                    rows={10}
                    style={{ width: '100%', minWidth: 0, padding: 10, background: '#161A1B', color: '#D5E4E8', border: '1px solid #42565C', borderRadius: 6, fontFamily: 'monospace', fontSize: 12, resize: 'vertical' }}
                  />
                </section>
              ) : null}
            </>
          ) : (
            <div role="status" style={{ color: '#80969F', fontSize: 11 }}>Loading…</div>
          )}
        </section>
      );
    }

    if (sectionTab === 'Soul') {
      return <>
          {runtimeKind === 'hermes' && nativeHermesState ? (
            <section
              data-testid="agent-profile-soul"
              style={{ display: 'grid', gap: 10, padding: 10, border: '1px solid #3A4A4F', borderRadius: 8, background: '#202827' }}
            >

              <div>
                <label htmlFor="card-prompt-soul" style={{ color: '#D5E4E8', fontSize: 11.5 }}>Soul</label>
                <div style={{ display: 'grid', gap: 7, marginTop: 8 }}>
                  <textarea
                    id="card-prompt-soul"
                    aria-label="Soul"
                    value={nativeSoulDraft}
                    onChange={(event) => setNativeSoulDraft(event.target.value)}
                    rows={10}
                    style={{ width: '100%', minWidth: 0, padding: 10, background: '#161A1B', color: '#D5E4E8', border: '1px solid #42565C', borderRadius: 6, fontFamily: 'monospace', fontSize: 12, resize: 'vertical' }}
                  />
                </div>
              </div>
            </section>
          ) : null}
      </>;
    }

    if (sectionTab === 'Knowledge') {
      return (
        <div data-testid="agent-manager-knowledge" style={{ display: 'grid', gap: 10 }}>
          {runInputs && (!runInputs.available || Number(runInputs.idf?.actualGraphData?.recordCounts?.total || 0) > 0) ? (
            <section
              data-testid="selected-run-idf-graph"
              style={{ display: 'grid', gap: 8, padding: 10, border: '1px solid #3A4A4F', borderRadius: 8, background: '#1D2526' }}
            >
              <strong style={{ color: '#D5E4E8', fontSize: 12 }}>
                Graph data
              </strong>
              {runInputs.available && runInputs.idf ? (
                <>
                  <div style={{ color: '#80969F', fontSize: 10.5 }}>
                    {Number(runInputs.idf.actualGraphData?.recordCounts?.total || 0)} records · {' '}
                    {Array.isArray(runInputs.idf.actualGraphData?.authorities) && runInputs.idf.actualGraphData.authorities.length > 0
                      ? runInputs.idf.actualGraphData.authorities.join(', ')
                      : 'no graph authority selected'}
                  </div>
                  <div data-testid="selected-run-idf-graph-token-estimate" style={{ color: '#9FB2B8', fontSize: 10.5 }}>
                    {Number(runInputs.inputSummary?.estimatedGraphContextTokens || 0).toLocaleString()} estimated tokens
                  </div>
                  <details>
                    <summary style={{ cursor: 'pointer', color: '#B8C8CD', fontSize: 11 }}>
                      Data
                    </summary>
                    <pre style={{ margin: '8px 0 0', padding: 8, maxHeight: 300, overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', background: '#161A1B', color: '#C7D7DC', fontSize: 10 }}>
                      {JSON.stringify(runInputs.idf.actualGraphData, null, 2)}
                    </pre>
                  </details>
                </>
              ) : (
                <div role="status" style={{ color: '#80969F', fontSize: 11 }}>
                  {runInputs.message || 'Input files unavailable for this Run'}
                </div>
              )}
            </section>
          ) : null}
          {knowledgeGraphProjection.nodes.length > 0 ? (
            <div
              data-testid={knowledgeProjectionIsMaterialized
                ? 'knowledge-model-bound-projection'
                : 'knowledge-loaded-projection'}
              style={{ height: 300, minHeight: 240, border: '1px solid #3A4A4F', borderRadius: 8, overflow: 'hidden' }}
            >
              <NativeGraphProjectionSurface
                projection={knowledgeGraphProjection}
                status="ready"
                error={null}
                authority="knowgraph"
              />
            </div>
          ) : null}
          {loadedGraphContext.map((item, index) => (
            <section
              key={`${item.reference.authority}:${item.reference.nativeId}`}
              style={{ display: 'grid', gap: 6, padding: 10, border: '1px solid #3A4A4F', borderRadius: 8 }}
            >
              <strong style={{ color: item.ready ? '#8FD1B8' : '#FFB6A2' }}>
                {item.reference.authority}:{item.reference.nativeId} · {item.ready ? 'ready' : 'not ready'}
              </strong>
              <div style={{ color: '#B8C8CD', fontSize: 11.5 }}>{item.reference.reason}</div>
              <div style={{ color: '#80969F', fontSize: 10.5 }}>
                {item.reference.required ? 'required' : 'optional'} · order {item.reference.order} · depth {item.reference.boundedExpansion} · result limit {item.reference.resultLimit}
                {item.resolvedReferences.some((reference) => reference.truncated === true) ? ' · truncated' : ''}
                {item.observedAt ? ` · observed ${item.observedAt}` : ''}
              </div>
              {item.error ? <div role="alert" style={{ color: '#FFA2A2', fontSize: 11 }}>{item.error}</div> : null}
              {item.resolvedReferences.map((reference, index) => (
                <div key={`${item.reference.nativeId}-resolved-${index}`} style={{ color: '#9FB2B8', fontSize: 10.5 }}>
                  provenance: {String(reference.provenance || reference.nativeKind || 'native graph')}
                </div>
              ))}
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  disabled={index === 0}
                  onClick={() => onMoveGraphReference?.(
                    item.reference.authority,
                    item.reference.nativeId,
                    -1,
                  )}
                  aria-label={`Move ${item.reference.nativeId} earlier`}
                >
                  Earlier
                </button>
                <button
                  type="button"
                  disabled={index === loadedGraphContext.length - 1}
                  onClick={() => onMoveGraphReference?.(
                    item.reference.authority,
                    item.reference.nativeId,
                    1,
                  )}
                  aria-label={`Move ${item.reference.nativeId} later`}
                >
                  Later
                </button>
                <button
                  type="button"
                  onClick={() => onRemoveGraphReference?.(
                    item.reference.authority,
                    item.reference.nativeId,
                  )}
                  aria-label={`Remove ${item.reference.nativeId}`}
                >
                  Remove
                </button>
              </div>
            </section>
          ))}
        </div>
      );
    }

    if (sectionTab === 'Runtime') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {!runtimeDictionaryReady ? (
            <div role={runtimeOptionsStatus === 'loading' ? 'status' : 'alert'} style={{ color: '#E0DED5', fontSize: 12 }}>
              {runtimeOptionsStatus === 'loading'
                ? 'Loading runtime options… Saved values are unchanged.'
                : 'Runtime options unavailable. Saved values are unchanged.'}
            </div>
          ) : null}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <>
                <div>
                  <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
                    Provider
                  </label>
                  <select
                    aria-label="Provider"
                    disabled={!runtimeDictionaryReady}
                    value={provider}
                    onChange={(event) => {
                      setProvider(event.target.value as typeof provider);
                      markDraftDirty();
                    }}
                  >
                    <option value="">Unset</option>
                    {provider && !providerOptions.some((option) => option.value === provider) ? (
                      <option value={provider}>{provider} (unavailable — saved)</option>
                    ) : null}
                    {providerOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
                    Access mode
                  </label>
                  <select
                    data-testid="agent-access-mode"
                    aria-label="Access mode"
                    disabled={!runtimeDictionaryReady}
                    value={accessMode}
                    onChange={(event) => {
                      setAccessMode(event.target.value as typeof accessMode);
                      markDraftDirty();
                    }}
                  >
                    <option value="">Select access mode</option>
                    {accessMode && !accessModeOptions.some((option) => option.value === accessMode) ? (
                      <option value={accessMode}>{accessMode} (saved)</option>
                    ) : null}
                    {accessModeOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
                    Model
                  </label>
                  <select
                    aria-label="Model"
                    disabled={!runtimeDictionaryReady}
                    value={modelKey}
                    onChange={(event) => {
                      setModelKey(event.target.value);
                      markDraftDirty();
                    }}
                  >
                    <option value="">Select model</option>
                    {modelKey && !availableModels.some((model) => model.key === modelKey) ? (
                      <option value={modelKey}>{modelKey} (unavailable — saved)</option>
                    ) : null}
                    {availableModels.map((model) => (
                      <option key={model.key} value={model.key}>{model.label}</option>
                    ))}
                  </select>
                  {runtimeDictionaryReady && !availableModels.length ? (
                    <div role="status" style={{ color: '#80969F', fontSize: 11 }}>
                      No configured models available for this provider. Saved selection is unchanged.
                    </div>
                  ) : null}
                </div>
              </>

            {runtimeKind !== 'hermes' ? <div>
              <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
                Reasoning effort
              </label>
              <select
                aria-label="Reasoning effort"
                disabled={!runtimeDictionaryReady}
                value={reasoningEffort}
                onChange={(event) => {
                  setReasoningEffort(
                    event.target.value as 'low' | 'medium' | 'high' | 'xhigh' | '',
                  );
                  markDraftDirty();
                }}
                style={{
                  width: '100%',
                  padding: 8,
                  background: '#2B2B2B',
                  color: '#FFF',
                  border: '1px solid #3A3A3A',
                  borderRadius: 8,
                }}
              >
                <option value="">Model default</option>
                {reasoningEffort && !reasoningEffortField?.options?.some((option) => option.value === reasoningEffort) ? (
                  <option value={reasoningEffort}>{reasoningEffort} (saved)</option>
                ) : null}
                {(reasoningEffortField?.options || []).map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div> : null}
          </div>
          {runtimeKind !== 'hermes' ? <>
            <div style={{ color: '#E0DED5', fontSize: 12, fontWeight: 600 }}>
              Advanced runtime
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <div>
              <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
                Temperature
              </label>
              <input
                aria-label="Temperature"
                disabled={!runtimeDictionaryReady}
                type="number"
                min={temperatureField?.minimum}
                max={temperatureField?.maximum}
                step={temperatureField?.step}
                value={temperature}
                onChange={(event) => {
                  setTemperature(event.target.value === '' ? '' : event.target.valueAsNumber);
                  markDraftDirty();
                }}
              />
              </div>
              <div>
              <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
                Max tokens
              </label>
              <input
                aria-label="Max tokens"
                disabled={!runtimeDictionaryReady}
                type="number"
                min={maxTokensField?.minimum}
                max={maxTokensField?.maximum}
                step={maxTokensField?.step}
                value={maxTokens}
                onChange={(event) => {
                  setMaxTokens(event.target.value === '' ? '' : event.target.valueAsNumber);
                  markDraftDirty();
                }}
              />
              </div>
              <div>
              <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
                Max turns
              </label>
              <input
                aria-label="Max turns"
                disabled={!runtimeDictionaryReady}
                type="number"
                min={maxTurnsField?.minimum}
                max={maxTurnsField?.maximum}
                step={maxTurnsField?.step}
                value={maxTurns}
                onChange={(event) => {
                  setMaxTurns(event.target.value === '' ? '' : event.target.valueAsNumber);
                  markDraftDirty();
                }}
              />
              </div>
            </div>
          </> : null}

        </div>
      );
    }

    if (sectionTab === 'Tools') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ color: '#E0DED5', fontSize: 12, fontWeight: 600 }}>
            Tools
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
            <input
              value={toolDictionaryQuery}
              onChange={(event) => {
                setToolDictionaryQuery(event.target.value);
                setToolDictionaryOffset(0);
              }}
              placeholder="Search ID, name, namespace, or description"
              aria-label="Search tools"
            />
            <select
              value={toolDictionaryNamespace}
              onChange={(event) => {
                setToolDictionaryNamespace(event.target.value);
                setToolDictionaryOffset(0);
              }}
              aria-label="Filter tools by namespace"
            >
              <option value="">All namespaces</option>
              {toolDictionaryPage.namespaces.map((namespace) => (
                <option key={namespace} value={namespace}>{namespace}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ color: '#91A9B8', fontSize: 11 }}>
              <input
                type="checkbox"
                checked={showSelectedToolsOnly}
                onChange={(event) => setShowSelectedToolsOnly(event.target.checked)}
              />{' '}
              Selected only
            </label>
            <button
              type="button"
              disabled={completeHealthyCatalog ? !disabledToolNames.length : !savedToolNames.length}
              onClick={() => {
                if (completeHealthyCatalog) setDisabledToolsText('');
                else setToolsText('');
                markDraftDirty();
              }}
            >
              {completeHealthyCatalog ? 'Enable all healthy' : 'Clear selected'}
            </button>
            <span style={{ color: '#80969F', fontSize: 11 }}>
              {toolDictionaryBusy ? 'Loading tools…' : !toolOptionsError ? `${toolDictionaryPage.total.toLocaleString()} tools` : null}
            </span>
          </div>
          {toolOptionsError ? (
            <div role="alert" style={{ color: '#FFA2A2', fontSize: 11 }}>
              Tool options unavailable. Saved selections are unchanged.
            </div>
          ) : null}
          {selectedToolRows.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ color: '#E0DED5', fontSize: 12, fontWeight: 600 }}>
                Selected · {selectedToolRows.length}
              </div>
              {selectedToolRows.map((tool) => (
                <label
                  key={tool.name}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '18px 1fr',
                    gap: 8,
                    alignItems: 'start',
                    padding: '7px 8px',
                    border: '1px solid #3A4A4F',
                    borderRadius: 6,
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={savedToolNames.includes(tool.name)}
                    onChange={(event) => {
                      if (!event.target.checked || tool.availability === 'available') {
                        toggleTool(tool.name, event.target.checked);
                      }
                    }}
                    aria-label={`Include ${tool.title || tool.name}`}
                  />
                  <span>
                    <span title={tool.description} style={{ display: 'block', color: '#D5E4E8', fontSize: 11 }}>
                      {tool.title || tool.name}
                    </span>
                    <span style={{ display: 'block', color: '#80969F', fontSize: 10 }}>
                      {tool.availability === 'stale' ? ' · Unavailable in current catalog' : ''}
                      {tool.availability === 'disabled' ? ' · Currently unavailable' : ''}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          ) : null}
          {!showSelectedToolsOnly && availableToolRows.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ color: '#E0DED5', fontSize: 12, fontWeight: 600 }}>
                {completeHealthyCatalog ? 'Catalog' : 'Available'}
              </div>
              {availableToolRows.map((tool) => (
                <label
                  key={tool.canonicalId}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '18px 1fr',
                    gap: 8,
                    alignItems: 'start',
                    padding: '7px 8px',
                    border: '1px solid #3A4A4F',
                    borderRadius: 6,
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={completeHealthyCatalog && (
                      tool.access === 'read'
                        ? !disabledToolNames.includes(tool.canonicalId)
                        : savedToolNames.includes(tool.canonicalId)
                    )}
                    disabled={tool.availability !== 'available'}
                    onChange={(event) => toggleTool(tool.canonicalId, event.target.checked, tool.access)}
                    aria-label={`Include ${tool.displayName || tool.canonicalId}`}
                  />
                  <span>
                    <span title={tool.shortDescription} style={{ display: 'block', color: '#D5E4E8', fontSize: 11 }}>
                      {tool.displayName || tool.canonicalId}
                    </span>
                    <span style={{ display: 'block', color: '#80969F', fontSize: 10 }}>
                      {tool.availability !== 'available' ? ' · Unavailable in current catalog' : ''}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          ) : !selectedToolRows.length && !toolDictionaryBusy && !toolOptionsError ? (
            <div style={{ color: '#91A9B8', fontSize: 11 }}>
              {showSelectedToolsOnly
                ? 'No tools are selected for this card.'
                : 'No tools match this search.'}
            </div>
          ) : null}
          {!showSelectedToolsOnly && !toolDictionaryBusy && !toolOptionsError ? (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <button
                type="button"
                disabled={toolDictionaryOffset <= 0}
                onClick={() => setToolDictionaryOffset(Math.max(0, toolDictionaryOffset - 100))}
              >
                Previous
              </button>
              <span style={{ color: '#80969F', fontSize: 11 }}>
                {toolDictionaryPage.total
                  ? `${toolDictionaryPage.offset + 1}-${Math.min(toolDictionaryPage.offset + toolDictionaryPage.limit, toolDictionaryPage.total)}`
                  : '0'}
              </span>
              <button
                type="button"
                disabled={!toolDictionaryPage.hasMore}
                onClick={() => setToolDictionaryOffset(toolDictionaryPage.offset + toolDictionaryPage.limit)}
              >
                Next
              </button>
            </div>
          ) : null}
          {runtimeKind !== 'hermes' ? <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 8 }}>
            <div>
              <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
                Card skill grants
              </label>
              <textarea
                aria-label="Card skill grants"
                value={skillsText}
                onChange={(event) => {
                  setSkillsText(event.target.value);
                  markDraftDirty();
                }}
                placeholder="One skill ID per line"
                rows={4}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
                Card toolset grants
              </label>
              <textarea
                aria-label="Card toolset grants"
                value={toolsetsText}
                onChange={(event) => {
                  setToolsetsText(event.target.value);
                  markDraftDirty();
                }}
                placeholder="One toolset ID per line"
                rows={4}
              />
            </div>
          </div> : null}
          <div>
            <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
              Card connection references
            </label>
            <textarea
              aria-label="Card connection references"
              value={mcpConnectionIdsText}
              onChange={(event) => {
                setMcpConnectionIdsText(event.target.value);
                markDraftDirty();
              }}
              placeholder="One configured connection ID per line"
              rows={4}
            />

          </div>
          {runtimeKind === 'hermes' && nativeHermesState ? (
            <section
              data-testid="agent-native-capabilities"
              style={{
                display: 'grid',
                gap: 8,
                padding: '10px 12px',
                border: '1px solid #3A4A4F',
                borderRadius: 8,
                background: '#202827',
              }}
            >


              <details>
                <summary style={{ cursor: 'pointer', color: '#D5E4E8', fontSize: 11.5 }}>
                  Toolsets · {nativeEnabledToolsets.length} enabled
                </summary>
                <div style={{ display: 'grid', gap: 5, marginTop: 8 }}>
                  {nativeHermesState.native.toolsets.map((toolset) => (
                    <label key={toolset.name} style={{ color: '#B8C8CD', fontSize: 11 }}>
                      <input
                        type="checkbox"
                        checked={nativeEnabledToolsets.includes(toolset.name)}
                        onChange={(event) => setNativeEnabledToolsets((current) => (
                          event.target.checked
                            ? Array.from(new Set([...current, toolset.name]))
                            : current.filter((name) => name !== toolset.name)
                        ))}
                      />{' '}
                      {toolset.label || toolset.name}{typeof toolset.tool_count === 'number' ? ` · ${toolset.tool_count} tools` : ''}
                    </label>
                  ))}
                </div>
              </details>
              {nativeHermesState.native.mcpServers.length ? nativeHermesState.native.mcpServers.map((server) => {
                const checked = nativeMcpChecks[server.name];
                return (
                  <div
                    key={server.name}
                    style={{
                      display: 'grid',
                      gap: 5,
                      padding: '8px 9px',
                      border: '1px solid #344542',
                      borderRadius: 6,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <label style={{ color: '#D5E4E8', fontSize: 11.5 }}>
                        <input
                          type="checkbox"
                          checked={nativeEnabledMcpServers.includes(server.name)}
                          onChange={(event) => setNativeEnabledMcpServers((current) => (
                            event.target.checked
                              ? Array.from(new Set([...current, server.name]))
                              : current.filter((name) => name !== server.name)
                          ))}
                        />{' '}
                        {server.name} · {server.credentialStatus.replace('_', ' ')}
                      </label>
                      <button
                        type="button"
                        onClick={() => void checkNativeMcpServer(server.name)}
                        disabled={!server.enabled || checked?.status === 'checking'}
                      >
                        {checked?.status === 'checking' ? 'Checking…' : 'Check connection'}
                      </button>
                    </div>
                    <div style={{ color: '#80969F', fontSize: 10.5 }}>
                      {server.transport}
                      {server.toolFilter.length ? ` · ${server.toolFilter.join(', ')}` : ''}
                    </div>
                    {checked ? (
                      <div style={{ color: checked.status === 'connected' ? '#72D7C7' : checked.status === 'failed' ? '#FFA2A2' : '#80969F', fontSize: 10.5 }}>
                        {checked.status === 'connected'
                          ? `Connected · ${checked.toolCount} native tools discovered`
                          : checked.status === 'failed'
                            ? checked.error || 'Connection failed.'
                            : 'Checking connection…'}
                      </div>
                    ) : null}
                  </div>
                );
              }) : (
                <div style={{ color: '#80969F', fontSize: 11 }}>No native MCP connections are configured.</div>
              )}
            </section>
          ) : null}
        </div>
      );
    }

    return null;
  };

  const sectionBody = activeTab === 'CLI'
    ? renderSectionBody('Terminal')
    : activeTab === 'Prompt'
      ? (
          <div data-testid="agent-manager-prompt-surface" style={{ display: 'grid', gap: 16 }}>
            <section aria-label="Prompt configuration">{renderSectionBody('Prompt')}</section>
            {renderSectionBody('Soul')}
          </div>
        )
      : activeTab === 'Runtime'
        ? (
            <div data-testid="agent-manager-runtime-surface" style={{ display: 'grid', gap: 16 }}>
              <section aria-label="Runtime configuration">{renderSectionBody('Runtime')}</section>
              {runtimeKind === 'hermes' ? (
                <label style={{ display: 'grid', gap: 6, color: '#D5E4E8', fontSize: 12 }}>
                  Subagent model
                  <select
                    aria-label="Subagent model"
                    value={`${subagentModel.provider}\u0000${subagentModel.modelKey}`}
                    onChange={(event) => {
                      const [selectedProvider, selectedKey] = event.target.value.split('\u0000');
                      const selected = subagentCatalogOptions.find((option) => (
                        option.provider === selectedProvider && option.key === selectedKey
                      ));
                      if (!selected) return;
                      setSubagentTouched(true);
                      setSubagentModel({
                        provider: selectedProvider,
                        accessMode: subagentAccessMode(selectedProvider),
                        modelKey: selected.key,
                        providerModelId: selected.providerModelId,
                      });
                      markDraftDirty();
                    }}
                  >
                    {!subagentCatalogOptions.some((option) => option.provider === subagentModel.provider
                      && option.key === subagentModel.modelKey) ? (
                      <option value={`${subagentModel.provider}\u0000${subagentModel.modelKey}`}>
                        {subagentModel.providerModelId} (unavailable — saved)
                      </option>
                    ) : null}
                    {subagentCatalogOptions.map((option) => (
                      <option key={`${option.provider}:${option.key}`} value={`${option.provider}\u0000${option.key}`}>
                        {option.provider} · {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {runtimeKind === 'hermes' ? (
                <label style={{ display: 'grid', gap: 6, color: '#D5E4E8', fontSize: 12 }}>
                  Delegate task
                  <select aria-label="Delegate task" value={delegationRole}
                    disabled={!editorField('delegationRole')?.options?.length}
                    onChange={(event) => {
                      const next = event.target.value as NonNullable<AgentCardRuntimeOptions['delegationRole']>;
                      setDelegationRole(next);
                      setDelegationTouched(true);
                      setTeamConfig((current) => ({ ...current, mode: next === 'team' ? 'auto' : 'off' }));
                      setTeamTouched(true);
                      markDraftDirty();
                    }}>
                    {editorField('delegationRole')?.options?.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
              ) : null}
              {localConfig && delegationRole === 'team' ? (
                <CardSubagentsTab
                  runtime={localConfig.runtime}
                  team={teamConfig}
                  fields={cardEditorFields}
                  modelOptions={subagentCatalogOptions}
                  onChange={(next) => {
                    setTeamTouched(true);
                    setTeamConfig(next);
                    markDraftDirty();
                  }}
                />
              ) : null}
            </div>
          )
        : activeTab === 'Memory'
          ? (
              <div data-testid="agent-manager-knowledge-surface" style={{ display: 'grid', gap: 16 }}>
                <section aria-label="Skills and memory">{renderSectionBody('Skills')}</section>
        {activeTab === 'Memory' && runInputs ? (
          <details
            data-testid="selected-run-idf"
            style={{ display: 'grid', gap: 8, padding: 10, border: '1px solid #3A4A4F', borderRadius: 8, background: '#1D2526' }}
          >
            <summary style={{ color: '#D5E4E8', fontSize: 12, cursor: 'pointer' }}>Input</summary>
            {runInputs.available && runInputs.idf && runInputs.idfText != null ? (
              <>
                <div style={{ color: '#80969F', fontSize: 10.5 }}>
                  {Number(runInputs.inputSummary?.idfBytes || 0).toLocaleString()} UTF-8 bytes · estimated {' '}
                  {Number(runInputs.inputSummary?.estimatedModelVisibleTokens || 0).toLocaleString()} supplied text tokens
                </div>
                <div data-testid="selected-run-token-estimate" style={{ color: '#9FB2B8', fontSize: 10.5, lineHeight: 1.5 }}>
                  system {Number(runInputs.inputSummary?.estimatedSystemContextTokens || 0).toLocaleString()} · {' '}
                  task {Number(runInputs.inputSummary?.estimatedTaskTokens || 0).toLocaleString()} · {' '}
                  output {Number(runInputs.inputSummary?.estimatedOutputContractTokens || 0).toLocaleString()} · {' '}
                  graph {Number(runInputs.inputSummary?.estimatedGraphContextTokens || 0).toLocaleString()}
                  <br />
                  Estimate: UTF-8 bytes ÷ 4, rounded up.
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" onClick={() => void exportRuntimeInput('.idf', runInputs.idfText || '')}>
                    Export Run input…
                  </button>
                </div>
                {inputFileTransferError ? (
                  <div role="alert" style={{ color: '#FFA2A2', fontSize: 10.5 }}>
                    {inputFileTransferError}
                  </div>
                ) : null}
                <details>
                  <summary style={{ cursor: 'pointer', color: '#B8C8CD', fontSize: 11 }}>
                    Inspect exact Run input JSON
                  </summary>
                  <pre style={{ margin: '8px 0 0', padding: 8, maxHeight: 300, overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', background: '#161A1B', color: '#C7D7DC', fontSize: 10 }}>
                    {runInputs.idfText}
                  </pre>
                </details>
              </>
            ) : (
              <div role="status" style={{ color: '#80969F', fontSize: 11 }}>
                {runInputs.message || 'Input files unavailable for this Run'}
              </div>
            )}
          </details>
        ) : null}
              </div>
            )
          : activeTab === 'Tools'
            ? (
                <div data-testid="agent-manager-tools-surface" style={{ display: 'grid', gap: 16 }}>
                  {renderSectionBody('Tools')}
                  {renderSectionBody('Script')}
                </div>
              )
            : null;

  if (!isLocalConfigMode || !localConfig || !onSaveLocalConfig) {
    return (
      <div
        style={{
          padding: '12px 14px',
          borderRadius: 8,
          border: '1px solid #3A3A3A',
          background: '#1F1F1F',
          color: '#E0DED5',
          fontSize: 12,
        }}
      >
        Select a saved Card to edit its configuration.
      </div>
    );
  }

  if (!sectionBody) {
    return null;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, colorScheme: 'dark' }}>
      {sectionBody}

      <div
        style={{
          display: activeTab === 'CLI' || saveCardStatus === 'failed' ? 'flex' : 'none',
          flexDirection: 'column',
          gap: 10,
          padding: '10px 12px',
          borderRadius: 8,
          border: '1px solid #3A4A4F',
          background: '#222625',
        }}
      >
          {saveCardStatus === 'failed' && saveCardErrorMessage ? (
            <span role="alert" data-testid="agent-manager-save-error" style={{ color: '#FFA2A2', fontSize: 11.5 }}>
              {saveCardErrorMessage}
            </span>
          ) : null}

        {activeTab === 'CLI' && showTaskComposer ? <AdaptiveCardTerminal
          enabled={adaptiveTerminal} projectId={projectId} deckId={deckId} cardId={cardId}
          runtime={localConfig.runtime} run={runResult} busy={runBusy}
          onStop={onStopCard} onRejoin={onRejoinCard}
        ><div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ color: '#E0DED5', fontSize: 12, fontWeight: 600 }}>Dynamic context / input</label>
          <textarea
            aria-label="Dynamic context / input"
            value={promptTestInput || ''}
            onChange={(event) => onChangePromptTestInput?.(event.target.value)}
            rows={5}
            style={{
              width: '100%',
              padding: 10,
              background: '#2B2B2B',
              color: '#FFF',
              border: '1px solid #3A3A3A',
              borderRadius: 8,
              fontFamily: 'monospace',
              fontSize: 12,
              resize: 'vertical',
            }}
          />

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={onClearInvocation}
              disabled={runBusy || (!String(promptTestInput || '').trim() && loadedGraphContext.length === 0)}
              data-testid="agent-manager-clear-invocation"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={async () => { if (await saveOnCardLeave()) onRunCard?.(); }}
              disabled={runDisabled || runBusy || !String(promptTestInput || '').trim()}
              aria-busy={runBusy}
              data-testid="agent-manager-run"
              style={{
                padding: '8px 14px',
                background: runBusy ? '#3A3A3A' : '#4FA2AD',
                color: '#FFF',
                border: '1px solid #3A4A4F',
                borderRadius: 8,
                cursor:
                  runDisabled || runBusy || !String(promptTestInput || '').trim()
                    ? 'not-allowed'
                    : 'pointer',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {runBusy ? 'Running…' : 'Run'}
            </button>
            {onLearnCard ? (
              <button
                type="button"
                onClick={async () => { if (await saveOnCardLeave()) onLearnCard?.(); }}
                disabled={runDisabled || runBusy || !String(promptTestInput || '').trim()}
                data-testid="agent-manager-learn"
              >
                Learn
              </button>
            ) : null}
            {runBusy && onStopCard ? (
              <button type="button" onClick={onStopCard} data-testid="agent-manager-stop">
                Stop
              </button>
            ) : null}
            {!adaptiveTerminal && !runBusy && runResult?.runId && onRejoinCard ? (
              <button type="button" onClick={onRejoinCard} data-testid="agent-manager-rejoin">
                Rejoin
              </button>
            ) : null}
          </div>
        </div></AdaptiveCardTerminal> : null}



        {activeTab === 'CLI' && runResult && !adaptiveTerminal && cardKind !== 'agent' ? (
          <div
            data-testid="agent-manager-run-result"
            style={{ display: 'grid', gap: 6, fontSize: 11.5 }}
          >
            <div style={{ color: '#D5E4E8' }}>
              Status: {runResult.status || 'completed'}
            </div>
            {runResult.runId ? (
              <div style={{ color: '#80969F' }}>
                Run: {runResult.runId}
                {runResult.nativeRootId ? ` · Native root: ${runResult.nativeRootId}` : ''}
              </div>
            ) : null}
            {typeof runResult.tasksTotal === 'number' && runResult.tasksTotal > 0 ? (
              <div style={{ color: '#80969F' }}>
                Progress: {runResult.tasksCompleted || 0}/{runResult.tasksTotal} · {runResult.activeWorkers || 0} active
              </div>
            ) : null}
            {(Number(runResult.inputTokens || 0) > 0 || Number(runResult.outputTokens || 0) > 0) ? (
              <div data-testid="selected-run-provider-usage" style={{ color: '#80969F' }}>
                Native provider usage: {Number(runResult.inputTokens || 0).toLocaleString()} input · {' '}
                {Number(runResult.outputTokens || 0).toLocaleString()} output
                {Number(runResult.cachedTokens || 0) > 0
                  ? ` · ${Number(runResult.cachedTokens).toLocaleString()} cached`
                  : ''}
                {Number(runResult.reasoningTokens || 0) > 0
                  ? ` · ${Number(runResult.reasoningTokens).toLocaleString()} reasoning`
                  : ''}
                {Number(runResult.costUsd || 0) > 0
                  ? ` · $${Number(runResult.costUsd).toFixed(6)}`
                  : ''}
                . This is separate from the pre-run input estimate.
              </div>
            ) : null}
            {runResult.output ? (
              <pre
                style={{
                  margin: 0,
                  padding: 8,
                  background: '#1B1B1B',
                  color: '#D9E4E8',
                  borderRadius: 6,
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'anywhere',
                  maxHeight: 240,
                  overflowY: 'auto',
                }}
              >
                {runResult.output}
              </pre>
            ) : null}
            {runResult.error ? (
              <div role="alert" style={{ color: '#FFA2A2' }}>
                {runResult.error}
              </div>
            ) : null}
          </div>
        ) : null}
        {activeTab === 'CLI' && runResult?.nativeEvents?.length ? (
          <details data-testid="card-native-telemetry" style={{ color: '#B8C8CD', fontSize: 11 }}>
            <summary style={{ cursor: 'pointer' }}>
              Native tool and Script telemetry ({runResult.nativeEvents.length})
            </summary>
            <pre style={{ margin: '8px 0 0', padding: 8, maxHeight: 320, overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', background: '#161A1B', color: '#C7D7DC', fontSize: 10 }}>
              {JSON.stringify(runResult.nativeEvents, null, 2)}
            </pre>
          </details>
        ) : null}
      </div>
    </div>
  );
}
