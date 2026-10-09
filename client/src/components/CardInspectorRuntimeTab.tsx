import type {
  CardEditorConfiguration,
  CardEditorModelOption,
  InputDictionaryEditorField,
  InputDictionaryEditorOption,
} from '../features/agentbuilder/cardConfigurationEditor';
import type { SavedCardConfiguration } from '../types/agentgraph';
import { CardRunMetrics } from './CardRunMetrics';

type SavedSubagentModel = NonNullable<SavedCardConfiguration['subagentModel']>;
type SavedSubagentType = NonNullable<SavedCardConfiguration['subagentType']>;

export type CardInspectorRuntimeTabModel = {
  identity: {
    projectId: string;
    deckId: string;
    cardId: string;
  };
  projectFolder: {
    editable: boolean;
    draft: string;
    status: 'idle' | 'saving' | 'saved' | 'failed';
    error: string | null;
  };
  runtime: {
    mode: CardEditorConfiguration['runtime']['mode'];
    dictionaryReady: boolean;
    optionsStatus: 'loading' | 'ready' | 'failed';
  };
  modelSelection: {
    provider: NonNullable<CardEditorConfiguration['provider']>;
    accessMode: NonNullable<CardEditorConfiguration['access_mode']>;
    modelKey: string;
    providerOptions: InputDictionaryEditorOption[];
    accessModeOptions: InputDictionaryEditorOption[];
    availableModels: CardEditorModelOption[];
    autoModelEnabled: boolean;
    autoModelAvailable: boolean;
  };
  subagents: {
    type: SavedSubagentType;
    typeField: InputDictionaryEditorField | undefined;
    preservesHermesAutoTeam: boolean;
    model: SavedSubagentModel;
    catalogOptions: Array<CardEditorModelOption & { provider: string }>;
  };
};

export type CardInspectorRuntimeTabActions = {
  submitProjectFolder(): void | Promise<void>;
  changeProjectFolder(value: string): void;
  changeProvider(value: string): void;
  changeAccessMode(value: string): void;
  changeModel(modelKey: string): void;
  changeAutoModel(enabled: boolean): void;
  changeSubagentType(type: SavedSubagentType): void;
  changeSubagentModel(provider: string, modelKey: string): void;
};

export function CardInspectorRuntimeTab({
  view,
  actions,
}: {
  view: CardInspectorRuntimeTabModel;
  actions: CardInspectorRuntimeTabActions;
}) {
  const { identity, projectFolder, runtime, modelSelection, subagents } = view;

  return (
    <div data-testid="card-inspector-runtime-surface" style={{ display: 'grid', gap: 16 }}>
      <CardRunMetrics
        projectId={identity.projectId}
        deckId={identity.deckId}
        cardId={identity.cardId}
      />
      <section aria-label="Runtime configuration">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {projectFolder.editable ? (
            <form
              aria-label="Builder Project code folder"
              onSubmit={(event) => {
                event.preventDefault();
                void actions.submitProjectFolder();
              }}
              style={{
                display: 'grid',
                gap: 8,
                padding: 10,
                border: '1px solid #3A4A50',
                borderRadius: 8,
                background: '#20292D',
              }}
            >
              <label style={{ display: 'grid', gap: 6, color: '#D5E4E8', fontSize: 12 }}>
                Project code folder
                <input
                  aria-label="Project code folder"
                  type="text"
                  value={projectFolder.draft}
                  onChange={(event) => actions.changeProjectFolder(event.target.value)}
                  placeholder="worker-agent-ui"
                  spellCheck={false}
                  autoComplete="off"
                />
              </label>
              <div style={{ color: '#91A9B8', fontSize: 11 }}>
                Name one folder in this Project's managed storage. Builder uses it for worker-agent code, agent UIs, hosted webapps, and its Hermes terminal.
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button type="submit" disabled={projectFolder.status === 'saving'}>
                  {projectFolder.status === 'saving' ? 'Setting…' : 'Set folder'}
                </button>
                {projectFolder.status === 'saved' ? (
                  <span role="status" style={{ color: '#8ED0AE', fontSize: 11 }}>Folder path saved.</span>
                ) : null}
                {projectFolder.status === 'failed' ? (
                  <span role="alert" style={{ color: '#FFA2A2', fontSize: 11 }}>
                    {projectFolder.error || 'Could not save the Project code folder.'}
                  </span>
                ) : null}
              </div>
            </form>
          ) : null}
          {!runtime.dictionaryReady ? (
            <div role={runtime.optionsStatus === 'loading' ? 'status' : 'alert'} style={{ color: '#E0DED5', fontSize: 12 }}>
              {runtime.optionsStatus === 'loading'
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
                  disabled={!runtime.dictionaryReady}
                  value={modelSelection.provider}
                  onChange={(event) => actions.changeProvider(event.target.value)}
                >
                  <option value="">Unset</option>
                  {modelSelection.provider
                  && !modelSelection.providerOptions.some((option) => option.value === modelSelection.provider) ? (
                    <option value={modelSelection.provider}>
                      {modelSelection.provider} (unavailable — saved)
                    </option>
                  ) : null}
                  {modelSelection.providerOptions.map((option) => (
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
                  disabled={!runtime.dictionaryReady}
                  value={modelSelection.accessMode}
                  onChange={(event) => actions.changeAccessMode(event.target.value)}
                >
                  <option value="">Select access mode</option>
                  {modelSelection.accessMode
                  && !modelSelection.accessModeOptions.some((option) => option.value === modelSelection.accessMode) ? (
                    <option value={modelSelection.accessMode}>{modelSelection.accessMode} (saved)</option>
                  ) : null}
                  {modelSelection.accessModeOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
                    Model
                  </label>
                  {runtime.mode !== 'magentic_one' ? (
                    <label style={{ color: '#D5E4E8', fontSize: 11 }}>
                      <input
                        type="checkbox"
                        aria-label="Auto Model"
                        checked={modelSelection.autoModelEnabled}
                        disabled={!modelSelection.autoModelAvailable}
                        onChange={(event) => actions.changeAutoModel(event.target.checked)}
                      />{' '}
                      Auto Model
                    </label>
                  ) : null}
                </div>
                <select
                  aria-label="Model"
                  disabled={!runtime.dictionaryReady}
                  value={modelSelection.modelKey}
                  onChange={(event) => actions.changeModel(event.target.value)}
                >
                  <option value="">Select model</option>
                  {modelSelection.modelKey
                  && !modelSelection.availableModels.some((model) => model.key === modelSelection.modelKey) ? (
                    <option value={modelSelection.modelKey}>
                      {modelSelection.modelKey} (unavailable — saved)
                    </option>
                  ) : null}
                  {modelSelection.availableModels.map((model) => (
                    <option key={model.key} value={model.key}>{model.label}</option>
                  ))}
                </select>
                {runtime.dictionaryReady && !modelSelection.availableModels.length ? (
                  <div role="status" style={{ color: '#80969F', fontSize: 11 }}>
                    No configured models available for this provider. Saved selection is unchanged.
                  </div>
                ) : null}
              </div>
              {runtime.mode !== 'magentic_one'
              && !subagents.preservesHermesAutoTeam
              && subagents.typeField?.control === 'select' ? (
                <div>
                  <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
                    {subagents.typeField.label}
                  </label>
                  <select
                    aria-label={subagents.typeField.label}
                    disabled={!runtime.dictionaryReady}
                    value={subagents.type}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (value !== 'none' && value !== 'leaf' && value !== 'recursive') return;
                      actions.changeSubagentType(value);
                    }}
                  >
                    {(subagents.typeField.options || [])
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

          </div>
        </div>
      </section>
      {runtime.mode !== 'magentic_one'
      && (subagents.type !== 'none' || subagents.preservesHermesAutoTeam) ? (
        <label style={{ display: 'grid', gap: 6, color: '#D5E4E8', fontSize: 12 }}>
          Subagent model
          <select
            aria-label="Subagent model"
            value={`${subagents.model.provider}\u0000${subagents.model.modelKey}`}
            onChange={(event) => {
              const [selectedProvider, selectedKey] = event.target.value.split('\u0000');
              actions.changeSubagentModel(selectedProvider, selectedKey);
            }}
          >
            {!subagents.catalogOptions.some((option) => option.provider === subagents.model.provider
              && option.key === subagents.model.modelKey) ? (
              <option value={`${subagents.model.provider}\u0000${subagents.model.modelKey}`}>
                {subagents.model.providerModelId} (unavailable — saved)
              </option>
            ) : null}
            {subagents.catalogOptions.map((option) => (
              <option
                key={`${option.provider}:${option.key}`}
                value={`${option.provider}\u0000${option.key}`}
              >
                {option.provider} · {option.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}


