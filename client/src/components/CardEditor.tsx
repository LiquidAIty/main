// Graph + less = more: less code that does the same work as more code is more useful.
// Entity names the feature; Relationship explains why this file belongs and what it contributes.
// Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
// Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
// Entity: Saved Cards
// Relationship: This file edits one saved Card's title, prompt, runtime, model, reasoning, delegation, skills, tools, connections, orchestrator skill, and optional Python source.
// Entity: Agent Builder
// Relationship: This file owns the human-facing Prompt, Runtime, Memory, Skills, Tools, and Script editing surfaces inside the construction workspace.
// Entity: IDD
// Relationship: This file loads the current Card-editor field and choice projection instead of maintaining a second runtime configuration dictionary.
// Entity: Card Profiles
// Relationship: This file reads effective profile state and learning details without exposing transport diagnostics or interactive MCP authentication in every Card editor.
// Entity: Tool Catalog
// Relationship: This file searches and selects live profile-eligible capabilities while preserving unresolved saved selections and the Card's explicit grant ceiling.
// Entity: Card Scripts
// Relationship: This file mounts the saved Python Script editor and persists only the visible Script configuration returned by that bounded editor.
// Entity: Run Ledger
// Relationship: This file reads the selected Card's latest runtime and token metrics for display without starting or reconciling a Run.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type {
  AgentCardRuntimeOptions,
  CardRuntime,
} from '../types/agentgraph';
import { CardScriptEditor } from '../features/agentbuilder/CardScriptEditor';
import HermesSkillGraph from '../features/agentbuilder/HermesSkillGraph';
import {
  applyCardProfileOperation,
  loadCardProfile,
  loadCardLearningDetail,
  type CardProfileView,
} from '../features/agentbuilder/cardProfileClient';

type ModelOption = { key: string; label: string; providerModelId: string };
type SavedSubagentModel = NonNullable<AgentCardRuntimeOptions['subagentModel']>;
type SavedSubagentType = NonNullable<AgentCardRuntimeOptions['subagentType']>;
type SavedCardScript = NonNullable<AgentCardRuntimeOptions['script']>;
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
  };
}

function subagentAccessMode(provider: string): SavedSubagentModel['accessMode'] {
  return provider === 'openrouter' ? 'openrouter-api'
    : provider === 'openai' ? 'chatgpt-account'
    : 'openai-api';
}
type InputDictionaryEditorField = {
  name: string;
  label: string;
  control: 'select' | 'catalog-select' | 'catalog-multiselect' | 'number' | 'integer' | 'text' | 'checkbox';
  options?: Array<{ value: string; label: string }>;
};

function parseCardEditorOptions(payload: unknown): {
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
type DisplayedToolRow = {
  name: string;
  title?: string;
  description?: string;
  availability: 'available' | 'disabled' | 'stale';
};

type InputDictionaryToolReference = {
  canonicalId: string;
  displayName?: string;
  shortDescription?: string;
  available: boolean;
  grantEligible: boolean;
  grantProfiles: string[];
};

type InputDictionaryToolPage = {
  references: InputDictionaryToolReference[];
  selectedKnownReferences: InputDictionaryToolReference[];
  unresolvedSelectedIds: string[];
  namespaces: string[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
};

function buildInputDictionarySelectedRows(
  selectedReferences: InputDictionaryToolReference[],
  unresolvedSelectedIds: string[],
): DisplayedToolRow[] {
  const known = selectedReferences.map((reference) => ({
      name: reference.canonicalId,
      title: reference.displayName || reference.canonicalId,
      description: reference.shortDescription,
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

interface CardEditorProps {
  cardId?: string;
  projectId?: string;
  deckId?: string;
  activeTab: string;
  cardName?: string;
  onChangeCardName?: (value: string) => void;
  localConfig?: CardEditorConfig | null;
  onSaveLocalConfig?: (config: CardEditorConfig) => void | Promise<void>;
  orangeConnections?: Array<{
    cardId: string;
    title: string;
    direction: 'incoming' | 'outgoing';
    prompt?: string;
  }>;
}

export type CardEditorConfig = {
  runtime: CardRuntime;
  runtime_options?: AgentCardRuntimeOptions | null;
  parent_graph_id?: string | null;
  role?: string | null;
  output_contract?: unknown;
  provider?: 'openai' | 'openrouter' | 'local_openai_compatible' | '' | null;
  access_mode?: 'chatgpt-account' | 'openai-api' | 'openrouter-api' | '' | null;
  model_key?: string | null;
  reasoning_effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra' | null;
  prompt_template?: string | null;
  tools?: unknown[];
  skills?: unknown[];
  toolsets?: unknown[];
  mcp_connection_ids?: unknown[];
};

type RuntimeMetrics = { runtimeMs: number | null; totalTokens: number | null };

function formatRuntime(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'unavailable';
  const totalSeconds = Math.max(0, Math.floor(value / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatTokens(value: number | null): string {
  return value === null || !Number.isFinite(value)
    ? 'unavailable'
    : Math.round(value).toLocaleString('en-US');
}

type PromptFields = {
  role: string;
  goal: string;
  constraints: string;
  ioSchema: string;
  memoryPolicy: string;
  outputExpectations: string;
  orchestratorSkill: string;
};

const PROMPT_HEADINGS: Record<string, keyof PromptFields> = {
  ROLE: 'role', GOAL: 'goal', CONSTRAINTS: 'constraints',
  IO_SCHEMA: 'ioSchema', INPUT_SCHEMA: 'ioSchema', MEMORY_POLICY: 'memoryPolicy',
  OUTPUT_EXPECTATIONS: 'outputExpectations', OUTPUT_CONTRACT: 'outputExpectations',
  OUTPUT_REQUIREMENTS: 'outputExpectations',
  ORCHESTRATOR_SKILL: 'orchestratorSkill',
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
  orchestratorSkill: 'ORCHESTRATOR SKILL',
};

function stripRetiredConnectedAgentSections(template: string): string {
  const retired = new Set(['ALL_CONNECTED_AGENTS', 'ALL_AGENTS_CONNECTED']);
  const headings = promptHeadings(template);
  let result = template;
  for (let index = headings.length - 1; index >= 0; index -= 1) {
    const heading = headings[index];
    if (!retired.has(promptHeadingKey(heading.label))) continue;
    const end = headings[index + 1]?.index ?? template.length;
    result = result.slice(0, heading.index) + result.slice(end);
  }
  return result.trim();
}

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
  template = stripRetiredConnectedAgentSections(template);
  const fields: PromptFields & Record<string, string> = {
    role: '', goal: '', constraints: '', ioSchema: '', memoryPolicy: '', outputExpectations: '',
    orchestratorSkill: '',
  };
  for (const range of promptFieldRanges(template)) fields[range.key] = template.slice(range.start, range.end);
  return fields;
}

function serializePromptFields(fields: PromptFields & Record<string, string>, original: string, edited: Record<string, boolean>): string {
  original = stripRetiredConnectedAgentSections(original);
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
  return text
    .split(/[\r\n,]+/)
    .map((entry) => entry.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean);
}

export function CardEditor({
  cardId = '',
  projectId = '',
  deckId = '',
  activeTab,
  cardName = '',
  onChangeCardName,
  localConfig,
  onSaveLocalConfig,
  orangeConnections = [],
}: CardEditorProps) {
  const isLocalConfigMode = Boolean(localConfig && onSaveLocalConfig);
  const outboundOrangeConnections = orangeConnections.filter(
    (connection) => connection.direction === 'outgoing',
  );
  const [saveCardErrorMessage, setSaveCardErrorMessage] = useState<string | null>(null);
  const [selectedConnectedCardId, setSelectedConnectedCardId] = useState<string | null>(null);
  const [runtimeMetrics, setRuntimeMetrics] = useState<RuntimeMetrics | null>(null);
  const [runtimeMetricsLoading, setRuntimeMetricsLoading] = useState(false);
  const cardSaveInFlightRef = useRef<Promise<boolean> | null>(null);
  const [draftRevision, setDraftRevision] = useState(0);
  const cardDraftRevisionRef = useRef(0);
  const cardLearningRevisionRef = useRef(0);
  const cardLearningDirtyRef = useRef(false);
  const cardProfileReadbackRef = useRef<CardProfileView | null>(null);
  const runtimeKind = localConfig?.runtime.kind;
  const runtimeMode = localConfig?.runtime.mode;
  const selectedConnectedCard = outboundOrangeConnections.find(
    (connection) => connection.cardId === selectedConnectedCardId,
  ) || null;
  const selectedConnectedIntroduction = selectedConnectedCard
    ? parsePromptTemplate(String(selectedConnectedCard.prompt || '')).orchestratorSkill.trim()
    : '';
  const [cardNameDraft, setCardNameDraft] = useState(cardName);

  useEffect(() => {
    setSelectedConnectedCardId(null);
  }, [cardId]);
  const [provider, setProvider] = useState<NonNullable<CardEditorConfig['provider']>>('');
  const [accessMode, setAccessMode] = useState<
    'chatgpt-account' | 'openai-api' | 'openrouter-api' | ''
  >('');
  const [{ key: modelKey, providerModelId }, setModel] = useState<{
    key: string; providerModelId?: string | null;
  }>({ key: '' });
  const [autoModel, setAutoModel] = useState(false);
  const [autoTools, setAutoTools] = useState(false);
  const [orchestratorEnabled, setOrchestratorEnabled] = useState(false);
  const [orchestratorTouched, setOrchestratorTouched] = useState(false);
  const [subagentModel, setSubagentModel] = useState<SavedSubagentModel>(DEFAULT_SUBAGENT_MODEL);
  const [subagentType, setSubagentType] = useState<SavedSubagentType>('none');
  const [subagentTouched, setSubagentTouched] = useState(false);
  const [subagentTypeTouched, setSubagentTypeTouched] = useState(false);
  const learningEditsRef = useRef(new Map<string, string>());
  const [scriptDraft, setScriptDraft] = useState<SavedCardScript>(blankCardScript);
  const scriptDraftCacheRef = useRef<Map<string, SavedCardScript>>(new Map());
  const dirtyScriptCardsRef = useRef<Set<string>>(new Set());
  const [reasoningEffort, setReasoningEffort] = useState<
    'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra' | ''
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
  const [toolDictionaryBusy, setToolDictionaryBusy] = useState(true);
  const [toolOptionsError, setToolOptionsError] = useState(false);
  const [promptText, setPromptText] = useState('');
  const [promptParts, setPromptParts] = useState<PromptFields & Record<string, string>>({
    role: '',
    goal: '',
    constraints: '',
    ioSchema: '',
    memoryPolicy: '',
    outputExpectations: '',
    orchestratorSkill: '',
  });
  const [promptPartsTouched, setPromptPartsTouched] = useState<Record<string, boolean>>({});
  const [toolsText, setToolsText] = useState('');
  const [skillsText, setSkillsText] = useState('');
  const [toolsetsText, setToolsetsText] = useState('');
  const [mcpConnectionIdsText, setMcpConnectionIdsText] = useState('');
  const [cardProfileState, setCardProfileState] = useState<CardProfileView | null>(null);
  const [cardProfileStatus, setCardProfileStatus] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [cardProfileError, setCardProfileError] = useState<string | null>(null);
  const [profileSettingBusy, setProfileSettingBusy] = useState(false);
  const [profileSettingError, setProfileSettingError] = useState<string | null>(null);
  const profileIdentityRef = useRef('');
  profileIdentityRef.current = `${projectId}:${deckId}:${cardId}`;
  const [cardLearningDetail, setCardLearningDetail] = useState<{
    kind: 'memory' | 'skill';
    id: string;
    label: string;
    content: string;
  } | null>(null);
  const [cardLearningDraft, setCardLearningDraft] = useState('');
  const [cardLearningStatus, setCardLearningStatus] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [cardLearningError, setCardLearningError] = useState<string | null>(null);
  const draftDirtyRef = useRef(false);
  useEffect(() => {
    setCardNameDraft(cardName);
  }, [cardId, cardName]);

  useEffect(() => {
    if (activeTab !== 'Runtime' || !projectId || !deckId || !cardId) {
      setRuntimeMetrics(null);
      setRuntimeMetricsLoading(false);
      return;
    }
    const controller = new AbortController();
    setRuntimeMetrics(null);
    setRuntimeMetricsLoading(true);
    void fetch('/api/cards/runs/read', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'metrics', projectId, deckId, cardId, inspectOnly: true,
      }),
      signal: controller.signal,
    }).then(async (response) => {
      const payload = await response.json().catch(() => null) as Record<string, any> | null;
      if (!response.ok || payload?.ok !== true) {
        throw new Error(String(payload?.error || 'card_runtime_metrics_unavailable'));
      }
      const result = payload.result && typeof payload.result === 'object'
        ? payload.result as Record<string, unknown>
        : null;
      if (result && String(result.cardId || '') !== cardId) {
        throw new Error('card_runtime_metrics_identity_mismatch');
      }
      setRuntimeMetrics(result ? {
        runtimeMs: typeof result.runtimeMs === 'number' ? result.runtimeMs : null,
        totalTokens: typeof result.totalTokens === 'number' ? result.totalTokens : null,
      } : null);
      setRuntimeMetricsLoading(false);
    }).catch(() => {
      if (controller.signal.aborted) return;
      setRuntimeMetrics(null);
      setRuntimeMetricsLoading(false);
    });
    return () => controller.abort();
  }, [activeTab, cardId, deckId, projectId]);

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
    setAutoModel(localConfig.runtime_options?.autoModel === true);
    setAutoTools(localConfig.runtime_options?.autoTools === true);
    setOrchestratorEnabled(
      localConfig.runtime.mode === 'main'
      || localConfig.runtime_options?.orchestrator === true,
    );
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
    savedScript.enabled = Boolean(savedScript.source.trim());
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

  const acceptCardProfileReadback = useCallback((state: CardProfileView | null) => {
    cardProfileReadbackRef.current = state;
    setCardProfileState(state);
    if (!state) {
      setCardLearningDetail(null);
      setCardLearningDraft('');
      setCardLearningStatus('idle');
      setCardLearningError(null);
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
      acceptCardProfileReadback(null);
      setCardProfileStatus('idle');
      setCardProfileError(null);
      return;
    }
    const controller = new AbortController();
    acceptCardProfileReadback(null);
    setCardProfileStatus('loading');
    setCardProfileError(null);
    setCardLearningDetail(null);
    setCardLearningDraft('');
    setCardLearningStatus('idle');
    setCardLearningError(null);
    void loadCardProfile({ projectId, deckId, cardId, signal: controller.signal })
      .then((state) => {
        if (controller.signal.aborted) return;
        acceptCardProfileReadback(state);
        setCardProfileStatus('ready');
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        acceptCardProfileReadback(null);
        setCardProfileStatus('failed');
        setCardProfileError(error instanceof Error ? error.message : 'Profile unavailable.');
      });
    return () => controller.abort();
  // Card profile readback is identity-scoped and deliberately independent from
  // unsaved Card drafts. Card save never mutates the bound profile.
  }, [isLocalConfigMode, projectId, deckId, cardId, acceptCardProfileReadback]);


  const markDraftDirty = () => {
    draftDirtyRef.current = true;
    cardDraftRevisionRef.current += 1;
    setDraftRevision((revision) => revision + 1);
  };

  const markCardLearningDirty = () => {
    cardLearningDirtyRef.current = true;
    cardLearningRevisionRef.current += 1;
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
    };
    scriptDraftCacheRef.current.set(cardId, structuredClone(nextDraft));
    if (changed) dirtyScriptCardsRef.current.add(cardId);
    else dirtyScriptCardsRef.current.delete(cardId);
    setScriptDraft(nextDraft);
    markDraftDirty();
  };

  const buildCurrentLocalPayload = useCallback((): CardEditorConfig => {
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
    const editedConfig: CardEditorConfig = {
      runtime: localConfig.runtime,
      provider,
      access_mode: accessMode,
      model_key: modelKey || null,
      reasoning_effort: reasoningEffort || null,
      prompt_template: serializedPrompt,
      tools: parseListText(toolsText),
      skills: parseListText(skillsText),
      toolsets: parseListText(toolsetsText),
      mcp_connection_ids: parseListText(mcpConnectionIdsText),
    };
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
        && (autoModel || localConfig.runtime_options?.autoModel !== undefined)
          ? { autoModel }
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
    provider,
    accessMode,
    modelKey,
    providerModelId,
    autoModel,
    autoTools,
    orchestratorEnabled,
    orchestratorTouched,
    subagentModel,
    subagentTouched,
    subagentType,
    subagentTypeTouched,
    scriptDraft,
    reasoningEffort,
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

  const openCardLearningNode = useCallback(async (nodeId: string) => {
    if (!projectId || !deckId || !cardId) return;
    setCardLearningStatus('loading');
    setCardLearningError(null);
    try {
      const detail = await loadCardLearningDetail({ projectId, deckId, cardId, nodeId });
      setCardLearningDetail(detail);
      setCardLearningDraft(learningEditsRef.current.get(nodeId) ?? detail.content);
      setCardLearningStatus('ready');
    } catch (error) {
      setCardLearningStatus('failed');
      setCardLearningError(error instanceof Error ? error.message : 'Card learning node unavailable.');
    }
  }, [projectId, deckId, cardId]);

  const changeProfileSetting = async (method: 'toolset.toggle' | 'skill.toggle', name: string, enabled: boolean) => {
    if (profileSettingBusy) return;
    const identity = profileIdentityRef.current;
    setProfileSettingBusy(true);
    setProfileSettingError(null);
    try {
      const state = await applyCardProfileOperation({ projectId, deckId, cardId,
        change: { method, params: { name, enabled } } });
      if (profileIdentityRef.current !== identity) return;
      acceptCardProfileReadback(state);
      if (method === 'toolset.toggle') {
        setToolsetsText(state.profile.toolsets.filter(row => row.enabled && row.platform === 'cli').map(row => row.name).join('\n'));
      } else {
        setSkillsText(state.profile.skills.filter(row => row.enabled).map(row => row.name).join('\n'));
      }
      markDraftDirty();
    } catch (error) {
      if (profileIdentityRef.current === identity) setProfileSettingError(error instanceof Error ? error.message : 'Card setting failed.');
    } finally {
      setProfileSettingBusy(false);
    }
  };

  const saveCurrentDraft = useCallback(async (): Promise<void> => {
      const learningRevision = cardLearningRevisionRef.current;
      const profileState = cardProfileReadbackRef.current;
      const learningEdits = [...learningEditsRef.current];
      if (cardLearningDirtyRef.current) {
        if (!profileState || !projectId || !deckId || !cardId) throw new Error('Card profile unavailable.');
      }
      await runSaveConfig();
      if (cardLearningDirtyRef.current) {
        let latestReadback = profileState;
        for (const [id, content] of learningEdits) {
          latestReadback = await applyCardProfileOperation({ projectId, deckId, cardId,
            change: { method: 'learning.edit', params: { id, content } } });
          cardProfileReadbackRef.current = latestReadback;
          setCardProfileState(latestReadback);
          if (learningEditsRef.current.get(id) === content) learningEditsRef.current.delete(id);
        }
        if (cardLearningRevisionRef.current === learningRevision) {
          cardLearningDirtyRef.current = false;
          if (latestReadback) acceptCardProfileReadback(latestReadback);
        }
      }
  }, [runSaveConfig, projectId, deckId, cardId, acceptCardProfileReadback]);

  const saveLatestDraftRef = useRef(saveCurrentDraft);
  useLayoutEffect(() => {
    saveLatestDraftRef.current = saveCurrentDraft;
  }, [saveCurrentDraft]);

  const saveOnCardLeave = useCallback((): Promise<boolean> => {
    // The canvas clears one selection and sets the other in the same click.
    // Both callers must await the same save, including any newer edits.
    if (cardSaveInFlightRef.current) return cardSaveInFlightRef.current;
    if (!draftDirtyRef.current && !cardLearningDirtyRef.current) return Promise.resolve(true);
    const save = Promise.resolve().then(async () => {
      setSaveCardErrorMessage(null);
      try {
        while (draftDirtyRef.current || cardLearningDirtyRef.current) {
          await saveLatestDraftRef.current();
        }
        return true;
      } catch (error) {
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
    if (!draftDirtyRef.current && !cardLearningDirtyRef.current) return;
    const timer = window.setTimeout(() => { void saveOnCardLeave(); }, 350);
    return () => window.clearTimeout(timer);
  }, [draftRevision, saveOnCardLeave]);

  const availableModels = provider ? modelsByProvider[provider] || [] : [];
  const subagentCatalogOptions = Object.entries(modelsByProvider).flatMap(([catalogProvider, models]) => (
    models.map((model) => ({ provider: catalogProvider, ...model }))
  ));

  const editorField = (name: string) => cardEditorFields.find((field) => field.name === name);
  const providerField = editorField('provider');
  const subagentTypeField = editorField('subagentType');
  const accessModeField = editorField('accessMode');
  const modelKeyField = editorField('modelKey');
  const autoModelField = editorField('autoModel');
  const autoToolsField = editorField('autoTools');
  const reasoningEffortField = editorField('reasoningEffort');
  const providerOptions = (providerField?.options || []).filter(
    (option) => (modelsByProvider[option.value] || []).length > 0,
  );
  const accessModeOptions = accessModeField?.options || [];
  const runtimeDictionaryReady = Boolean(
    runtimeOptionsStatus === 'ready'
    && providerField
    && subagentTypeField?.control === 'select'
    && accessModeField
    && modelKeyField
    && autoModelField?.control === 'checkbox'
    && autoToolsField?.control === 'checkbox'
    && reasoningEffortField,
  );
  const savedToolNames = parseListText(toolsText);
  const selectedToolRows = buildInputDictionarySelectedRows(
    toolDictionaryPage.selectedKnownReferences,
    toolDictionaryPage.unresolvedSelectedIds,
  );
  const toggleTool = (name: string, checked: boolean) => {
    const next = checked
      ? savedToolNames.includes(name) ? savedToolNames : [...savedToolNames, name]
      : savedToolNames.filter((savedName) => savedName !== name);
    setToolsText(next.join('\n'));
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
            projectId,
            deckId,
            cardId,
            query: '',
            offset: '0',
            limit: '200',
          });
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
            offset: 0,
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
    projectId,
    deckId,
    cardId,
    savedToolNames.join('\u0000'),
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
            <div style={{ display: 'grid', gap: 7, color: '#E0DED5', fontSize: 12 }}>
              <span style={{ fontWeight: 700 }}>All connected agents</span>
              <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {outboundOrangeConnections.map((connection) => (
                  <button
                    type="button"
                    key={`${connection.direction}:${connection.cardId}`}
                    onClick={() => setSelectedConnectedCardId(connection.cardId)}
                    style={{
                      padding: '3px 7px',
                      borderRadius: 999,
                      border: connection.cardId === selectedConnectedCardId
                        ? '1px solid rgba(111,224,214,.62)'
                        : '1px solid rgba(242,166,74,.28)',
                      background: connection.cardId === selectedConnectedCardId
                        ? 'rgba(111,224,214,.14)'
                        : 'rgba(242,166,74,.08)',
                      color: '#F0D2A9',
                      fontSize: 10,
                      cursor: 'pointer',
                    }}
                  >
                    {connection.title}
                  </button>
                ))}
              </span>
              {selectedConnectedCard ? (
                <section
                  aria-label={`${selectedConnectedCard.title} introduction`}
                  style={{
                    display: 'grid',
                    gap: 8,
                    padding: 12,
                    borderRadius: 10,
                    border: '1px solid rgba(111,224,214,.28)',
                    background: 'rgba(20,24,28,.52)',
                  }}
                >
                  <strong style={{ color: '#6FE0D6' }}>@{selectedConnectedCard.title}</strong>
                  <div style={{ color: '#D6DFE2', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                    {selectedConnectedIntroduction || 'This Card does not yet have a saved orchestrator introduction.'}
                  </div>
                </section>
              ) : null}
            </div>
          ) : null}

          {onChangeCardName ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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
                    background: 'rgba(20,24,28,0.52)',
                    color: '#FFF',
                    border: '1px solid #3A3A3A',
                    borderRadius: 8,
                  }}
                />
              </div>
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
                background: 'rgba(20,24,28,0.52)',
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
                background: 'rgba(20,24,28,0.52)',
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
                background: 'rgba(20,24,28,0.52)',
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
                background: 'rgba(20,24,28,0.52)',
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
                background: 'rgba(20,24,28,0.52)',
                color: '#FFF',
                border: '1px solid #3A3A3A',
                borderRadius: 8,
                fontFamily: 'monospace',
                fontSize: 13,
                resize: 'vertical',
              }}
            />
          </div>

          {promptFieldRanges(stripRetiredConnectedAgentSections(promptText)).filter((block) => (
            !['role', 'goal', 'constraints', 'ioSchema', 'outputExpectations'].includes(block.key)
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
                style={{ width: '100%', padding: 10, background: 'rgba(20,24,28,0.52)', color: '#FFF',
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
          projectId={projectId}
          deckId={deckId}
          runtimeKind={localConfig.runtime.kind}
          script={scriptDraft}
          selectedTools={savedToolNames}
          onChange={updateScriptDraft}
        />
      );
    }
    if (sectionTab === 'Skills') {
      return (
        <section data-testid="agent-manager-skills" style={{ display: 'grid', gap: 12 }}>
          {cardProfileStatus === 'failed' ? (
            <div role="alert">{cardProfileError || 'Skills unavailable.'}</div>
          ) : cardProfileState ? (
            <>
              <HermesSkillGraph graph={cardProfileState.profile.learning.graph}
                profile={cardProfileState.binding.profile}
                onOpenNode={(id) => void openCardLearningNode(id)} />
              <details>
                <summary>Installed skills</summary>
                <div style={{ display: 'grid', gap: 6 }}>
                  {cardProfileState.profile.skills.map((skill) => (
                    <label key={skill.name}>
                      <input type="checkbox" checked={skill.enabled} disabled={profileSettingBusy}
                        aria-label={`Enable skill ${skill.name}`}
                        onChange={(event) => void changeProfileSetting('skill.toggle', skill.name, event.target.checked)} />
                      {' '}{skill.name}
                    </label>
                  ))}
                </div>
              </details>
              {profileSettingError ? <div role="alert">{profileSettingError}</div> : null}
              {cardLearningStatus === 'loading' ? <div role="status">Opening…</div> : null}
              {cardLearningStatus === 'failed' ? <div role="alert">{cardLearningError}</div> : null}
              {cardLearningDetail ? (
                <section style={{ display: 'grid', gap: 6 }}>
                  <strong>{cardLearningDetail.kind}: {cardLearningDetail.label}</strong>
                  <textarea aria-label="Learning" value={cardLearningDraft} rows={10}
                    onChange={(event) => {
                      setCardLearningDraft(event.target.value);
                      learningEditsRef.current.set(cardLearningDetail.id, event.target.value);
                      markCardLearningDirty();
                    }} />
                </section>
              ) : null}
            </>
          ) : <div role="status">Loading Hermes learning graph…</div>}
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
                      setAutoModel(false);
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
                  {runtimeKind === 'hermes' && runtimeMode !== 'magentic_one' ? (
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, color: '#91A9B8', fontSize: 11 }}>
                      <input
                        type="checkbox"
                        aria-label="Auto Model with Jev"
                        disabled={!runtimeDictionaryReady}
                        checked={autoModel}
                        onChange={(event) => {
                          setAutoModel(event.target.checked);
                          markDraftDirty();
                        }}
                      />
                      {autoModelField?.label || 'Auto Model'} with Jev
                    </label>
                  ) : null}
                </div>
                {runtimeKind === 'hermes'
                && runtimeMode !== 'magentic_one'
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

            <div>
              <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
                Reasoning effort
              </label>
              <select
                aria-label="Reasoning effort"
                disabled={!runtimeDictionaryReady}
                value={reasoningEffort}
                onChange={(event) => {
                  setReasoningEffort(
                    event.target.value as 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra' | '',
                  );
                  markDraftDirty();
                }}
                style={{
                  width: '100%',
                  padding: 8,
                  background: 'rgba(20,24,28,0.52)',
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
            </div>
          </div>
        </div>
      );
    }

    if (sectionTab === 'Tools') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <section aria-label="Hermes tools" style={{ display: 'grid', gap: 8 }}>
            <strong>Hermes</strong>
            {cardProfileStatus === 'failed' ? <div role="alert">{cardProfileError}</div>
              : !cardProfileState ? <div role="status">Loading Hermes tools…</div>
              : cardProfileState.profile.toolsets.map(toolset => (
                <div key={toolset.name}>
                  <label title={toolset.description}>
                    <input type="checkbox" checked={toolset.enabled} disabled={profileSettingBusy}
                      aria-label={`Enable Hermes ${toolset.name}`}
                      onChange={(event) => void changeProfileSetting('toolset.toggle', toolset.name, event.target.checked)} />
                    {' '}{toolset.label || toolset.name}
                  </label>
                  {toolset.tools?.length ? <details style={{ paddingLeft: 22 }}>
                    <summary>{toolset.tools.length} tools</summary>
                    {toolset.tools.map(name => <div key={name}><code>{name}</code></div>)}
                  </details> : null}
                </div>
              ))}
            {profileSettingError ? <div role="alert">{profileSettingError}</div> : null}
          </section>
          <div style={{ color: '#E0DED5', fontSize: 12, fontWeight: 600 }}>
            Application capabilities
          </div>
          {runtimeKind === 'hermes' && runtimeMode !== 'magentic_one' ? (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#91A9B8', fontSize: 11 }}>
              <input
                type="checkbox"
                aria-label="Auto Tools with Jev"
                disabled={!runtimeDictionaryReady}
                checked={autoTools}
                onChange={(event) => {
                  setAutoTools(event.target.checked);
                  markDraftDirty();
                }}
              />
              {autoToolsField?.label || 'Auto Tools'} with Jev · choose only from this Card's selected authorized tools
            </label>
          ) : null}
          {toolDictionaryBusy ? (
            <div style={{ color: '#80969F', fontSize: 11 }}>Loading selected tools…</div>
          ) : null}
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
                    aria-label={`Include ${tool.name}`}
                  />
                  <span>
                    <code style={{ display: 'block', color: '#D5E4E8', fontSize: 11 }}>
                      {tool.name}
                    </code>
                    <span style={{ display: 'block', color: '#80969F', fontSize: 10 }}>
                      {tool.availability === 'stale' ? ' · Unavailable in current catalog' : ''}
                      {tool.availability === 'disabled' ? ' · Currently unavailable' : ''}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          ) : null}
          {!selectedToolRows.length && !toolDictionaryBusy && !toolOptionsError ? (
            <div style={{ color: '#91A9B8', fontSize: 11 }}>
              No tools are selected for this Card.
            </div>
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
            <section
              aria-label="Runtime usage"
              style={{
                display: 'flex', gap: 18, padding: '9px 11px', border: '1px solid #3A4A4F',
                borderRadius: 8, background: 'rgba(24,34,36,0.44)', color: '#D5E4E8', fontSize: 11.5,
              }}
            >
              <span>
                Runtime: {runtimeMetricsLoading
                  ? 'loading…'
                  : formatRuntime(runtimeMetrics?.runtimeMs ?? null)}
              </span>
              <span>
                Tokens: {runtimeMetricsLoading
                  ? 'loading…'
                  : formatTokens(runtimeMetrics?.totalTokens ?? null)}
              </span>
            </section>
            <section aria-label="Runtime configuration">{renderSectionBody('Runtime')}</section>
            {runtimeKind === 'hermes'
            && runtimeMode !== 'magentic_one'
            && subagentType !== 'none' ? (
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
      : activeTab === 'Skills'
          ? renderSectionBody('Skills')
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
          background: 'rgba(15,18,22,0.46)',
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
      {saveCardErrorMessage ? (
        <span role="alert" data-testid="agent-manager-save-error" style={{ color: '#FFA2A2', fontSize: 11.5 }}>
          {saveCardErrorMessage}
        </span>
      ) : null}
    </div>
  );
}
