import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type LastRun = {
  state: string;
  acceptedAt: string | null;
  model: string | null;
  elapsedMs: number | null;
  totalTokens: number | null;
  costUsd: number | null;
  costStatus: 'estimated' | 'unavailable';
  toolCallCount: number | null;
};

type LastRunPayload = {
  cardId: string;
  latest: LastRun | null;
};

type Props = { projectId: string; deckId: string; cardId: string };

const TERMINAL_STATES = new Set(['completed', 'failed', 'cancelled', 'blocked', 'interrupted']);

function formatDuration(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'unavailable';
  const totalCentiseconds = Math.max(0, Math.floor(value / 10));
  const minutes = Math.floor(totalCentiseconds / 6_000);
  const seconds = Math.floor((totalCentiseconds % 6_000) / 100);
  const centiseconds = totalCentiseconds % 100;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`;
}

function formatCount(value: number | null): string {
  return value === null || !Number.isFinite(value)
    ? 'unavailable'
    : Math.round(value).toLocaleString('en-US');
}

function formatCost(value: number | null, status: LastRun['costStatus']): string {
  return value === null || !Number.isFinite(value) || status !== 'estimated'
    ? 'unavailable'
    : `~$${value.toFixed(2)} estimated`;
}

export function CardRunMetrics({ projectId, deckId, cardId }: Props) {
  const [payload, setPayload] = useState<LastRunPayload | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [error, setError] = useState('');
  const [clock, setClock] = useState(() => Date.now());
  const requestRef = useRef(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!projectId || !deckId || !cardId) return;
    const request = ++requestRef.current;
    try {
      const response = await fetch('/api/cards/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'history', projectId, deckId, cardId, limit: 1 }),
        signal,
      });
      const body = await response.json();
      if (!response.ok || body?.ok !== true || body?.result?.cardId !== cardId) {
        throw new Error(String(body?.error || 'card_run_status_unavailable'));
      }
      if (request !== requestRef.current || signal?.aborted) return;
      setPayload(body.result as LastRunPayload);
      setStatus('ready');
      setError('');
    } catch (caught) {
      if (signal?.aborted || request !== requestRef.current) return;
      setStatus('failed');
      setError(caught instanceof Error ? caught.message : 'card_run_status_unavailable');
    }
  }, [projectId, deckId, cardId]);

  useEffect(() => {
    const controller = new AbortController();
    setPayload(null);
    setStatus('loading');
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const latest = payload?.latest || null;
  const running = Boolean(latest && !TERMINAL_STATES.has(latest.state));

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 2_000);
    return () => window.clearTimeout(timer);
  }, [latest, load]);

  useEffect(() => {
    if (!running) return undefined;
    const timer = window.setInterval(() => setClock(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [running]);

  const elapsedMs = useMemo(() => {
    if (!latest) return null;
    if (!running) return latest.elapsedMs;
    const accepted = Date.parse(latest.acceptedAt || '');
    return Number.isFinite(accepted) ? Math.max(0, clock - accepted) : latest.elapsedMs;
  }, [clock, latest, running]);

  return (
    <section aria-label="Last run" data-testid="card-run-metrics"
      style={{ display: 'grid', gap: 8, padding: 10, border: '1px solid #3A4A4F',
        borderRadius: 8, background: '#202827', color: '#E0DED5', fontSize: 11.5 }}>
      <div style={{ fontSize: 12, fontWeight: 700 }}>Last run</div>
      {status === 'loading' ? <div role="status">Loading…</div> : null}
      {status === 'failed' ? <div role="alert">Run history unavailable: {error}</div> : null}
      {status === 'ready' && !latest ? <div>No runs yet.</div> : null}
      {latest ? (
        <div style={{ display: 'grid', gap: 5 }}>
          <div>Model: {latest.model || 'unavailable'}</div>
          <div>Time: {formatDuration(elapsedMs)}</div>
          <div>Tokens: {formatCount(latest.totalTokens)}</div>
          <div>Cost: {formatCost(latest.costUsd, latest.costStatus)}</div>
          <div>Tools: {formatCount(latest.toolCallCount)}</div>
        </div>
      ) : null}
    </section>
  );
}
