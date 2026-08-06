import React from 'react';

import {
  GRAPH_THEME,
  graphDrawerButtonStyle,
  graphDrawerInputStyle,
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
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 10,
        padding: '6px 0',
        borderBottom: '1px solid rgba(167,176,186,0.1)',
      }}
    >
      <div
        style={{
          flex: '0 0 92px',
          fontSize: 11,
          color: GRAPH_THEME.surface.mutedText,
        }}
      >
        {label}
      </div>
      <div style={{ flex: '1 1 auto', minWidth: 0 }}>{children}</div>
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
    <section style={{ margin: '0 0 14px' }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: GRAPH_THEME.surface.text,
          marginBottom: 6,
        }}
      >
        {title}
      </div>
      {children}
    </section>
  );
}

function CheckRow({
  label,
  checked,
  onChange,
  testId,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  testId: string;
}) {
  return (
    <label
      data-testid={testId}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        padding: '3px 0',
        fontSize: 11,
        color: GRAPH_THEME.surface.text,
        cursor: 'pointer',
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ margin: 0 }}
      />
      {label}
    </label>
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
  const statusLine = current
    ? (Object.entries(current.counts || {}) as [string, number][])
        .map(([status, count]) => `${KANBAN_STATUS_LABELS[status] || status} ${count}`)
        .join(' · ')
    : '';
  return (
    <div>
      <FieldRow label="Board">
        <span style={{ fontSize: 12, color: GRAPH_THEME.surface.text }}>
          {current?.name || currentBoard}
          {current && current.slug !== currentBoard ? ` (${currentBoard})` : ''}
        </span>
      </FieldRow>
      <FieldRow label="Tasks">
        <span data-testid="hermes-kanban-board-total" style={{ fontSize: 12, color: GRAPH_THEME.surface.text }}>
          {current ? current.total : '—'}
        </span>
      </FieldRow>
      <FieldRow label="Status">
        <span data-testid="hermes-kanban-board-status-line" style={{ fontSize: 11, color: GRAPH_THEME.surface.mutedText }}>
          {statusLine || '—'}
        </span>
      </FieldRow>

      <div style={{ height: 10 }} />

      <Section title="Filters">
        <CheckRow
          label="Show archived"
          checked={filters.includeArchived}
          onChange={(checked) => onFiltersChange({ includeArchived: checked })}
          testId="hermes-kanban-archived-toggle"
        />
        <CheckRow
          label="Group lanes by profile"
          checked={filters.lanesByProfile}
          onChange={(checked) => onFiltersChange({ lanesByProfile: checked })}
          testId="hermes-kanban-lanes-by-profile"
        />
        <FieldRow label="Assignee">
          <input
            data-testid="hermes-kanban-assignee-filter"
            placeholder="Filter by assignee"
            value={filters.assignee}
            onChange={(e) => onFiltersChange({ assignee: e.target.value })}
            style={graphDrawerInputStyle()}
          />
        </FieldRow>
        <FieldRow label="Tenant">
          <input
            data-testid="hermes-kanban-tenant-filter"
            placeholder="Filter by tenant"
            value={filters.tenant}
            onChange={(e) => onFiltersChange({ tenant: e.target.value })}
            style={graphDrawerInputStyle()}
          />
        </FieldRow>
        <FieldRow label="Status lanes">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0 14px' }}>
            {KANBAN_STATUSES.map((status) => (
              <CheckRow
                key={status}
                label={KANBAN_STATUS_LABELS[status] || status}
                checked={filters.visibleStatuses.has(status)}
                onChange={() => toggleStatus(status)}
                testId={`hermes-kanban-status-filter-${status}`}
              />
            ))}
          </div>
        </FieldRow>
      </Section>

      <Section title="Dispatcher">
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            data-testid="hermes-kanban-refresh"
            onClick={actions.onRefresh}
            style={graphDrawerButtonStyle()}
          >
            Refresh
          </button>
          <button
            type="button"
            data-testid="hermes-kanban-nudge"
            disabled={actions.busy('nudge')}
            onClick={actions.onNudge}
            title="Run one native dispatcher pass (reclaims stale, promotes ready, spawns workers)"
            style={graphDrawerButtonStyle()}
          >
            {actions.busy('nudge') ? 'Dispatching…' : 'Nudge dispatcher'}
          </button>
        </div>
        <div style={{ fontSize: 10, color: GRAPH_THEME.surface.mutedText, marginTop: 6, lineHeight: 1.4 }}>
          Nudge runs a real dispatcher pass and may spawn workers; it is never run automatically.
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
        Values are read from the native configuration. Editing is not part of
        this surface.
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
          No profiles detected.
        </div>
      ) : (
        profiles.map((profile) => (
          <section
            key={profile.name}
            data-testid={`hermes-kanban-profile-${profile.name}`}
            style={{
              margin: '0 0 12px',
              paddingBottom: 10,
              borderBottom: '1px solid rgba(167,176,186,0.12)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span
                style={{
                  fontWeight: 700,
                  fontSize: 12,
                  color: profile.active ? GRAPH_THEME.surface.text : GRAPH_THEME.surface.mutedText,
                }}
              >
                {profile.active ? '◆ ' : ''}
                {profile.name}
              </span>
              <span
                style={{
                  fontSize: 10,
                  color:
                    profile.gateway === 'running' ? '#63D8A0' : '#E06C6C',
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
            Restarts the local gateway process. Only triggered by explicit
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
