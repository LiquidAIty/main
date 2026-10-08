import {
  cardPromptFieldRanges,
  type CardEditorConfiguration,
  type CardEditorModelOption,
  type CardPromptFields,
  type InputDictionaryEditorField,
  type InputDictionaryEditorOption,
} from '../features/agentbuilder/cardConfigurationEditor';
import type { SavedCardConfiguration } from '../types/agentgraph';
import { CardRunMetrics } from './CardRunMetrics';

type SavedSubagentModel = NonNullable<SavedCardConfiguration['subagentModel']>;
type SavedSubagentType = NonNullable<SavedCardConfiguration['subagentType']>;
type SavedJevContext = NonNullable<SavedCardConfiguration['jevContext']>;
type JevContextMode = NonNullable<SavedJevContext['autoTools']>;

export type CardInspectorPromptViewModel = {
  runtime: {
    kind: CardEditorConfiguration['runtime']['kind'] | undefined;
    mode: CardEditorConfiguration['runtime']['mode'] | undefined;
    orchestratorEnabled: boolean;
  };
  outboundConnections: Array<{
    cardId: string;
    title: string;
    direction: 'incoming' | 'outgoing';
  }>;
  cardName: {
    editable: boolean;
    draft: string;
  };
  prompt: {
    text: string;
    parts: CardPromptFields & Record<string, string>;
    touched: Record<string, boolean>;
  };
};

export type CardInspectorPromptActions = {
  changeOrchestrator(enabled: boolean): void;
  changeCardName(value: string): void;
  changePromptField(field: string, value: string): void;
};

export function CardInspectorPromptView({
  view,
  actions,
}: {
  view: CardInspectorPromptViewModel;
  actions: CardInspectorPromptActions;
}) {
  const orchestratorOn = view.runtime.kind === 'hermes'
    && view.runtime.mode !== 'magentic_one'
    && (view.runtime.mode === 'main' || view.runtime.orchestratorEnabled);

  return (
    <div data-testid="card-inspector-prompt-surface" style={{ display: 'grid', gap: 16 }}>
      <section aria-label="Prompt configuration">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {view.runtime.kind === 'hermes' && view.runtime.mode !== 'magentic_one' ? (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#E0DED5', fontSize: 12 }}>
              <input
                type="checkbox"
                aria-label="Orchestrator"
                checked={orchestratorOn}
                disabled={view.runtime.mode === 'main'}
                onChange={(event) => actions.changeOrchestrator(event.target.checked)}
              />
              Orchestrator
            </label>
          ) : null}

          {orchestratorOn && view.outboundConnections.length > 0 ? (
            <label style={{ display: 'grid', gap: 7, color: '#E0DED5', fontSize: 12 }}>
              <span style={{ fontWeight: 700 }}>All connected agents</span>
              <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {view.outboundConnections.map((connection) => (
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
                value={view.prompt.parts.connectedAgents}
                placeholder={view.outboundConnections
                  .map((connection) => (
                    `${connection.title} is a connected teammate. Describe when and why this Card should call it.`
                  ))
                  .join('\n')}
                onChange={(event) => actions.changePromptField('connectedAgents', event.target.value)}
                rows={Math.max(5, Math.min(10, view.outboundConnections.length + 3))}
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

          {view.cardName.editable ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
                  Name
                </label>
                <input
                  type="text"
                  value={view.cardName.draft}
                  onChange={(event) => actions.changeCardName(event.target.value)}
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
            </div>
          ) : null}

          {([
            ['role', 'Role'],
            ['goal', 'Goal'],
            ['constraints', 'Constraints'],
            ['ioSchema', 'Input schema'],
            ['outputExpectations', 'Output expectations'],
          ] as const).map(([field, label]) => (
            <div key={field}>
              <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
                {label}
              </label>
              <textarea
                aria-label={label}
                value={view.prompt.parts[field]}
                onChange={(event) => actions.changePromptField(field, event.target.value)}
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
          ))}

          {cardPromptFieldRanges(view.prompt.text).filter((block) => (
            !['role', 'goal', 'constraints', 'ioSchema', 'outputExpectations', 'connectedAgents'].includes(block.key)
            && (block.start !== block.end || view.prompt.touched[block.key])
          )).map((block) => (
            <label key={block.key} style={{ display: 'grid', gap: 6, color: '#E0DED5', fontSize: 12 }}>
              {block.key === 'memoryPolicy' ? 'Memory policy' : block.label}
              <textarea
                aria-label={block.key === 'memoryPolicy' ? 'Memory policy' : block.label}
                value={view.prompt.parts[block.key] ?? ''}
                onChange={(event) => actions.changePromptField(block.key, event.target.value)}
                rows={5}
                style={{ width: '100%', padding: 10, background: '#2B2B2B', color: '#FFF',
                  border: '1px solid #3A3A3A', borderRadius: 8, fontFamily: 'monospace',
                  fontSize: 13, resize: 'vertical' }}
              />
            </label>
          ))}
        </div>
      </section>
    </div>
  );
}

export type CardInspectorRuntimeViewModel = {
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
    kind: CardEditorConfiguration['runtime']['kind'] | undefined;
    mode: CardEditorConfiguration['runtime']['mode'] | undefined;
    dictionaryReady: boolean;
    optionsStatus: 'loading' | 'ready' | 'failed';
  };
  modelSelection: {
    provider: NonNullable<CardEditorConfiguration['provider']>;
    accessMode: NonNullable<CardEditorConfiguration['access_mode']>;
    modelKey: string;
    autoSelect: boolean;
    providerOptions: InputDictionaryEditorOption[];
    accessModeOptions: InputDictionaryEditorOption[];
    availableModels: CardEditorModelOption[];
  };
  subagents: {
    type: SavedSubagentType;
    typeField: InputDictionaryEditorField | undefined;
    preservesHermesAutoTeam: boolean;
    model: SavedSubagentModel;
    catalogOptions: Array<CardEditorModelOption & { provider: string }>;
  };
  jev: {
    context: Required<SavedJevContext>;
    modelChoiceField: InputDictionaryEditorField | undefined;
    autoToolsField: InputDictionaryEditorField | undefined;
  };
  reasoning: {
    effort: NonNullable<CardEditorConfiguration['reasoning_effort']> | '';
    field: InputDictionaryEditorField | undefined;
  };
  advanced: {
    temperature: number | '';
    maxTokens: number | '';
    maxTurns: number | '';
    temperatureField: InputDictionaryEditorField | undefined;
    maxTokensField: InputDictionaryEditorField | undefined;
    maxTurnsField: InputDictionaryEditorField | undefined;
  };
};

export type CardInspectorRuntimeActions = {
  submitProjectFolder(): void | Promise<void>;
  changeProjectFolder(value: string): void;
  changeProvider(value: string): void;
  changeAccessMode(value: string): void;
  changeModel(modelKey: string): void;
  changeAutoSelect(enabled: boolean): void;
  changeSubagentType(type: SavedSubagentType): void;
  changeReasoningEffort(effort: NonNullable<CardEditorConfiguration['reasoning_effort']> | ''): void;
  changeJevContext(key: keyof Required<SavedJevContext>, mode: JevContextMode): void;
  changeTemperature(value: number | ''): void;
  changeMaxTokens(value: number | ''): void;
  changeMaxTurns(value: number | ''): void;
  changeSubagentModel(provider: string, modelKey: string): void;
};

function jevContextLabel(mode: JevContextMode) {
  return ({
    inherited: 'Inherited / current behavior',
    request_card: 'Current request + saved Card',
    conversation_window: 'Add bounded conversation window',
    selected_graph_context: 'Add selected graph context',
  })[mode];
}

function supportedJevContextOptions(field: InputDictionaryEditorField | undefined) {
  return (field?.options || []).filter(
    (option): option is InputDictionaryEditorOption & { value: JevContextMode } => (
      option.value === 'inherited'
      || option.value === 'request_card'
      || option.value === 'conversation_window'
      || option.value === 'selected_graph_context'
    ),
  );
}

export function CardInspectorRuntimeView({
  view,
  actions,
}: {
  view: CardInspectorRuntimeViewModel;
  actions: CardInspectorRuntimeActions;
}) {
  const { identity, projectFolder, runtime, modelSelection, subagents, jev, reasoning, advanced } = view;

  return (
    <div data-testid="card-inspector-runtime-surface" style={{ display: 'grid', gap: 16 }}>
      {identity.projectId && identity.deckId && identity.cardId ? (
        <CardRunMetrics
          projectId={identity.projectId}
          deckId={identity.deckId}
          cardId={identity.cardId}
        />
      ) : null}
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
                <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
                  Model
                </label>
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
                {runtime.kind === 'hermes' ? (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, color: '#91A9B8', fontSize: 11 }}>
                    <input
                      type="checkbox"
                      aria-label="Auto-select model with Jev"
                      checked={modelSelection.autoSelect}
                      onChange={(event) => actions.changeAutoSelect(event.target.checked)}
                    />
                    Auto-select with Jev
                  </label>
                ) : null}
              </div>
              {runtime.kind === 'hermes'
              && runtime.mode !== 'magentic_one'
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

            {runtime.kind !== 'hermes' ? <div>
              <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
                Reasoning effort
              </label>
              <select
                aria-label="Reasoning effort"
                disabled={!runtime.dictionaryReady}
                value={reasoning.effort}
                onChange={(event) => actions.changeReasoningEffort(
                  event.target.value as CardInspectorRuntimeViewModel['reasoning']['effort'],
                )}
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
                {reasoning.effort
                && !reasoning.field?.options?.some((option) => option.value === reasoning.effort) ? (
                  <option value={reasoning.effort}>{reasoning.effort} (saved)</option>
                ) : null}
                {(reasoning.field?.options || []).map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div> : null}
          </div>
          {runtime.kind === 'hermes' ? (
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
                  label: jev.modelChoiceField?.label || 'Model-choice context',
                  field: jev.modelChoiceField,
                }, {
                  key: 'autoTools' as const,
                  label: jev.autoToolsField?.label || 'Auto-tools context',
                  field: jev.autoToolsField,
                }].map(({ key, label, field }) => {
                  const options = supportedJevContextOptions(field);
                  const current = jev.context[key];
                  return (
                    <label key={key} style={{ display: 'grid', gap: 5, color: '#B9CDD2', fontSize: 11 }}>
                      {label}
                      <select
                        aria-label={label}
                        disabled={!runtime.dictionaryReady || !options.length}
                        value={current}
                        onChange={(event) => {
                          const selected = event.target.value as JevContextMode;
                          if (!options.some((option) => option.value === selected)) return;
                          actions.changeJevContext(key, selected);
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
                {!supportedJevContextOptions(jev.modelChoiceField).length
                || !supportedJevContextOptions(jev.autoToolsField).length ? (
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
          {runtime.kind !== 'hermes' ? <>
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
                  disabled={!runtime.dictionaryReady}
                  type="number"
                  min={advanced.temperatureField?.minimum}
                  max={advanced.temperatureField?.maximum}
                  step={advanced.temperatureField?.step}
                  value={advanced.temperature}
                  onChange={(event) => actions.changeTemperature(
                    event.target.value === '' ? '' : event.target.valueAsNumber,
                  )}
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
                  Max tokens
                </label>
                <input
                  aria-label="Max tokens"
                  disabled={!runtime.dictionaryReady}
                  type="number"
                  min={advanced.maxTokensField?.minimum}
                  max={advanced.maxTokensField?.maximum}
                  step={advanced.maxTokensField?.step}
                  value={advanced.maxTokens}
                  onChange={(event) => actions.changeMaxTokens(
                    event.target.value === '' ? '' : event.target.valueAsNumber,
                  )}
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
                  Max turns
                </label>
                <input
                  aria-label="Max turns"
                  disabled={!runtime.dictionaryReady}
                  type="number"
                  min={advanced.maxTurnsField?.minimum}
                  max={advanced.maxTurnsField?.maximum}
                  step={advanced.maxTurnsField?.step}
                  value={advanced.maxTurns}
                  onChange={(event) => actions.changeMaxTurns(
                    event.target.value === '' ? '' : event.target.valueAsNumber,
                  )}
                />
              </div>
            </div>
          </> : null}
        </div>
      </section>
      {runtime.kind === 'hermes'
      && runtime.mode !== 'magentic_one'
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
