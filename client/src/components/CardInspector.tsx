import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { SavedCardConfiguration } from '../types/agentgraph';
import {
  assertUniqueCanonicalPromptSections,
  buildCardConfigurationFromEditorFields,
  buildInputDictionarySelectedRows,
  parseCardListEditorText,
  parseCardEditorOptions,
  parseCardPromptTemplate,
  serializeCardPromptFields,
  toggleSavedToolAssignment,
  type CardEditorConfiguration,
  type CardEditorModelOption,
  type CardPromptFields,
  type InputDictionaryEditorField,
  type InputDictionaryToolPage,
} from '../features/agentbuilder/cardConfigurationEditor';
import {
  CardInspectorPromptView,
  CardInspectorRuntimeView,
} from './CardInspectorPromptRuntime';
import {
  CardInspectorMemoryView,
  CardInspectorSkillsView,
  CardInspectorToolsView,
} from './CardInspectorCapabilities';
import {
  applyHermesCardOperation,
  loadHermesCardProfile,
  loadHermesLearningDetail,
  testHermesMcp,
  type HermesCardProfileView,
} from '../features/agentbuilder/hermesCardProfile';

type SavedSubagentModel = NonNullable<SavedCardConfiguration['subagentModel']>;
type SavedSubagentType = NonNullable<SavedCardConfiguration['subagentType']>;
type SavedCardScript = NonNullable<SavedCardConfiguration['script']>;
type SavedJevContext = NonNullable<SavedCardConfiguration['jevContext']>;
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
interface CardInspectorProps {
  cardId?: string;
  projectId?: string;
  deckId?: string;
  activeTab: string;
  cardName?: string;
  onChangeCardName?: (value: string) => void;
  localConfig?: CardEditorConfiguration | null;
  onSaveLocalConfig?: (config: CardEditorConfiguration) => void | Promise<void>;
  projectCodeFolder?: string | null;
  onSetProjectCodeFolder?: (folder: string) => Promise<void>;
  registerCardDraftFlush?: (save: (() => Promise<boolean>) | null) => void;
  orangeConnections?: Array<{
    cardId: string;
    title: string;
    direction: 'incoming' | 'outgoing';
  }>;
}

type SaveCardStatus = 'idle' | 'saving' | 'saved' | 'failed';

export function CardInspector({
  cardId = '',
  projectId = '',
  deckId = '',
  activeTab,
  cardName = '',
  onChangeCardName,
  localConfig,
  onSaveLocalConfig,
  projectCodeFolder = null,
  onSetProjectCodeFolder,
  registerCardDraftFlush,
  orangeConnections = [],
}: CardInspectorProps) {
  const isLocalConfigMode = Boolean(localConfig && onSaveLocalConfig);
  const outboundOrangeConnections = orangeConnections.filter(
    (connection) => connection.direction === 'outgoing',
  );
  const [saveCardStatus, setSaveCardStatus] = useState<SaveCardStatus>('idle');
  const [saveCardErrorMessage, setSaveCardErrorMessage] = useState<string | null>(null);
  const [projectFolderDraft, setProjectFolderDraft] = useState(projectCodeFolder || '');
  const [projectFolderStatus, setProjectFolderStatus] = useState<SaveCardStatus>('idle');
  const [projectFolderError, setProjectFolderError] = useState<string | null>(null);
  const cardSaveInFlightRef = useRef<Promise<boolean> | null>(null);
  const [draftRevision, setDraftRevision] = useState(0);
  const cardDraftRevisionRef = useRef(0);
  const profileDraftRevisionRef = useRef(0);
  const profileDraftDirtyRef = useRef(false);
  const profileReadbackRef = useRef<HermesCardProfileView | null>(null);
  const runtimeKind = localConfig?.runtime.kind;
  const runtimeMode = localConfig?.runtime.mode;
  const [cardNameDraft, setCardNameDraft] = useState(cardName);
  const [provider, setProvider] = useState<NonNullable<CardEditorConfiguration['provider']>>('');
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
  const [modelsByProvider, setModelsByProvider] = useState<Record<string, CardEditorModelOption[]>>({});
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
  const [promptParts, setPromptParts] = useState<CardPromptFields & Record<string, string>>({
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

  useEffect(() => {
    setProjectFolderDraft(projectCodeFolder || '');
    setProjectFolderStatus('idle');
    setProjectFolderError(null);
  }, [projectCodeFolder]);

  const setProjectCodeFolder = useCallback(async () => {
    if (!onSetProjectCodeFolder || projectFolderStatus === 'saving') return;
    setProjectFolderStatus('saving');
    setProjectFolderError(null);
    try {
      await onSetProjectCodeFolder(projectFolderDraft.trim());
      setProjectFolderStatus('saved');
    } catch (error) {
      setProjectFolderStatus('failed');
      setProjectFolderError(
        error instanceof Error && error.message
          ? error.message
          : 'Could not save the Project code folder.',
      );
    }
  }, [onSetProjectCodeFolder, projectFolderDraft, projectFolderStatus]);
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
    const parsedPrompt = parseCardPromptTemplate(localConfig.prompt_template || '');
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

  const buildCurrentLocalPayload = useCallback((): CardEditorConfiguration => {
    if (!localConfig) throw new Error('card_config_missing');
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
    const runtimeOptions: SavedCardConfiguration = {
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

  const flushCardDraft = useCallback((): Promise<boolean> => {
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
    const timer = window.setTimeout(() => { void flushCardDraft(); }, 350);
    return () => window.clearTimeout(timer);
  }, [draftRevision, flushCardDraft]);

  useEffect(() => {
    registerCardDraftFlush?.(flushCardDraft);
    return () => registerCardDraftFlush?.(null);
  }, [registerCardDraftFlush, flushCardDraft]);

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
    localConfig?.runtime_options as (SavedCardConfiguration & { team?: { mode?: unknown } }) | null | undefined
  )?.team;
  const preservesHermesAutoTeam = runtimeKind === 'hermes'
    && localConfig?.runtime_options?.subagentType === undefined
    && legacyTeam?.mode === 'auto';
  const accessModeOptions = accessModeField?.options || [];
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
  const savedToolNames = parseCardListEditorText(toolsText);
  const savedHermesToolsetNames = parseCardListEditorText(toolsetsText);
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

  const sectionBody = activeTab === 'Prompt'
    ? (
        <CardInspectorPromptView
          view={{
            runtime: {
              kind: runtimeKind,
              mode: runtimeMode,
              orchestratorEnabled,
            },
            outboundConnections: outboundOrangeConnections,
            cardName: {
              editable: Boolean(onChangeCardName),
              draft: cardNameDraft,
            },
            prompt: {
              text: promptText,
              parts: promptParts,
              touched: promptPartsTouched,
            },
          }}
          actions={{
            changeOrchestrator: (enabled) => {
              setOrchestratorEnabled(enabled);
              setOrchestratorTouched(true);
              markDraftDirty();
            },
            changeCardName: (value) => {
              setCardNameDraft(value);
              onChangeCardName?.(value);
            },
            changePromptField: (field, value) => {
              setPromptParts((current) => ({ ...current, [field]: value }));
              setPromptPartsTouched((current) => ({ ...current, [field]: true }));
              markDraftDirty();
            },
          }}
        />
      )
    : activeTab === 'Runtime'
      ? (
          <CardInspectorRuntimeView
            view={{
              identity: { projectId, deckId, cardId },
              projectFolder: {
                editable: Boolean(onSetProjectCodeFolder),
                draft: projectFolderDraft,
                status: projectFolderStatus,
                error: projectFolderError,
              },
              runtime: {
                kind: runtimeKind,
                mode: runtimeMode,
                dictionaryReady: runtimeDictionaryReady,
                optionsStatus: runtimeOptionsStatus,
              },
              modelSelection: {
                provider,
                accessMode,
                modelKey,
                autoSelect,
                providerOptions,
                accessModeOptions,
                availableModels,
              },
              subagents: {
                type: subagentType,
                typeField: subagentTypeField,
                preservesHermesAutoTeam,
                model: subagentModel,
                catalogOptions: subagentCatalogOptions,
              },
              jev: {
                context: jevContext,
                modelChoiceField: jevModelChoiceContextField,
                autoToolsField: jevAutoToolsContextField,
              },
              reasoning: {
                effort: reasoningEffort,
                field: reasoningEffortField,
              },
              advanced: {
                temperature,
                maxTokens,
                maxTurns,
                temperatureField,
                maxTokensField,
                maxTurnsField,
              },
            }}
            actions={{
              submitProjectFolder: setProjectCodeFolder,
              changeProjectFolder: (value) => {
                setProjectFolderDraft(value);
                setProjectFolderStatus('idle');
                setProjectFolderError(null);
              },
              changeProvider: (value) => {
                setProvider(value as typeof provider);
                markDraftDirty();
              },
              changeAccessMode: (value) => {
                setAccessMode(value as typeof accessMode);
                markDraftDirty();
              },
              changeModel: (key) => {
                const selected = availableModels.find((model) => model.key === key);
                if (key && !selected) return;
                setModel({ key, providerModelId: selected?.providerModelId ?? null });
                setAutoSelect(false);
                markDraftDirty();
              },
              changeAutoSelect: (enabled) => {
                setAutoSelect(enabled);
                markDraftDirty();
              },
              changeSubagentType: (type) => {
                setSubagentType(type);
                setSubagentTypeTouched(true);
                markDraftDirty();
              },
              changeReasoningEffort: (effort) => {
                setReasoningEffort(effort);
                markDraftDirty();
              },
              changeJevContext: (key, mode) => {
                setJevContext((value) => ({ ...value, [key]: mode }));
                setJevContextTouched(true);
                markDraftDirty();
              },
              changeTemperature: (value) => {
                setTemperature(value);
                markDraftDirty();
              },
              changeMaxTokens: (value) => {
                setMaxTokens(value);
                markDraftDirty();
              },
              changeMaxTurns: (value) => {
                setMaxTurns(value);
                markDraftDirty();
              },
              changeSubagentModel: (selectedProvider, selectedKey) => {
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
              },
            }}
          />
        )
      : activeTab === 'Memory'
        ? (
            <CardInspectorMemoryView
              view={{
                runtimeKind,
                profileStatus: hermesProfileStatus,
                profileError: hermesProfileError,
              }}
            />
          )
        : activeTab === 'Skills'
          ? (
              <CardInspectorSkillsView
                view={{
                  runtimeKind,
                  skillsText,
                  profile: {
                    state: hermesProfileState,
                    status: hermesProfileStatus,
                    error: hermesProfileError,
                  },
                  learning: {
                    detail: hermesLearningDetail,
                    draft: hermesLearningDraft,
                    status: hermesLearningStatus,
                    error: hermesLearningError,
                  },
                }}
                actions={{
                  changeSkillGrants: (value) => {
                    setSkillsText(value);
                    markDraftDirty();
                  },
                  openLearningNode: openHermesLearningNode,
                  changeLearningDraft: (value) => {
                    setHermesLearningDraft(value);
                    if (hermesLearningDetail) {
                      learningEditsRef.current.set(hermesLearningDetail.id, value);
                      markProfileDraftDirty();
                    }
                  },
                }}
              />
            )
          : activeTab === 'Tools'
            ? (
                <CardInspectorToolsView
                  view={{
                    runtimeKind: localConfig.runtime.kind,
                    autoTools,
                    dictionary: {
                      query: toolDictionaryQuery,
                      namespace: toolDictionaryNamespace,
                      page: toolDictionaryPage,
                      showSelectedOnly: showSelectedToolsOnly,
                      busy: toolDictionaryBusy,
                      error: toolOptionsError,
                      savedToolNames,
                      selectedRows: selectedToolRows,
                      availableRows: availableToolRows,
                    },
                    hermes: {
                      profileState: hermesProfileState,
                      profileStatus: hermesProfileStatus,
                      profileError: hermesProfileError,
                      savedToolsetNames: savedHermesToolsetNames,
                      mcpChecks: hermesMcpChecks,
                    },
                    script: {
                      cardId,
                      runtimeKind: localConfig.runtime.kind,
                      script: scriptDraft,
                      selectedTools: savedToolNames,
                    },
                    mcpConnectionIdsText,
                  }}
                  actions={{
                    changeAutoTools: (enabled) => {
                      setAutoTools(enabled);
                      markDraftDirty();
                    },
                    changeToolQuery: (value) => {
                      setToolDictionaryQuery(value);
                      setToolDictionaryOffset(0);
                    },
                    changeToolNamespace: (value) => {
                      setToolDictionaryNamespace(value);
                      setToolDictionaryOffset(0);
                    },
                    changeShowSelectedOnly: setShowSelectedToolsOnly,
                    clearSelectedTools: () => {
                      setToolsText('');
                      markDraftDirty();
                    },
                    toggleTool,
                    showPreviousToolPage: () => {
                      setToolDictionaryOffset(Math.max(0, toolDictionaryOffset - 100));
                    },
                    showNextToolPage: () => {
                      setToolDictionaryOffset(toolDictionaryPage.offset + toolDictionaryPage.limit);
                    },
                    toggleHermesToolset: (name, enabled) => {
                      setToolsetsText(toggleSavedToolAssignment(
                        savedHermesToolsetNames,
                        name,
                        enabled,
                      ).join('\n'));
                      markDraftDirty();
                    },
                    changeScript: updateScriptDraft,
                    changeMcpConnections: (value) => {
                      setMcpConnectionIdsText(value);
                      markDraftDirty();
                    },
                    checkMcpServer: checkHermesMcpServer,
                  }}
                />
              )
            : null;

  if (!sectionBody) {
    return null;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, colorScheme: 'dark' }}>
      {sectionBody}
      {saveCardStatus === 'failed' && saveCardErrorMessage ? (
        <span role="alert" data-testid="card-inspector-save-error" style={{ color: '#FFA2A2', fontSize: 11.5 }}>
          {saveCardErrorMessage}
        </span>
      ) : null}
    </div>
  );
}
