import React from 'react';

import {
  GRAPH_THEME,
  graphDrawerButtonStyle,
  graphDrawerInputStyle,
  graphDrawerSectionStyle,
} from '../../components/graph/graphVisualTokens';
import type {
  BoardFilters,
  HermesConfig,
  HermesSystemStatus,
  KanbanBoardInfo,
  ProfileInfo,
} from './types';
import { KANBAN_STATUS_LABELS, KANBAN_STATUSES } from './types';

export type BoardTabActions = {
  onRefresh: () => void;
  onNudge: () => void;
  onRestartGateway: () => void;
  busy: (key: string) => boolean;
};

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ margin: '0 0 8px' }}>
      <div
        style={{
          fontSize: 9,
          fontWeight: 800,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: GRAPH_THEME.surface.mutedText,
          marginBottom: 3,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section style={graphDrawerSectionStyle({ padding: '10px 11px', margin: '0 0 10px' })}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          color: '#7DE0DA',
          marginBottom: 8,
        }}
      >
        {title}
      </div>
      {children}
    </section>
  );
}

function BoardTab({
  boards,
  currentBoard,
  filters,
  onFiltersChange,
  actions,
}: {
  boards: KanbanBoardInfo[];
  currentBoard: string;
  filters: BoardFilters;
  onFiltersChange: (patch: Partial<BoardFilters>) => void;
  actions: BoardTabActions;
}) {
  const current = boards.find((b) => b.slug === currentBoard) || null;
  const toggleStatus = (status: string) => {
    const next = new Set(filters.visibleStatuses);
    if (next.has(status)) next.delete(status);
    else next.add(status);
    onFiltersChange({ visibleStatuses: next });
  };
  return (
    <div>
      <Section title="Current Board">
        <FieldRow label="Board">
          <div style={{ fontSize: 12, color: GRAPH_THEME.surface.text }}>
            {current?.name || currentBoard}
            <span style={{ color: GRAPH_THEME.surface.mutedText }}> ({currentBoard})</span>
          </div>
        </FieldRow>
        <FieldRow label="Total tasks">
          <div style={{ fontSize: 12, color: GRAPH_THEME.surface.text }}>
            {current ? current.total : '—'}
          </div>
        </FieldRow>
        <FieldRow label="Per-status counts">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {(Object.entries(current?.counts || {}) as [string, number][]).map(([status, count]) => (
              <span
                key={status}
                style={{
                  fontSize: 9,
                  padding: '1px 6px',
                  borderRadius: 999,
                  background: 'rgba(167,176,186,0.1)',
                  border: '1px solid rgba(167,176,186,0.22)',
                  color: GRAPH_THEME.surface.mutedText,
                }}
              >
                {KANBAN_STATUS_LABELS[status] || status}={count}
              </span>
            ))}
          </div>
        </FieldRow>
      </Section>

      <Section title="Board Filters">
        <FieldRow label="Status lanes">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {KANBAN_STATUSES.map((status) => {
              const on = filters.visibleStatuses.has(status);
              return (
                <button
                  key={status}
                  type="button"
                  data-testid={`hermes-kanban-status-filter-${status}`}
                  aria-pressed={on}
                  onClick={() => toggleStatus(status)}
                  style={{
                    padding: '3px 7px',
                    borderRadius: 999,
                    border: `1px solid ${on ? 'rgba(55,173,170,0.45)' : 'rgba(167,176,186,0.24)'}`,
                    background: on ? 'rgba(55,173,170,0.14)' : 'rgba(11,14,18,0.6)',
                    color: on ? '#7DE0DA' : GRAPH_THEME.surface.mutedText,
                    fontSize: 9,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {KANBAN_STATUS_LABELS[status] || status}
                </button>
              );
            })}
          </div>
        </FieldRow>
        <FieldRow label="Show archived">
          <button
            type="button"
            data-testid="hermes-kanban-archived-toggle"
            aria-pressed={filters.includeArchived}
            onClick={() => onFiltersChange({ includeArchived: !filters.includeArchived })}
            style={graphDrawerButtonStyle({
              background: filters.includeArchived ? 'rgba(55,173,170,0.18)' : 'transparent',
              color: filters.includeArchived ? '#7DE0DA' : GRAPH_THEME.surface.mutedText,
            })}
          >
            {filters.includeArchived ? 'Including archived' : 'Hidden (archived off)'}
          </button>
        </FieldRow>
        <FieldRow label="Assignee filter">
          <input
            data-testid="hermes-kanban-assignee-filter"
            placeholder="e.g. default"
            value={filters.assignee}
            onChange={(e) => onFiltersChange({ assignee: e.target.value })}
            style={graphDrawerInputStyle()}
          />
        </FieldRow>
        <FieldRow label="Tenant filter">
          <input
            data-testid="hermes-kanban-tenant-filter"
            placeholder="tenant namespace"
            value={filters.tenant}
            onChange={(e) => onFiltersChange({ tenant: e.target.value })}
            style={graphDrawerInputStyle()}
          />
        </FieldRow>
        <FieldRow label="Lanes by profile">
          <button
            type="button"
            data-testid="hermes-kanban-lanes-by-profile"
            aria-pressed={filters.lanesByProfile}
            onClick={() => onFiltersChange({ lanesByProfile: !filters.lanesByProfile })}
            style={graphDrawerButtonStyle({
              background: filters.lanesByProfile ? 'rgba(55,173,170,0.18)' : 'transparent',
              color: filters.lanesByProfile ? '#7DE0DA' : GRAPH_THEME.surface.mutedText,
            })}
          >
            {filters.lanesByProfile ? 'Per-profile lanes on' : 'Per-status lanes'}
          </button>
        </FieldRow>
      </Section>

      <Section title="Dispatcher">
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            data-testid="hermes-kanban-refresh"
            onClick={actions.onRefresh}
            style={graphDrawerButtonStyle({ color: '#7DE0DA' })}
          >
            Refresh
          </button>
          <button
            type="button"
            data-testid="hermes-kanban-nudge"
            disabled={actions.busy('nudge')}
            onClick={actions.onNudge}
            title="Run one native dispatcher pass (reclaims stale, promotes ready, spawns workers)"
            style={graphDrawerButtonStyle({ color: '#F2A64A', borderColor: 'rgba(242,166,74,0.42)' })}
          >
            {actions.busy('nudge') ? 'Dispatching…' : 'Nudge dispatcher'}
          </button>
        </div>
        <div style={{ fontSize: 9, color: GRAPH_THEME.surface.mutedText, marginTop: 6, lineHeight: 1.4 }}>
          Nudge runs a real dispatcher pass against the live board and may spawn
          workers. It is never run automatically.
        </div>
      </Section>
    </div>
  );
}

function OrchestrationTab({ config }: { config: HermesConfig | null }) {
  const orbit: Array<[key: string, label: string]> = [
    ['dispatch_in_gateway', 'Auto/manual mode'],
    ['dispatch_interval_seconds', 'Dispatch interval (s)'],
    ['failure_limit', 'Failure limit'],
    ['orchestrator_profile', 'Orchestrator profile'],
    ['default_assignee', 'Default assignee'],
    ['max_in_progress_per_profile', 'Max workers per profile'],
    ['auto_decompose', 'Auto-decompose Triage'],
    ['auto_decompose_per_tick', 'Decompositions per tick'],
    ['dispatch_stale_timeout_seconds', 'Stale-worker timeout (s)'],
    ['worker_log_rotate_bytes', 'Worker log rotate bytes'],
    ['auto_subscribe_on_create', 'Auto-subscribe on create'],
  ];
  const kanban = config?.kanban || {};
  const delegation = config?.delegation || {};
  return (
    <div>
      <Section title="Dispatcher Mode">
        {orbit.map(([key, label]) => {
          const value = kanban[key];
          return (
            <RowValue
              key={key}
              label={label}
              value={value}
              testId={`hermes-kanban-orchestration-${String(key).toLowerCase()}`}
            />
          );
        })}
      </Section>
      <Section title="Delegation (global)">
        {(['max_concurrent_children', 'max_spawn_depth', 'child_timeout_seconds'] as const).map((key) => (
          <RowValue
            key={key}
            label={key}
            value={delegation[key]}
            testId={`hermes-kanban-delegation-${key}`}
          />
        ))}
      </Section>
      <div style={{ fontSize: 9, color: GRAPH_THEME.surface.mutedText, lineHeight: 1.4 }}>
        Values are the native Hermes config (<code>hermes config get kanban / delegation</code>).
        Configuration editing is not part of this board surface.
      </div>
    </div>
  );
}

function RowValue({
  label,
  value,
  testId,
}: {
  label: string;
  value: unknown;
  testId?: string;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '3px 0' }} data-testid={testId}>
      <span style={{ fontSize: 10, color: GRAPH_THEME.surface.mutedText }}>{label}</span>
      <span style={{ fontSize: 11, color: GRAPH_THEME.surface.text, fontWeight: 700, textAlign: 'right', wordBreak: 'break-word' }}>
        {value === null || value === undefined || value === '' ? '—' : String(value)}
      </span>
    </div>
  );
}

function ProfilesTab({ profiles }: { profiles: ProfileInfo[] }) {
  return (
    <div>
      {profiles.length === 0 ? (
        <div style={{ fontSize: 11, color: GRAPH_THEME.surface.mutedText, padding: 8 }}>
          No Hermes profiles detected.
        </div>
      ) : (
        profiles.map((profile) => (
          <section
            key={profile.name}
            data-testid={`hermes-kanban-profile-${profile.name}`}
            style={graphDrawerSectionStyle({
              padding: '9px 11px',
              margin: '0 0 8px',
              borderColor: profile.active ? 'rgba(55,173,170,0.4)' : undefined,
            })}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  fontWeight: 800,
                  fontSize: 12,
                  color: profile.active ? '#7DE0DA' : GRAPH_THEME.surface.text,
                }}
              >
                {profile.active ? '◆ ' : ''}
                {profile.name}
              </span>
              <span
                style={{
                  marginLeft: 'auto',
                  fontSize: 9,
                  padding: '1px 6px',
                  borderRadius: 999,
                  background:
                    profile.gateway === 'running' ? 'rgba(99,216,160,0.12)' : 'rgba(224,108,108,0.1)',
                  border: `1px solid ${
                    profile.gateway === 'running' ? 'rgba(99,216,160,0.35)' : 'rgba(224,108,108,0.32)'
                  }`,
                  color: profile.gateway === 'running' ? '#63D8A0' : '#E06C6C',
                }}
              >
                {profile.gateway}
              </span>
            </div>
            {profile.model ? (
              <div style={{ fontSize: 10, color: GRAPH_THEME.surface.mutedText, marginTop: 4, fontFamily: 'ui-monospace, monospace' }}>
                {profile.model}
              </div>
            ) : null}
            {profile.alias && profile.alias !== '—' ? (
              <div style={{ fontSize: 10, color: GRAPH_THEME.surface.mutedText, marginTop: 2 }}>alias: {profile.alias}</div>
            ) : null}
            {profile.concurrency ? (
              <div style={{ fontSize: 10, color: GRAPH_THEME.surface.mutedText, marginTop: 2 }}>
                per-profile concurrency: {profile.concurrency}
              </div>
            ) : null}
            {profile.description ? (
              <div style={{ fontSize: 10, color: GRAPH_THEME.surface.mutedText, marginTop: 6, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>
                {profile.description}
              </div>
            ) : null}
          </section>
        ))
      )}
    </div>
  );
}

function SystemTab({
  system,
  actions,
}: {
  system: HermesSystemStatus | null;
  actions: BoardTabActions;
}) {
  const diagnosed = Array.isArray(system?.diagnostics) ? system.diagnostics : [];
  return (
    <div>
      <Section title="Gateway">
        <RowValue
          label="Gateway"
          value={system ? (system.gateway.running ? 'running' : 'stopped') : '…'}
          testId="hermes-kanban-system-gateway"
        />
        <RowValue label="PID" value={system?.gateway.pid ?? null} />
        <div style={{ marginTop: 8 }}>
          <button
            type="button"
            data-testid="hermes-kanban-restart-gateway"
            disabled={actions.busy('restart-gateway')}
            onClick={actions.onRestartGateway}
            style={graphDrawerButtonStyle({
              color: '#F2A64A',
              borderColor: 'rgba(242,166,74,0.42)',
            })}
          >
            {actions.busy('restart-gateway') ? 'Restarting…' : 'Restart gateway'}
          </button>
          <div style={{ fontSize: 9, color: GRAPH_THEME.surface.mutedText, marginTop: 5, lineHeight: 1.4 }}>
            Restarts the local Hermes gateway process. Only triggered by explicit
            user action.
          </div>
        </div>
      </Section>
      <Section title="Dispatcher">
        <RowValue
          label="Dispatchers"
          value={system ? (system.dispatcher.running ? 'running' : 'idle') : '…'}
          testId="hermes-kanban-system-dispatcher"
        />
        <RowValue label="In gateway" value={system?.dispatcher.dispatchInGateway ?? null} />
        <RowValue label="Interval (s)" value={system?.dispatcher.intervalSeconds ?? null} />
        <RowValue label="Stale timeout (s)" value={system?.dispatcher.staleTimeoutSeconds ?? null} />
      </Section>
      <Section title="Active profile sessions">
        {(system?.profiles || []).filter((p) => p.gateway === 'running').length === 0 ? (
          <div style={{ fontSize: 10, color: GRAPH_THEME.surface.mutedText }}>No profile gateways running.</div>
        ) : (
          (system?.profiles || [])
            .filter((p) => p.gateway === 'running')
            .map((p) => (
              <div key={p.name} style={{ fontSize: 11, color: GRAPH_THEME.surface.text, padding: '2px 0' }}>
                {p.name} <span style={{ color: GRAPH_THEME.surface.mutedText }}>— gateway running</span>
              </div>
            ))
        )}
      </Section>
      <Section title="Diagnostics">
        {diagnosed.length === 0 ? (
          <div style={{ fontSize: 10, color: GRAPH_THEME.surface.mutedText }}>No diagnostics reported.</div>
        ) : (
          diagnosed.map((d, i) => (
            <pre
              key={i}
              style={{
                fontSize: 9,
                color: GRAPH_THEME.surface.mutedText,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                margin: 0,
              }}
            >
              {typeof d === 'string' ? d : JSON.stringify(d, null, 2)}
            </pre>
          ))
        )}
      </Section>
    </div>
  );
}

export { BoardTab, OrchestrationTab, ProfilesTab, SystemTab };
