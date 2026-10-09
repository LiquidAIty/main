import type { CardEditorConfiguration } from '../features/agentbuilder/cardConfigurationEditor';
import { CardInspectorMemoryTab } from './CardInspectorMemoryTab';
import { CardInspectorPromptTab } from './CardInspectorPromptTab';
import { CardInspectorRuntimeTab } from './CardInspectorRuntimeTab';
import { CardInspectorSkillsTab } from './CardInspectorSkillsTab';
import { CardInspectorToolsTab } from './CardInspectorToolsTab';
import { useCardInspectorDraft } from './useCardInspectorDraft';

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
  const draft = useCardInspectorDraft({
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
  });
  const { profile, toolOptions, actions } = draft;
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
              mode: draft.runtimeMode,
              orchestratorEnabled: draft.orchestratorEnabled,
            },
            outboundConnections: outboundOrangeConnections,
            cardName: {
              draft: draft.cardNameDraft,
            },
            prompt: {
              text: draft.promptText,
              parts: draft.promptParts,
              touched: draft.promptPartsTouched,
            },
          }}
          actions={{
            changeOrchestrator: actions.changeOrchestrator,
            changeCardName: actions.changeCardName,
            changePromptField: actions.changePromptField,
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
                draft: draft.projectFolderDraft,
                status: draft.projectFolderStatus,
                error: draft.projectFolderError,
              },
              runtime: {
                mode: draft.runtimeMode,
                dictionaryReady: draft.runtimeDictionaryReady,
                optionsStatus: draft.runtimeOptionsStatus,
              },
              modelSelection: {
                provider: draft.provider,
                accessMode: draft.accessMode,
                modelKey: draft.modelKey,
                providerOptions: draft.providerOptions,
                accessModeOptions: draft.accessModeOptions,
                availableModels: draft.availableModels,
                autoModelEnabled: draft.autoModelEnabled,
                autoModelAvailable: draft.autoModelAvailable,
              },
              subagents: {
                type: draft.subagentType,
                typeField: draft.subagentTypeField,
                preservesHermesAutoTeam: draft.preservesHermesAutoTeam,
                model: draft.subagentModel,
                catalogOptions: draft.subagentCatalogOptions,
              },
            }}
            actions={{
              submitProjectFolder: actions.submitProjectFolder,
              changeProjectFolder: actions.changeProjectFolder,
              changeProvider: actions.changeProvider,
              changeAccessMode: actions.changeAccessMode,
              changeModel: actions.changeModel,
              changeAutoModel: actions.changeAutoModel,
              changeSubagentType: actions.changeSubagentType,
              changeSubagentModel: actions.changeSubagentModel,
            }}
          />
        )
      : activeTab === 'Memory'
        ? (
            <CardInspectorMemoryTab
              view={{
                profileStatus: profile.profileStatus,
                profileError: profile.profileError,
              }}
            />
          )
        : activeTab === 'Skills'
          ? (
              <CardInspectorSkillsTab
                view={{
                  skillsText: draft.skillsText,
                  profile: {
                    state: profile.profileState,
                    status: profile.profileStatus,
                    error: profile.profileError,
                  },
                  learning: {
                    detail: profile.learningDetail,
                    draft: profile.learningDraft,
                    status: profile.learningStatus,
                    error: profile.learningError,
                  },
                }}
                actions={{
                  changeSkillGrants: actions.changeSkillGrants,
                  openLearningNode: profile.openLearningNode,
                  changeLearningDraft: profile.changeLearningDraft,
                }}
              />
            )
          : activeTab === 'Tools'
            ? (
                <CardInspectorToolsTab
                  view={{
                    dictionary: {
                      autoToolsEnabled: draft.autoToolsEnabled,
                      autoToolsVisible: draft.runtimeMode !== 'magentic_one',
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
                      profileState: profile.profileState,
                      profileStatus: profile.profileStatus,
                      profileError: profile.profileError,
                      savedToolsetNames: draft.savedHermesToolsetNames,
                      mcpChecks: profile.mcpChecks,
                    },
                    script: {
                      cardId,
                      script: draft.scriptDraft,
                      selectedTools: savedToolNames,
                    },
                    mcpConnectionIdsText: draft.mcpConnectionIdsText,
                  }}
                  actions={{
                    changeToolQuery: toolOptions.changeQuery,
                    changeAutoTools: actions.changeAutoTools,
                    changeToolNamespace: toolOptions.changeNamespace,
                    changeShowSelectedOnly: toolOptions.changeShowSelectedOnly,
                    clearSelectedTools: toolOptions.clearSelectedTools,
                    toggleTool: toolOptions.toggleTool,
                    showPreviousToolPage: toolOptions.showPreviousPage,
                    showNextToolPage: toolOptions.showNextPage,
                    toggleHermesToolset: actions.toggleHermesToolset,
                    changeScript: actions.changeScript,
                    changeMcpConnections: actions.changeMcpConnections,
                    checkMcpServer: profile.checkMcpServer,
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
      {draft.saveCardStatus === 'failed' && draft.saveCardErrorMessage ? (
        <span role="alert" data-testid="card-inspector-save-error" style={{ color: '#FFA2A2', fontSize: 11.5 }}>
          {draft.saveCardErrorMessage}
        </span>
      ) : null}
    </div>
  );
}
