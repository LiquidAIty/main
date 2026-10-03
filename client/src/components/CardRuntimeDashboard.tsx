import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type RunSummary = {
  runId: string;
  state: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  createdAt?: string | null;
  provider?: string | null;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  toolCallCount?: number | null;
  costUsd?: number | null;
  errorCode?: string | null;
  cardRevisionId?: string | null;
  requestFulfillment?: Record<string, unknown> | null;
  acceptedAt?: string | null;
  totalElapsedMs?: number | null;
  preparationState?: string | null;
  preparationError?: string | null;
  nativeRunId?: string | number | null;
  runtimeKind?: string | null;
  runtimeMode?: string | null;
  runtimeProfile?: string | null;
  effectiveProvider?: string | null;
  executionAuthorityFingerprint?: string | null;
  cachedTokens?: number | null;
  reasoningTokens?: number | null;
};

type RunDetail = RunSummary & {
  conversationId?: string | null;
  acceptedAt?: string | null;
  correlationId?: string;
  cardId?: string;
  runtimeKind?: string;
  runtimeMode?: string;
  runtimeProfile?: string;
  nativeStatus?: string | null;
  nativeRootId?: string | null;
  nativeRunId?: string | number | null;
  hermesSessionId?: string | null;
  accessMode?: string | null;
  openaiRuntime?: string | null;
  effectiveProvider?: string | null;
  providerApiMode?: string | null;
  preparationMs?: number | null;
  preparationStartedAt?: string | null;
  preparationEndedAt?: string | null;
  preparationState?: string | null;
  preparationError?: string | null;
  totalElapsedMs?: number | null;
  elapsedMs?: number | null;
  toolCallCount?: number | null;
  graphReads?: number;
  graphWrites?: number;
  cachedTokens?: number | null;
  reasoningTokens?: number | null;
  modelFallbackOccurred?: boolean;
  modelFallbackReason?: string | null;
  errorSummary?: string | null;
  output?: string | null;
  requestFulfillment?: Record<string, unknown> | null;
  idf?: { sha256?: string | null; bytes?: number | null };
  jevDecisions?: Record<string, unknown>[];
  attemptEvents?: Record<string, unknown>[];
  toolEvents?: Record<string, unknown>[];
  nativeReferences?: Record<string, unknown>[];
  materializedNativeReferences?: Record<string, unknown>[];
  artifacts?: Record<string, unknown>[];
  observationGap?: number;
  terminal?: {
    parentRunId?: string | null;
    children?: RunSummary[];
    configuration?: Record<string, unknown>;
  };
};

type HistoryPayload = {
  latest: RunDetail | null;
  runs: RunSummary[];
  limit: number;
};

type Props = { projectId: string; deckId: string; cardId: string };

const TERMINAL_STATES = new Set(['completed', 'failed', 'cancelled', 'blocked']);

function duration(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'Unavailable';
  if (value < 1_000) return `${Math.round(value)} ms`;
  if (value < 60_000) return `${(value / 1_000).toFixed(value < 10_000 ? 2 : 1)} s`;
  const minutes = Math.floor(value / 60_000);
  return `${minutes}m ${Math.round((value % 60_000) / 1_000)}s`;
}

function timestamp(value: string | null | undefined): string {
  if (!value) return 'Unavailable';
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : 'Unavailable';
}

function count(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? 'Unavailable'
    : value.toLocaleString();
}

function money(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? 'Unavailable'
    : `$${value.toFixed(6)}`;
}

function elapsed(run: RunSummary): number | null {
  if (typeof run.totalElapsedMs === 'number' && Number.isFinite(run.totalElapsedMs)) {
    return run.totalElapsedMs;
  }
  const accepted = Date.parse(run.acceptedAt || run.createdAt || '');
  const finished = Date.parse(run.finishedAt || '');
  return Number.isFinite(accepted) && Number.isFinite(finished)
    ? Math.max(0, finished - accepted)
    : null;
}

function average(values: Array<number | null | undefined>): number | null {
  const known = values.filter((value): value is number => (
    typeof value === 'number' && Number.isFinite(value)
  ));
  return known.length ? known.reduce((total, value) => total + value, 0) / known.length : null;
}

function resultSummary(run: RunDetail): string {
  const output = String(run.output || '').replace(/\s+/g, ' ').trim();
  if (output) return output.length > 180 ? `${output.slice(0, 177)}...` : output;
  const error = String(run.errorSummary || run.errorCode || '').replace(/\s+/g, ' ').trim();
  if (error) return error.length > 180 ? `${error.slice(0, 177)}...` : error;
  if (!TERMINAL_STATES.has(run.state)) return `Run ${run.state || 'in progress'}; no terminal result yet.`;
  return run.state === 'completed'
    ? 'Completed; no saved result text was retained.'
    : `${run.state || 'Run ended'}; no result summary was retained.`;
}

function JsonDetails({ label, value }: { label: string; value: unknown }) {
  return (
    <details style={{ borderTop: '1px solid #38494D', paddingTop: 8 }}>
      <summary style={{ cursor: 'pointer', color: '#B9D0D6', fontSize: 11.5 }}>{label}</summary>
      <pre style={{ margin: '8px 0 0', padding: 8, overflow: 'auto', maxHeight: 260,
        borderRadius: 6, background: '#111718', color: '#B9C9CD', fontSize: 10.5,
        whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}

function Fact({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div style={{ minWidth: 0, padding: '7px 8px', border: '1px solid #38494D', borderRadius: 6,
      background: '#192120' }}>
      <div style={{ color: '#7F969D', fontSize: 9.5, textTransform: 'uppercase', letterSpacing: 0.7 }}>
        {label}
      </div>
      <div style={{ color: '#E0E7E5', fontSize: 11.5, overflowWrap: 'anywhere' }}>{value}</div>
      {detail ? <div style={{ color: '#71878D', fontSize: 9.5 }}>{detail}</div> : null}
    </div>
  );
}

function Timeline({ run }: { run: RunDetail }) {
  const total = run.totalElapsedMs;
  const prep = run.preparationMs;
  const native = run.elapsedMs;
  const prepWidth = total && prep !== null && prep !== undefined
    ? Math.max(2, Math.min(100, (prep / total) * 100)) : 0;
  const nativeWidth = total && native !== null && native !== undefined
    ? Math.max(2, Math.min(100 - prepWidth, (native / total) * 100)) : 0;
  return (
    <section aria-label="Run timeline" style={{ display: 'grid', gap: 6 }}>
      <div style={{ color: '#B9D0D6', fontSize: 11, fontWeight: 600 }}>Timeline</div>
      {total === null || total === undefined ? (
        <div style={{ color: '#7F969D', fontSize: 10.5 }}>
          Accepted-submission timing was not observed for this Run.
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', height: 9, overflow: 'hidden', borderRadius: 999,
            background: '#111718', border: '1px solid #34464A' }}>
            <div title={`Preparation ${duration(prep)}`} style={{ width: `${prepWidth}%`, background: '#B88443' }} />
            <div title={`Native Run ${duration(native)}`} style={{ width: `${nativeWidth}%`, background: '#2E9A98' }} />
          </div>
          <div style={{ display: 'flex', gap: 12, color: '#8DA2A8', fontSize: 10 }}>
            <span><span style={{ color: '#B88443' }}>●</span> Preparation {duration(prep)}</span>
            <span><span style={{ color: '#2E9A98' }}>●</span> Native {duration(native)}</span>
            <span>Total {duration(total)}</span>
          </div>
        </>
      )}
    </section>
  );
}

function AttemptWaterfall({ attempts }: { attempts: Record<string, unknown>[] }) {
  const rows = attempts.filter((attempt) => (
    attempt.phase === 'completed' || attempt.phase === 'failed' || attempt.phase === 'cancelled'
  ));
  const maximum = Math.max(1, ...rows.map((attempt) => (
    typeof attempt.durationMs === 'number' && Number.isFinite(attempt.durationMs)
      ? attempt.durationMs : 0
  )));
  if (!rows.length) {
    return (
      <div style={{ color: '#71878D', fontSize: 10.5 }}>
        No per-call Hermes receipt is available for this Run. Aggregate Run measurements remain authoritative.
      </div>
    );
  }
  return (
    <div style={{ display: 'grid', gap: 5 }}>
      {rows.map((attempt, index) => {
        const durationMs = typeof attempt.durationMs === 'number' ? attempt.durationMs : null;
        const width = durationMs === null ? 2 : Math.max(3, (durationMs / maximum) * 100);
        const kind = String(attempt.kind || 'attempt');
        const label = kind === 'tool'
          ? String(attempt.toolName || 'Tool')
          : String(attempt.model || 'LLM request');
        const tokenDetail = kind === 'llm' ? [
          `input ${count(typeof attempt.inputTokens === 'number' ? attempt.inputTokens : null)}`,
          `output ${count(typeof attempt.outputTokens === 'number' ? attempt.outputTokens : null)}`,
          `cache ${count(typeof attempt.cachedTokens === 'number' ? attempt.cachedTokens : null)}`,
          `reasoning ${count(typeof attempt.reasoningTokens === 'number' ? attempt.reasoningTokens : null)}`,
          `total ${count(typeof attempt.totalTokens === 'number' ? attempt.totalTokens : null)}`,
        ].join(' · ') : '';
        const retries = typeof attempt.retryCount === 'number'
          ? ` · retries ${attempt.retryCount}` : '';
        const failure = [attempt.errorType, attempt.errorMessage]
          .filter(Boolean).map(String).join(' · ');
        return (
          <div key={String(attempt.eventId || `${kind}-${index}`)} style={{ display: 'grid', gap: 3 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 10 }}>
              <span style={{ color: '#B9CDD2', overflowWrap: 'anywhere' }}>
                {kind === 'llm' ? 'LLM' : 'Tool'} · {label}
              </span>
              <span style={{ color: attempt.phase === 'completed' ? '#72D7C7' : '#FFA2A2' }}>
                {duration(durationMs)}{retries}
              </span>
            </div>
            <div style={{ height: 7, borderRadius: 999, background: '#111718', overflow: 'hidden' }}>
              <div style={{ width: `${width}%`, height: '100%', borderRadius: 999,
                background: kind === 'llm' ? '#2E9A98' : '#8F6CAE' }} />
            </div>
            {kind === 'llm' ? <div style={{ color: '#71878D', fontSize: 9.5 }}>
              {tokenDetail} · first token {duration(
                typeof attempt.firstTokenMs === 'number' ? attempt.firstTokenMs : null
              )}
            </div> : null}
            {failure ? <div style={{ color: '#FFA2A2', fontSize: 9.5 }}>{failure}</div> : null}
          </div>
        );
      })}
    </div>
  );
}

function ToolReceiptLog({ events, attempts }: {
  events: Record<string, unknown>[];
  attempts: Record<string, unknown>[];
}) {
  const source = events.length
    ? events
    : attempts.filter((attempt) => attempt.kind === 'tool');
  const grouped = new Map<string, { name: string; status: string; count: number }>();
  source.forEach((event) => {
    const name = String(event.toolName || event.name || 'Unnamed tool').trim() || 'Unnamed tool';
    const status = String(event.phase || event.status || 'observed').trim() || 'observed';
    const key = `${name}\u0000${status}`;
    const current = grouped.get(key);
    grouped.set(key, { name, status, count: (current?.count || 0) + 1 });
  });
  if (!grouped.size) {
    return (
      <div style={{ color: '#71878D', fontSize: 10.5 }}>
        No canonical tool event was observed. Generic Hermes tool bodies are not reconstructed from output text.
      </div>
    );
  }
  return (
    <div aria-label="Observed tool receipt metadata" style={{ display: 'grid', gap: 4 }}>
      {[...grouped.values()].map((item) => (
        <div key={`${item.name}-${item.status}`} style={{ color: '#9FB2B7', fontSize: 10.5 }}>
          {item.name} · {item.status}{item.count > 1 ? ` · ${item.count} calls` : ''}
        </div>
      ))}
      <div style={{ color: '#71878D', fontSize: 9.5 }}>
        Count and name metadata only; tool arguments and results are never rendered here.
      </div>
    </div>
  );
}

export function CardRuntimeDashboard({ projectId, deckId, cardId }: Props) {
  const [history, setHistory] = useState<HistoryPayload | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [error, setError] = useState('');
  const [retainedInput, setRetainedInput] = useState<Record<string, unknown> | null>(null);
  const [inputStatus, setInputStatus] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const requestRef = useRef(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!projectId || !deckId || !cardId) return;
    const request = ++requestRef.current;
    setStatus((current) => current === 'ready' ? current : 'loading');
    try {
      const response = await fetch('/api/cards/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'history', projectId, deckId, cardId, limit: 8 }),
        signal,
      });
      const payload = await response.json();
      if (!response.ok || payload?.ok !== true || !payload.result) {
        throw new Error(String(payload?.error || 'card_run_history_unavailable'));
      }
      if (request !== requestRef.current || signal?.aborted) return;
      setHistory(payload.result as HistoryPayload);
      setStatus('ready');
      setError('');
    } catch (caught) {
      if (signal?.aborted || request !== requestRef.current) return;
      setStatus('failed');
      const reason = caught instanceof Error ? caught.message : 'card_run_history_unavailable';
      setError(reason === 'configured_card_action_invalid'
        ? 'Backend reload required before Run receipts can be read.'
        : reason);
    }
  }, [projectId, deckId, cardId]);

  useEffect(() => {
    const controller = new AbortController();
    setHistory(null);
    setRetainedInput(null);
    setInputStatus('idle');
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    const state = history?.latest?.state || '';
    if (!state || TERMINAL_STATES.has(state)) return undefined;
    const timer = window.setTimeout(() => void load(), 2_000);
    return () => window.clearTimeout(timer);
  }, [history?.latest?.state, load]);

  const loadInput = useCallback(async () => {
    const runId = history?.latest?.runId;
    if (!runId || inputStatus === 'loading') return;
    setInputStatus('loading');
    try {
      const response = await fetch('/api/cards/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'inputs', projectId, deckId, cardId, runId }),
      });
      const payload = await response.json();
      if (!response.ok || payload?.ok !== true) {
        throw new Error(String(payload?.error || 'run_input_unavailable'));
      }
      setRetainedInput(payload.result as Record<string, unknown>);
      setInputStatus('ready');
    } catch (caught) {
      setRetainedInput({ error: caught instanceof Error ? caught.message : 'run_input_unavailable' });
      setInputStatus('failed');
    }
  }, [history?.latest?.runId, inputStatus, projectId, deckId, cardId]);

  const latest = history?.latest || null;
  const totalTokens = useMemo(() => {
    if (!latest || latest.inputTokens === null || latest.inputTokens === undefined
      || latest.outputTokens === null || latest.outputTokens === undefined) return null;
    return latest.inputTokens + latest.outputTokens;
  }, [latest]);
  const attemptTotals = useMemo(() => {
    const calls = (latest?.attemptEvents || []).filter((attempt) => (
      attempt.kind === 'llm' && attempt.phase === 'completed'
    ));
    const sum = (field: string) => calls.length > 0
      && calls.every((attempt) => typeof attempt[field] === 'number')
      ? calls.reduce((total, attempt) => total + Number(attempt[field]), 0)
      : null;
    return {
      inputTokens: sum('inputTokens'),
      outputTokens: sum('outputTokens'),
      cachedTokens: sum('cachedTokens'),
      reasoningTokens: sum('reasoningTokens'),
      totalTokens: sum('totalTokens'),
      costStatus: calls.length && calls.every((attempt) => attempt.costStatus === 'included')
        ? 'included'
        : null,
      count: calls.length,
    };
  }, [latest?.attemptEvents]);
  const latestCostLabel = latest?.costUsd !== null && latest?.costUsd !== undefined
    ? money(latest.costUsd)
    : attemptTotals.costStatus === 'included'
      ? 'Included'
      : 'Unavailable';
  const observationGap = useMemo(() => Math.max(
    Number(latest?.observationGap || 0),
    ...(latest?.attemptEvents || []).map((attempt) => (
      typeof attempt.observationGap === 'number' && Number.isFinite(attempt.observationGap)
        ? attempt.observationGap : 0
    )),
  ), [latest?.attemptEvents, latest?.observationGap]);
  const currentSummary = useMemo(() => (
    (history?.runs || []).find((run) => run.runId === latest?.runId) || null
  ), [history?.runs, latest?.runId]);
  const comparableRuns = useMemo(() => {
    const fingerprint = currentSummary?.executionAuthorityFingerprint?.trim();
    if (!fingerprint) return [];
    return (history?.runs || []).filter((run) => (
      run.runId !== latest?.runId
      && run.state === 'completed'
      && run.executionAuthorityFingerprint === fingerprint
    )).slice(0, 5);
  }, [currentSummary?.executionAuthorityFingerprint, history?.runs, latest?.runId]);
  const comparableBaseline = useMemo(() => ({
    elapsedMs: average(comparableRuns.map(elapsed)),
    inputTokens: average(comparableRuns.map((run) => run.inputTokens)),
    outputTokens: average(comparableRuns.map((run) => run.outputTokens)),
    cachedTokens: average(comparableRuns.map((run) => run.cachedTokens)),
    reasoningTokens: average(comparableRuns.map((run) => run.reasoningTokens)),
    costUsd: average(comparableRuns.map((run) => run.costUsd)),
  }), [comparableRuns]);
  const lowestElapsedComparable = useMemo(() => comparableRuns
    .map((run) => ({ run, elapsedMs: elapsed(run) }))
    .filter((item): item is { run: RunSummary; elapsedMs: number } => item.elapsedMs !== null)
    .sort((left, right) => left.elapsedMs - right.elapsedMs)[0] || null, [comparableRuns]);

  return (
    <section aria-label="Card Runtime observations" data-testid="card-runtime-dashboard"
      style={{ display: 'grid', gap: 10, padding: 10, border: '1px solid #3A4A4F',
        borderRadius: 8, background: '#202827' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div>
          <div style={{ color: '#E0DED5', fontSize: 12, fontWeight: 700 }}>Last Run</div>
          <div style={{ color: '#71878D', fontSize: 10 }}>Accepted request, canonical Run when present, and passive observations</div>
        </div>
        <button type="button" onClick={() => void load()} disabled={status === 'loading'}>
          {status === 'loading' ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {status === 'failed' ? (
        <div role="alert" style={{ color: '#FFA2A2', fontSize: 11 }}>
          Runtime observations unavailable: {error}
        </div>
      ) : null}
      {status === 'loading' && !history ? (
        <div role="status" style={{ color: '#80969F', fontSize: 11 }}>Loading Run history…</div>
      ) : null}
      {status === 'ready' && !latest ? (
        <div style={{ color: '#80969F', fontSize: 11 }}>No saved Runs exist for this Card.</div>
      ) : null}

      {latest ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 8 }}>
            <div style={{ padding: 10, border: '1px solid #3B5354', borderRadius: 8,
              background: 'linear-gradient(135deg, #1A2928, #17201F)' }}>
              <div style={{ color: '#79CFC5', fontSize: 9.5, textTransform: 'uppercase', letterSpacing: 0.8 }}>Last Run</div>
              <div style={{ color: '#E4ECEA', fontSize: 12, fontWeight: 700 }}>{latest.state}</div>
              <code style={{ color: '#91A9B8', fontSize: 9.5 }}>{latest.runId}</code>
              <div style={{ color: '#AFC2C7', fontSize: 10.5, marginTop: 5 }}>
                {duration(latest.totalElapsedMs ?? latest.elapsedMs)} · {count(totalTokens ?? attemptTotals.totalTokens)} tokens · {latestCostLabel}
              </div>
              <div style={{ color: '#71878D', fontSize: 9.5 }}>
                Fulfillment {latest.requestFulfillment?.status === 'scored'
                  && typeof latest.requestFulfillment.normalizedScore100 === 'number'
                  ? `${latest.requestFulfillment.normalizedScore100}%`
                  : 'unavailable'}
              </div>
              <div style={{ color: '#71878D', fontSize: 9.5 }}>
                {latest.effectiveProvider || latest.provider || 'provider unavailable'} · {latest.model || 'model unavailable'}
                {' · '}{attemptTotals.count || 'LLM calls unavailable'}
                {' · '}{latest.toolCallCount === null || latest.toolCallCount === undefined
                  ? 'tool calls unavailable' : `${latest.toolCallCount} tool call${latest.toolCallCount === 1 ? '' : 's'}`}
              </div>
              <div style={{ color: '#71878D', fontSize: 9.5 }}>
                In {count(latest.inputTokens ?? attemptTotals.inputTokens)} · Out {count(latest.outputTokens ?? attemptTotals.outputTokens)}
                {' · '}Cached {count(latest.cachedTokens ?? attemptTotals.cachedTokens)}
                {' · '}Reasoning {count(latest.reasoningTokens ?? attemptTotals.reasoningTokens)}
              </div>
              <div style={{ color: '#71878D', fontSize: 9.5 }}>
                {latest.attemptEvents?.length || 0} visible receipt{latest.attemptEvents?.length === 1 ? '' : 's'}
                {' · '}observation gap {observationGap}
                {' · '}{latest.modelFallbackOccurred
                  ? `fallback: ${latest.modelFallbackReason || 'reason unavailable'}`
                  : 'no fallback recorded'}
              </div>
              <div style={{ color: '#AFC2C7', fontSize: 10, marginTop: 5 }}>
                {resultSummary(latest)}
              </div>
              {latest.errorCode || latest.errorSummary ? (
                <div style={{ color: '#FFA2A2', fontSize: 9.5, marginTop: 3 }}>
                  {latest.errorCode || latest.errorSummary}
                </div>
              ) : null}
            </div>
            <div style={{ padding: 10, border: '1px solid #564B68', borderRadius: 8,
              background: 'linear-gradient(135deg, #282235, #1B1D26)' }}>
              <div style={{ color: '#C6A7E5', fontSize: 9.5, textTransform: 'uppercase', letterSpacing: 0.8 }}>Moving baseline / comparable low</div>
              {comparableRuns.length ? (
                <>
                  <div style={{ color: '#E7E0ED', fontSize: 12, fontWeight: 700, marginTop: 5 }}>
                    Moving baseline · {comparableRuns.length} same-authority Run{comparableRuns.length === 1 ? '' : 's'}
                  </div>
                  <div style={{ color: '#BBAECB', fontSize: 10.5, marginTop: 4 }}>
                    {duration(comparableBaseline.elapsedMs)} avg wall · In {count(comparableBaseline.inputTokens)}
                    {' · '}Out {count(comparableBaseline.outputTokens)} · {money(comparableBaseline.costUsd)} avg reported cost
                  </div>
                  <div style={{ color: '#82758F', fontSize: 9.5, marginTop: 4 }}>
                    Cached {count(comparableBaseline.cachedTokens)} · Reasoning {count(comparableBaseline.reasoningTokens)}
                    {lowestElapsedComparable
                      ? ` · Lowest observed wall ${duration(lowestElapsedComparable.elapsedMs)} (${lowestElapsedComparable.run.runId})`
                      : ' · Lowest observed wall unavailable'}
                  </div>
                  <div style={{ color: '#82758F', fontSize: 9.5, marginTop: 4 }}>
                    Same saved execution-authority fingerprint; accounting comparison only, not a quality rank.
                  </div>
                </>
              ) : (
                <>
                  <div style={{ color: '#E7E0ED', fontSize: 12, fontWeight: 700, marginTop: 5 }}>
                    No comparable baseline
                  </div>
                  <div style={{ color: '#82758F', fontSize: 9.5, marginTop: 4 }}>
                    No completed prior Run with the same saved execution-authority fingerprint is retained.
                    Card revision alone is not comparability.
                  </div>
                </>
              )}
            </div>
          </div>
          <div style={{ color: '#71878D', fontSize: 10 }}>
            Recent history is accounting only. No task-quality rank, winner, or normal Run is inferred.
          </div>
          <details>
            <summary style={{ cursor: 'pointer', color: '#B9D0D6', fontSize: 11.5 }}>
              Run details, calls, and recent history
            </summary>
            <div style={{ display: 'grid', gap: 10, marginTop: 9 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ padding: '3px 8px', borderRadius: 999,
              background: TERMINAL_STATES.has(latest.state) ? '#263534' : '#493A24',
              color: latest.state === 'completed' ? '#72D7C7'
                : latest.state === 'failed' || latest.state === 'cancelled' || latest.state === 'blocked'
                  ? '#FFA2A2' : '#F1C27D', fontSize: 10.5, fontWeight: 700 }}>
              {latest.state || 'unknown'}
            </span>
            <code style={{ color: '#91A9B8', fontSize: 10.5 }}>{latest.runId}</code>
            {!TERMINAL_STATES.has(latest.state) ? (
              <span style={{ color: '#F1C27D', fontSize: 10 }}>Running; last terminal result is not substituted.</span>
            ) : null}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(125px, 1fr))', gap: 6 }}>
            <Fact label="Accepted" value={timestamp(latest.acceptedAt)} />
            <Fact label="Preparation" value={latest.preparationState || 'Unavailable'}
              detail={latest.preparationError || duration(latest.preparationMs)} />
            <Fact label="Started" value={timestamp(latest.startedAt)} />
            <Fact label="Completed" value={timestamp(latest.finishedAt)} />
            <Fact label="Native Run ID" value={latest.nativeRunId === null || latest.nativeRunId === undefined
              ? 'Unavailable' : String(latest.nativeRunId)} />
            <Fact label="Provider" value={latest.effectiveProvider || latest.provider || 'Unavailable'}
              detail={latest.providerApiMode || latest.accessMode || undefined} />
            <Fact label="Model" value={latest.model || 'Unavailable'}
              detail={latest.modelFallbackOccurred ? `Fallback: ${latest.modelFallbackReason || 'reason unavailable'}` : 'No fallback recorded'} />
            <Fact label="Profile" value={latest.runtimeProfile || 'Unavailable'}
              detail={[latest.runtimeKind, latest.runtimeMode].filter(Boolean).join(' · ')} />
          </div>

          <Timeline run={latest} />

          {observationGap > 0 ? (
            <div role="alert" style={{ padding: 8, borderRadius: 6, border: '1px solid #75623D',
              background: '#322A1D', color: '#F3D49A', fontSize: 10.5 }}>
              Observation gap: {observationGap.toLocaleString()} observer event{observationGap === 1 ? '' : 's'}
              {' '}were dropped or could not be delivered. The native Run state remains authoritative.
            </div>
          ) : null}

          <section aria-label="Hermes attempt waterfall" style={{ display: 'grid', gap: 6 }}>
            <div style={{ color: '#B9D0D6', fontSize: 11, fontWeight: 600 }}>Hermes calls</div>
            <AttemptWaterfall attempts={latest.attemptEvents || []} />
          </section>

          <section aria-label="Run usage" style={{ display: 'grid', gap: 6 }}>
            <div style={{ color: '#B9D0D6', fontSize: 11, fontWeight: 600 }}>Usage and cost</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: 6 }}>
              <Fact label="Input" value={count(latest.inputTokens ?? attemptTotals.inputTokens)}
                detail={latest.inputTokens !== null && latest.inputTokens !== undefined ? 'provider Run aggregate' : 'sum of complete Hermes call receipts'} />
              <Fact label="Output" value={count(latest.outputTokens ?? attemptTotals.outputTokens)}
                detail={latest.outputTokens !== null && latest.outputTokens !== undefined ? 'provider Run aggregate' : 'sum of complete Hermes call receipts'} />
              <Fact label="Total" value={count(totalTokens ?? attemptTotals.totalTokens)}
                detail="input + output when known" />
              <Fact label="Cached" value={count(latest.cachedTokens ?? attemptTotals.cachedTokens)}
                detail={latest.cachedTokens !== null && latest.cachedTokens !== undefined
                  ? 'provider Run aggregate' : 'sum of complete Hermes call receipts'} />
              <Fact label="Reasoning" value={count(latest.reasoningTokens ?? attemptTotals.reasoningTokens)}
                detail={latest.reasoningTokens !== null && latest.reasoningTokens !== undefined
                  ? 'provider Run aggregate' : 'sum of complete Hermes call receipts'} />
              <Fact label="Cost" value={latestCostLabel}
                detail={latest.costUsd !== null && latest.costUsd !== undefined
                  ? 'provider reported'
                  : attemptTotals.costStatus === 'included' ? 'included by provider access' : 'pricing unavailable'} />
            </div>
          </section>

          {latest.errorCode || latest.errorSummary ? (
            <div role="alert" style={{ padding: 8, borderRadius: 6, border: '1px solid #744B4B',
              background: '#321F20', color: '#FFC0C0', fontSize: 11 }}>
              <strong>{latest.errorCode || 'Run incomplete'}</strong>
              {latest.errorSummary ? ` · ${latest.errorSummary}` : ''}
            </div>
          ) : null}

          {latest.output ? (
            <details>
              <summary style={{ cursor: 'pointer', color: '#B9D0D6', fontSize: 11.5 }}>Final result</summary>
              <div style={{ marginTop: 7, padding: 8, maxHeight: 220, overflow: 'auto',
                borderRadius: 6, background: '#151C1D', color: '#D8E3E2', fontSize: 11,
                whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{latest.output}</div>
            </details>
          ) : null}

          <section aria-label="Run evidence" style={{ display: 'grid', gap: 7 }}>
            <div style={{ color: '#B9D0D6', fontSize: 11, fontWeight: 600 }}>Context, decisions, and attempts</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 6 }}>
              <Fact label="Request context bytes" value={count(latest.idf?.bytes)} detail={latest.idf?.sha256 ? `IDF sha256 ${latest.idf.sha256.slice(0, 12)}…` : 'IDF hash unavailable'} />
              <Fact label="Jev decisions" value={count(latest.jevDecisions?.length)} detail="retained safe receipts" />
              <Fact label="Tool events" value={count(latest.toolEvents?.length)} detail="observable native events" />
              <Fact label="Call receipts" value={count(latest.attemptEvents?.length)} detail="bounded Hermes hooks" />
              <Fact label="Materialized refs" value={count(latest.materializedNativeReferences?.length)} detail="native IDs only" />
            </div>
            {latest.requestFulfillment ? <JsonDetails label="Fulfillment assessment (not task-success proof)" value={latest.requestFulfillment} /> : (
              <div style={{ color: '#71878D', fontSize: 10.5 }}>Fulfillment assessment unavailable.</div>
            )}
            {latest.jevDecisions?.length ? <JsonDetails label="Jev decisions and safe input receipts" value={latest.jevDecisions} /> : (
              <div style={{ color: '#71878D', fontSize: 10.5 }}>No Jev receipt was retained for this Run.</div>
            )}
            <ToolReceiptLog events={latest.toolEvents || []} attempts={latest.attemptEvents || []} />
            <JsonDetails label="Identity, lineage, references, and artifacts" value={{
              runId: latest.runId,
              correlationId: latest.correlationId,
              conversationId: latest.conversationId,
              nativeRootId: latest.nativeRootId,
              nativeRunId: latest.nativeRunId,
              hermesSessionId: latest.hermesSessionId,
              parentRunId: latest.terminal?.parentRunId || null,
              children: latest.terminal?.children || [],
              nativeReferences: latest.nativeReferences || [],
              materializedNativeReferences: latest.materializedNativeReferences || [],
              artifacts: latest.artifacts || [],
            }} />
            <div>
              <button type="button" onClick={() => void loadInput()} disabled={inputStatus === 'loading'}>
                {inputStatus === 'loading' ? 'Loading retained input…' : 'Inspect retained input'}
              </button>
            </div>
            {retainedInput ? <JsonDetails label="Retained canonical input" value={retainedInput} /> : null}
          </section>

          <section aria-label="Recent Card runs" style={{ display: 'grid', gap: 6 }}>
            <div style={{ color: '#B9D0D6', fontSize: 11, fontWeight: 600 }}>Recent runs</div>
            <div style={{ color: '#71878D', fontSize: 10 }}>
              Bounded newest-first Card accounting. No comparable baseline is retained.
            </div>
            {(history?.runs || []).map((run, index) => (
              <div key={run.runId} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto',
                gap: 8, padding: '6px 8px', borderRadius: 5,
                background: index === 0 ? '#1A2B2A' : '#171E1F', fontSize: 10.5 }}>
                <div style={{ minWidth: 0 }}>
                  <code style={{ color: '#AFC2C7', overflowWrap: 'anywhere' }}>{run.runId}</code>
                  <div style={{ color: '#71878D' }}>{timestamp(run.startedAt || run.createdAt)}</div>
                </div>
                <div style={{ textAlign: 'right', color: run.state === 'completed' ? '#72D7C7'
                  : run.state === 'running' ? '#F1C27D' : '#FFA2A2' }}>
                  <div>{run.state}</div>
                  <div>{duration(run.totalElapsedMs)}</div>
                </div>
              </div>
            ))}
          </section>
            </div>
          </details>
        </>
      ) : null}
    </section>
  );
}
