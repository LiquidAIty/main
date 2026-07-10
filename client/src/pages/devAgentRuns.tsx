import { Fragment, useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';

/**
 * /dev/agent-runs — the Hermes Dev Observatory (DEV-ONLY).
 *
 * Hermes' developer brain view over the agent system: what actually ran, what
 * is actually wired, and whether coding-agent claims are actually supported.
 * Five tabs, all fed by real backend state (never invented):
 *
 *  - Runs:          telemetry events grouped into runs; stage chips make a
 *                   missing preflight/postflight visible; click an event for
 *                   its full JSON. RAM vs durable source is labeled.
 *  - System:        live topology — orchestrator, bus edges, connected vs
 *                   parked, graph endpoints, instrumented stages.
 *  - Cards:         per-card saved config vs runtime-RESOLVED config (same
 *                   strict resolvers the real run uses), tools, graph access,
 *                   invocation paths, and any resolution error.
 *  - Coder Reports: submitted CoderReports with deterministic claim
 *                   verification (SUPPORTED / UNSUPPORTED / CONTRADICTED /
 *                   MISSING_PROOF) and the evidence event ids.
 *  - Drift:         removed/unknown tool references in live prompts, model
 *                   resolution failures, connected-but-broken cards.
 *
 * This is an inspection surface, not an agent and not user analytics: the
 * route registers only in dev builds, every backing route 403s in production,
 * and nothing here mutates cards or graphs.
 */

export type AgentTelemetryEvent = {
  id: string;
  timestamp: string;
  projectId: string | null;
  deckId: string | null;
  conversationId: string | null;
  correlationId: string | null;
  stage: string;
  caller: string;
  cardId: string | null;
  provider: string | null;
  model: string | null;
  inputSummary: string;
  outputSummary: string;
  status: string;
  errorSummary: string | null;
  durationMs: number | null;
  tools: string[];
  graphReads: string[];
  graphWrites: string[];
  mode: string;
  metadata: Record<string, unknown>;
  source?: 'ram' | 'durable';
};

export type SystemCard = {
  cardId: string;
  title: string;
  runtimeType: string | null;
  runtimeBinding: string | null;
  connected: boolean;
  enabled: boolean;
  promptChars: number;
  provider: string | null;
  modelKey: string | null;
  resolved: { provider: string; providerModelId: string; tools: string[] } | null;
  resolutionError: string | null;
  graphReads: string[];
  graphWrites: string[];
  invocableBy: string[];
};

export type SystemDescription = {
  projectId: string;
  deckId: string;
  orchestratorCardId: string | null;
  busEdges: number;
  disconnectedCards: string[];
  cards: SystemCard[];
  graphEndpoints: Record<string, string>;
  runStages: string[];
};

export type DriftFinding = {
  cardId: string;
  kind: string;
  severity: 'problem' | 'warning';
  detail: string;
};

export type DriftReport = {
  checkedCards: number;
  problems: DriftFinding[];
  warnings: DriftFinding[];
};

export type CoderReportRecord = {
  submission: {
    id: string;
    timestamp: string;
    projectId: string;
    executionMode: string;
    adapter: string | null;
    jobId: string | null;
    reportText: string;
    claims: Record<string, unknown>;
  };
  verification: {
    verdict: string;
    supported: number;
    unsupported: number;
    contradicted: number;
    missingProof: number;
    findings: Array<{ kind: string; claim: string; verdict: string; evidence: string[]; note: string }>;
  } | null;
};

export type AgentEventsFetchResult =
  | { ok: true; events: AgentTelemetryEvent[] }
  | { ok: false; error: string };
export type SystemFetchResult = { ok: true; system: SystemDescription } | { ok: false; error: string };
export type DriftFetchResult = { ok: true; drift: DriftReport } | { ok: false; error: string };
export type CoderReportsFetchResult =
  | { ok: true; reports: CoderReportRecord[] }
  | { ok: false; error: string };
export type ProjectsFetchResult =
  | { ok: true; projects: Array<{ id: string; name: string }> }
  | { ok: false; error: string };

async function getJson(url: string): Promise<any> {
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok || payload?.ok !== true) {
    throw new Error(String(payload?.error || `http_${response.status}`));
  }
  return payload;
}

async function fetchAgentEventsFromBackend(): Promise<AgentEventsFetchResult> {
  try {
    const payload = await getJson('/api/dev/agent-harness/events?limit=500');
    return { ok: true, events: payload.events as AgentTelemetryEvent[] };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'agent_events_unreachable' };
  }
}

async function fetchSystemFromBackend(projectId: string): Promise<SystemFetchResult> {
  try {
    const payload = await getJson(`/api/dev/agent-harness/system?projectId=${encodeURIComponent(projectId)}`);
    return { ok: true, system: payload as SystemDescription };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'system_unreachable' };
  }
}

async function fetchDriftFromBackend(projectId: string): Promise<DriftFetchResult> {
  try {
    const payload = await getJson(`/api/dev/agent-harness/drift?projectId=${encodeURIComponent(projectId)}`);
    return { ok: true, drift: payload as DriftReport };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'drift_unreachable' };
  }
}

async function fetchCoderReportsFromBackend(): Promise<CoderReportsFetchResult> {
  try {
    const payload = await getJson('/api/dev/agent-harness/coder-reports?limit=20');
    return { ok: true, reports: payload.reports as CoderReportRecord[] };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'coder_reports_unreachable' };
  }
}

async function fetchProjectsFromBackend(): Promise<ProjectsFetchResult> {
  try {
    const payload = await getJson('/api/projects');
    return {
      ok: true,
      projects: (payload.projects as any[]).map((p) => ({ id: String(p.id), name: String(p.name || p.id) })),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'projects_unreachable' };
  }
}

async function clearAgentEventsOnBackend(): Promise<void> {
  await fetch('/api/dev/agent-harness/events/clear', { method: 'POST' }).catch(() => null);
}

// The intended pipeline order (matches the backend's instrumented stages).
export const PIPELINE_STAGES = [
  'frontdoor',
  'hermes_preflight',
  'mag_one_dispatch',
  'participant_turn',
  'card_call',
  'graph_read',
  'graph_write',
  'hermes_postflight',
] as const;

type RunGroup = {
  correlationId: string;
  events: AgentTelemetryEvent[];
  firstTimestamp: string;
  failed: boolean;
  isProbe: boolean;
  projectId: string | null;
  stagesPresent: Set<string>;
};

/** Group events into runs by correlationId, newest run first (pure). */
export function groupEventsIntoRuns(events: AgentTelemetryEvent[]): RunGroup[] {
  const byRun = new Map<string, AgentTelemetryEvent[]>();
  for (const event of events) {
    const key = event.correlationId || '(no run id)';
    const list = byRun.get(key) ?? [];
    list.push(event);
    byRun.set(key, list);
  }
  return [...byRun.entries()]
    .map(([correlationId, runEvents]) => ({
      correlationId,
      events: runEvents,
      firstTimestamp: runEvents[0]?.timestamp ?? '',
      failed: runEvents.some((e) => e.status === 'failed'),
      isProbe: runEvents.every((e) => e.stage === 'dev_probe'),
      projectId: runEvents.find((e) => e.projectId)?.projectId ?? null,
      stagesPresent: new Set(runEvents.map((e) => e.stage)),
    }))
    .sort((a, b) => (a.firstTimestamp < b.firstTimestamp ? 1 : -1));
}

const MODE_COLORS: Record<string, string> = {
  real_model_call: '#7dd3a0',
  dry_run: '#8ab8ff',
  simulated_probe: '#c9a7ff',
  blocked: '#ff9d8a',
};

const VERDICT_COLORS: Record<string, string> = {
  SUPPORTED: '#7dd3a0',
  PARTIALLY_SUPPORTED: '#e8c268',
  UNSUPPORTED: '#e8c268',
  CONTRADICTED: '#ff9d8a',
  MISSING_PROOF: 'rgba(255,255,255,0.45)',
};

function timeLabel(iso: string): string {
  const match = /T(\d{2}:\d{2}:\d{2})/.exec(iso || '');
  return match ? match[1] : iso;
}

const cell: CSSProperties = {
  padding: '4px 8px',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
  verticalAlign: 'top',
  textAlign: 'left',
};

const button: CSSProperties = {
  background: 'rgba(138,184,255,0.12)',
  border: '1px solid rgba(138,184,255,0.35)',
  color: 'inherit',
  borderRadius: 4,
  padding: '3px 10px',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 12,
};

/** Stage chips: which pipeline stages actually happened in a run. An absent
 * chip means "no event seen" — not run, or not an instrumented boundary. */
function StageChips({ run }: { run: RunGroup }) {
  if (run.isProbe) {
    return <span style={{ color: MODE_COLORS.dry_run }}>dev probe</span>;
  }
  return (
    <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
      {PIPELINE_STAGES.map((stage) => {
        const present = run.stagesPresent.has(stage);
        const failedHere = run.events.some((e) => e.stage === stage && e.status === 'failed');
        return (
          <span
            key={stage}
            data-testid={`stage-chip-${stage}`}
            data-present={present}
            title={present ? stage : `${stage}: no event seen for this run`}
            style={{
              padding: '1px 6px',
              borderRadius: 8,
              fontSize: 10,
              border: '1px solid',
              borderColor: failedHere ? '#ff9d8a' : present ? 'rgba(125,211,160,0.5)' : 'rgba(255,255,255,0.12)',
              color: failedHere ? '#ff9d8a' : present ? '#7dd3a0' : 'rgba(255,255,255,0.28)',
            }}
          >
            {stage
              .replace('hermes_', 'H:')
              .replace('mag_one_dispatch', 'mag_one')
              .replace('participant_turn', 'turns')}
          </span>
        );
      })}
    </span>
  );
}

export type DevAgentRunsProps = {
  /** Injectable for tests; defaults hit the real backend. */
  fetchEvents?: () => Promise<AgentEventsFetchResult>;
  fetchSystem?: (projectId: string) => Promise<SystemFetchResult>;
  fetchDrift?: (projectId: string) => Promise<DriftFetchResult>;
  fetchCoderReports?: () => Promise<CoderReportsFetchResult>;
  fetchProjects?: () => Promise<ProjectsFetchResult>;
  clearEvents?: () => Promise<void>;
};

type TabId = 'runs' | 'system' | 'cards' | 'reports' | 'drift';

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'runs', label: 'Runs' },
  { id: 'system', label: 'System' },
  { id: 'cards', label: 'Cards' },
  { id: 'reports', label: 'Coder Reports' },
  { id: 'drift', label: 'Drift' },
];

export default function DevAgentRuns({
  fetchEvents = fetchAgentEventsFromBackend,
  fetchSystem = fetchSystemFromBackend,
  fetchDrift = fetchDriftFromBackend,
  fetchCoderReports = fetchCoderReportsFromBackend,
  fetchProjects = fetchProjectsFromBackend,
  clearEvents = clearAgentEventsOnBackend,
}: DevAgentRunsProps) {
  const [tab, setTab] = useState<TabId>('runs');
  const [events, setEvents] = useState<AgentTelemetryEvent[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [projectId, setProjectId] = useState<string>('');
  const [system, setSystem] = useState<SystemDescription | null>(null);
  const [systemError, setSystemError] = useState<string | null>(null);
  const [drift, setDrift] = useState<DriftReport | null>(null);
  const [driftError, setDriftError] = useState<string | null>(null);
  const [reports, setReports] = useState<CoderReportRecord[]>([]);
  const [reportsError, setReportsError] = useState<string | null>(null);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const result = await fetchEvents();
    if (result.ok) {
      setEvents(result.events);
      setFetchError(null);
    } else {
      setFetchError(result.error);
    }
  }, [fetchEvents]);

  useEffect(() => {
    void refresh();
    void fetchProjects().then((result) => {
      if (result.ok && result.projects.length > 0) {
        setProjects(result.projects);
        setProjectId((current) => current || result.projects[0].id);
      }
    });
  }, [refresh, fetchProjects]);

  // Live-run watching: poll the ring buffer while enabled.
  useEffect(() => {
    if (!autoRefresh) return undefined;
    const timer = setInterval(() => void refresh(), 4000);
    return () => clearInterval(timer);
  }, [autoRefresh, refresh]);

  // System + Cards tabs share the system description; Drift and Cards share
  // the drift report; each loads on demand for the selected project.
  useEffect(() => {
    if ((tab !== 'system' && tab !== 'cards') || !projectId) return;
    void fetchSystem(projectId).then((result) => {
      if (result.ok) {
        setSystem(result.system);
        setSystemError(null);
      } else {
        setSystemError(result.error);
      }
    });
  }, [tab, projectId, fetchSystem]);

  useEffect(() => {
    if ((tab !== 'drift' && tab !== 'cards') || !projectId) return;
    void fetchDrift(projectId).then((result) => {
      if (result.ok) {
        setDrift(result.drift);
        setDriftError(null);
      } else {
        setDriftError(result.error);
      }
    });
  }, [tab, projectId, fetchDrift]);

  useEffect(() => {
    if (tab !== 'reports') return;
    void fetchCoderReports().then((result) => {
      if (result.ok) {
        setReports(result.reports);
        setReportsError(null);
      } else {
        setReportsError(result.error);
      }
    });
  }, [tab, fetchCoderReports]);

  const runs = useMemo(() => groupEventsIntoRuns(events), [events]);
  const selectedRun = runs.find((run) => run.correlationId === selectedRunId) ?? null;
  const durableCount = events.filter((e) => e.source === 'durable').length;

  return (
    <div
      data-testid="dev-agent-runs"
      style={{
        minHeight: '100vh',
        background: '#10141c',
        color: 'rgba(214,222,235,0.9)',
        fontFamily: 'ui-monospace, Consolas, monospace',
        fontSize: 12,
        padding: 16,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 16, margin: 0 }}>Hermes Dev Observatory</h1>
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            data-testid={`tab-${id}`}
            onClick={() => setTab(id)}
            style={{ ...button, opacity: tab === id ? 1 : 0.5 }}
          >
            {label}
          </button>
        ))}
        {projects.length > 0 ? (
          <select
            data-testid="dev-project-select"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            style={{ ...button, cursor: 'pointer' }}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id} style={{ color: '#10141c' }}>
                {p.name}
              </option>
            ))}
          </select>
        ) : null}
        <span style={{ opacity: 0.55, marginLeft: 'auto' }} data-testid="dev-agent-runs-counter">
          {events.length} event(s){durableCount > 0 ? ` (${durableCount} restored from disk)` : ''}
        </span>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
          <input
            type="checkbox"
            data-testid="dev-agent-runs-autorefresh"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
          />
          auto-refresh
        </label>
        <button type="button" data-testid="dev-agent-runs-refresh" onClick={() => void refresh()} style={button}>
          Refresh
        </button>
        <button
          type="button"
          data-testid="dev-agent-runs-clear"
          onClick={() => {
            void clearEvents().then(() => refresh());
          }}
          style={button}
        >
          Clear buffer
        </button>
      </div>

      {tab === 'system' ? (
        <SystemTab system={system} error={systemError} projectId={projectId} />
      ) : tab === 'cards' ? (
        <CardsTab system={system} error={systemError} drift={drift} />
      ) : tab === 'reports' ? (
        <CoderReportsTab
          reports={reports}
          error={reportsError}
          selectedReportId={selectedReportId}
          onSelect={setSelectedReportId}
        />
      ) : tab === 'drift' ? (
        <DriftTab drift={drift} error={driftError} />
      ) : fetchError ? (
        <div data-testid="dev-agent-runs-error" style={{ color: '#ff9d8a' }}>
          Telemetry unavailable: {fetchError} (is the backend running in dev mode?)
        </div>
      ) : events.length === 0 ? (
        <div data-testid="dev-agent-runs-empty" style={{ opacity: 0.6 }}>
          No agent events recorded yet. Send a chat message, run a card from the Task tab, or use the
          dev harness probes (probe_frontdoor / probe_card).
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          <table data-testid="dev-agent-runs-list" style={{ borderCollapse: 'collapse', minWidth: 420 }}>
            <thead>
              <tr style={{ opacity: 0.6 }}>
                <th style={cell}>first event</th>
                <th style={cell}>run</th>
                <th style={cell}>pipeline stages seen</th>
                <th style={cell}>status</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr
                  key={run.correlationId}
                  data-testid="dev-agent-run-row"
                  onClick={() => {
                    setSelectedRunId(run.correlationId);
                    setExpandedEventId(null);
                  }}
                  style={{
                    cursor: 'pointer',
                    background: run.correlationId === selectedRunId ? 'rgba(138,184,255,0.12)' : 'transparent',
                  }}
                >
                  <td style={cell}>{timeLabel(run.firstTimestamp)}</td>
                  <td style={{ ...cell, maxWidth: 160, overflowWrap: 'anywhere' }}>{run.correlationId}</td>
                  <td style={cell}>
                    <StageChips run={run} />
                  </td>
                  <td style={{ ...cell, color: run.failed ? '#ff9d8a' : '#7dd3a0' }}>
                    {run.failed ? 'failed' : 'ok'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ flex: 1, minWidth: 0 }}>
            {selectedRun ? (
              <table data-testid="dev-agent-run-detail" style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead>
                  <tr style={{ opacity: 0.6 }}>
                    <th style={cell}>time</th>
                    <th style={cell}>stage</th>
                    <th style={cell}>status</th>
                    <th style={cell}>mode</th>
                    <th style={cell}>card</th>
                    <th style={cell}>provider/model</th>
                    <th style={cell}>ms</th>
                    <th style={cell}>graph r/w</th>
                    <th style={cell}>src</th>
                    <th style={cell}>in / out / error</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedRun.events.map((event) => (
                    <Fragment key={event.id}>
                      <tr
                        data-testid="dev-agent-event-row"
                        onClick={() => setExpandedEventId(expandedEventId === event.id ? null : event.id)}
                        style={{ cursor: 'pointer' }}
                        title="click to expand full event JSON"
                      >
                        <td style={cell}>{timeLabel(event.timestamp)}</td>
                        <td style={cell}>{event.stage}</td>
                        <td style={{ ...cell, color: event.status === 'failed' ? '#ff9d8a' : undefined }}>
                          {event.status}
                        </td>
                        <td style={{ ...cell, color: MODE_COLORS[event.mode] }}>{event.mode}</td>
                        <td style={cell}>{event.cardId || event.caller}</td>
                        <td style={cell}>
                          {event.provider || event.model ? `${event.provider ?? '?'} / ${event.model ?? '?'}` : ''}
                        </td>
                        <td style={cell}>{event.durationMs ?? ''}</td>
                        <td style={cell}>
                          {event.graphReads.length ? `r:${event.graphReads.join(',')}` : ''}
                          {event.graphWrites.length ? ` w:${event.graphWrites.join(',')}` : ''}
                        </td>
                        <td style={{ ...cell, opacity: 0.55 }}>{event.source === 'durable' ? 'disk' : 'ram'}</td>
                        <td style={{ ...cell, maxWidth: 380, overflowWrap: 'anywhere' }}>
                          {event.inputSummary ? <div style={{ opacity: 0.8 }}>→ {event.inputSummary}</div> : null}
                          {event.outputSummary ? <div style={{ opacity: 0.65 }}>← {event.outputSummary}</div> : null}
                          {event.errorSummary ? <div style={{ color: '#ff9d8a' }}>✗ {event.errorSummary}</div> : null}
                        </td>
                      </tr>
                      {expandedEventId === event.id ? (
                        <tr data-testid="dev-agent-event-json">
                          <td colSpan={10} style={{ ...cell, background: 'rgba(255,255,255,0.03)' }}>
                            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                              {JSON.stringify(event, null, 2)}
                            </pre>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            ) : (
              <div style={{ opacity: 0.6, padding: 8 }}>
                Select a run to see its event timeline. Click an event to see its full JSON
                (participants, called agents, blocked reasons, graph record ids).
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SystemTab({
  system,
  error,
  projectId,
}: {
  system: SystemDescription | null;
  error: string | null;
  projectId: string;
}) {
  if (error) {
    return (
      <div data-testid="dev-system-error" style={{ color: '#ff9d8a' }}>
        System description unavailable: {error}
      </div>
    );
  }
  if (!projectId) return <div style={{ opacity: 0.6 }}>No project available yet.</div>;
  if (!system) return <div style={{ opacity: 0.6 }}>Loading live topology…</div>;
  const connected = system.cards.filter((c) => c.connected).map((c) => c.cardId);
  return (
    <div data-testid="dev-system-view">
      <table style={{ borderCollapse: 'collapse' }}>
        <tbody>
          <tr>
            <td style={cell}>deck</td>
            <td style={cell}>
              <b>{system.deckId}</b>
            </td>
          </tr>
          <tr>
            <td style={cell}>orchestrator</td>
            <td style={{ ...cell, color: system.orchestratorCardId ? '#7dd3a0' : '#ff9d8a' }}>
              {system.orchestratorCardId || 'MISSING'}
            </td>
          </tr>
          <tr>
            <td style={cell}>bus edges</td>
            <td style={cell}>{system.busEdges}</td>
          </tr>
          <tr>
            <td style={cell}>connected workers</td>
            <td style={{ ...cell, color: '#7dd3a0' }}>{connected.join(', ') || 'none'}</td>
          </tr>
          <tr>
            <td style={cell}>parked (disconnected)</td>
            <td style={{ ...cell, opacity: 0.6 }}>{system.disconnectedCards.join(', ') || 'none'}</td>
          </tr>
          <tr>
            <td style={cell}>instrumented stages</td>
            <td style={{ ...cell, opacity: 0.75 }}>{system.runStages.join(' → ')}</td>
          </tr>
        </tbody>
      </table>
      <div style={{ marginTop: 10, opacity: 0.6 }}>
        {Object.entries(system.graphEndpoints).map(([graph, description]) => (
          <div key={graph}>
            <b>{graph}</b>: {description}
          </div>
        ))}
      </div>
    </div>
  );
}

function CardsTab({
  system,
  error,
  drift,
}: {
  system: SystemDescription | null;
  error: string | null;
  drift: DriftReport | null;
}) {
  if (error) {
    return (
      <div data-testid="dev-cards-error" style={{ color: '#ff9d8a' }}>
        Card descriptions unavailable: {error}
      </div>
    );
  }
  if (!system) return <div style={{ opacity: 0.6 }}>Loading cards…</div>;
  const findingsByCard = new Map<string, DriftFinding[]>();
  for (const finding of [...(drift?.problems ?? []), ...(drift?.warnings ?? [])]) {
    const list = findingsByCard.get(finding.cardId) ?? [];
    list.push(finding);
    findingsByCard.set(finding.cardId, list);
  }
  const orderedCards = [...system.cards].sort(
    (a, b) => Number(b.connected) - Number(a.connected) || a.cardId.localeCompare(b.cardId),
  );
  return (
    <table data-testid="dev-cards-view" style={{ borderCollapse: 'collapse', width: '100%' }}>
      <thead>
        <tr style={{ opacity: 0.6 }}>
          <th style={cell}>card</th>
          <th style={cell}>state</th>
          <th style={cell}>binding</th>
          <th style={cell}>saved model</th>
          <th style={cell}>resolves to (runtime truth)</th>
          <th style={cell}>tools</th>
          <th style={cell}>graph access</th>
          <th style={cell}>prompt</th>
          <th style={cell}>invocable by</th>
          <th style={cell}>drift</th>
        </tr>
      </thead>
      <tbody>
        {orderedCards.map((card) => {
          const state =
            card.runtimeType === 'magentic_one'
              ? 'orchestrator'
              : card.runtimeBinding === 'main_chat'
                ? 'front door'
                : card.connected
                  ? 'connected'
                  : 'parked';
          const cardFindings = findingsByCard.get(card.cardId) ?? [];
          return (
            <tr key={card.cardId} data-testid="dev-system-card-row">
              <td style={cell}>
                {card.cardId}
                <div style={{ opacity: 0.5 }}>{card.title}</div>
              </td>
              <td
                style={{
                  ...cell,
                  color:
                    state === 'connected' || state === 'orchestrator'
                      ? '#7dd3a0'
                      : state === 'front door'
                        ? '#8ab8ff'
                        : 'rgba(255,255,255,0.4)',
                }}
              >
                {state}
                {!card.enabled ? ' (disabled)' : ''}
              </td>
              <td style={cell}>{card.runtimeBinding || ''}</td>
              <td style={cell}>{card.provider && card.modelKey ? `${card.provider} / ${card.modelKey}` : ''}</td>
              <td style={{ ...cell, color: card.resolutionError ? '#ff9d8a' : undefined }}>
                {card.resolutionError
                  ? `✗ ${card.resolutionError}`
                  : card.resolved
                    ? `${card.resolved.provider} / ${card.resolved.providerModelId}`
                    : ''}
              </td>
              <td style={cell}>{(card.resolved?.tools ?? []).join(', ')}</td>
              <td style={cell}>
                {card.graphReads.length ? `r:${card.graphReads.join(',')}` : ''}
                {card.graphWrites.length ? ` w:${card.graphWrites.join(',')}` : ''}
              </td>
              <td style={cell}>{card.promptChars} chars</td>
              <td style={{ ...cell, maxWidth: 220 }}>{card.invocableBy.join('; ')}</td>
              <td style={{ ...cell, maxWidth: 260 }}>
                {cardFindings.length === 0
                  ? ''
                  : cardFindings.map((finding, i) => (
                      <div
                        key={i}
                        style={{ color: finding.severity === 'problem' ? '#ff9d8a' : '#e8c268' }}
                      >
                        {finding.kind}: {finding.detail}
                      </div>
                    ))}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function CoderReportsTab({
  reports,
  error,
  selectedReportId,
  onSelect,
}: {
  reports: CoderReportRecord[];
  error: string | null;
  selectedReportId: string | null;
  onSelect: (id: string) => void;
}) {
  if (error) {
    return (
      <div data-testid="dev-reports-error" style={{ color: '#ff9d8a' }}>
        Coder reports unavailable: {error}
      </div>
    );
  }
  if (reports.length === 0) {
    return (
      <div data-testid="dev-reports-empty" style={{ opacity: 0.6 }}>
        No CoderReports submitted yet. A coding agent submits one via the dev harness
        (submit_coder_report) with its claims + telemetry trace ids; verification is deterministic
        evidence matching — never an LLM grading itself.
      </div>
    );
  }
  const selected = reports.find((r) => r.submission.id === selectedReportId) ?? null;
  return (
    <div data-testid="dev-reports-view" style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
      <table style={{ borderCollapse: 'collapse', minWidth: 420 }}>
        <thead>
          <tr style={{ opacity: 0.6 }}>
            <th style={cell}>submitted</th>
            <th style={cell}>adapter / mode</th>
            <th style={cell}>verdict</th>
            <th style={cell}>claims (S/U/C/M)</th>
          </tr>
        </thead>
        <tbody>
          {[...reports].reverse().map((record) => (
            <tr
              key={record.submission.id}
              data-testid="dev-report-row"
              onClick={() => onSelect(record.submission.id)}
              style={{
                cursor: 'pointer',
                background: record.submission.id === selectedReportId ? 'rgba(138,184,255,0.12)' : 'transparent',
              }}
            >
              <td style={cell}>{timeLabel(record.submission.timestamp)}</td>
              <td style={cell}>
                {record.submission.adapter ?? '?'} / {record.submission.executionMode}
              </td>
              <td style={{ ...cell, color: VERDICT_COLORS[record.verification?.verdict ?? ''] }}>
                {record.verification?.verdict ?? 'unverified'}
              </td>
              <td style={cell}>
                {record.verification
                  ? `${record.verification.supported}/${record.verification.unsupported}/${record.verification.contradicted}/${record.verification.missingProof}`
                  : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ flex: 1, minWidth: 0 }}>
        {selected ? (
          <div data-testid="dev-report-detail">
            <div style={{ opacity: 0.7, marginBottom: 8, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {selected.submission.reportText.slice(0, 600)}
              {selected.submission.reportText.length > 600 ? '…' : ''}
            </div>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr style={{ opacity: 0.6 }}>
                  <th style={cell}>check</th>
                  <th style={cell}>claim</th>
                  <th style={cell}>verdict</th>
                  <th style={cell}>evidence</th>
                  <th style={cell}>note</th>
                </tr>
              </thead>
              <tbody>
                {(selected.verification?.findings ?? []).map((finding, i) => (
                  <tr key={i} data-testid="dev-report-finding">
                    <td style={cell}>{finding.kind}</td>
                    <td style={{ ...cell, maxWidth: 240, overflowWrap: 'anywhere' }}>{finding.claim}</td>
                    <td style={{ ...cell, color: VERDICT_COLORS[finding.verdict] }}>{finding.verdict}</td>
                    <td style={{ ...cell, maxWidth: 200, overflowWrap: 'anywhere', opacity: 0.6 }}>
                      {finding.evidence.join(', ')}
                    </td>
                    <td style={{ ...cell, maxWidth: 280, overflowWrap: 'anywhere', opacity: 0.75 }}>
                      {finding.note}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ opacity: 0.6, padding: 8 }}>Select a report to see its claim-by-claim verification.</div>
        )}
      </div>
    </div>
  );
}

function DriftTab({ drift, error }: { drift: DriftReport | null; error: string | null }) {
  if (error) {
    return (
      <div data-testid="dev-drift-error" style={{ color: '#ff9d8a' }}>
        Drift report unavailable: {error}
      </div>
    );
  }
  if (!drift) return <div style={{ opacity: 0.6 }}>Loading drift report…</div>;
  if (drift.problems.length === 0 && drift.warnings.length === 0) {
    return (
      <div data-testid="dev-drift-clean" style={{ color: '#7dd3a0' }}>
        No drift detected across {drift.checkedCards} card(s): live prompts reference only live
        tools, every card's saved model resolves, and no connected card is broken.
      </div>
    );
  }
  return (
    <table data-testid="dev-drift-view" style={{ borderCollapse: 'collapse', width: '100%' }}>
      <thead>
        <tr style={{ opacity: 0.6 }}>
          <th style={cell}>severity</th>
          <th style={cell}>card</th>
          <th style={cell}>kind</th>
          <th style={cell}>detail</th>
        </tr>
      </thead>
      <tbody>
        {[...drift.problems, ...drift.warnings].map((finding, i) => (
          <tr key={i} data-testid="dev-drift-row">
            <td style={{ ...cell, color: finding.severity === 'problem' ? '#ff9d8a' : '#e8c268' }}>
              {finding.severity}
            </td>
            <td style={cell}>{finding.cardId}</td>
            <td style={cell}>{finding.kind}</td>
            <td style={{ ...cell, overflowWrap: 'anywhere' }}>{finding.detail}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
