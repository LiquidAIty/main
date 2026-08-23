import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  NativeGraphProjectionSurface,
  type GraphProjectionV1,
} from './knowledge/NativeAuthorityGraphSurface';

import type {
  AgentCardRuntimeOptions,
  CardRuntime,
} from '../types/agentgraph';
import {
  applyNativeHermesCard,
  loadNativeHermesCard,
  previewNativeHermesCard,
  testNativeHermesMcp,
  type HermesCardDraft,
  type NativeHermesCardView,
} from '../features/agentbuilder/nativeHermesCard';

type ModelOption = { key: string; label: string; providerModelId: string };
export type InputDictionaryEditorOption = { value: string; label: string };
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

export function parseCardEditorInputDataDictionary(payload: unknown): {
  fields: InputDictionaryEditorField[];
  modelsByProvider: Record<string, ModelOption[]>;
} {
  if (!payload || typeof payload !== 'object') {
    throw new Error('input_data_dictionary_card_editor_invalid');
  }
  const document = payload as Record<string, unknown>;
  if (!Array.isArray(document.fields)) {
    throw new Error('input_data_dictionary_card_editor_invalid');
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
  onMaterializeCard?: () => void;
  onClearInvocation?: () => void;
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
  magOneWorkers?: Array<{
    cardId: string;
    title: string;
    ready: boolean;
    provider: string | null;
    model: string | null;
  }>;
  saveDeckStatusMessage?: string | null;
  openDeckRevision?: string | null;
  cardName?: string;
  cardSubtext?: string;
  onChangeCardName?: (value: string) => void;
  onChangeCardSubtext?: (value: string) => void;
  localConfig?: AgentManagerLocalConfig | null;
  onSaveLocalConfig?: (config: AgentManagerLocalConfig) => void | Promise<void>;
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
  output: string;
  error: string | null;
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
      systemPrompt: string;
      message: string;
      runtime: Record<string, unknown>;
      provider: Record<string, unknown>;
      runtimeOptions: Record<string, unknown>;
      enabledTools: string[];
      toolDefinitions: Array<Record<string, unknown>>;
      nativeTools: string[];
      skills: string[];
      toolsets: string[];
      mcpConnectionIds: string[];
      nativeReferences: Array<Record<string, unknown>>;
      images: Array<Record<string, unknown>>;
    };
    cardIdentity: { cardId: string; title?: string };
  } | null;
  receipt?: Record<string, unknown> | null;
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
    // fall back to newline/comma parsing
  }
  return text
    .split(/[\r\n,]+/)
    .map((entry) => entry.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean);
}

function buildEditedCardRuntime(
  kind: 'hermes' | 'autogen',
  mode: CardRuntime['mode'],
  profile: string,
): CardRuntime {
  if (kind === 'hermes') {
    const hermesMode = ['main', 'delegate', 'kanban'].includes(mode)
      ? mode as 'main' | 'delegate' | 'kanban'
      : 'delegate';
    return { kind, mode: hermesMode, profile: profile.trim() || 'default' };
  }
  return {
    kind,
    mode: mode === 'magentic_one' ? 'magentic_one' : 'assistant',
  };
}

export function buildActiveAgentManagerLocalConfig(input: {
  runtime: CardRuntime;
  provider: 'openai' | 'openrouter' | '';
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

export function buildHermesCardDraftFromLocalConfig(
  config: AgentManagerLocalConfig,
): HermesCardDraft {
  if (config.runtime.kind !== 'hermes') throw new Error('card_runtime_not_hermes');
  return {
    role: String(config.role || ''),
    prompt: String(config.prompt_template || ''),
    runtime: config.runtime,
    runtimeOptions: {
      provider:
        config.provider === 'openai'
        || config.provider === 'openrouter'
        || config.provider === 'local_openai_compatible'
          ? config.provider
          : null,
      accessMode: config.access_mode || null,
      modelKey: config.model_key || null,
      reasoningEffort: config.reasoning_effort || null,
      temperature: config.temperature ?? null,
      maxTokens: config.max_tokens ?? null,
      maxTurns: config.max_turns ?? null,
      tools: parseListText(JSON.stringify(config.tools || [])),
      nativeTools: Array.isArray(config.runtime_options?.nativeTools)
        ? config.runtime_options.nativeTools
        : [],
      skills: parseListText(JSON.stringify(config.skills || [])),
      toolsets: parseListText(JSON.stringify(config.toolsets || [])),
      mcpConnectionIds: parseListText(JSON.stringify(config.mcp_connection_ids || [])),
    },
  };
}

export function AgentManager({
  cardId = '',
  projectId = '',
  deckId = '',
  activeTab,
  promptTestInput,
  onChangePromptTestInput,
  onRunCard,
  onMaterializeCard,
  onClearInvocation,
  onRemoveGraphReference,
  onMoveGraphReference,
  runBusy = false,
  runDisabled = false,
  showTaskComposer = true,
  runResult = null,
  loadedGraphContext = [],
  magOneWorkers = [],
  saveDeckStatusMessage = null,
  openDeckRevision = null,
  cardName = '',
  cardSubtext = '',
  onChangeCardName,
  onChangeCardSubtext,
  localConfig,
  onSaveLocalConfig,
}: AgentManagerProps) {
  const isLocalConfigMode = Boolean(localConfig && onSaveLocalConfig);
  const [saveCardStatus, setSaveCardStatus] = useState<SaveCardStatus>('idle');
  const [saveCardErrorMessage, setSaveCardErrorMessage] = useState<string | null>(null);
  const saveCardResetTimerRef = useRef<number | null>(null);
  const [runtimeKind, setRuntimeKind] = useState<'hermes' | 'autogen'>('hermes');
  const [runtimeMode, setRuntimeMode] = useState<CardRuntime['mode']>('delegate');
  const [cardNameDraft, setCardNameDraft] = useState(cardName);
  const [cardSubtextDraft, setCardSubtextDraft] = useState(cardSubtext);
  const [provider, setProvider] = useState<'openai' | 'openrouter' | ''>('');
  const [accessMode, setAccessMode] = useState<
    'chatgpt-account' | 'openai-api' | 'openrouter-api' | ''
  >('');
  const [modelKey, setModelKey] = useState('');
  const [hermesProfile, setHermesProfile] = useState('');
  const [reasoningEffort, setReasoningEffort] = useState<
    'low' | 'medium' | 'high' | 'xhigh' | ''
  >('');
  const [modelsByProvider, setModelsByProvider] = useState<Record<string, ModelOption[]>>({});
  const [cardEditorFields, setCardEditorFields] = useState<InputDictionaryEditorField[]>([]);
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
  const [toolDictionaryBusy, setToolDictionaryBusy] = useState(false);
  const [temperature, setTemperature] = useState<number | ''>('');
  const [maxTokens, setMaxTokens] = useState<number | ''>('');
  const [maxTurns, setMaxTurns] = useState<number | ''>('');
  const [promptText, setPromptText] = useState('');
  const [promptParts, setPromptParts] = useState({
    role: '',
    goal: '',
    constraints: '',
    ioSchema: '',
    memoryPolicy: '',
  });
  const [promptPartsTouched, setPromptPartsTouched] = useState(false);
  const [toolsText, setToolsText] = useState('');
  const [skillsText, setSkillsText] = useState('');
  const [toolsetsText, setToolsetsText] = useState('');
  const [mcpConnectionIdsText, setMcpConnectionIdsText] = useState('');
  const [nativeHermesState, setNativeHermesState] = useState<NativeHermesCardView | null>(null);
  const [nativeHermesStatus, setNativeHermesStatus] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [nativeHermesError, setNativeHermesError] = useState<string | null>(null);
  const [nativeMcpChecks, setNativeMcpChecks] = useState<Record<string, {
    status: 'checking' | 'connected' | 'failed';
    toolCount: number;
    effectiveTools: string[];
    error: string | null;
  }>>({});
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

  useEffect(() => {
    setCardNameDraft(cardName);
    setCardSubtextDraft(cardSubtext);
  }, [cardId, cardName, cardSubtext]);

  useEffect(() => {
    let active = true;
    void fetch('/api/coder/input-data-dictionary/card-editor')
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok || payload?.ok !== true) {
          throw new Error('input_data_dictionary_card_editor_unavailable');
        }
        const parsed = parseCardEditorInputDataDictionary(payload);
        if (active) {
          setCardEditorFields(parsed.fields);
          setModelsByProvider(parsed.modelsByProvider);
        }
      })
      .catch(() => {
        if (active) {
          setCardEditorFields([]);
          setModelsByProvider({});
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!isLocalConfigMode || !localConfig) return;
    draftDirtyRef.current = false;
    setRuntimeKind(localConfig.runtime.kind);
    setRuntimeMode(localConfig.runtime.mode);
    setProvider(
      localConfig.provider === 'openai' || localConfig.provider === 'openrouter'
        ? localConfig.provider
        : '',
    );
    setAccessMode(
      localConfig.access_mode === 'chatgpt-account'
      || localConfig.access_mode === 'openai-api'
      || localConfig.access_mode === 'openrouter-api'
        ? localConfig.access_mode
        : '',
    );
    setModelKey(localConfig.model_key || '');
    setHermesProfile(localConfig.runtime.kind === 'hermes' ? localConfig.runtime.profile : '');
    setReasoningEffort(localConfig.reasoning_effort || '');
    setTemperature(typeof localConfig.temperature === 'number' ? localConfig.temperature : '');
    setMaxTokens(typeof localConfig.max_tokens === 'number' ? localConfig.max_tokens : '');
    setMaxTurns(typeof localConfig.max_turns === 'number' ? localConfig.max_turns : '');
    setPromptText(localConfig.prompt_template || '');
    const parsedPrompt = parsePromptTemplate(localConfig.prompt_template || '');
    setPromptParts({
      ...parsedPrompt,
      role: String(localConfig.role || '').trim() || parsedPrompt.role,
    });
    setPromptPartsTouched(false);
    setToolsText(
      Array.isArray(localConfig.tools)
        ? localConfig.tools
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

  useEffect(() => {
    if (
      !isLocalConfigMode
      || localConfig?.runtime.kind !== 'hermes'
      || !projectId
      || !deckId
      || !cardId
    ) {
      setNativeHermesState(null);
      setNativeHermesStatus('idle');
      setNativeHermesError(null);
      return;
    }
    const controller = new AbortController();
    setNativeHermesStatus('loading');
    setNativeHermesError(null);
    void loadNativeHermesCard({ projectId, deckId, cardId, signal: controller.signal })
      .then((state) => {
        if (controller.signal.aborted) return;
        setNativeHermesState(state);
        setNativeHermesStatus('ready');
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setNativeHermesState(null);
        setNativeHermesStatus('failed');
        setNativeHermesError(error instanceof Error ? error.message : 'Native Hermes profile unavailable.');
      });
    return () => controller.abort();
  // Card/profile readback is identity-scoped. Do not immediately overwrite a
  // successful apply with a read of the still-saving prior deck revision.
  // Draft profile changes are previewed/applied explicitly by Save.
  }, [isLocalConfigMode, projectId, deckId, cardId]);

  const markDraftDirty = () => {
    draftDirtyRef.current = true;
  };

  const buildCurrentLocalPayload = useCallback((): AgentManagerLocalConfig => {
    if (!localConfig) throw new Error('card_config_missing');
    const editedConfig = buildActiveAgentManagerLocalConfig({
      runtime: buildEditedCardRuntime(runtimeKind, runtimeMode, hermesProfile || cardId),
      provider,
      accessMode,
      modelKey,
      reasoningEffort,
      temperature,
      maxTokens,
      maxTurns,
      promptTemplate: promptPartsTouched ? serializePromptFields(promptParts) : promptText,
      toolsText,
      skillsText,
      toolsetsText,
      mcpConnectionIdsText,
    });
    return {
      ...localConfig,
      ...editedConfig,
      role: promptParts.role,
      provider:
        provider
        || (localConfig.provider === 'local_openai_compatible'
          ? 'local_openai_compatible'
          : editedConfig.provider),
    };
  }, [
    localConfig,
    runtimeKind,
    runtimeMode,
    hermesProfile,
    cardId,
    provider,
    accessMode,
    modelKey,
    reasoningEffort,
    temperature,
    maxTokens,
    maxTurns,
    promptPartsTouched,
    promptParts,
    promptText,
    toolsText,
    skillsText,
    toolsetsText,
    mcpConnectionIdsText,
  ]);

  const runSaveConfig = useCallback(async () => {
    if (!isLocalConfigMode || !localConfig || !onSaveLocalConfig) return;
    if (saveCardStatus === 'saving') return;
    const payload = buildCurrentLocalPayload();
    if (saveCardResetTimerRef.current != null) {
      window.clearTimeout(saveCardResetTimerRef.current);
      saveCardResetTimerRef.current = null;
    }
    saveRevisionAtStartRef.current = openDeckRevision ?? null;
    setSaveCardStatus('saving');
    setSaveCardErrorMessage(null);
    try {
      if (payload.runtime.kind === 'hermes') {
        if (!projectId || !deckId || !cardId) throw new Error('hermes_card_identity_missing');
        const draft = buildHermesCardDraftFromLocalConfig(payload);
        let observed = nativeHermesState;
        if (!observed || observed.intent.profile !== draft.runtime.profile) {
          observed = await previewNativeHermesCard({ projectId, deckId, cardId, draft });
        }
        const applied = await applyNativeHermesCard({
          projectId,
          deckId,
          cardId,
          expectedFingerprint: observed.fingerprint,
          draft,
        });
        setNativeHermesState(applied);
        setNativeHermesStatus('ready');
        setNativeHermesError(null);
      }
      await Promise.resolve(onSaveLocalConfig(payload));
      // Persistence readback is confirmed downstream by the deck save (CAS +
      // expectedRevision). Watch openDeckRevision / saveDeckStatusMessage; if a
      // failure/conflict surfaces, flip to failed; a revision advance means the
      // server confirmed the write. Never substitute a timer for that readback.
    } catch (error) {
      saveRevisionAtStartRef.current = null;
      setSaveCardStatus('failed');
      setSaveCardErrorMessage(
        error instanceof Error && error.message ? error.message : 'Save failed.',
      );
    }
  }, [
    isLocalConfigMode,
    localConfig,
    onSaveLocalConfig,
    saveCardStatus,
    cardId,
    projectId,
    deckId,
    nativeHermesState,
    buildCurrentLocalPayload,
    openDeckRevision,
  ]);

  const refreshNativeProfile = useCallback(async () => {
    if (!projectId || !deckId || !cardId) return;
    setNativeHermesStatus('loading');
    setNativeHermesError(null);
    try {
      const draft = buildHermesCardDraftFromLocalConfig(buildCurrentLocalPayload());
      const refreshed = await previewNativeHermesCard({ projectId, deckId, cardId, draft });
      setNativeHermesState(refreshed);
      setNativeHermesStatus('ready');
    } catch (error) {
      setNativeHermesStatus('failed');
      setNativeHermesError(error instanceof Error ? error.message : 'Native profile unavailable.');
    }
  }, [projectId, deckId, cardId, buildCurrentLocalPayload]);

  const checkNativeMcpServer = useCallback(async (serverName: string) => {
    if (!projectId || !deckId || !cardId) return;
    setNativeMcpChecks((current) => ({
      ...current,
      [serverName]: { status: 'checking', toolCount: 0, effectiveTools: [], error: null },
    }));
    try {
      const result = await testNativeHermesMcp({ projectId, deckId, cardId, serverName });
      setNativeMcpChecks((current) => ({
        ...current,
        [serverName]: {
          status: result.ok ? 'connected' : 'failed',
          toolCount: result.tools.length,
          effectiveTools: result.effectiveTools,
          error: result.error,
        },
      }));
    } catch (error) {
      setNativeMcpChecks((current) => ({
        ...current,
        [serverName]: {
          status: 'failed',
          toolCount: 0,
          effectiveTools: [],
          error: error instanceof Error ? error.message : 'Connection check failed.',
        },
      }));
    }
  }, [projectId, deckId, cardId]);

  const saveRevisionAtStartRef = useRef<string | null>(null);
  useEffect(() => {
    if (saveCardStatus !== 'saving') return;
    const failedSurface =
      saveDeckStatusMessage &&
      /(could not save|deck_conflict|failed)/i.test(saveDeckStatusMessage)
        ? saveDeckStatusMessage
        : null;
    if (failedSurface) {
      saveRevisionAtStartRef.current = null;
      setSaveCardStatus('failed');
      setSaveCardErrorMessage(failedSurface);
      return;
    }
    if (openDeckRevision && openDeckRevision !== saveRevisionAtStartRef.current) {
      saveRevisionAtStartRef.current = null;
      setSaveCardStatus('saved');
      if (saveCardResetTimerRef.current != null) {
        window.clearTimeout(saveCardResetTimerRef.current);
      }
      saveCardResetTimerRef.current = window.setTimeout(() => {
        setSaveCardStatus('idle');
        saveCardResetTimerRef.current = null;
      }, 1500);
    }
  }, [saveCardStatus, openDeckRevision, saveDeckStatusMessage]);

  useEffect(() => {
    if (!isLocalConfigMode || !localConfig || !onSaveLocalConfig || !draftDirtyRef.current) {
      return;
    }
    if (runtimeKind === 'hermes') return;
    draftDirtyRef.current = false;
    const editedConfig = buildActiveAgentManagerLocalConfig({
      runtime: buildEditedCardRuntime(runtimeKind, runtimeMode, hermesProfile || cardId),
      provider,
      accessMode,
      modelKey,
      reasoningEffort,
      temperature,
      maxTokens,
      maxTurns,
      promptTemplate: promptPartsTouched ? serializePromptFields(promptParts) : promptText,
      toolsText,
      skillsText,
      toolsetsText,
      mcpConnectionIdsText,
    });
    void onSaveLocalConfig({
      ...localConfig,
      ...editedConfig,
      role: promptParts.role,
      provider:
        provider ||
        (localConfig.provider === 'local_openai_compatible'
          ? 'local_openai_compatible'
          : editedConfig.provider),
    });
  }, [
    isLocalConfigMode,
    localConfig,
    onSaveLocalConfig,
    runtimeKind,
    runtimeMode,
    provider,
    accessMode,
    modelKey,
    reasoningEffort,
    temperature,
    maxTokens,
    maxTurns,
    promptText,
    promptParts,
    promptPartsTouched,
    toolsText,
    skillsText,
    toolsetsText,
    mcpConnectionIdsText,
    hermesProfile,
    cardId,
  ]);

  const availableModels = provider ? modelsByProvider[provider] || [] : [];
  const editorField = (name: string) => cardEditorFields.find((field) => field.name === name);
  const runtimeKindField = editorField('runtimeKind');
  const runtimeModeField = editorField('runtimeMode');
  const runtimeProfileField = editorField('runtimeProfile');
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
  const runtimeModeOptions = (runtimeModeField?.options || []).filter((option) =>
    runtimeKind === 'hermes'
      ? ['main', 'delegate', 'kanban'].includes(option.value)
      : ['assistant', 'magentic_one'].includes(option.value),
  );
  const runtimeDictionaryReady = Boolean(
    runtimeKindField
    && runtimeModeField
    && runtimeProfileField
    && providerField
    && accessModeField
    && modelKeyField
    && reasoningEffortField
    && temperatureField
    && maxTokensField
    && maxTurnsField,
  );
  const savedToolNames = parseListText(toolsText);
  const selectedToolRows = buildInputDictionarySelectedRows(
    toolDictionaryPage.selectedKnownReferences.filter((reference) => reference.access === 'write'),
    toolDictionaryPage.unresolvedSelectedIds,
  );
  const availableToolRows = toolDictionaryPage.references.filter((reference) =>
    !savedToolNames.includes(reference.canonicalId) &&
    reference.availability === 'available' &&
    reference.access === 'write',
  );
  const toggleTool = (name: string, checked: boolean) => {
    setToolsText(toggleSavedToolAssignment(savedToolNames, name, checked).join('\n'));
    markDraftDirty();
  };

  useEffect(() => {
    if (!isLocalConfigMode || !localConfig) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void (async () => {
        setToolDictionaryBusy(true);
        try {
          const params = new URLSearchParams({
            query: toolDictionaryQuery,
            access: 'write',
            offset: String(toolDictionaryOffset),
            limit: '100',
          });
          if (toolDictionaryNamespace) params.set('namespace', toolDictionaryNamespace);
          if (savedToolNames.length) params.set('selectedIds', savedToolNames.join(','));
          const response = await fetch(`/api/coder/input-data-dictionary/tools?${params}`, {
            signal: controller.signal,
          });
          const payload = await response.json();
          if (!response.ok || !payload?.ok || !Array.isArray(payload.references)) {
            throw new Error('Input data dictionary unavailable');
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
    toolDictionaryNamespace,
    toolDictionaryOffset,
    toolDictionaryQuery,
  ]);

  const sectionBody = (() => {
    if (activeTab === 'Task') {
      return (
        <div data-testid="agent-manager-invocation" style={{ display: 'grid', gap: 10 }}>
          <div style={{ color: '#E0DED5', fontSize: 12, fontWeight: 600 }}>
            Complete Card invocation
          </div>
          <div style={{ color: '#9FB2B8', fontSize: 11.5, lineHeight: 1.5 }}>
            <div>Card: {cardId} · {cardName || 'Untitled'}</div>
            <div>
              Runtime: {localConfig?.runtime.kind || 'unconfigured'} · {localConfig?.runtime.mode || 'unconfigured'}
            </div>
            <div>Provider: {localConfig?.provider || 'unconfigured'} · {localConfig?.model_key || 'unconfigured'} · {localConfig?.access_mode || 'unconfigured'}</div>
            <div>Skills: {Array.isArray(localConfig?.skills) && localConfig.skills.length ? localConfig.skills.map(String).join(', ') : 'none'}</div>
            <div>Tools: {Array.isArray(localConfig?.tools) && localConfig.tools.length ? localConfig.tools.map(String).join(', ') : 'none'}</div>
          </div>
          <details>
            <summary style={{ cursor: 'pointer', color: '#D5E4E8', fontSize: 11.5 }}>Stable Card prompt</summary>
            <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: '#B8C8CD', fontSize: 11 }}>
              {String(localConfig?.prompt_template || '')}
            </pre>
          </details>
        </div>
      );
    }
    if (activeTab === 'Prompt') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {onChangeCardName || onChangeCardSubtext ? (
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
              {onChangeCardSubtext ? (
                <div>
                  <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
                    Description
                  </label>
                  <input
                    type="text"
                    value={cardSubtextDraft}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      setCardSubtextDraft(nextValue);
                      onChangeCardSubtext(nextValue);
                    }}
                    placeholder="Enter agent description"
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
              IO Schema
            </label>
            <textarea
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
              Memory Policy
            </label>
            <textarea
              value={promptParts.memoryPolicy}
              onChange={(event) => {
                setPromptParts((current) => ({ ...current, memoryPolicy: event.target.value }));
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

        </div>
      );
    }

    if (activeTab === 'Knowledge') {
      return (
        <div data-testid="agent-manager-knowledge" style={{ display: 'grid', gap: 10 }}>
          <div style={{ color: '#E0DED5', fontSize: 12, fontWeight: 600 }}>
            {knowledgeProjectionIsMaterialized
              ? 'Exact model-bound native graph context'
              : 'Loaded native graph context'}
          </div>
          {knowledgeGraphProjection.nodes.length === 0 ? (
            <div style={{ color: '#80969F', fontSize: 11.5 }}>
              No transient graph references are loaded for this Card invocation.
            </div>
          ) : (
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
          )}
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
          {magOneWorkers.length > 0 ? (
            <section style={{ display: 'grid', gap: 5, padding: 10, border: '1px solid #3A4A4F', borderRadius: 8 }}>
              <strong style={{ color: '#8FC8D1' }}>Saved Mag One workers</strong>
              {magOneWorkers.map((worker) => (
                <div key={worker.cardId} style={{ color: worker.ready ? '#B8C8CD' : '#FFA2A2', fontSize: 11 }}>
                  {worker.title} · {worker.provider || 'provider missing'} / {worker.model || 'model missing'} · {worker.ready ? 'ready' : 'not ready'}
                </div>
              ))}
            </section>
          ) : null}
        </div>
      );
    }

    if (activeTab === 'Runtime') {
      if (!runtimeDictionaryReady) {
        return (
          <div role="alert" style={{ color: '#FFA2A2', fontSize: 12 }}>
            Input Data Definition unavailable. Runtime choices cannot be edited safely.
          </div>
        );
      }
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
                {runtimeKindField?.label}
              </label>
              <select
                data-testid="agent-runtime-kind"
                value={runtimeKind}
                onChange={(event) => {
                  const nextKind = event.target.value === 'autogen' ? 'autogen' : 'hermes';
                  setRuntimeKind(nextKind);
                  setRuntimeMode(nextKind === 'hermes' ? 'delegate' : 'assistant');
                  markDraftDirty();
                }}
              >
                {(runtimeKindField?.options || []).map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
                {runtimeModeField?.label}
              </label>
              <select
                data-testid="agent-runtime-mode"
                value={runtimeMode}
                onChange={(event) => {
                  setRuntimeMode(event.target.value as CardRuntime['mode']);
                  markDraftDirty();
                }}
              >
                {runtimeModeOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            {runtimeKind === 'hermes' ? (
              <div>
                <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
                  {runtimeProfileField?.label}
                </label>
                <input
                  data-testid="agent-hermes-profile"
                  value={hermesProfile}
                  onChange={(event) => {
                    setHermesProfile(event.target.value);
                    markDraftDirty();
                  }}
                />
                <div style={{ color: '#80969F', fontSize: 10, marginTop: 4 }}>
                  This saved profile owns the Card's isolated Hermes session and SQLite memory.
                </div>
              </div>
            ) : null}
            <div>
              <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
                {providerField?.label}
              </label>
              <select
                value={provider}
                onChange={(event) => {
                  const nextProvider = event.target.value as 'openai' | 'openrouter' | '';
                  setProvider(nextProvider);
                  const nextModels = nextProvider ? modelsByProvider[nextProvider] || [] : [];
                  setModelKey((current) =>
                    nextModels.some((model) => model.key === current)
                      ? current
                      : nextModels[0]?.key || '',
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
                <option value="">Unset</option>
                {providerOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
                {accessModeField?.label}
              </label>
              <select
                data-testid="agent-access-mode"
                value={accessMode}
                onChange={(event) => {
                  setAccessMode(event.target.value as typeof accessMode);
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
                <option value="">Select access mode</option>
                {accessModeOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
                {modelKeyField?.label}
              </label>
              <select
                value={modelKey}
                onChange={(event) => {
                  setModelKey(event.target.value);
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
                <option value="">Select model</option>
                {availableModels.map((model) => (
                  <option key={model.key} value={model.key}>
                    {model.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
                {reasoningEffortField?.label}
              </label>
              <select
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
                {(reasoningEffortField?.options || []).map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ color: '#E0DED5', fontSize: 12, fontWeight: 600 }}>
            Advanced runtime
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
                {temperatureField?.label}
              </label>
              <input
                aria-label={temperatureField?.label}
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
                {maxTokensField?.label}
              </label>
              <input
                aria-label={maxTokensField?.label}
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
                {maxTurnsField?.label}
              </label>
              <input
                aria-label={maxTurnsField?.label}
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
          {runtimeKind === 'hermes' ? (
            <section
              data-testid="agent-native-profile-status"
              style={{
                display: 'grid',
                gap: 8,
                padding: '10px 12px',
                border: '1px solid #3A4A4F',
                borderRadius: 8,
                background: '#202827',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                <div style={{ color: '#E0DED5', fontSize: 12, fontWeight: 600 }}>Profile status</div>
                <button
                  type="button"
                  onClick={() => void refreshNativeProfile()}
                  disabled={nativeHermesStatus === 'loading'}
                >
                  {nativeHermesStatus === 'loading' ? 'Reading…' : 'Re-read profile'}
                </button>
              </div>
              {nativeHermesStatus === 'failed' ? (
                <div role="alert" style={{ color: '#FFA2A2', fontSize: 11 }}>
                  {nativeHermesError || 'Profile read failed.'}
                </div>
              ) : nativeHermesState ? (
                <>
                  <div style={{ color: '#9FB2B8', fontSize: 11.5, lineHeight: 1.5 }}>
                    <div>Binding: {nativeHermesState.native.name}</div>
                    <div>Launch: {runtimeMode}</div>
                    <div>
                      Model: {nativeHermesState.native.model.provider || 'unset'} / {nativeHermesState.native.model.default || 'unset'}
                    </div>
                    <div>Workspace: {nativeHermesState.intent.workspace || 'current launch workspace'}</div>
                    <div>Memory: profile-owned · policy is defined under Prompt</div>
                  </div>
                  <div
                    style={{
                      color: nativeHermesState.drift.status === 'in_sync' ? '#72D7C7' : '#F2C36B',
                      fontSize: 11.5,
                    }}
                  >
                    {nativeHermesState.drift.status === 'in_sync'
                      ? 'Card and profile agree.'
                      : `Profile drift: ${nativeHermesState.drift.fields.join(', ')}`}
                  </div>
                  {nativeHermesState.unsupported.length ? (
                    <div style={{ color: '#F2C36B', fontSize: 11 }}>
                      Run-only or unavailable: {nativeHermesState.unsupported.map((item) => item.field).join(', ')}
                    </div>
                  ) : null}
                  <details>
                    <summary style={{ cursor: 'pointer', color: '#B8C8CD', fontSize: 11 }}>Technical readback</summary>
                    <div style={{ color: '#80969F', fontSize: 10.5, overflowWrap: 'anywhere' }}>
                      Native fingerprint: {nativeHermesState.fingerprint}<br />
                      Profile IDs are bindings only; Card ID remains {cardId}.
                    </div>
                  </details>
                </>
              ) : (
                <div style={{ color: '#80969F', fontSize: 11 }}>Profile state has not been read yet.</div>
              )}
            </section>
          ) : null}
        </div>
      );
    }

    if (activeTab === 'Tools') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ color: '#E0DED5', fontSize: 12, fontWeight: 600 }}>
            Input Data Definition · Tools
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
              disabled={!savedToolNames.length}
              onClick={() => {
                setToolsText('');
                markDraftDirty();
              }}
            >
              Clear selected
            </button>
            <span style={{ color: '#80969F', fontSize: 11 }}>
              {toolDictionaryPage.total.toLocaleString()} tools
              {toolDictionaryBusy ? ' · Loading…' : ''}
            </span>
          </div>
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
                    <span style={{ display: 'block', color: '#D5E4E8', fontSize: 11 }}>
                      {tool.title || tool.name}
                    </span>
                    <span style={{ display: 'block', color: '#80969F', fontSize: 10 }}>
                      {tool.name}
                      {tool.kind ? ` · ${tool.kind}` : ''}
                      {tool.sourceIds?.length ? ` · ${tool.sourceIds.join(', ')}` : ''}
                      {tool.description ? ` · ${tool.description}` : ''}
                      {tool.availability === 'stale' ? ' · Missing from current dictionary' : ''}
                      {tool.availability === 'disabled' ? ' · Currently unavailable' : ''}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          ) : null}
          {!showSelectedToolsOnly && availableToolRows.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ color: '#E0DED5', fontSize: 12, fontWeight: 600 }}>Available</div>
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
                    checked={false}
                    onChange={(event) => toggleTool(tool.canonicalId, event.target.checked)}
                    aria-label={`Include ${tool.displayName || tool.canonicalId}`}
                  />
                  <span>
                    <span style={{ display: 'block', color: '#D5E4E8', fontSize: 11 }}>
                      {tool.displayName || tool.canonicalId}
                    </span>
                    <span style={{ display: 'block', color: '#80969F', fontSize: 10 }}>
                      {tool.canonicalId}
                      {tool.namespace ? ` · ${tool.namespace}` : ''}
                      {tool.kind ? ` · ${tool.kind}` : ''}
                      {tool.sourceIds?.length ? ` · ${tool.sourceIds.join(', ')}` : ''}
                      {tool.shortDescription ? ` · ${tool.shortDescription}` : ''}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          ) : !selectedToolRows.length ? (
            <div style={{ color: '#91A9B8', fontSize: 11 }}>
              {showSelectedToolsOnly
                ? 'No tools are selected for this card.'
                : 'No tools match this dictionary query.'}
            </div>
          ) : null}
          {!showSelectedToolsOnly ? (
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
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 8 }}>
            <div>
              <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
                Enabled skills
              </label>
              <textarea
                aria-label="Enabled skills"
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
                Toolsets
              </label>
              <textarea
                aria-label="Toolsets"
                value={toolsetsText}
                onChange={(event) => {
                  setToolsetsText(event.target.value);
                  markDraftDirty();
                }}
                placeholder="One toolset ID per line"
                rows={4}
              />
            </div>
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
              MCP connections
            </label>
            <textarea
              aria-label="MCP connections"
              value={mcpConnectionIdsText}
              onChange={(event) => {
                setMcpConnectionIdsText(event.target.value);
                markDraftDirty();
              }}
              placeholder="One configured connection ID per line"
              rows={4}
            />
            <div style={{ color: '#80969F', fontSize: 10, marginTop: 4 }}>
              Connection references only. Credentials and tokens remain in the profile's native secret scope.
            </div>
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
              <div style={{ color: '#E0DED5', fontSize: 12, fontWeight: 600 }}>
                Effective profile capabilities
              </div>
              <div style={{ color: '#9FB2B8', fontSize: 11 }}>
                Skills: {nativeHermesState.native.skills.filter((item) => item.enabled).map((item) => item.name).join(', ') || 'none'}
              </div>
              <div style={{ color: '#9FB2B8', fontSize: 11 }}>
                Toolsets: {nativeHermesState.native.toolsets.filter((item) => item.enabled).map((item) => item.name).join(', ') || 'none'}
              </div>
              <div style={{ color: '#9FB2B8', fontSize: 11 }}>
                Card grant ceiling: {nativeHermesState.intent.cardGrants.join(', ') || 'none'}
              </div>
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
                      <span style={{ color: '#D5E4E8', fontSize: 11.5 }}>
                        {server.name} · {server.enabled ? 'enabled' : 'disabled'} · {server.credentialStatus.replace('_', ' ')}
                      </span>
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
                      {server.toolFilter.length ? ` · filter: ${server.toolFilter.join(', ')}` : ' · all discovered tools visible before Card grants'}
                    </div>
                    {checked ? (
                      <div style={{ color: checked.status === 'connected' ? '#72D7C7' : checked.status === 'failed' ? '#FFA2A2' : '#80969F', fontSize: 10.5 }}>
                        {checked.status === 'connected'
                          ? `Connected · ${checked.toolCount} discovered · ${checked.effectiveTools.length} allowed by this Card`
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
  })();

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
        Legacy Agent Manager has been disconnected from the active Builder runtime.
      </div>
    );
  }

  if (!sectionBody) {
    return null;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {sectionBody}

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          padding: '10px 12px',
          borderRadius: 8,
          border: '1px solid #3A4A4F',
          background: '#222625',
        }}
      >
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => void runSaveConfig()}
            disabled={saveCardStatus === 'saving' || !onSaveLocalConfig}
            aria-busy={saveCardStatus === 'saving'}
            data-testid="agent-manager-save"
            style={{
              padding: '8px 14px',
              background:
                saveCardStatus === 'saving'
                  ? '#3A3A3A'
                  : saveCardStatus === 'saved'
                    ? '#1D3A2F'
                    : saveCardStatus === 'failed'
                      ? '#4A2525'
                      : '#4FA2AD',
              color: '#FFF',
              border: '1px solid #3A4A4F',
              borderRadius: 8,
              cursor: saveCardStatus === 'saving' ? 'progress' : 'pointer',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {saveCardStatus === 'saving' ? 'Saving…' : saveCardStatus === 'saved' ? 'Saved' : 'Save Card Version'}
          </button>
          <span style={{ color: '#80969F', fontSize: 10.5 }}>
            Stable Card fields are versioned; the dynamic input remains in this Card workspace.
          </span>
          {saveCardStatus === 'failed' && saveCardErrorMessage ? (
            <span role="alert" data-testid="agent-manager-save-error" style={{ color: '#FFA2A2', fontSize: 11.5 }}>
              {saveCardErrorMessage}
            </span>
          ) : null}
          {saveDeckStatusMessage ? (
            <span style={{ color: '#80969F', fontSize: 11 }}>{saveDeckStatusMessage}</span>
          ) : null}
        </div>

        {activeTab === 'Task' && showTaskComposer ? <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
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
          <div style={{ color: '#80969F', fontSize: 10.5 }}>
            Python combines this input with the saved Card into the one exact model call shown below.
          </div>
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
              onClick={onMaterializeCard}
              disabled={runDisabled || runBusy || !String(promptTestInput || '').trim()}
              data-testid="agent-manager-materialize"
            >
              {runBusy ? 'Working…' : 'Prepare / Refresh'}
            </button>
            <button
              type="button"
              onClick={onRunCard}
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
          </div>
        </div> : null}

        {activeTab === 'Task' && runResult ? (
          <div
            data-testid="agent-manager-run-result"
            style={{ display: 'grid', gap: 6, fontSize: 11.5 }}
          >
            <div style={{ color: '#D5E4E8' }}>
              Status: {runResult.status || 'completed'}
              {runResult.provider || runResult.model || runResult.runtimeLabel
                ? ` · ${[runResult.provider, runResult.model, runResult.runtimeLabel]
                    .filter(Boolean)
                    .join(' · ')}`
                : ''}
            </div>
            {runResult.tools.length > 0 ? (
              <div style={{ color: '#80969F' }}>
                Tools granted: {runResult.tools.join(', ')}
              </div>
            ) : null}
            {runResult.invocation ? (
              <>
                <div style={{ color: '#8FC8D1' }}>
                  Transient IDF · Card revision {runResult.invocation.cardRevision} · {runResult.invocation.runtimeOwner}
                </div>
                <details open>
                  <summary style={{ cursor: 'pointer', color: '#D5E4E8' }}>Exact in-memory IDF</summary>
                  <textarea
                    aria-label="Exact temporary IDF"
                    value={JSON.stringify(runResult.invocation.idf, null, 2)}
                    readOnly
                    rows={18}
                    style={{
                      width: '100%',
                      margin: 0,
                      padding: 8,
                      background: '#1B1B1B',
                      color: '#D9E4E8',
                      border: '1px solid #3A4A4F',
                      borderRadius: 6,
                      whiteSpace: 'pre-wrap',
                      overflowWrap: 'anywhere',
                      fontFamily: 'monospace',
                      fontSize: 11,
                      resize: 'vertical',
                    }}
                  />
                </details>
              </>
            ) : null}
            {runResult.receipt ? (
              <details>
                <summary style={{ cursor: 'pointer', color: '#D5E4E8' }}>Run telemetry receipt</summary>
                <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: '#B8C8CD' }}>
                  {JSON.stringify(runResult.receipt, null, 2)}
                </pre>
              </details>
            ) : null}
            {runResult.toolCallCount !== undefined && runResult.toolCallCount !== null ? (
              <div style={{ color: '#80969F' }}>Tool calls: {runResult.toolCallCount}</div>
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
      </div>
    </div>
  );
}
