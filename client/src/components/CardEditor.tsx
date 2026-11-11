// Entity: Saved Cards
// Relationship: Edits one saved Card's title, prompt and runtime options, including model, reasoning, delegation, skills, tools, orchestrator skill and optional Python source.
// Entity: Agent Builder
// Relationship: Owns the human-facing Prompt, Runtime, Skills and Tools surfaces, including the embedded Script editor, inside the construction workspace.
// Entity: IDD
// Relationship: This file loads the current Card-editor field and choice projection instead of maintaining a second runtime configuration dictionary.
// Entity: Card Profiles
// Relationship: Publishes compiled PromptBlocks to SOUL.md, edits the Card's logically named profile skill, and selects optional Hermes library skills without exposing storage paths.
// Entity: Tool Catalog
// Relationship: Displays selected application capabilities from IDD, preserves unavailable saved selections, and edits the Card's explicit grants through checkboxes.
// Entity: Card Scripts
// Relationship: This file mounts the saved Python Script editor and persists only the visible Script configuration returned by that bounded editor.
// Entity: Saved Cards
// Relationship: Displays the selected Card profile's Hermes-reported model, active-model count, token usage, and average latency without another Run metrics route.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type {
  AgentCardRuntimeOptions,
  CardRuntime,
} from '../types/agentgraph';
import { CardScriptEditor } from '../features/agentbuilder/CardScriptEditor';
import { applicationFetch } from '../lib/applicationApi';
import { buildBasicHermesCardSkill } from '../features/hermes/hermesCardSkill';
import type { HermesRuntimeSnapshot } from '../features/hermes/hermesRuntimeClient';
import {
  configureHermesProfile,
  connectHermesApplicationTools,
  createHermesProfile,
  createHermesSkill,
  loadHermesProfile,
  loadHermesSkill,
  saveHermesSkill,
  type HermesProfileView,
} from '../features/hermes/hermesProfileClient';

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

function hermesProfileProvider(
  provider: CardEditorConfig['provider'],
  accessMode: CardEditorConfig['access_mode'],
): string {
  if (provider === 'openai' && accessMode === 'chatgpt-account') return 'openai-codex';
  if (provider === 'openrouter') return 'openrouter';
  if (provider === 'openai') return 'openai';
  return String(provider || '').trim();
}

function hermesProfileDescription(
  runtime: CardRuntime,
  cardName: string,
  prompt: string,
): string {
  const category = runtime.mode === 'main'
    ? 'Category: system. User-facing Project orchestrator.'
    : runtime.mode === 'magentic_one'
      ? 'Category: team. Fixed saved blue-wire specialist roster.'
      : runtime.profile === 'team'
        ? 'Category: fallback-team. Automatic decomposition when no specialist matches.'
        : runtime.profile === 'builder'
          ? 'Category: builder. Prompts, saved Cards, UI, and supporting code.'
          : runtime.profile === 'thinkgraph'
            ? 'Category: memory. Engraphis reasoning and operational knowledge.'
            : runtime.profile === 'knowgraph'
              ? 'Category: research. Firecrawl evidence and Graphiti sourced knowledge.'
              : `Category: specialist. ${String(cardName || runtime.profile).trim()}.`;
  const callGuidance = parsePromptTemplate(prompt).orchestratorSkill.trim();
  return callGuidance ? `${category}\n${callGuidance}` : category;
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
  wiredConnections?: Array<{
    cardId: string;
    cardRevisionId: string;
    title: string;
    profile: string;
    direction: 'incoming' | 'outgoing';
    edgeType: 'flow' | 'magentic_option';
    prompt?: string;
  }>;
  runtimeSnapshot?: HermesRuntimeSnapshot;
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

function formatDuration(value: number | null): string {
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

async function loadCardScriptRuntime(
  projectId: string,
  deckId: string,
  cardId: string,
): Promise<Record<string, unknown> | null> {
  const params = new URLSearchParams({ projectId, deckId, cardId });
  const response = await applicationFetch(`/api/idd/card-script-runtime?${params}`, {
    credentials: 'include',
  });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || payload?.ok !== true) {
    throw new Error(String(payload?.error || 'card_script_runtime_unavailable'));
  }
  const script = payload.script;
  if (script === null || script === undefined) return null;
  if (!script || typeof script !== 'object' || Array.isArray(script)) {
    throw new Error('card_script_runtime_invalid');
  }
  return script as Record<string, unknown>;
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
  wiredConnections = [],
  runtimeSnapshot,
}: CardEditorProps) {
  const isLocalConfigMode = Boolean(localConfig && onSaveLocalConfig);
  const outboundWiredConnections = wiredConnections.filter(
    (connection) => connection.direction === 'outgoing',
  );
  const [saveCardErrorMessage, setSaveCardErrorMessage] = useState<string | null>(null);
  const [selectedConnectedCardId, setSelectedConnectedCardId] = useState<string | null>(null);
  const cardSaveInFlightRef = useRef<Promise<boolean> | null>(null);
  const [draftRevision, setDraftRevision] = useState(0);
  const cardDraftRevisionRef = useRef(0);
  const runtimeKind = localConfig?.runtime.kind;
  const runtimeMode = localConfig?.runtime.mode;
  const selectedConnectedCard = outboundWiredConnections.find(
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
  const [orchestratorEnabled, setOrchestratorEnabled] = useState(false);
  const [orchestratorTouched, setOrchestratorTouched] = useState(false);
  const [subagentModel, setSubagentModel] = useState<SavedSubagentModel>(DEFAULT_SUBAGENT_MODEL);
  const [subagentType, setSubagentType] = useState<SavedSubagentType>('none');
  const [subagentTouched, setSubagentTouched] = useState(false);
  const [subagentTypeTouched, setSubagentTypeTouched] = useState(false);
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
  const [toolDictionaryQuery, setToolDictionaryQuery] = useState('');
  const [showSelectedToolsOnly, setShowSelectedToolsOnly] = useState(true);
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
  const [hermesProfile, setHermesProfile] = useState<HermesProfileView | null>(null);
  const [hermesProfileStatus, setHermesProfileStatus] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [hermesProfileError, setHermesProfileError] = useState<string | null>(null);
  const [hermesProfileBusy, setHermesProfileBusy] = useState(false);
  const [appToolsConnected, setAppToolsConnected] = useState(false);
  const [skillEditor, setSkillEditor] = useState<{
    name: string;
    content: string;
    savedContent: string;
    exists: boolean;
    status: 'loading' | 'ready' | 'saving' | 'failed';
    error?: string;
  } | null>(null);
  const draftDirtyRef = useRef(false);
  useEffect(() => {
    setCardNameDraft(cardName);
  }, [cardId, cardName]);

  useEffect(() => {
    let active = true;
    setRuntimeOptionsStatus('loading');
    setCardEditorFields([]);
    setModelsByProvider({});
    void applicationFetch('/api/cards/options')
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

  useEffect(() => {
    const profile = localConfig?.runtime.kind === 'hermes'
      ? localConfig.runtime.profile.trim()
      : '';
    setHermesProfile(null);
    setHermesProfileError(null);
    setAppToolsConnected(false);
    setSkillEditor(null);
    if (!isLocalConfigMode || !profile) {
      setHermesProfileStatus('idle');
      return;
    }
    let active = true;
    setHermesProfileStatus('loading');
    void loadHermesProfile(profile).then((state) => {
      if (!active) return;
      setHermesProfile(state);
      setHermesProfileStatus('ready');
    }).catch((error) => {
      if (!active) return;
      setHermesProfileStatus('failed');
      setHermesProfileError(error instanceof Error ? error.message : 'Hermes profile unavailable.');
    });
    return () => { active = false; };
  }, [cardId, isLocalConfigMode, localConfig?.runtime]);

  const cardSkillName = localConfig?.runtime.kind === 'hermes'
    ? localConfig.runtime.profile.trim().toLowerCase()
    : '';
  const cardSkillInstalled = Boolean(
    cardSkillName
    && hermesProfile?.skills.some((skill) => skill.name === cardSkillName),
  );

  useEffect(() => {
    const profile = localConfig?.runtime.kind === 'hermes'
      ? localConfig.runtime.profile.trim()
      : '';
    if (activeTab !== 'Skills' || !profile || hermesProfileStatus !== 'ready') return;
    if (!cardSkillInstalled) {
      setSkillEditor({
        name: cardSkillName,
        content: buildBasicHermesCardSkill({
          profile,
          title: cardName,
          mode: localConfig?.runtime.mode || '',
        }),
        savedContent: '',
        exists: false,
        status: 'ready',
      });
      return;
    }
    let active = true;
    setSkillEditor({
      name: cardSkillName,
      content: '',
      savedContent: '',
      exists: true,
      status: 'loading',
    });
    void loadHermesSkill(profile, cardSkillName).then((result) => {
      if (!active) return;
      setSkillEditor({
        name: result.name,
        content: result.content,
        savedContent: result.content,
        exists: true,
        status: 'ready',
      });
    }).catch((error) => {
      if (!active) return;
      setSkillEditor({
        name: cardSkillName,
        content: '',
        savedContent: '',
        exists: true,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Custom skill unavailable.',
      });
    });
    return () => { active = false; };
  }, [
    activeTab,
    cardId,
    cardName,
    cardSkillName,
    cardSkillInstalled,
    hermesProfileStatus,
    localConfig?.runtime,
  ]);

  const markDraftDirty = () => {
    draftDirtyRef.current = true;
    cardDraftRevisionRef.current += 1;
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
    if (payload.runtime.kind === 'hermes') {
      const profileDescription = hermesProfileDescription(
        payload.runtime,
        cardName,
        String(payload.prompt_template || ''),
      );
      const profileModel = String(payload.runtime_options?.providerModelId || payload.model_key || '').trim() || undefined;
      const profileProvider = hermesProfileProvider(
        payload.provider,
        payload.access_mode,
      ) || undefined;
      const activeProfile = hermesProfile || await loadHermesProfile(
        payload.runtime.profile,
      ).catch(() => createHermesProfile({
        profile: payload.runtime.profile,
        description: profileDescription,
        soul: String(payload.prompt_template || ''),
        model: profileModel,
        provider: profileProvider,
      }));
      setHermesProfile(activeProfile);
      setHermesProfileStatus('ready');
      const selectedTools = parseListText(String((payload.tools || []).join('\n')));
      const savedSkills = parseListText(String((payload.skills || []).join('\n')));
      const selectedSkills = [
        ...savedSkills.filter((name) => name === payload.runtime.profile),
        ...savedSkills.filter((name) => name !== payload.runtime.profile),
      ];
      const cardScript = await loadCardScriptRuntime(projectId, deckId, cardId);
      const enabledMcpServers = new Set(parseListText(String(
        (payload.mcp_connection_ids || []).join('\n'),
      )));
      if (selectedTools.length || cardScript) enabledMcpServers.add('liquidaity');
      const orchestrator = payload.runtime.mode === 'main'
        || payload.runtime_options?.orchestrator === true;
      const taskMode = payload.runtime.mode === 'magentic_one'
        ? 'magnetic' as const
        : payload.runtime.profile === 'team'
          ? 'team' as const
          : '' as const;
      const savedSubagentModel = payload.runtime_options?.subagentModel;
      const profileSubagentModel = savedSubagentModel
        ? {
            provider: hermesProfileProvider(
              savedSubagentModel.provider as AgentCardRuntimeOptions['provider'],
              savedSubagentModel.accessMode,
            ),
            model: savedSubagentModel.providerModelId || savedSubagentModel.modelKey,
            // The Card exposes one effort control; its leaf inherits that choice.
            reasoningEffort: payload.reasoning_effort || '',
          }
        : null;
      const botModeRoster = payload.runtime.mode === 'magentic_one'
        ? outboundWiredConnections
          .filter((connection) => connection.edgeType === 'magentic_option')
          .map((connection) => connection.profile)
        : orchestrator
          ? outboundWiredConnections.map((connection) => connection.profile)
          : [];
      const enabledToolsets = new Set(
        parseListText(String((payload.toolsets || []).join('\n'))),
      );
      if (cardScript || taskMode) enabledToolsets.add('card-tools');
      else enabledToolsets.delete('card-tools');
      const state = await configureHermesProfile({
        profile: payload.runtime.profile,
        soul: String(payload.prompt_template || ''),
        description: profileDescription,
        model: profileModel,
        provider: profileProvider,
        reasoningEffort: payload.reasoning_effort || '',
        subagentType: payload.runtime.mode === 'magentic_one'
          ? undefined : payload.runtime_options?.subagentType,
        enabledSkills: selectedSkills,
        autoLoadSkills: selectedSkills,
        enabledToolsets: [...enabledToolsets],
        enabledMcpServers: [...enabledMcpServers],
        botModeRoster,
        applicationTools: selectedTools,
        cardScript,
        taskMode,
        subagentModel: profileSubagentModel,
      });
      setHermesProfile(state);
      setHermesProfileStatus('ready');
      setHermesProfileError(null);
    }
    if (cardDraftRevisionRef.current === revision) {
      draftDirtyRef.current = false;
    }
  }, [
    isLocalConfigMode,
    localConfig,
    onSaveLocalConfig,
    buildCurrentLocalPayload,
    hermesProfile,
    outboundWiredConnections,
    cardName,
    projectId,
    deckId,
    cardId,
  ]);

  const changeSavedToolset = async (name: string, enabled: boolean) => {
    if (!localConfig || localConfig.runtime.kind !== 'hermes' || hermesProfileBusy) return;
    const current = parseListText(toolsetsText);
    const next = enabled
      ? [...new Set([...current, name])]
      : current.filter((entry) => entry !== name);
    setHermesProfileBusy(true);
    setHermesProfileError(null);
    try {
      const state = await configureHermesProfile({
        profile: localConfig.runtime.profile,
        enabledToolsets: next,
      });
      setHermesProfile(state);
      setToolsetsText(next.join('\n'));
      markDraftDirty();
    } catch (error) {
      setHermesProfileError(error instanceof Error ? error.message : 'Hermes profile update failed.');
    } finally {
      setHermesProfileBusy(false);
    }
  };

  const connectAppTools = async () => {
    if (!projectId || !deckId || !cardId || localConfig?.runtime.kind !== 'hermes'
      || hermesProfileBusy) return;
    setHermesProfileBusy(true);
    setHermesProfileError(null);
    setAppToolsConnected(false);
    try {
      await runSaveConfig();
      const state = await connectHermesApplicationTools({ projectId, deckId, cardId,
        profile: localConfig.runtime.profile });
      setHermesProfile(state);
      setHermesProfileStatus('ready');
      setAppToolsConnected(true);
    } catch (error) {
      setHermesProfileError(error instanceof Error ? error.message : 'App-tool setup failed.');
    } finally {
      setHermesProfileBusy(false);
    }
  };

  const saveCardSkill = async () => {
    if (
      !localConfig
      || localConfig.runtime.kind !== 'hermes'
      || !skillEditor
      || skillEditor.status === 'saving'
      || hermesProfileBusy
    ) return;
    const profile = localConfig.runtime.profile;
    const { content, exists: existed } = skillEditor;
    let writeCompleted = false;
    setHermesProfileBusy(true);
    setHermesProfileError(null);
    setSkillEditor((current) => current
      ? { ...current, status: 'saving', error: undefined }
      : current);
    try {
      if (existed) await saveHermesSkill(profile, cardSkillName, content);
      else await createHermesSkill(profile, cardSkillName, content);
      writeCompleted = true;
      setSkillEditor((current) => current
        ? { ...current, exists: true, savedContent: content }
        : current);
      const savedSkills = parseListText(skillsText);
      const selectedSkills = [
        ...savedSkills.filter((name) => name === cardSkillName),
        ...savedSkills.filter((name) => name !== cardSkillName),
      ];
      const state = await configureHermesProfile({
        profile,
        enabledSkills: selectedSkills,
        autoLoadSkills: selectedSkills,
      });
      setHermesProfile(state);
      setSkillEditor((current) => current
        ? { ...current, exists: true, savedContent: content, status: 'ready', error: undefined }
        : current);
      markDraftDirty();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Custom skill save failed.';
      setHermesProfileError(message);
      setSkillEditor((current) => current
        ? {
            ...current,
            exists: current.exists || writeCompleted,
            savedContent: writeCompleted ? content : current.savedContent,
            status: 'ready',
            error: message,
          }
        : current);
    } finally {
      setHermesProfileBusy(false);
    }
  };

  const saveCurrentDraft = useCallback(async (): Promise<void> => {
    await runSaveConfig();
  }, [runSaveConfig]);

  const saveLatestDraftRef = useRef(saveCurrentDraft);
  useLayoutEffect(() => {
    saveLatestDraftRef.current = saveCurrentDraft;
  }, [saveCurrentDraft]);

  const saveOnCardLeave = useCallback((): Promise<boolean> => {
    // The canvas clears one selection and sets the other in the same click.
    // Both callers must await the same save, including any newer edits.
    if (cardSaveInFlightRef.current) return cardSaveInFlightRef.current;
    if (!draftDirtyRef.current) return Promise.resolve(true);
    const save = Promise.resolve().then(async () => {
      setSaveCardErrorMessage(null);
      try {
        while (draftDirtyRef.current) {
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
    if (!draftDirtyRef.current) return;
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
    && reasoningEffortField,
  );
  const savedToolNames = parseListText(toolsText);
  const selectedToolRows = buildInputDictionarySelectedRows(
    toolDictionaryPage.selectedKnownReferences,
    toolDictionaryPage.unresolvedSelectedIds,
  );
  const availableToolRows = showSelectedToolsOnly
    ? []
    : toolDictionaryPage.references.filter(
        (reference) => !savedToolNames.includes(reference.canonicalId),
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
            query: toolDictionaryQuery,
            offset: '0',
            limit: '200',
          });
          if (savedToolNames.length) params.set('selectedIds', savedToolNames.join(','));
          const response = await applicationFetch(`/api/idd/tools?${params}`, {
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

          {orchestratorOn && outboundWiredConnections.length > 0 ? (
            <div style={{ display: 'grid', gap: 7, color: '#E0DED5', fontSize: 12 }}>
              <span style={{ fontWeight: 700 }}>All connected agents</span>
              <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {outboundWiredConnections.map((connection) => (
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
      const selectedSkills = new Set(parseListText(skillsText));
      const selectSkill = (name: string, checked: boolean) => {
        const next = new Set(selectedSkills);
        if (checked) next.add(name);
        else next.delete(name);
        setSkillsText([...next].join('\n'));
        markDraftDirty();
      };
      const librarySkills = (hermesProfile?.skills || [])
        .filter((skill) => skill.name !== cardSkillName)
        .sort((left, right) => left.name.localeCompare(right.name));
      return (
        <section data-testid="agent-manager-skills" style={{ display: 'grid', gap: 12 }}>
          <strong>Skills</strong>
          <div style={{ color: '#91A9B8', fontSize: 11 }}>
            Edit this Card&apos;s own skill and optionally include any discovered Hermes library skills.
            PromptBlocks remain in SOUL.md; storage paths are managed by Hermes.
          </div>
          {hermesProfileStatus === 'loading' ? <div role="status">Loading skills…</div> : null}
          {hermesProfileStatus === 'failed' ? <div role="alert">{hermesProfileError}</div> : null}
          {hermesProfileError && hermesProfileStatus !== 'failed' ? <div role="alert">{hermesProfileError}</div> : null}
          {skillEditor ? (
            <section style={{ display: 'grid', gap: 8 }} aria-label="Skill editor">
              <strong>{skillEditor.exists ? 'Edit' : 'Create'} {skillEditor.name}</strong>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" aria-label="Use custom skill"
                  checked={selectedSkills.has(cardSkillName)}
                  onChange={(event) => selectSkill(cardSkillName, event.target.checked)} />
                <span>Use custom skill</span>
              </label>
              {skillEditor.status === 'loading' ? <div role="status">Loading skill…</div> : null}
              {skillEditor.error ? <div role="alert">{skillEditor.error}</div> : null}
              {skillEditor.status === 'ready' || skillEditor.status === 'saving' ? <>
                <textarea aria-label="Skill content" rows={16} value={skillEditor.content}
                  disabled={skillEditor.status === 'saving'}
                  onChange={(event) => setSkillEditor((current) => current
                    ? { ...current, content: event.target.value }
                    : current)} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button"
                    disabled={skillEditor.status === 'saving'
                      || (skillEditor.exists && skillEditor.content === skillEditor.savedContent)}
                    onClick={() => void saveCardSkill()}>Save Skill</button>
                </div>
              </> : null}
            </section>
          ) : null}
          {hermesProfileStatus === 'ready' ? (
            <fieldset aria-label="Hermes skill library" style={{ display: 'grid', gap: 6 }}>
              <legend style={{ color: '#E0DED5', fontSize: 12 }}>Optional Hermes library skills</legend>
              {librarySkills.map((skill) => (
                <label key={skill.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" checked={selectedSkills.has(skill.name)}
                    onChange={(event) => selectSkill(skill.name, event.target.checked)} />
                  <span>{skill.name}</span>
                </label>
              ))}
              {!librarySkills.length ? (
                <span style={{ color: '#91A9B8', fontSize: 11 }}>No optional Hermes skills are available.</span>
              ) : null}
            </fieldset>
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
      const savedToolsets = parseListText(toolsetsText);
      const visibleToolsets = hermesProfile?.toolsets || savedToolsets.map((name) => ({
        name, enabled: true,
      }));
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <section aria-label="Hermes tools" style={{ display: 'grid', gap: 8 }}>
            <strong>Hermes toolsets</strong>
            {hermesProfileStatus === 'loading' ? <div role="status">Loading Hermes toolsets…</div> : null}
            {visibleToolsets.length ? visibleToolsets.map((toolset) => (
              <label key={toolset.name} title={toolset.description}>
                <input type="checkbox" checked={toolset.enabled} disabled={hermesProfileBusy}
                  aria-label={`Enable Hermes ${toolset.name}`}
                  onChange={(event) => void changeSavedToolset(toolset.name, event.target.checked)} />
                {' '}{toolset.label || toolset.name}
                {toolset.toolCount ? ` · ${toolset.toolCount}` : ''}
              </label>
            )) : hermesProfileStatus === 'ready' ? <div>No Hermes toolsets.</div> : null}
            {hermesProfileError ? <div role="alert">{hermesProfileError}</div> : null}
          </section>
          <div style={{ color: '#E0DED5', fontSize: 12, fontWeight: 600 }}>
            Application capabilities
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button" disabled={hermesProfileBusy || !projectId || !cardId}
              onClick={() => void connectAppTools()}>Connect app tools</button>
            {appToolsConnected ? <span role="status">Connection tested</span> : null}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
            <input
              value={toolDictionaryQuery}
              onChange={(event) => setToolDictionaryQuery(event.target.value)}
              placeholder="Search ID, name, namespace, or description"
              aria-label="Search tools"
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#91A9B8', fontSize: 11 }}>
              <input
                type="checkbox"
                checked={showSelectedToolsOnly}
                onChange={(event) => setShowSelectedToolsOnly(event.target.checked)}
              />
              Selected only
            </label>
          </div>
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
          {availableToolRows.length ? (
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
                    cursor: tool.available && tool.grantEligible ? 'pointer' : 'default',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={false}
                    disabled={!tool.available || !tool.grantEligible}
                    onChange={(event) => toggleTool(tool.canonicalId, event.target.checked)}
                    aria-label={`Include ${tool.canonicalId}`}
                  />
                  <span>
                    <span title={tool.shortDescription} style={{ display: 'block', color: '#D5E4E8', fontSize: 11 }}>
                      {tool.displayName || tool.canonicalId}
                    </span>
                    <code style={{ display: 'block', color: '#80969F', fontSize: 10 }}>
                      {tool.canonicalId}
                    </code>
                    {!tool.available ? (
                      <span style={{ display: 'block', color: '#80969F', fontSize: 10 }}>
                        Currently unavailable
                      </span>
                    ) : !tool.grantEligible ? (
                      <span style={{ display: 'block', color: '#80969F', fontSize: 10 }}>
                        Not grant eligible
                      </span>
                    ) : null}
                  </span>
                </label>
              ))}
            </div>
          ) : !selectedToolRows.length && !toolDictionaryBusy && !toolOptionsError ? (
            <div style={{ color: '#91A9B8', fontSize: 11 }}>
              {showSelectedToolsOnly ? 'No tools are selected for this Card.' : 'No tools match this search.'}
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
                Avg runtime: {runtimeSnapshot === undefined
                  ? 'loading…'
                  : formatDuration(runtimeSnapshot.averageLatencyMs)}
              </span>
              <span>
                Tokens: {runtimeSnapshot === undefined
                  ? 'loading…'
                  : formatTokens(runtimeSnapshot.totalTokens)}
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
