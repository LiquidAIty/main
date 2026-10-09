import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import {
  parseCardListEditorText,
  toggleSavedToolAssignment,
  type CardEditorConfiguration,
  type CardPromptFields,
} from '../features/agentbuilder/cardConfigurationEditor';
import {
  blankCardInspectorPromptParts,
  buildCardInspectorDraftPayload,
  cardInspectorListDraft,
  cardInspectorPromptDraft,
  cardInspectorSubagentAccessMode,
  DEFAULT_CARD_INSPECTOR_SUBAGENT_MODEL,
  type CardInspectorAccessMode,
  type CardInspectorSubagentModel,
  type CardInspectorSubagentType,
} from './cardInspectorDraftPayload';
import { useCardInspectorDraftPersistence } from './useCardInspectorDraftPersistence';
import { useCardInspectorEditorOptions } from './useCardInspectorEditorOptions';
import { useCardInspectorHermesProfile } from './useCardInspectorHermesProfile';
import { useCardInspectorScriptDraft } from './useCardInspectorScriptDraft';
import { useCardToolOptions } from './useCardToolOptions';

export function useCardInspectorDraft({
  cardId,
  projectId,
  deckId,
  cardName,
  onChangeCardName,
  localConfig,
  onSaveLocalConfig,
  projectCodeFolder,
  onSetProjectCodeFolder,
  registerCardDraftFlush,
}: {
  cardId: string;
  projectId: string;
  deckId: string;
  cardName: string;
  onChangeCardName(value: string): void;
  localConfig: CardEditorConfiguration;
  onSaveLocalConfig(config: CardEditorConfiguration): void | Promise<void>;
  projectCodeFolder: string | null;
  onSetProjectCodeFolder?: (folder: string) => Promise<void>;
  registerCardDraftFlush(save: (() => Promise<boolean>) | null): void;
}) {
  const runtimeMode = localConfig.runtime.mode;
  const [cardNameDraft, setCardNameDraft] = useState(cardName);
  const [provider, setProvider] = useState<NonNullable<CardEditorConfiguration['provider']>>('');
  const [accessMode, setAccessMode] = useState<CardInspectorAccessMode>('');
  const [{ key: modelKey, providerModelId }, setModel] = useState<{
    key: string; providerModelId?: string | null;
  }>({ key: '' });
  const [orchestratorEnabled, setOrchestratorEnabled] = useState(false);
  const [autoToolsEnabled, setAutoToolsEnabled] = useState(false);
  const [autoModelEnabled, setAutoModelEnabled] = useState(false);
  const [orchestratorTouched, setOrchestratorTouched] = useState(false);
  const [subagentModel, setSubagentModel] = useState<CardInspectorSubagentModel>(
    DEFAULT_CARD_INSPECTOR_SUBAGENT_MODEL,
  );
  const [subagentType, setSubagentType] = useState<CardInspectorSubagentType>('none');
  const [subagentTouched, setSubagentTouched] = useState(false);
  const [subagentTypeTouched, setSubagentTypeTouched] = useState(false);
  const [promptText, setPromptText] = useState('');
  const [promptParts, setPromptParts] = useState<CardPromptFields & Record<string, string>>(
    blankCardInspectorPromptParts,
  );
  const [promptPartsTouched, setPromptPartsTouched] = useState<Record<string, boolean>>({});
  const [toolsText, setToolsText] = useState('');
  const [skillsText, setSkillsText] = useState('');
  const [toolsetsText, setToolsetsText] = useState('');
  const [mcpConnectionIdsText, setMcpConnectionIdsText] = useState('');

  useEffect(() => {
    setCardNameDraft(cardName);
  }, [cardId, cardName]);

  const editorOptions = useCardInspectorEditorOptions({
    projectId,
    deckId,
    cardId,
    localConfig,
    provider,
    accessMode,
    projectCodeFolder,
    onSetProjectCodeFolder,
  });

  const markCardDraftDirtyRef = useRef<() => void>(() => undefined);
  const markProfileDraftActivityRef = useRef<() => void>(() => undefined);
  const markScriptDraftDirty = useCallback(() => {
    markCardDraftDirtyRef.current();
  }, []);
  const markProfileDraftActivity = useCallback(() => {
    markProfileDraftActivityRef.current();
  }, []);

  const profile = useCardInspectorHermesProfile({
    projectId,
    deckId,
    cardId,
    onDraftDirty: markProfileDraftActivity,
  });
  const script = useCardInspectorScriptDraft({
    cardId,
    savedScript: localConfig.runtime_options?.script,
    markDraftDirty: markScriptDraftDirty,
  });

  const buildCurrentLocalPayload = useCallback(() => buildCardInspectorDraftPayload({
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
    scriptDraft: script.scriptDraft,
    promptText,
    promptParts,
    promptPartsTouched,
    toolsText,
    skillsText,
    toolsetsText,
    mcpConnectionIdsText,
  }), [
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
    script.scriptDraft,
    promptText,
    promptParts,
    promptPartsTouched,
    toolsText,
    skillsText,
    toolsetsText,
    mcpConnectionIdsText,
  ]);

  const persistence = useCardInspectorDraftPersistence({
    buildCurrentLocalPayload,
    onSaveLocalConfig,
    captureProfileDraft: profile.captureDraft,
    saveCapturedProfileDraft: profile.saveCapturedDraft,
    hasDirtyProfileDraft: profile.hasDirtyDraft,
    registerCardDraftFlush,
  });

  useLayoutEffect(() => {
    markCardDraftDirtyRef.current = persistence.markDraftDirty;
    markProfileDraftActivityRef.current = persistence.markProfileDraftActivity;
  }, [persistence.markDraftDirty, persistence.markProfileDraftActivity]);

  useEffect(() => {
    // A response to an earlier save must not replace edits made while it was pending.
    if (persistence.isHydrationBlocked()) return;
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
    setModel({
      key: localConfig.model_key || '',
      providerModelId: localConfig.runtime_options?.providerModelId,
    });
    setOrchestratorEnabled(
      localConfig.runtime.mode === 'main'
      || localConfig.runtime_options?.orchestrator === true,
    );
    setAutoToolsEnabled(localConfig.runtime_options?.autoTools === true);
    setAutoModelEnabled(localConfig.runtime_options?.autoModel === true);
    const savedSubagentType = localConfig.runtime_options?.subagentType;
    setSubagentType(
      savedSubagentType === 'leaf' || savedSubagentType === 'recursive'
        ? savedSubagentType
        : 'none',
    );
    setSubagentModel(
      localConfig.runtime_options?.subagentModel || DEFAULT_CARD_INSPECTOR_SUBAGENT_MODEL,
    );
    script.hydrateFromSaved();
    const promptDraft = cardInspectorPromptDraft(localConfig);
    setPromptText(promptDraft.promptText);
    setPromptParts(promptDraft.promptParts);
    setPromptPartsTouched({});
    setToolsText(cardInspectorListDraft(localConfig.tools));
    setSkillsText(cardInspectorListDraft(localConfig.skills));
    setToolsetsText(cardInspectorListDraft(localConfig.toolsets));
    setMcpConnectionIdsText(cardInspectorListDraft(localConfig.mcp_connection_ids));
  }, [cardId, localConfig, persistence.isHydrationBlocked, script.hydrateFromSaved]);

  const savedHermesToolsetNames = parseCardListEditorText(toolsetsText);
  const toolOptions = useCardToolOptions({
    toolsText,
    setToolsText,
    markDraftDirty: persistence.markDraftDirty,
  });

  const changeOrchestrator = useCallback((enabled: boolean) => {
    setOrchestratorEnabled(enabled);
    setOrchestratorTouched(true);
    persistence.markDraftDirty();
  }, [persistence.markDraftDirty]);
  const changeCardName = useCallback((value: string) => {
    setCardNameDraft(value);
    onChangeCardName(value);
  }, [onChangeCardName]);
  const changePromptField = useCallback((field: string, value: string) => {
    setPromptParts((current) => ({ ...current, [field]: value }));
    setPromptPartsTouched((current) => ({ ...current, [field]: true }));
    persistence.markDraftDirty();
  }, [persistence.markDraftDirty]);
  const changeProvider = useCallback((value: string) => {
    setProvider(value as typeof provider);
    persistence.markDraftDirty();
  }, [persistence.markDraftDirty]);
  const changeAccessMode = useCallback((value: string) => {
    setAccessMode(value as typeof accessMode);
    persistence.markDraftDirty();
  }, [persistence.markDraftDirty]);
  const changeModel = useCallback((key: string) => {
    const selected = editorOptions.availableModels.find((model) => model.key === key);
    if (key && !selected) return;
    setModel({ key, providerModelId: selected?.providerModelId ?? null });
    persistence.markDraftDirty();
  }, [editorOptions.availableModels, persistence.markDraftDirty]);
  const changeAutoModel = useCallback((enabled: boolean) => {
    setAutoModelEnabled(enabled);
    persistence.markDraftDirty();
  }, [persistence.markDraftDirty]);
  const changeSubagentType = useCallback((type: CardInspectorSubagentType) => {
    setSubagentType(type);
    setSubagentTypeTouched(true);
    persistence.markDraftDirty();
  }, [persistence.markDraftDirty]);
  const changeSubagentModel = useCallback((selectedProvider: string, selectedKey: string) => {
    const selected = editorOptions.subagentCatalogOptions.find((option) => (
      option.provider === selectedProvider && option.key === selectedKey
    ));
    if (!selected) return;
    setSubagentTouched(true);
    setSubagentModel({
      provider: selectedProvider,
      accessMode: cardInspectorSubagentAccessMode(selectedProvider),
      modelKey: selected.key,
      providerModelId: selected.providerModelId,
    });
    persistence.markDraftDirty();
  }, [editorOptions.subagentCatalogOptions, persistence.markDraftDirty]);
  const changeSkillGrants = useCallback((value: string) => {
    setSkillsText(value);
    persistence.markDraftDirty();
  }, [persistence.markDraftDirty]);
  const changeAutoTools = useCallback((enabled: boolean) => {
    setAutoToolsEnabled(enabled);
    persistence.markDraftDirty();
  }, [persistence.markDraftDirty]);
  const toggleHermesToolset = useCallback((name: string, enabled: boolean) => {
    setToolsetsText(toggleSavedToolAssignment(
      savedHermesToolsetNames,
      name,
      enabled,
    ).join('\n'));
    persistence.markDraftDirty();
  }, [persistence.markDraftDirty, savedHermesToolsetNames]);
  const changeMcpConnections = useCallback((value: string) => {
    setMcpConnectionIdsText(value);
    persistence.markDraftDirty();
  }, [persistence.markDraftDirty]);

  return {
    saveCardStatus: persistence.saveCardStatus,
    saveCardErrorMessage: persistence.saveCardErrorMessage,
    runtimeMode,
    cardNameDraft,
    provider,
    accessMode,
    modelKey,
    orchestratorEnabled,
    autoToolsEnabled,
    autoModelEnabled,
    subagentModel,
    subagentType,
    scriptDraft: script.scriptDraft,
    runtimeOptionsStatus: editorOptions.runtimeOptionsStatus,
    promptText,
    promptParts,
    promptPartsTouched,
    skillsText,
    mcpConnectionIdsText,
    projectFolderDraft: editorOptions.projectFolderDraft,
    projectFolderStatus: editorOptions.projectFolderStatus,
    projectFolderError: editorOptions.projectFolderError,
    availableModels: editorOptions.availableModels,
    autoModelAvailable: editorOptions.autoModelAvailable,
    subagentCatalogOptions: editorOptions.subagentCatalogOptions,
    subagentTypeField: editorOptions.subagentTypeField,
    providerOptions: editorOptions.providerOptions,
    accessModeOptions: editorOptions.accessModeOptions,
    preservesHermesAutoTeam: editorOptions.preservesHermesAutoTeam,
    runtimeDictionaryReady: editorOptions.runtimeDictionaryReady,
    savedHermesToolsetNames,
    toolOptions,
    profile,
    actions: {
      submitProjectFolder: editorOptions.submitProjectFolder,
      changeProjectFolder: editorOptions.changeProjectFolder,
      changeOrchestrator,
      changeCardName,
      changePromptField,
      changeProvider,
      changeAccessMode,
      changeModel,
      changeAutoModel,
      changeSubagentType,
      changeSubagentModel,
      changeSkillGrants,
      changeAutoTools,
      toggleHermesToolset,
      changeScript: script.changeScript,
      changeMcpConnections,
    },
  };
}
