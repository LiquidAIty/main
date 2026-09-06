import React from 'react';

import type { AgentCardRuntimeOptions, CardRuntime } from '../../../types/agentgraph';
import type { InputDictionaryEditorField } from '../../../components/AgentManager';

export type SavedTeamConfig = NonNullable<AgentCardRuntimeOptions['team']>;
type SavedModel = SavedTeamConfig['workerModel'];

export type TeamModelOption = {
  provider: string;
  key: string;
  label: string;
  providerModelId: string;
};

function modelValue(model: SavedModel): string {
  return `${model.provider}\u0000${model.modelKey}`;
}

function modelSelect(args: {
  label: string;
  value: SavedModel;
  options: TeamModelOption[];
  onChange: (model: SavedModel) => void;
}) {
  const selected = modelValue(args.value);
  const available = args.options.some((option) => (
    option.provider === args.value.provider
    && option.key === args.value.modelKey
    && option.providerModelId === args.value.providerModelId
  ));
  return (
    <label style={{ display: 'grid', gap: 4, color: '#B8C8CD', fontSize: 10.5 }}>
      {args.label}
      <select
        aria-label={args.label}
        value={selected}
        onChange={(event) => {
          const [provider, key] = event.target.value.split('\u0000');
          const option = args.options.find((candidate) => (
            candidate.provider === provider && candidate.key === key
          ));
          if (!option) return;
          args.onChange({
            provider,
            accessMode: provider === 'openrouter' ? 'openrouter-api'
              : provider === 'openai' ? 'chatgpt-account'
              : 'openai-api',
            modelKey: option.key,
            providerModelId: option.providerModelId,
          });
        }}
      >
        {!available ? (
          <option value={selected}>{args.value.providerModelId} (unavailable — saved)</option>
        ) : null}
        {args.options.map((option) => (
          <option key={`${option.provider}:${option.key}`} value={`${option.provider}\u0000${option.key}`}>
            {option.label} · {option.provider}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function CardSubagentsTab({
  runtime,
  team,
  modelOptions,
  onChange,
  fields,
}: {
  runtime: CardRuntime;
  team: SavedTeamConfig;
  modelOptions: TeamModelOption[];
  onChange: (team: SavedTeamConfig) => void;
  fields: InputDictionaryEditorField[];
}) {
  if (runtime.kind !== 'hermes' || team.mode !== 'auto') return null;
  const workers = fields.find((field) => field.name === 'teamMaxWorkers');
  const retries = fields.find((field) => field.name === 'teamRetryLimit');

  return (
    <div data-testid="card-subagents-tab" style={{ display: 'grid', gap: 10 }}>
      <section style={{ padding: 10, borderRadius: 8, border: '1px solid #3A4A4F', background: '#1D2526' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
          <label style={{ display: 'grid', gap: 4, color: '#B8C8CD', fontSize: 10.5 }}>
            Maximum workers
            <select
              aria-label="Maximum workers"
              value={team.maxWorkers}
              disabled={!workers?.options?.length}
              onChange={(event) => onChange({
                ...team,
                maxWorkers: Number(event.target.value) as SavedTeamConfig['maxWorkers'],
              })}
            >
              {workers?.options?.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label style={{ display: 'grid', gap: 4, color: '#B8C8CD', fontSize: 10.5 }}>
            Retry limit
            <input type="number"
              aria-label="Retry limit"
              value={team.retryLimit}
              min={retries?.minimum}
              max={retries?.maximum}
              step={retries?.step}
              disabled={!retries}
              onChange={(event) => onChange({ ...team, retryLimit: Number(event.target.value) })}
            />
          </label>
        </div>
        <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
          {modelSelect({
            label: 'Worker model', value: team.workerModel, options: modelOptions,
            onChange: (workerModel) => onChange({ ...team, workerModel }),
          })}
          {modelSelect({
            label: 'Team lead model', value: team.leadModel, options: modelOptions,
            onChange: (leadModel) => onChange({ ...team, leadModel }),
          })}
        </div>
        
      </section>

    </div>
  );
}
