import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { SavedCardConfiguration } from '../types/agentgraph';
import {
  assertUniqueCanonicalPromptSections,
  buildCardConfigurationFromEditorFields,
  parseCardListEditorText,
  parseCardEditorOptions,
  parseCardPromptTemplate,
  serializeCardPromptFields,
  toggleSavedToolAssignment,
  type CardEditorConfiguration,
  type CardEditorAutoModelCandidate,
  type CardEditorModelOption,
  type CardPromptFields,
  type InputDictionaryEditorField,
} from '../features/agentbuilder/cardConfigurationEditor';
import { useCardToolOptions } from './useCardToolOptions';
import {
  CardInspectorPromptTab,
} from './CardInspectorPromptTab';
import { CardInspectorRuntimeTab } from './CardInspectorRuntimeTab';
import { CardInspectorMemoryTab } from './CardInspectorMemoryTab';
import { CardInspectorSkillsTab } from './CardInspectorSkillsTab';
import { CardInspectorToolsTab } from './CardInspectorToolsTab';
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
const DEFAULT_SUBAGENT_MODEL: SavedSubagentModel = {
  provider: 'openai',
  accessMode: 'chatgpt-account',
  modelKey: 'gpt-5.6-luna',
  providerModelId: 'gpt-5.6-luna',
};

function blankCardScript(): SavedCardScript {
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

function subagentAccessMode(provider: string): SavedSubagentModel['accessMode'] {
  return provider === 'openrouter' ? 'openrouter-api'
    : provider === 'openai' ? 'chatgpt-account'
    : 'openai-api';
}
interface CardInspectorProps {
  cardId: string;
  projectId: string;
  deckId: string;
  activeTab: string;
  cardName: string;
  onChangeCardName: (value: string) => void;
  localConfig: CardEditorConfiguration;
  onSaveLocalConfig: (config: CardEditorConfiguration) => void | Promise<void>;
  projectCodeFolder?: string | null;
  onSetProjectCodeFolder?: (folder: string) => Promise<void>;
  registerCardDraftFlush: (save: (() => Promise<boolean>) | null) => void;
  orangeConnections: Array<{
    cardId: string;
    title: string;
    direction: 'incoming' | 'outgoing';
  }>;
}

type SaveCardStatus = 'idle' | 'saving' | 'saved' | 'failed';

export function CardInspector({
  cardId,
  projectId,
  deckId,
  activeTab,
  cardName,
  onChangeCardName,
  localConfig,
  onSaveLocalConfig,
  projectCodeFolder = null,
  onSetProjectCodeFolder,
  registerCardDraftFlush,
  orangeConnections,
}: CardInspectorProps) {
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
  const runtimeMode = localConfig.runtime.mode;
  const [cardNameDraft, setCardNameDraft] = useState(cardName);
  const [provider, setProvider] = useState<NonNullable<CardEditorConfiguration['provider']>>('');
  const [accessMode, setAccessMode] = useState<
    'chatgpt-account' | 'openai-api' | 'openrouter-api' | ''
  >('');
  const [{ key: modelKey, providerModelId }, setModel] = useState<{
    key: string; providerModelId?: string | null;
  }>({ key: '' });
  const [orchestratorEnabled, setOrchestratorEnabled] = useState(false);
  const [autoToolsEnabled, setAutoToolsEnabled] = useState(false);
  const [autoModelEnabled, setAutoModelEnabled] = useState(false);
  const [orchestratorTouched, setOrchestratorTouched] = useState(false);
  const [subagentModel, setSubagentModel] = useState<SavedSubagentModel>(DEFAULT_SUBAGENT_MODEL);
  const [subagentType, setSubagentType] = useState<SavedSubagentType>('none');
  const [subagentTouched, setSubagentTouched] = useState(false);
  const [subagentTypeTouched, setSubagentTypeTouched] = useState(false);
  const learningEditsRef = useRef(new Map<string, string>());
  const [scriptDraft, setScriptDraft] = useState<SavedCardScript>(blankCardScript);
  const scriptDraftCacheRef = useRef<Map<string, SavedCardScript>>(new Map());
  const dirtyScriptCardsRef = useRef<Set<string>>(new Set());
  const [modelsByProvider, setModelsByProvider] = useState<Record<string, CardEditorModelOption[]>>({});
  const [autoModelCandidates, setAutoModelCandidates] = useState<CardEditorAutoModelCandidate[]>([]);
  const [cardEditorFields, setCardEditorFields] = useState<InputDictionaryEditorField[]>([]);
  const [runtimeOptionsStatus, setRuntimeOptionsStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
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
    setAutoModelCandidates([]);
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
          setAutoModelCandidates(parsed.autoModelCandidates);
          setRuntimeOptionsStatus('ready');
        }
      })
      .catch(() => {
        if (active) {
          setCardEditorFields([]);
          setModelsByProvider({});
          setAutoModelCandidates([]);
          setRuntimeOptionsStatus('failed');
        }
      });
    return () => {
      active = false;
    };
  }, [projectId, deckId, cardId]);

  useEffect(() => {
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
    setAutoToolsEnabled(localConfig.runtime_options?.autoTools === true);
    setAutoModelEnabled(localConfig.runtime_options?.autoModel === true);
    const savedSubagentModel = localConfig.runtime_options?.subagentModel;
    const savedSubagentType = localConfig.runtime_options?.subagentType;
    setSubagentType(
      savedSubagentType === 'leaf' || savedSubagentType === 'recursive'
        ? savedSubagentType
        : 'none',
    );
    setSubagentModel(savedSubagentModel || DEFAULT_SUBAGENT_MODEL);
    const savedScript = localConfig.runtime_options?.script
      ? structuredClone(localConfig.runtime_options.script)
      : blankCardScript();
    const cachedScript = scriptDraftCacheRef.current.get(cardId);
    const preserveUnsavedScript = Boolean(
      cachedScript
      && dirtyScriptCardsRef.current.has(cardId)
      && cachedScript.source !== savedScript.source,
    );
    if (preserveUnsavedScript && cachedScript) {
      setScriptDraft(structuredClone(cachedScript));
    } else {
      scriptDraftCacheRef.current.set(cardId, structuredClone(savedScript));
      dirtyScriptCardsRef.current.delete(cardId);
      setScriptDraft(savedScript);
    }
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
  }, [cardId, localConfig]);

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
  }, [projectId, deckId, cardId, acceptProfileReadback]);


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
    const saved = localConfig.runtime_options?.script || null;
    const changed = !saved
      ? Boolean(next.source.trim())
      : next.source !== saved.source;
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

  const buildCurrentLocalPayload = useCallback((): CardEditorConfiguration => {
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
  }, [
    localConfig,
    runtimeMode,
    cardId,
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
    const revision = cardDraftRevisionRef.current;
    const payload = buildCurrentLocalPayload();
    await Promise.resolve(onSaveLocalConfig(payload));
    if (cardDraftRevisionRef.current === revision) {
      draftDirtyRef.current = false;
    }
  }, [
    onSaveLocalConfig,
    buildCurrentLocalPayload,
  ]);

  const openHermesLearningNode = useCallback(async (nodeId: string) => {
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
        if (!profileState) throw new Error('Hermes profile unavailable.');
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
    registerCardDraftFlush(flushCardDraft);
    return () => registerCardDraftFlush(null);
  }, [registerCardDraftFlush, flushCardDraft]);

  const availableModels = provider ? modelsByProvider[provider] || [] : [];
  const autoModelAvailable = autoModelCandidates.some((candidate) => (
    candidate.eligible && candidate.provider === provider && candidate.accessMode === accessMode
  ));
  const subagentCatalogOptions = Object.entries(modelsByProvider).flatMap(([catalogProvider, models]) => (
    models.map((model) => ({ provider: catalogProvider, ...model }))
  ));

  const editorField = (name: string) => cardEditorFields.find((field) => field.name === name);
  const providerField = editorField('provider');
  const subagentTypeField = editorField('subagentType');
  const accessModeField = editorField('accessMode');
  const modelKeyField = editorField('modelKey');
  const providerOptions = (providerField?.options || []).filter(
    (option) => (modelsByProvider[option.value] || []).length > 0,
  );
  const legacyTeam = (
    localConfig.runtime_options as (SavedCardConfiguration & { team?: { mode?: unknown } }) | null | undefined
  )?.team;
  const preservesHermesAutoTeam = localConfig.runtime_options?.subagentType === undefined
    && legacyTeam?.mode === 'auto';
  const accessModeOptions = accessModeField?.options || [];
  const runtimeDictionaryReady = Boolean(
    runtimeOptionsStatus === 'ready'
    && providerField
    && subagentTypeField?.control === 'select'
    && accessModeField
    && modelKeyField,
  );
  const savedHermesToolsetNames = parseCardListEditorText(toolsetsText);
  const toolOptions = useCardToolOptions({ toolsText, setToolsText, markDraftDirty });
  const {
    page: toolDictionaryPage,
    query: toolDictionaryQuery,
    namespace: toolDictionaryNamespace,
    showSelectedOnly: showSelectedToolsOnly,
    busy: toolDictionaryBusy,
    error: toolOptionsError,
    savedToolNames,
    selectedRows: selectedToolRows,
    availableRows: availableToolRows,
  } = toolOptions;

  const sectionBody = activeTab === 'Prompt'
    ? (
        <CardInspectorPromptTab
          view={{
            runtime: {
              mode: runtimeMode,
              orchestratorEnabled,
            },
            outboundConnections: outboundOrangeConnections,
            cardName: {
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
              onChangeCardName(value);
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
          <CardInspectorRuntimeTab
            view={{
              identity: { projectId, deckId, cardId },
              projectFolder: {
                editable: Boolean(onSetProjectCodeFolder),
                draft: projectFolderDraft,
                status: projectFolderStatus,
                error: projectFolderError,
              },
            runtime: {
              mode: runtimeMode,
                dictionaryReady: runtimeDictionaryReady,
                optionsStatus: runtimeOptionsStatus,
              },
              modelSelection: {
                provider,
                accessMode,
                modelKey,
                providerOptions,
                accessModeOptions,
                availableModels,
                autoModelEnabled,
                autoModelAvailable,
              },
              subagents: {
                type: subagentType,
                typeField: subagentTypeField,
                preservesHermesAutoTeam,
                model: subagentModel,
                catalogOptions: subagentCatalogOptions,
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
                markDraftDirty();
              },
              changeAutoModel: (enabled) => {
                setAutoModelEnabled(enabled);
                markDraftDirty();
              },
              changeSubagentType: (type) => {
                setSubagentType(type);
                setSubagentTypeTouched(true);
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
            <CardInspectorMemoryTab
              view={{
                profileStatus: hermesProfileStatus,
                profileError: hermesProfileError,
              }}
            />
          )
        : activeTab === 'Skills'
          ? (
              <CardInspectorSkillsTab
                view={{
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
                <CardInspectorToolsTab
                  view={{
                    dictionary: {
                      autoToolsEnabled,
                      autoToolsVisible: runtimeMode !== 'magentic_one',
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
                      script: scriptDraft,
                      selectedTools: savedToolNames,
                    },
                    mcpConnectionIdsText,
                  }}
                  actions={{
                    changeToolQuery: toolOptions.changeQuery,
                    changeAutoTools: (enabled) => {
                      setAutoToolsEnabled(enabled);
                      markDraftDirty();
                    },
                    changeToolNamespace: toolOptions.changeNamespace,
                    changeShowSelectedOnly: toolOptions.changeShowSelectedOnly,
                    clearSelectedTools: toolOptions.clearSelectedTools,
                    toggleTool: toolOptions.toggleTool,
                    showPreviousToolPage: toolOptions.showPreviousPage,
                    showNextToolPage: toolOptions.showNextPage,
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
