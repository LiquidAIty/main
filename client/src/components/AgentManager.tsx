import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type {
  AgentCardRuntimeOptions,
  CardRuntime,
} from '../types/agentgraph';
import { CardScriptEditor } from '../features/agentbuilder/CardScriptEditor';
import { CardRuntimeDashboard } from './CardRuntimeDashboard';
import {
  applyHermesCardOperation,
  loadHermesCardProfile,
  loadHermesLearningDetail,
  testHermesMcp,
  type HermesCardProfileView,
} from '../features/agentbuilder/hermesCardProfile';

type ModelOption = { key: string; label: string; providerModelId: string };
type SavedSubagentModel = NonNullable<AgentCardRuntimeOptions['subagentModel']>;
type SavedSubagentType = NonNullable<AgentCardRuntimeOptions['subagentType']>;
type SavedCardScript = NonNullable<AgentCardRuntimeOptions['script']>;
type SavedJevContext = NonNullable<AgentCardRuntimeOptions['jevContext']>;
type JevContextMode = NonNullable<SavedJevContext['autoTools']>;
const DEFAULT_JEV_CONTEXT: Required<SavedJevContext> = {
  autoTools: 'inherited',
  modelChoice: 'inherited',
};
const DEFAULT_SUBAGENT_MODEL: SavedSubagentModel = {
  provider: 'openai',
  accessMode: 'chatgpt-account',
  modelKey: 'gpt-5.6-luna',
  providerModelId: 'gpt-5.6-luna',
};

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
    hermesSupport: {
      available: false,
      active: false,
      executor: null,
      reason: 'card_script_hermes_runner_unavailable',
    },
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
  control: 'select' | 'catalog-select' | 'catalog-multiselect' | 'number' | 'integer' | 'text' | 'checkbox';
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
  provider: string;
  providerToolName: string;
  namespace?: string;
  displayName?: string;
  description?: string;
  available: boolean;
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
      title: reference.displayName || reference.canonicalId,
      description: reference.description,
      availability: reference.available ? 'available' as const : 'disabled' as const,
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
interface AgentManagerProps {
  cardId?: string;
  projectId?: string;
  deckId?: string;
  activeTab: string;
  cardName?: string;
  onChangeCardName?: (value: string) => void;
  localConfig?: AgentManagerLocalConfig | null;
  onSaveLocalConfig?: (config: AgentManagerLocalConfig) => void | Promise<void>;
  registerCardLeave?: (save: (() => Promise<boolean>) | null) => void;
  orangeConnections?: Array<{
    cardId: string;
    title: string;
    direction: 'incoming' | 'outgoing';
  }>;
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

type SaveCardStatus = 'idle' | 'saving' | 'saved' | 'failed';

type PromptFields = {
  role: string;
  goal: string;
  constraints: string;
  ioSchema: string;
  memoryPolicy: string;
  outputExpectations: string;
  connectedAgents: string;
};

const PROMPT_HEADINGS: Record<string, keyof PromptFields> = {
  ROLE: 'role', GOAL: 'goal', CONSTRAINTS: 'constraints',
  IO_SCHEMA: 'ioSchema', INPUT_SCHEMA: 'ioSchema', MEMORY_POLICY: 'memoryPolicy',
  OUTPUT_EXPECTATIONS: 'outputExpectations', OUTPUT_CONTRACT: 'outputExpectations',
  OUTPUT_REQUIREMENTS: 'outputExpectations',
  ALL_CONNECTED_AGENTS: 'connectedAgents', ALL_AGENTS_CONNECTED: 'connectedAgents',
};

function promptHeadingKey(label: string): string {
  return label.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

const CANONICAL_PROMPT_HEADING: Record<keyof PromptFields, string> = {
  role: 'ROLE',
  goal: 'GOAL',
  constraints: 'CONSTRAINTS',
  ioSchema: 'IO_SCHEMA',
  memoryPolicy: 'MEMORY_POLICY',
  outputExpectations: 'OUTPUT_EXPECTATIONS',
  connectedAgents: 'ALL CONNECTED AGENTS',
};

function promptHeadings(template: string) {
  const headings: Array<{ label: string; index: number; end: number }> = [];
  let fence: string | null = null;
  for (const line of template.matchAll(/^.*(?:\r?\n|$)/gm)) {
    const marker = line[0].match(/^\s*(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
      continue;
    }
    if (fence) continue;
    const heading = line[0].match(/^(?:\[([^\]\r\n]+)\][ \t]*|#{1,6}[ \t]+([^\r\n]+))(?:\r?\n|$)/);
    if (heading) headings.push({ label: heading[1] ?? heading[2], index: line.index!, end: line.index! + line[0].length });
  }
  return headings;
}

function assertUniqueCanonicalPromptSections(template: string): void {
  const seen = new Set<keyof PromptFields>();
  for (const heading of promptHeadings(template)) {
    const field = PROMPT_HEADINGS[promptHeadingKey(heading.label)];
    if (!field) continue;
    if (seen.has(field)) {
      const canonical = CANONICAL_PROMPT_HEADING[field];
      throw new Error(`card_prompt_duplicate_section:${canonical}. Keep exactly one [${canonical}] block before saving.`);
    }
    seen.add(field);
  }
}

function promptFieldRanges(template: string) {
  // Headings delimit editable blocks; they do not classify the text inside them.
  const headings = promptHeadings(template);
  const ranges: Array<{ key: string; label: string; start: number; end: number }> = [];
  const seen = new Set<keyof PromptFields>();
  headings.forEach((heading, index) => {
    const field = PROMPT_HEADINGS[promptHeadingKey(heading.label)];
    const key = field && !seen.has(field) ? field : `section:${heading.index}`;
    if (field) seen.add(field);
    const start = heading.end;
    const end = headings[index + 1]?.index ?? template.length;
    const body = template.slice(start, end);
    const leading = body.match(/^\s*/)?.[0].length || 0;
    const trailing = body.match(/\s*$/)?.[0].length || 0;
    ranges.push({ key, label: heading.label, start: start + leading, end: Math.max(start + leading, end - trailing) });
  });
  const preambleEnd = headings[0]?.index ?? template.length;
  if (template.slice(0, preambleEnd).trim()) {
    ranges.unshift({ key: 'instructions', label: 'Instructions', start: 0, end: preambleEnd });
  }
  return ranges;
}

function parsePromptTemplate(template: string): PromptFields & Record<string, string> {
  const fields: PromptFields & Record<string, string> = {
    role: '', goal: '', constraints: '', ioSchema: '', memoryPolicy: '', outputExpectations: '',
    connectedAgents: '',
  };
  for (const range of promptFieldRanges(template)) fields[range.key] = template.slice(range.start, range.end);
  return fields;
}

function serializePromptFields(fields: PromptFields & Record<string, string>, original: string, edited: Record<string, boolean>): string {
  const ranges = promptFieldRanges(original);
  const previous = parsePromptTemplate(original);
  let result = original;
  for (const range of [...ranges].reverse()) {
    if (edited[range.key] && fields[range.key] !== previous[range.key]) {
      result = result.slice(0, range.start) + fields[range.key] + result.slice(range.end);
    }
  }
  const newline = original.includes('\r\n') ? '\r\n' : '\n';
  for (const [key, heading] of Object.entries(CANONICAL_PROMPT_HEADING) as Array<[keyof PromptFields, string]>) {
    if (!edited[key] || ranges.some((range) => range.key === key) || !fields[key]) continue;
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
  hermesProfileModel: unknown,
): boolean {
  const saved = String(savedCardModel || '').trim();
  const hermes = String(hermesProfileModel || '').trim();
  return Boolean(saved && hermes && saved !== hermes);
}

export function AgentManager({
  cardId = '',
  projectId = '',
  deckId = '',
  activeTab,
  cardName = '',
  onChangeCardName,
  localConfig,
  onSaveLocalConfig,
  registerCardLeave,
  orangeConnections = [],
}: AgentManagerProps) {
  const isLocalConfigMode = Boolean(localConfig && onSaveLocalConfig);
  const outboundOrangeConnections = orangeConnections.filter(
    (connection) => connection.direction === 'outgoing',
  );
  const [saveCardStatus, setSaveCardStatus] = useState<SaveCardStatus>('idle');
  const [saveCardErrorMessage, setSaveCardErrorMessage] = useState<string | null>(null);
  const cardSaveInFlightRef = useRef<Promise<boolean> | null>(null);
  const [draftRevision, setDraftRevision] = useState(0);
  const cardDraftRevisionRef = useRef(0);
  const profileDraftRevisionRef = useRef(0);
  const profileDraftDirtyRef = useRef(false);
  const profileReadbackRef = useRef<HermesCardProfileView | null>(null);
  const runtimeKind = localConfig?.runtime.kind;
  const runtimeMode = localConfig?.runtime.mode;
  const [cardNameDraft, setCardNameDraft] = useState(cardName);
  const [provider, setProvider] = useState<NonNullable<AgentManagerLocalConfig['provider']>>('');
  const [accessMode, setAccessMode] = useState<
    'chatgpt-account' | 'openai-api' | 'openrouter-api' | ''
  >('');
  const [{ key: modelKey, providerModelId }, setModel] = useState<{
    key: string; providerModelId?: string | null;
  }>({ key: '' });
  const [autoSelect, setAutoSelect] = useState(false);
  const [autoTools, setAutoTools] = useState(false);
  const [orchestratorEnabled, setOrchestratorEnabled] = useState(false);
  const [orchestratorTouched, setOrchestratorTouched] = useState(false);
  const [jevContext, setJevContext] = useState<Required<SavedJevContext>>(DEFAULT_JEV_CONTEXT);
  const [jevContextTouched, setJevContextTouched] = useState(false);
  const [subagentModel, setSubagentModel] = useState<SavedSubagentModel>(DEFAULT_SUBAGENT_MODEL);
  const [subagentType, setSubagentType] = useState<SavedSubagentType>('none');
  const [subagentTouched, setSubagentTouched] = useState(false);
  const [subagentTypeTouched, setSubagentTypeTouched] = useState(false);
  const learningEditsRef = useRef(new Map<string, string>());
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
  const [showSelectedToolsOnly, setShowSelectedToolsOnly] = useState(true);
  const [toolDictionaryBusy, setToolDictionaryBusy] = useState(true);
  const [toolOptionsError, setToolOptionsError] = useState(false);
  const [temperature, setTemperature] = useState<number | ''>('');
  const [maxTokens, setMaxTokens] = useState<number | ''>('');
  const [maxTurns, setMaxTurns] = useState<number | ''>('');
  const [promptText, setPromptText] = useState('');
  const [promptParts, setPromptParts] = useState<PromptFields & Record<string, string>>({
    role: '',
    goal: '',
    constraints: '',
    ioSchema: '',
    memoryPolicy: '',
    outputExpectations: '',
    connectedAgents: '',
  });
  const [promptPartsTouched, setPromptPartsTouched] = useState<Record<string, boolean>>({});
  const [toolsText, setToolsText] = useState('');
  const [skillsText, setSkillsText] = useState('');
  const [toolsetsText, setToolsetsText] = useState('');
  const [mcpConnectionIdsText, setMcpConnectionIdsText] = useState('');
  const [hermesProfileState, setHermesProfileState] = useState<HermesCardProfileView | null>(null);
  const [hermesProfileStatus, setHermesProfileStatus] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [hermesProfileError, setHermesProfileError] = useState<string | null>(null);
  const [hermesLearningDetail, setHermesLearningDetail] = useState<{
    kind: 'memory' | 'skill';
    id: string;
    label: string;
    content: string;
  } | null>(null);
  const [hermesLearningDraft, setHermesLearningDraft] = useState('');
  const [hermesLearningStatus, setHermesLearningStatus] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [hermesLearningError, setHermesLearningError] = useState<string | null>(null);
  const [hermesMcpChecks, setHermesMcpChecks] = useState<Record<string, {
    status: 'checking' | 'connected' | 'failed';
    toolCount: number;
    error: string | null;
  }>>({});
  const draftDirtyRef = useRef(false);
  useEffect(() => {
    setCardNameDraft(cardName);
  }, [cardId, cardName]);

  useEffect(() => {
    let active = true;
    setRuntimeOptionsStatus('loading');
    setCardEditorFields([]);
    setModelsByProvider({});
    void fetch('/api/cards/options')
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
    // A response to an earlier save must not replace edits made while it was pending.
    if (draftDirtyRef.current || cardSaveInFlightRef.current) return;
    draftDirtyRef.current = false;
    setSubagentTouched(false);
    setSubagentTypeTouched(false);
    setJevContextTouched(false);
    setOrchestratorTouched(false);
    setProvider(localConfig.provider || '');
    setAccessMode(
      localConfig.access_mode === 'chatgpt-account'
      || localConfig.access_mode === 'openai-api'
      || localConfig.access_mode === 'openrouter-api'
        ? localConfig.access_mode
        : '',
    );
    setModel({ key: localConfig.model_key || '',
      providerModelId: localConfig.runtime_options?.providerModelId });
    setAutoSelect(localConfig.runtime_options?.autoSelect === true);
    setAutoTools(localConfig.runtime_options?.autoTools === true);
    setOrchestratorEnabled(
      localConfig.runtime.mode === 'main'
      || localConfig.runtime_options?.orchestrator === true,
    );
    setJevContext({
      autoTools: localConfig.runtime_options?.jevContext?.autoTools || 'inherited',
      modelChoice: localConfig.runtime_options?.jevContext?.modelChoice || 'inherited',
    });
    const savedSubagentModel = localConfig.runtime_options?.subagentModel;
    const savedSubagentType = localConfig.runtime_options?.subagentType;
    setSubagentType(
      savedSubagentType === 'leaf' || savedSubagentType === 'recursive'
        ? savedSubagentType
        : 'none',
    );
    setSubagentModel(
      localConfig.runtime.kind === 'hermes' && savedSubagentModel
        ? savedSubagentModel
        : DEFAULT_SUBAGENT_MODEL,
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
    const parsedPrompt = parsePromptTemplate(localConfig.prompt_template || '');
    const legacyOutputExpectations = typeof localConfig.output_contract === 'string'
      ? localConfig.output_contract
      : localConfig.output_contract == null
        ? ''
        : JSON.stringify(localConfig.output_contract, null, 2);
    setPromptParts({
      ...parsedPrompt,
      outputExpectations: parsedPrompt.outputExpectations || legacyOutputExpectations,
    });
    setPromptPartsTouched({});
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

  const acceptProfileReadback = useCallback((state: HermesCardProfileView | null) => {
    profileReadbackRef.current = state;
    setHermesProfileState(state);
    if (!state) {
      setHermesLearningDetail(null);
      setHermesLearningDraft('');
      setHermesLearningStatus('idle');
      setHermesLearningError(null);
      return;
    }
  }, []);

  useEffect(() => {
    if (
      !isLocalConfigMode
      || localConfig?.runtime.kind !== 'hermes'
      || !projectId
      || !deckId
      || !cardId
    ) {
      acceptProfileReadback(null);
      setHermesProfileStatus('idle');
      setHermesProfileError(null);
      return;
    }
    const controller = new AbortController();
    acceptProfileReadback(null);
    setHermesProfileStatus('loading');
    setHermesProfileError(null);
    setHermesLearningDetail(null);
    setHermesLearningDraft('');
    setHermesLearningStatus('idle');
    setHermesLearningError(null);
    void loadHermesCardProfile({ projectId, deckId, cardId, signal: controller.signal })
      .then((state) => {
        if (controller.signal.aborted) return;
        acceptProfileReadback(state);
        setHermesProfileStatus('ready');
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        acceptProfileReadback(null);
        setHermesProfileStatus('failed');
        setHermesProfileError(error instanceof Error ? error.message : 'Profile unavailable.');
      });
    return () => controller.abort();
  // Hermes profile readback is identity-scoped and deliberately independent from
  // unsaved Card drafts. Card save never mutates the bound profile.
  }, [isLocalConfigMode, projectId, deckId, cardId, acceptProfileReadback]);


  const markDraftDirty = () => {
    draftDirtyRef.current = true;
    cardDraftRevisionRef.current += 1;
    setDraftRevision((revision) => revision + 1);
  };

  const markProfileDraftDirty = () => {
    profileDraftDirtyRef.current = true;
    profileDraftRevisionRef.current += 1;
    setDraftRevision((revision) => revision + 1);
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
    const originalPrompt = parsePromptTemplate(promptText);
    const migrateLegacyOutput = Boolean(
      localConfig.output_contract != null
      && !originalPrompt.outputExpectations
      && promptParts.outputExpectations,
    );
    const serializedPrompt = serializePromptFields(
      promptParts,
      promptText,
      migrateLegacyOutput
        ? { ...promptPartsTouched, outputExpectations: true }
        : promptPartsTouched,
    );
    assertUniqueCanonicalPromptSections(serializedPrompt);
    const editedConfig = buildActiveAgentManagerLocalConfig({
      runtime: localConfig.runtime,
      provider,
      accessMode,
      modelKey,
      reasoningEffort,
      temperature,
      maxTokens,
      maxTurns,
      promptTemplate: serializedPrompt,
      toolsText,
      skillsText,
      toolsetsText,
      mcpConnectionIdsText,
    });
    const runtimeOptions: AgentCardRuntimeOptions = {
      ...(localConfig.runtime_options || {}),
      ...(
        runtimeKind === 'hermes' && runtimeMode === 'magentic_one'
          ? { subagentType: 'none' as const }
          : subagentTypeTouched
            ? { subagentType }
            : {}
      ),
      ...(providerModelId !== undefined ? { providerModelId } : {}),
      ...(
        runtimeKind === 'hermes'
        && (autoSelect || localConfig.runtime_options?.autoSelect !== undefined)
          ? { autoSelect }
          : {}
      ),
      ...(
        runtimeKind === 'hermes'
        && (autoTools || localConfig.runtime_options?.autoTools !== undefined)
          ? { autoTools }
          : {}
      ),
      ...(
        runtimeKind === 'hermes'
        && runtimeMode === 'delegate'
        && (orchestratorTouched || localConfig.runtime_options?.orchestrator !== undefined)
          ? { orchestrator: orchestratorEnabled }
          : {}
      ),
      ...(subagentTouched ? { subagentModel } : {}),
      ...(
        runtimeKind === 'hermes'
        && (jevContextTouched || localConfig.runtime_options?.jevContext !== undefined)
          ? { jevContext }
          : {}
      ),
      ...(
        localConfig.runtime_options?.script || scriptDraft.source.trim() || scriptDraft.enabled
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
  }, [
    localConfig,
    runtimeKind,
    runtimeMode,
    cardId,
    provider,
    accessMode,
    modelKey,
    providerModelId,
    autoSelect,
    autoTools,
    orchestratorEnabled,
    orchestratorTouched,
    jevContext,
    jevContextTouched,
    subagentModel,
    subagentTouched,
    subagentType,
    subagentTypeTouched,
    scriptDraft,
    reasoningEffort,
    temperature,
    maxTokens,
    maxTurns,
    promptParts,
    promptPartsTouched,
    promptText,
    toolsText,
    skillsText,
    toolsetsText,
    mcpConnectionIdsText,
  ]);

  const runSaveConfig = useCallback(async () => {
    if (!draftDirtyRef.current) return;
    if (!isLocalConfigMode || !localConfig || !onSaveLocalConfig) throw new Error('card_config_missing');
    const revision = cardDraftRevisionRef.current;
    const payload = buildCurrentLocalPayload();
    await Promise.resolve(onSaveLocalConfig(payload));
    if (cardDraftRevisionRef.current === revision) {
      draftDirtyRef.current = false;
    }
  }, [
    isLocalConfigMode,
    localConfig,
    onSaveLocalConfig,
    buildCurrentLocalPayload,
  ]);

  const openHermesLearningNode = useCallback(async (nodeId: string) => {
    if (!projectId || !deckId || !cardId) return;
    setHermesLearningStatus('loading');
    setHermesLearningError(null);
    try {
      const detail = await loadHermesLearningDetail({ projectId, deckId, cardId, nodeId });
      setHermesLearningDetail(detail);
      setHermesLearningDraft(learningEditsRef.current.get(nodeId) ?? detail.content);
      setHermesLearningStatus('ready');
    } catch (error) {
      setHermesLearningStatus('failed');
      setHermesLearningError(error instanceof Error ? error.message : 'Hermes learning node unavailable.');
    }
  }, [projectId, deckId, cardId]);

  const checkHermesMcpServer = useCallback(async (serverName: string) => {
    if (!projectId || !deckId || !cardId) return;
    setHermesMcpChecks((current) => ({
      ...current,
      [serverName]: { status: 'checking', toolCount: 0, error: null },
    }));
    try {
      const result = await testHermesMcp({ projectId, deckId, cardId, serverName });
      setHermesMcpChecks((current) => ({
        ...current,
        [serverName]: {
          status: result.ok ? 'connected' : 'failed',
          toolCount: result.tools.length,
          error: result.error,
        },
      }));
    } catch (error) {
      setHermesMcpChecks((current) => ({
        ...current,
        [serverName]: {
          status: 'failed',
          toolCount: 0,
          error: error instanceof Error ? error.message : 'Connection check failed.',
        },
      }));
    }
  }, [projectId, deckId, cardId]);

  const saveCurrentDraft = useCallback(async (): Promise<void> => {
      const profileRevision = profileDraftRevisionRef.current;
      const profileState = profileReadbackRef.current;
      const learningEdits = [...learningEditsRef.current];
      if (profileDraftDirtyRef.current) {
        if (!profileState || !projectId || !deckId || !cardId) throw new Error('Hermes profile unavailable.');
      }
      await runSaveConfig();
      if (profileDraftDirtyRef.current) {
        let latestReadback = profileState;
        for (const [id, content] of learningEdits) {
          latestReadback = await applyHermesCardOperation({ projectId, deckId, cardId,
            change: { method: 'learning.edit', params: { id, content } } });
          profileReadbackRef.current = latestReadback;
          setHermesProfileState(latestReadback);
          if (learningEditsRef.current.get(id) === content) learningEditsRef.current.delete(id);
        }
        if (profileDraftRevisionRef.current === profileRevision) {
          profileDraftDirtyRef.current = false;
          if (latestReadback) acceptProfileReadback(latestReadback);
        }
      }
  }, [runSaveConfig, projectId, deckId, cardId, acceptProfileReadback]);

  const saveLatestDraftRef = useRef(saveCurrentDraft);
  useLayoutEffect(() => {
    saveLatestDraftRef.current = saveCurrentDraft;
  }, [saveCurrentDraft]);

  const saveOnCardLeave = useCallback((): Promise<boolean> => {
    // The canvas clears one selection and sets the other in the same click.
    // Both callers must await the same save, including any newer edits.
    if (cardSaveInFlightRef.current) return cardSaveInFlightRef.current;
    if (!draftDirtyRef.current && !profileDraftDirtyRef.current) return Promise.resolve(true);
    const save = Promise.resolve().then(async () => {
      setSaveCardStatus('saving');
      setSaveCardErrorMessage(null);
      try {
        while (draftDirtyRef.current || profileDraftDirtyRef.current) {
          await saveLatestDraftRef.current();
        }
        setSaveCardStatus('saved');
        return true;
      } catch (error) {
        setSaveCardStatus('failed');
        setSaveCardErrorMessage(error instanceof Error ? error.message : 'Could not save Card.');
        return false;
      } finally {
        cardSaveInFlightRef.current = null;
      }
    });
    cardSaveInFlightRef.current = save;
    return save;
  }, []);

  useEffect(() => {
    if (!draftDirtyRef.current && !profileDraftDirtyRef.current) return;
    const timer = window.setTimeout(() => { void saveOnCardLeave(); }, 350);
    return () => window.clearTimeout(timer);
  }, [draftRevision, saveOnCardLeave]);

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
  const subagentTypeField = editorField('subagentType');
  const accessModeField = editorField('accessMode');
  const modelKeyField = editorField('modelKey');
  const jevModelChoiceContextField = editorField('jevModelChoiceContext');
  const jevAutoToolsContextField = editorField('jevAutoToolsContext');
  const reasoningEffortField = editorField('reasoningEffort');
  const temperatureField = editorField('temperature');
  const maxTokensField = editorField('maxTokens');
  const maxTurnsField = editorField('maxTurns');
  const providerOptions = (providerField?.options || []).filter(
    (option) => (modelsByProvider[option.value] || []).length > 0,
  );
  const legacyTeam = (
    localConfig?.runtime_options as (AgentCardRuntimeOptions & { team?: { mode?: unknown } }) | null | undefined
  )?.team;
  const preservesHermesAutoTeam = runtimeKind === 'hermes'
    && localConfig?.runtime_options?.subagentType === undefined
    && legacyTeam?.mode === 'auto';
  const accessModeOptions = accessModeField?.options || [];
  const jevContextLabel = (mode: JevContextMode) => ({
    inherited: 'Inherited / current behavior',
    request_card: 'Current request + saved Card',
    conversation_window: 'Add bounded conversation window',
    selected_graph_context: 'Add selected graph context',
  })[mode];
  const supportedJevContextOptions = (field: InputDictionaryEditorField | undefined) => (
    (field?.options || []).filter((option): option is InputDictionaryEditorOption & { value: JevContextMode } => (
      option.value === 'inherited'
      || option.value === 'request_card'
      || option.value === 'conversation_window'
      || option.value === 'selected_graph_context'
    ))
  );
  const runtimeDictionaryReady = Boolean(
    runtimeOptionsStatus === 'ready'
    && providerField
    && subagentTypeField?.control === 'select'
    && accessModeField
    && modelKeyField
    && reasoningEffortField
    && temperatureField
    && maxTokensField
    && maxTurnsField,
  );
  const savedToolNames = parseListText(toolsText);
  const savedHermesToolsetNames = parseListText(toolsetsText);
  const selectedToolRows = buildInputDictionarySelectedRows(
    toolDictionaryPage.selectedKnownReferences,
    toolDictionaryPage.unresolvedSelectedIds,
  );
  const availableToolRows = toolDictionaryPage.references.filter((reference) =>
    !savedToolNames.includes(reference.canonicalId)
    && !showSelectedToolsOnly,
  );
  const toggleTool = (name: string, checked: boolean) => {
    setToolsText(toggleSavedToolAssignment(savedToolNames, name, checked).join('\n'));
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
          if (savedToolNames.length) params.set('selectedIds', savedToolNames.join(','));
          const response = await fetch(`/api/idd/tools?${params}`, {
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
    toolDictionaryNamespace,
    toolDictionaryOffset,
    toolDictionaryQuery,
  ]);

  const renderSectionBody = (sectionTab: string) => {
    if (sectionTab === 'Prompt') {
      const orchestratorOn = runtimeKind === 'hermes'
        && runtimeMode !== 'magentic_one'
        && (runtimeMode === 'main' || orchestratorEnabled);
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {runtimeKind === 'hermes' && runtimeMode !== 'magentic_one' ? (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#E0DED5', fontSize: 12 }}>
              <input
                type="checkbox"
                aria-label="Orchestrator"
                checked={orchestratorOn}
                disabled={runtimeMode === 'main'}
                onChange={(event) => {
                  setOrchestratorEnabled(event.target.checked);
                  setOrchestratorTouched(true);
                  markDraftDirty();
                }}
              />
              Orchestrator
            </label>
          ) : null}

          {orchestratorOn && outboundOrangeConnections.length > 0 ? (
            <label style={{ display: 'grid', gap: 7, color: '#E0DED5', fontSize: 12 }}>
              <span style={{ fontWeight: 700 }}>All connected agents</span>
              <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {outboundOrangeConnections.map((connection) => (
                  <span
                    key={`${connection.direction}:${connection.cardId}`}
                    style={{
                      padding: '3px 7px',
                      borderRadius: 999,
                      border: '1px solid rgba(242,166,74,.28)',
                      background: 'rgba(242,166,74,.08)',
                      color: '#F0D2A9',
                      fontSize: 10,
                    }}
                  >
                    {connection.title}
                  </span>
                ))}
              </span>
              <textarea
                aria-label="All connected agents"
                value={promptParts.connectedAgents}
                placeholder={outboundOrangeConnections
                  .map((connection) => (
                    `${connection.title} is a connected teammate. Describe when and why this Card should call it.`
                  ))
                  .join('\n')}
                onChange={(event) => {
                  setPromptParts((current) => ({ ...current, connectedAgents: event.target.value }));
                  setPromptPartsTouched((current) => ({ ...current, connectedAgents: true }));
                  markDraftDirty();
                }}
                rows={Math.max(5, Math.min(10, outboundOrangeConnections.length + 3))}
                style={{
                  width: '100%',
                  padding: 10,
                  background: '#2B2B2B',
                  color: '#FFF',
                  border: '1px solid rgba(242,166,74,.26)',
                  borderRadius: 8,
                  fontFamily: 'monospace',
                  fontSize: 13,
                  resize: 'vertical',
                }}
              />
            </label>
          ) : null}

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
                setPromptPartsTouched((current) => ({ ...current, role: true }));
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
                setPromptPartsTouched((current) => ({ ...current, goal: true }));
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
                setPromptPartsTouched((current) => ({ ...current, constraints: true }));
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
                setPromptPartsTouched((current) => ({ ...current, ioSchema: true }));
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
              value={promptParts.outputExpectations}
              onChange={(event) => {
                setPromptParts((current) => ({ ...current, outputExpectations: event.target.value }));
                setPromptPartsTouched((current) => ({ ...current, outputExpectations: true }));
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

          {promptFieldRanges(promptText).filter((block) => (
            !['role', 'goal', 'constraints', 'ioSchema', 'outputExpectations', 'connectedAgents'].includes(block.key)
            && (block.start !== block.end || promptPartsTouched[block.key])
          )).map((block) => (
            <label key={block.key} style={{ display: 'grid', gap: 6, color: '#E0DED5', fontSize: 12 }}>
              {block.key === 'memoryPolicy' ? 'Memory policy' : block.label}
              <textarea
                aria-label={block.key === 'memoryPolicy' ? 'Memory policy' : block.label}
                value={promptParts[block.key] ?? ''}
                onChange={(event) => {
                  const value = event.target.value;
                  setPromptParts((current) => ({ ...current, [block.key]: value }));
                  setPromptPartsTouched((current) => ({ ...current, [block.key]: true }));
                  markDraftDirty();
                }}
                rows={5}
                style={{ width: '100%', padding: 10, background: '#2B2B2B', color: '#FFF',
                  border: '1px solid #3A3A3A', borderRadius: 8, fontFamily: 'monospace',
                  fontSize: 13, resize: 'vertical' }}
              />
            </label>
          ))}

        </div>
      );
    }
    if (sectionTab === 'Script' && localConfig) {
      return (
        <CardScriptEditor
          cardId={cardId}
          runtimeKind={localConfig.runtime.kind}
          script={scriptDraft}
          selectedTools={savedToolNames}
          onChange={updateScriptDraft}
        />
      );
    }
    if (sectionTab === 'Skills') {
      return (
        <section
          data-testid="agent-manager-skills"
          style={{ display: 'grid', gap: 12, padding: 10, border: '1px solid #3A4A4F', borderRadius: 8, background: '#202827' }}
        >
          <div style={{ color: '#E0DED5', fontSize: 12, fontWeight: 600 }}>Skills</div>
          <textarea
            aria-label="Card skill grants"
            value={skillsText}
            onChange={(event) => {
              setSkillsText(event.target.value);
              markDraftDirty();
            }}
            placeholder="One skill ID per line"
            rows={5}
          />
          {runtimeKind !== 'hermes' ? null : hermesProfileStatus === 'failed' ? (
            <div role="alert" style={{ color: '#FFA2A2', fontSize: 11 }}>
              {hermesProfileError || 'Skills unavailable.'}
            </div>
          ) : hermesProfileState ? (
            <>
              <details data-testid="effective-hermes-skills">
                <summary style={{ cursor: 'pointer', color: '#D5E4E8', fontSize: 11.5 }}>
                  Loaded
                </summary>
                <div style={{ display: 'grid', gap: 5, marginTop: 8 }}>
                  {hermesProfileState.profile.skills.map((skill) => (
                    <div key={skill.name} style={{ color: '#B8C8CD', fontSize: 11 }}>
                      {skill.name} · {skill.enabled ? 'enabled' : 'disabled'}
                    </div>
                  ))}
                </div>
              </details>
              {hermesProfileState.profile.learning.buckets.some((bucket) => bucket.nodes.length > 0) ? (
                <section aria-label="Learning" style={{ display: 'grid', gap: 7 }}>
                  <div style={{ color: '#D5E4E8', fontSize: 11.5, fontWeight: 600 }}>Learning</div>
                  {hermesProfileState.profile.learning.buckets.map((bucket) => (
                    bucket.nodes.length ? (
                      <div key={`${bucket.index}:${bucket.date}`} style={{ display: 'grid', gap: 5 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: '#80969F', fontSize: 10.5 }}>
                          <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: '50%', background: bucket.color || '#80969F' }} />
                          <span>{bucket.label || bucket.date}</span>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                          {bucket.nodes.map((node) => (
                            <button
                              key={node.id}
                              type="button"
                              aria-label={`Open ${node.fullLabel || node.label}`}
                              title={node.meta || node.fullLabel || node.label}
                              onClick={() => void openHermesLearningNode(node.id)}
                              style={{
                                minWidth: 0,
                                padding: '4px 7px',
                                border: '1px solid #3A4A4F',
                                borderRadius: 999,
                                background: '#18201F',
                                color: '#B8C8CD',
                                fontSize: 10.5,
                                cursor: 'pointer',
                              }}
                            >
                              {node.glyph ? `${node.glyph} ` : ''}{node.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null
                  ))}
                </section>
              ) : null}
              {hermesLearningStatus === 'loading' ? <div style={{ color: '#80969F' }}>Opening…</div> : null}
              {hermesLearningStatus === 'failed' ? (
                <div role="alert" style={{ color: '#FFA2A2' }}>{hermesLearningError}</div>
              ) : null}
              {hermesLearningDetail ? (
                <section style={{ display: 'grid', gap: 6, padding: 8, border: '1px solid #42565C', borderRadius: 6 }}>
                  <strong>{hermesLearningDetail.kind}: {hermesLearningDetail.label}</strong>
                  <textarea
                    aria-label="Learning"
                    value={hermesLearningDraft}
                    onChange={(event) => {
                      setHermesLearningDraft(event.target.value);
                      learningEditsRef.current.set(hermesLearningDetail.id, event.target.value);
                      markProfileDraftDirty();
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

    if (sectionTab === 'Memory') {
      return (
        <section
          data-testid="agent-manager-memory"
          style={{ display: 'grid', gap: 12, padding: 10, border: '1px solid #3A4A4F', borderRadius: 8, background: '#202827' }}
        >
          <div style={{ color: '#E0DED5', fontSize: 12, fontWeight: 600 }}>Memory</div>
          {runtimeKind === 'hermes' && hermesProfileStatus === 'failed' ? (
            <div role="alert" style={{ color: '#FFA2A2', fontSize: 11 }}>
              {hermesProfileError || 'Memory unavailable.'}
            </div>
          ) : null}
        </section>
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
                      const key = event.target.value;
                      const selected = availableModels.find((model) => model.key === key);
                      if (key && !selected) return;
                      setModel({ key, providerModelId: selected?.providerModelId ?? null });
                      setAutoSelect(false);
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
                  {runtimeKind === 'hermes' ? (
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, color: '#91A9B8', fontSize: 11 }}>
                      <input
                        type="checkbox"
                        aria-label="Auto-select model with Jev"
                        checked={autoSelect}
                        onChange={(event) => {
                          setAutoSelect(event.target.checked);
                          markDraftDirty();
                        }}
                      />
                      Auto-select with Jev
                    </label>
                  ) : null}
                </div>
                {runtimeKind === 'hermes'
                && runtimeMode !== 'magentic_one'
                && !preservesHermesAutoTeam
                && subagentTypeField?.control === 'select' ? (
                  <div>
                    <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
                      {subagentTypeField.label}
                    </label>
                    <select
                      aria-label={subagentTypeField.label}
                      disabled={!runtimeDictionaryReady}
                      value={subagentType}
                      onChange={(event) => {
                        const value = event.target.value;
                        if (value !== 'none' && value !== 'leaf' && value !== 'recursive') return;
                        setSubagentType(value);
                        setSubagentTypeTouched(true);
                        markDraftDirty();
                      }}
                    >
                      {(subagentTypeField.options || [])
                        .filter((option) => (
                          option.value === 'none'
                          || option.value === 'leaf'
                          || option.value === 'recursive'
                        ))
                        .map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.value === 'none'
                              ? 'None'
                              : option.value === 'leaf'
                                ? 'Leaf'
                                : 'Recursive'}
                          </option>
                        ))}
                    </select>
                  </div>
                ) : null}
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
          {runtimeKind === 'hermes' ? (
            <details style={{ padding: 9, border: '1px solid #3A4A4F', borderRadius: 7,
              background: '#1A2221' }}>
              <summary style={{ cursor: 'pointer', color: '#D5E4E8', fontSize: 12, fontWeight: 600 }}>
                Jev context
              </summary>
              <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
                <div style={{ color: '#80969F', fontSize: 10.5 }}>
                  These choices add bounded semantic evidence to this Card&apos;s model-choice and Auto-tools decisions.
                  The current request, saved Card contract, candidates, and grants always remain required. No choice grants data or tools.
                </div>
                {[{
                  key: 'modelChoice' as const,
                  label: jevModelChoiceContextField?.label || 'Model-choice context',
                  field: jevModelChoiceContextField,
                }, {
                  key: 'autoTools' as const,
                  label: jevAutoToolsContextField?.label || 'Auto-tools context',
                  field: jevAutoToolsContextField,
                }].map(({ key, label, field }) => {
                  const options = supportedJevContextOptions(field);
                  const current = jevContext[key];
                  return (
                    <label key={key} style={{ display: 'grid', gap: 5, color: '#B9CDD2', fontSize: 11 }}>
                      {label}
                      <select
                        aria-label={label}
                        disabled={!runtimeDictionaryReady || !options.length}
                        value={current}
                        onChange={(event) => {
                          const selected = event.target.value as JevContextMode;
                          if (!options.some((option) => option.value === selected)) return;
                          setJevContext((value) => ({ ...value, [key]: selected }));
                          setJevContextTouched(true);
                          markDraftDirty();
                        }}
                      >
                        {current && !options.some((option) => option.value === current) ? (
                          <option value={current}>{jevContextLabel(current)} (saved)</option>
                        ) : null}
                        {options.map((option) => (
                          <option key={option.value} value={option.value}>
                            {jevContextLabel(option.value)}
                          </option>
                        ))}
                      </select>
                    </label>
                  );
                })}
                {!supportedJevContextOptions(jevModelChoiceContextField).length
                || !supportedJevContextOptions(jevAutoToolsContextField).length ? (
                  <div role="status" style={{ color: '#D2A86B', fontSize: 10.5 }}>
                    Jev context choices are unavailable from the current Input Data Dictionary; saved policy is unchanged.
                  </div>
                ) : null}
                <div style={{ color: '#71878D', fontSize: 10 }}>
                  Graph Focus, Think/Know relationship classification, and fulfillment scoring keep their purpose-specific provider inputs;
                  they are not silently reconfigured by these Card-level choices.
                </div>
              </div>
            </details>
          ) : null}
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
            Application capabilities
          </div>
          {runtimeKind === 'hermes' ? (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#91A9B8', fontSize: 11 }}>
              <input
                type="checkbox"
                aria-label="Auto-tools with Jev"
                checked={autoTools}
                onChange={(event) => {
                  setAutoTools(event.target.checked);
                  markDraftDirty();
                }}
              />
              Auto-tools · choose only from this Card's selected authorized tools
            </label>
          ) : null}
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
                Available
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
                    checked={savedToolNames.includes(tool.canonicalId)}
                    disabled={!tool.available}
                    onChange={(event) => toggleTool(tool.canonicalId, event.target.checked)}
                    aria-label={`Include ${tool.displayName || tool.canonicalId}`}
                  />
                  <span>
                    <span title={tool.description} style={{ display: 'block', color: '#D5E4E8', fontSize: 11 }}>
                      {tool.displayName || tool.canonicalId}
                    </span>
                    <span style={{ display: 'block', color: '#80969F', fontSize: 10 }}>
                      {!tool.available ? ' · Unavailable in current catalog' : ''}
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
          {runtimeKind === 'hermes' ? (
            <section
              aria-label="Hermes capabilities"
              data-testid="hermes-toolsets"
              style={{
                display: 'grid',
                gap: 8,
                padding: '10px 12px',
                border: '1px solid #3A4A4F',
                borderRadius: 8,
              }}
            >
              <div style={{ color: '#E0DED5', fontSize: 12, fontWeight: 600 }}>
                Hermes capabilities
              </div>
              <div style={{ color: '#80969F', fontSize: 10.5 }}>
                Hermes toolsets saved on this Card. These are not MCP tools.
              </div>
              {hermesProfileStatus === 'failed' ? (
                <div role="alert" style={{ color: '#FFA2A2', fontSize: 11 }}>
                  {hermesProfileError || 'Hermes capabilities unavailable. Saved selections are unchanged.'}
                </div>
              ) : hermesProfileState ? (
                hermesProfileState.profile.toolsets.length ? (
                  <div style={{ display: 'grid', gap: 6 }}>
                    {hermesProfileState.profile.toolsets.map((toolset) => {
                      const label = toolset.label || toolset.name;
                      return (
                        <label
                          key={toolset.name}
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '18px 1fr',
                            gap: 8,
                            alignItems: 'start',
                            padding: '7px 8px',
                            border: '1px solid #344542',
                            borderRadius: 6,
                            cursor: 'pointer',
                          }}
                        >
                          <input
                            type="checkbox"
                            aria-label={`Enable Hermes ${label}`}
                            checked={savedHermesToolsetNames.includes(toolset.name)}
                            onChange={(event) => {
                              setToolsetsText(toggleSavedToolAssignment(
                                savedHermesToolsetNames,
                                toolset.name,
                                event.target.checked,
                              ).join('\n'));
                              markDraftDirty();
                            }}
                          />
                          <span>
                            <span title={toolset.description} style={{ display: 'block', color: '#D5E4E8', fontSize: 11 }}>
                              {label}{label !== toolset.name ? ` · ${toolset.name}` : ''}
                            </span>
                            <span style={{ display: 'block', color: '#80969F', fontSize: 10 }}>
                              {typeof toolset.tool_count === 'number' ? `${toolset.tool_count} tools · ` : ''}
                              Profile readback: {toolset.enabled ? 'enabled' : 'disabled'}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ color: '#80969F', fontSize: 11 }}>
                    No Hermes toolsets are available for this profile.
                  </div>
                )
              ) : (
                <div role="status" style={{ color: '#80969F', fontSize: 11 }}>
                  Loading Hermes capabilities…
                </div>
              )}
            </section>
          ) : null}
          {renderSectionBody('Script')}
          <section
            aria-label="External connections"
            style={{ display: 'grid', gap: 8, padding: '10px 12px', border: '1px solid #3A4A4F', borderRadius: 8 }}
          >
            <div style={{ color: '#E0DED5', fontSize: 12, fontWeight: 600 }}>External connections</div>
            <label style={{ display: 'grid', gap: 6, color: '#D5E4E8', fontSize: 12 }}>
              External MCP connection references
              <textarea
                aria-label="External MCP connection references"
                value={mcpConnectionIdsText}
                onChange={(event) => {
                  setMcpConnectionIdsText(event.target.value);
                  markDraftDirty();
                }}
                placeholder="One configured connection ID per line"
                rows={4}
              />
            </label>
          </section>
          {runtimeKind === 'hermes' && hermesProfileState ? (
            <section
              data-testid="effective-hermes-runtime"
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
                Effective runtime / diagnostics
              </div>
              <div style={{ color: '#91A9B8', fontSize: 11 }}>
                Profile {hermesProfileState.binding.profile} · saved Card authority materializes at Run start. Effective Hermes profile values are read-only here.
              </div>
              {hermesProfileState.profile.mcpServers.length ? hermesProfileState.profile.mcpServers.map((server) => {
                const checked = hermesMcpChecks[server.name];
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
                      <div style={{ color: '#D5E4E8', fontSize: 11.5 }}>
                        {server.name} · {server.enabled ? 'enabled' : 'disabled'} · {server.credentialStatus.replace('_', ' ')}
                      </div>
                      <button
                        type="button"
                        onClick={() => void checkHermesMcpServer(server.name)}
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
                          ? `Connected · ${checked.toolCount} MCP tools discovered`
                          : checked.status === 'failed'
                            ? checked.error || 'Connection failed.'
                            : 'Checking connection…'}
                      </div>
                    ) : null}
                  </div>
                );
              }) : (
                <div style={{ color: '#80969F', fontSize: 11 }}>No Hermes MCP connections are configured.</div>
              )}
            </section>
          ) : null}
        </div>
      );
    }

    return null;
  };

  const sectionBody = activeTab === 'Prompt'
    ? (
        <div data-testid="agent-manager-prompt-surface" style={{ display: 'grid', gap: 16 }}>
          <section aria-label="Prompt configuration">{renderSectionBody('Prompt')}</section>
        </div>
      )
    : activeTab === 'Runtime'
      ? (
          <div data-testid="agent-manager-runtime-surface" style={{ display: 'grid', gap: 16 }}>
            {projectId && deckId && cardId ? (
              <CardRuntimeDashboard projectId={projectId} deckId={deckId} cardId={cardId} />
            ) : null}
            <section aria-label="Runtime configuration">{renderSectionBody('Runtime')}</section>
            {runtimeKind === 'hermes'
            && runtimeMode !== 'magentic_one'
            && (subagentType !== 'none' || preservesHermesAutoTeam) ? (
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
          </div>
        )
      : activeTab === 'Memory'
        ? renderSectionBody('Memory')
        : activeTab === 'Skills'
          ? renderSectionBody('Skills')
          : activeTab === 'Tools'
            ? (
                <div data-testid="agent-manager-tools-surface" style={{ display: 'grid', gap: 16 }}>
                  {renderSectionBody('Tools')}
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
        Select an agent to edit.
      </div>
    );
  }

  if (!sectionBody) {
    return null;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, colorScheme: 'dark' }}>
      {sectionBody}
      {saveCardStatus === 'failed' && saveCardErrorMessage ? (
        <span role="alert" data-testid="agent-manager-save-error" style={{ color: '#FFA2A2', fontSize: 11.5 }}>
          {saveCardErrorMessage}
        </span>
      ) : null}
    </div>
  );
}
