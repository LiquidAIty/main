import React from 'react';

import type { AgentCardRuntimeOptions, CardRuntime } from '../../../types/agentgraph';

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
  currentRun,
}: {
  runtime: CardRuntime;
  team: SavedTeamConfig;
  modelOptions: TeamModelOption[];
  onChange: (team: SavedTeamConfig) => void;
  currentRun?: {
    runId?: string | null;
    state?: string | null;
    status?: string;
    nativeRootId?: string | null;
    nativeRunId?: string | number | null;
    activeWorkers?: number;
    error?: string | null;
    teamReceipt?: {
      source: string;
      maxWorkers: number;
      retryLimit: number;
      workerProvider: string;
      workerModel: string;
      leadProvider: string;
      leadModel: string;
      maxDepth: number;
    } | null;
  } | null;
}) {
  const teamSupported = runtime.kind === 'hermes';
  const rawState = String(currentRun?.state || currentRun?.status || '').toLowerCase();
  const status = !currentRun?.runId ? 'idle'
    : ['pending', 'running'].includes(rawState) ? 'running'
    : rawState === 'completed' || rawState === 'complete' ? 'completed'
    : rawState === 'failed' || rawState === 'blocked' || rawState === 'cancelled' ? 'failed'
    : rawState || 'idle';
  const telemetry = currentRun?.teamReceipt;

  if (!teamSupported) {
    return (
      <div data-testid="card-subagents-tab" style={{ color: '#B8C8CD', fontSize: 11 }}>
        This Card keeps its existing {runtime.kind} adapter. Native Hermes subagents are not claimed for this runtime.
      </div>
    );
  }

  return (
    <div data-testid="card-subagents-tab" style={{ display: 'grid', gap: 10 }}>
      <section style={{ padding: 10, borderRadius: 8, border: '1px solid #3A4A4F', background: '#202827' }}>
        <div style={{ color: '#E0DED5', fontSize: 12, fontWeight: 700 }}>Native Team</div>
        <div style={{ color: '#80969F', fontSize: 10.5, marginTop: 3 }}>
          Team is the only configured subagent strategy today. Auto authorizes Hermes to call it when useful; it does not start Team with every Run.
        </div>
        <label style={{ display: 'grid', gap: 4, marginTop: 8, color: '#B8C8CD', fontSize: 10.5 }}>
          Team availability
          <select
            aria-label="Team availability"
            value={team.mode}
            onChange={(event) => onChange({ ...team, mode: event.target.value as SavedTeamConfig['mode'] })}
          >
            <option value="off">Off</option>
            <option value="auto">Auto</option>
          </select>
        </label>
      </section>

      <section style={{ padding: 10, borderRadius: 8, border: '1px solid #3A4A4F', background: '#1D2526' }}>
        <div style={{ color: '#E0DED5', fontSize: 11.5, fontWeight: 700 }}>Bounds</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
          <label style={{ display: 'grid', gap: 4, color: '#B8C8CD', fontSize: 10.5 }}>
            Maximum workers
            <select
              aria-label="Maximum workers"
              value={team.maxWorkers}
              onChange={(event) => onChange({
                ...team,
                maxWorkers: Number(event.target.value) as SavedTeamConfig['maxWorkers'],
              })}
            >
              {[2, 3, 4].map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label style={{ display: 'grid', gap: 4, color: '#B8C8CD', fontSize: 10.5 }}>
            Retry limit
            <select
              aria-label="Retry limit"
              value={team.retryLimit}
              onChange={(event) => onChange({ ...team, retryLimit: Number(event.target.value) })}
            >
              {[0, 1, 2, 3, 4].map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
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
        <div style={{ color: '#80969F', fontSize: 10, marginTop: 7 }}>
          The Team lead performs native decomposition and final synthesis. SQLite records applied execution truth; it is not editable configuration.
        </div>
      </section>

      <section style={{ padding: 10, borderRadius: 8, border: '1px solid #3A4A4F', background: '#1D2526' }}>
        <div style={{ color: '#E0DED5', fontSize: 11.5, fontWeight: 700 }}>Status</div>
        <div data-testid="card-subagents-status" style={{ color: '#B8C8CD', fontSize: 10.5, marginTop: 7 }}>
          {status}
          {typeof currentRun?.activeWorkers === 'number' && currentRun.activeWorkers > 0
            ? ` · ${currentRun.activeWorkers} running workers`
            : ''}
        </div>
        {currentRun?.runId ? (
          <div style={{ color: '#80969F', fontSize: 10, marginTop: 5, fontFamily: 'ui-monospace, monospace' }}>
            Card Run {currentRun.runId}
            {currentRun.nativeRootId ? ` · root ${currentRun.nativeRootId}` : ''}
            {currentRun.nativeRunId != null ? ` · native run ${currentRun.nativeRunId}` : ''}
          </div>
        ) : null}
        {currentRun?.error ? (
          <div role="alert" style={{ color: '#FFA2A2', fontSize: 10, marginTop: 5 }}>
            {currentRun.error}
          </div>
        ) : null}
        {telemetry ? (
          <div data-testid="card-subagents-telemetry" style={{ color: '#80969F', fontSize: 10, marginTop: 6 }}>
            Applied {telemetry.maxWorkers} workers · {telemetry.retryLimit} retries · worker {telemetry.workerProvider}/{telemetry.workerModel} · lead {telemetry.leadProvider}/{telemetry.leadModel} · depth {telemetry.maxDepth}
          </div>
        ) : (
          <div style={{ color: '#80969F', fontSize: 10, marginTop: 6 }}>
            No native Team policy telemetry on the selected Run.
          </div>
        )}
      </section>
    </div>
  );
}
