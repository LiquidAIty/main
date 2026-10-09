import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type LastRun = {
  state: string;
  startedAt: string | null;
  model: string | null;
  elapsedMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number | null;
  costUsd: number | null;
  costStatus: 'actual' | 'estimated' | 'included' | 'unavailable';
  toolCallCount: number | null;
  autoToolsDecision: Record<string, unknown>;
  autoModelDecision: Record<string, unknown>;
};

type LastRunPayload = {
  cardId: string;
  latest: LastRun | null;
};

type Props = { projectId: string; deckId: string; cardId: string };

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
  if (status === 'included') return '$0.00 included';
  if (value === null || !Number.isFinite(value) || status === 'unavailable') return 'unavailable';
  const amount = value > 0 && value < 0.00005
    ? '<0.0001'
    : value > 0 && value < 0.01
      ? value.toFixed(4)
      : value.toFixed(2);
  return `${status === 'estimated' ? '~' : ''}$${amount} ${status}`;
}

function confidence(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? ` · ${value}%` : '';
}

function decisionRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function autoModelText(value: unknown): string | null {
  const decision = decisionRecord(value);
  if (!Object.keys(decision).length) return null;
  const status = String(decision.status || 'unavailable');
  return `${status}${confidence(decision.selectedConfidencePercentage)}`;
}

function autoToolsText(value: unknown): string | null {
  const decision = decisionRecord(value);
  if (!Object.keys(decision).length) return null;
  const selected = Array.isArray(decision.selectedToolIds) ? decision.selectedToolIds : [];
  const candidateCount = typeof decision.candidateCount === 'number' ? decision.candidateCount : null;
  const decisionStatus = String(decision.status || 'unavailable');
  const confidences = decision.selectedConfidencePercentages
    && typeof decision.selectedConfidencePercentages === 'object'
    ? selected.flatMap((id) => {
      const value = (decision.selectedConfidencePercentages as Record<string, unknown>)[String(id)];
      return typeof value === 'number' ? [`${String(id)} ${value}%`] : [];
    })
    : [];
  const selection = decisionStatus === 'unavailable'
    ? `unavailable${candidateCount === null ? '' : ` · full ${candidateCount}`}`
    : candidateCount === null
      ? decisionStatus
    : `${selected.length}/${candidateCount} selected`;
  return `${selection}${confidences.length ? ` · USE ${confidences.join(', ')}` : ''}`;
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
      const response = await fetch('/api/cards/runs/read', {
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
  const running = latest?.state === 'running';

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
    const started = Date.parse(latest.startedAt || '');
    return Number.isFinite(started) ? Math.max(0, clock - started) : latest.elapsedMs;
  }, [clock, latest, running]);
  const autoModel = latest ? autoModelText(latest.autoModelDecision) : null;
  const autoTools = latest ? autoToolsText(latest.autoToolsDecision) : null;

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
          <div>Model: {latest.model || 'unavailable'}{autoModel ? ` · Auto Model: ${autoModel}` : ''}</div>
          <div>Time: {formatDuration(elapsedMs)}</div>
          <div>Tokens: {formatCount(latest.totalTokens)}</div>
          <div>Cost: {formatCost(latest.costUsd, latest.costStatus)}</div>
          <div>Tools: {formatCount(latest.toolCallCount)}{autoTools ? ` · AutoTools: ${autoTools}` : ''}</div>
        </div>
      ) : null}
    </section>
  );
}
