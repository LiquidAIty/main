import { useCallback, useEffect, useState } from 'react';

import type { SavedCardConfiguration } from '../types/agentgraph';
import {
  parseCardEditorOptions,
  type CardEditorAutoModelCandidate,
  type CardEditorConfiguration,
  type CardEditorModelOption,
  type InputDictionaryEditorField,
} from '../features/agentbuilder/cardConfigurationEditor';
import type { CardInspectorAccessMode } from './cardInspectorDraftPayload';

type SaveCardStatus = 'idle' | 'saving' | 'saved' | 'failed';

export function useCardInspectorEditorOptions({
  projectId,
  deckId,
  cardId,
  localConfig,
  provider,
  accessMode,
  projectCodeFolder,
  onSetProjectCodeFolder,
}: {
  projectId: string;
  deckId: string;
  cardId: string;
  localConfig: CardEditorConfiguration;
  provider: NonNullable<CardEditorConfiguration['provider']>;
  accessMode: CardInspectorAccessMode;
  projectCodeFolder: string | null;
  onSetProjectCodeFolder?: (folder: string) => Promise<void>;
}) {
  const [projectFolderDraft, setProjectFolderDraft] = useState(projectCodeFolder || '');
  const [projectFolderStatus, setProjectFolderStatus] = useState<SaveCardStatus>('idle');
  const [projectFolderError, setProjectFolderError] = useState<string | null>(null);
  const [modelsByProvider, setModelsByProvider] = useState<Record<string, CardEditorModelOption[]>>({});
  const [autoModelCandidates, setAutoModelCandidates] = useState<CardEditorAutoModelCandidate[]>([]);
  const [cardEditorFields, setCardEditorFields] = useState<InputDictionaryEditorField[]>([]);
  const [runtimeOptionsStatus, setRuntimeOptionsStatus] = useState<'loading' | 'ready' | 'failed'>('loading');

  useEffect(() => {
    setProjectFolderDraft(projectCodeFolder || '');
    setProjectFolderStatus('idle');
    setProjectFolderError(null);
  }, [projectCodeFolder]);

  const submitProjectFolder = useCallback(async () => {
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

  const changeProjectFolder = useCallback((value: string) => {
    setProjectFolderDraft(value);
    setProjectFolderStatus('idle');
    setProjectFolderError(null);
  }, []);

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

  return {
    runtimeOptionsStatus,
    availableModels,
    autoModelAvailable,
    subagentCatalogOptions,
    subagentTypeField,
    providerOptions,
    accessModeOptions,
    preservesHermesAutoTeam,
    runtimeDictionaryReady,
    projectFolderDraft,
    projectFolderStatus,
    projectFolderError,
    submitProjectFolder,
    changeProjectFolder,
  };
}
