import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import type { AgentCardInstance } from '../types/agentgraph';
import {
  DEFAULT_TRADING_CONFIGURATION,
  type HistoricalBars,
  type MarketBar,
  readTradingConfiguration,
  type TradeAction,
  type TradeJob,
  type TradingConfiguration,
  type TradingSettings,
  type TradingState,
} from '../features/trading/tradingState';

const CARD_ID = 'card_trading_workbench';
const BG = '#071018';
const PANEL = '#0c1822';
const PANEL_2 = '#10212d';
const EDGE = '#223947';
const INK = '#e5f2f6';
const MUTED = '#89a4ae';
const CYAN = '#56d4dd';
const GREEN = '#5cdaa0';
const AMBER = '#f2bf61';
const RED = '#ff786e';

type TradingTab = 'overview' | 'jobs' | 'risk' | 'evidence';
type InterventionAction = 'PAUSE' | 'EXIT' | 'FAIL_SAFE';

type TradingUIProps = {
  symbol?: string;
  projectId?: string | null;
  deckId?: string;
  card?: AgentCardInstance | null;
  onConfigurationChange?: (configuration: TradingConfiguration) => void;
};

function statusColor(action: TradeAction): string {
  if (action === 'ENTER' || action === 'HOLD') return GREEN;
  if (action === 'REDUCE' || action === 'WAIT') return AMBER;
  if (action === 'EXIT' || action === 'FAIL_SAFE') return RED;
  return '#9aaec7';
}

function money(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 2,
  }).format(value);
}

function shortTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function tradingViewSymbol(job: TradeJob | null, fallback?: string): string | null {
  const symbol = String(job?.plan?.instrument?.symbol || job?.symbol || fallback || '')
    .trim().toUpperCase();
  if (!/^[A-Z0-9._-]{1,32}$/.test(symbol)) return null;
  const venue = String(job?.plan?.instrument?.venue || 'NYSE').trim().toUpperCase();
  return /^[A-Z0-9._-]{1,20}$/.test(venue) ? `${venue}:${symbol}` : symbol;
}

let chartSequence = 0;

function TradingViewChart({ symbol }: { symbol: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const idRef = useRef(`trading-chart-${++chartSequence}`);
  useEffect(() => {
    let cancelled = false;
    const render = () => {
      if (cancelled || !ref.current || !(window as any).TradingView) return;
      ref.current.id = idRef.current;
      try {
        new (window as any).TradingView.widget({
          autosize: true,
          symbol,
          interval: '5',
          timezone: 'Etc/UTC',
          theme: 'dark',
          container_id: idRef.current,
          hide_top_toolbar: false,
          hide_legend: false,
          allow_symbol_change: false,
        });
      } catch {
        // The evidence panel remains usable if the third-party chart cannot load.
      }
    };
    if ((window as any).TradingView) render();
    else {
      let script = document.querySelector<HTMLScriptElement>('#tradingview-widget-script');
      if (!script) {
        script = document.createElement('script');
        script.id = 'tradingview-widget-script';
        script.src = 'https://s3.tradingview.com/tv.js';
        script.async = true;
        document.head.appendChild(script);
      }
      script.addEventListener('load', render, { once: true });
    }
    return () => { cancelled = true; };
  }, [symbol]);
  return <div ref={ref} style={{ height: '100%', minHeight: 340, width: '100%' }} />;
}

function useHistoricalBars(symbol: string | null, enabled = true) {
  const [payload, setPayload] = useState<HistoricalBars | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!symbol || !enabled) return;
    const controller = new AbortController();
    void fetch(`/market/bars?symbol=${encodeURIComponent(symbol)}&timeframe=5Min&limit=48`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(String(body?.detail || `market_bars_${response.status}`));
        setPayload(body as HistoricalBars);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : 'Market bars unavailable');
      });
    return () => controller.abort();
  }, [enabled, symbol]);
  return { payload, error };
}

function Candles({ bars }: { bars: MarketBar[] }) {
  const width = 320;
  const height = 116;
  const pad = 7;
  const prices = bars.flatMap((bar) => [bar.high, bar.low]);
  const high = Math.max(...prices);
  const low = Math.min(...prices);
  const range = Math.max(high - low, 0.000001);
  const step = (width - pad * 2) / bars.length;
  const candleWidth = Math.max(1.5, Math.min(7, step - 2));
  const y = (value: number) => pad + ((high - value) / range) * (height - pad * 2);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none"
         aria-label="Recent real market candles" style={{ display: 'block', height: 116, width: '100%' }}>
      <line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke="#19313e" />
      {bars.map((bar, index) => {
        const x = pad + index * step + step / 2;
        const color = bar.close >= bar.open ? GREEN : RED;
        const top = Math.min(y(bar.open), y(bar.close));
        const bodyHeight = Math.max(1.5, Math.abs(y(bar.open) - y(bar.close)));
        return (
          <g key={`${bar.timestamp}-${index}`}>
            <line x1={x} y1={y(bar.high)} x2={x} y2={y(bar.low)} stroke={color} />
            <rect x={x - candleWidth / 2} y={top} width={candleWidth} height={bodyHeight}
                  rx={0.6} fill={color} />
          </g>
        );
      })}
    </svg>
  );
}

function MiniCandleChart({ symbol }: { symbol: string }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: '120px' });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);
  const { payload, error } = useHistoricalBars(symbol, visible);
  const bars = Array.isArray(payload?.bars) ? payload.bars : [];
  return (
    <div ref={hostRef} style={{ minHeight: 116, background: '#08131c', borderRadius: 10, overflow: 'hidden' }}>
      {bars.length > 0 ? <Candles bars={bars} /> : (
        <div style={{ alignItems: 'center', color: MUTED, display: 'flex', fontSize: 12,
          height: 116, justifyContent: 'center', padding: 12, textAlign: 'center' }}>
          {error || payload?.diagnostics || (visible ? 'No market bars returned' : 'Chart loads when visible')}
        </div>
      )}
    </div>
  );
}

function PortfolioChart({ jobs }: { jobs: TradeJob[] }) {
  const closed = jobs.filter((job) => job.realizedPnlUsd !== null).slice()
    .sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());
  if (closed.length === 0) {
    return <div style={{ alignItems: 'center', color: MUTED, display: 'flex', height: 180,
      justifyContent: 'center', padding: 20, textAlign: 'center' }}>
      Portfolio performance will appear after a Trade Job records real realized paper P/L.
    </div>;
  }
  let cumulative = 0;
  const values = closed.map((job) => { cumulative += Number(job.realizedPnlUsd || 0); return cumulative; });
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const range = Math.max(max - min, 1);
  const points = values.map((value, index) => {
    const x = 10 + (index / Math.max(values.length - 1, 1)) * 600;
    const y = 170 - ((value - min) / range) * 145;
    return `${x},${y}`;
  }).join(' ');
  const zeroY = 170 - ((0 - min) / range) * 145;
  return (
    <svg viewBox="0 0 620 190" preserveAspectRatio="none"
         aria-label="Cumulative realized paper profit and loss" style={{ display: 'block', height: 180, width: '100%' }}>
      <line x1={0} y1={zeroY} x2={620} y2={zeroY} stroke="#314957" strokeDasharray="5 5" />
      <polyline points={points} fill="none" stroke={values.at(-1)! >= 0 ? GREEN : RED}
                strokeWidth={3} vectorEffect="non-scaling-stroke" />
      {points.split(' ').map((point, index) => {
        const [cx, cy] = point.split(',');
        return <circle key={closed[index].jobId} cx={cx} cy={cy} r={4}
          fill={values[index] >= 0 ? GREEN : RED} />;
      })}
    </svg>
  );
}

function Badge({ children, color = MUTED }: { children: React.ReactNode; color?: string }) {
  return <span style={{ background: `${color}13`, border: `1px solid ${color}55`, borderRadius: 999,
    color, fontSize: 11, fontWeight: 700, letterSpacing: '.04em', padding: '5px 8px' }}>{children}</span>;
}

function Metric({ label, value, tone = INK }: { label: string; value: React.ReactNode; tone?: string }) {
  return <div style={{ background: PANEL_2, border: `1px solid ${EDGE}`, borderRadius: 12, minWidth: 118, padding: '10px 12px' }}>
    <div style={{ color: MUTED, fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase' }}>{label}</div>
    <div style={{ color: tone, fontSize: 18, fontWeight: 760, marginTop: 3 }}>{value}</div>
  </div>;
}

function TradeJobCard({ job, selected, onSelect }: { job: TradeJob; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" onClick={onSelect} style={{ background: selected ? '#122a35' : PANEL,
      border: `1px solid ${selected ? CYAN : EDGE}`, borderRadius: 14, color: INK, cursor: 'pointer',
      minWidth: 0, overflow: 'hidden', padding: 0, textAlign: 'left', width: '100%' }}>
      <div style={{ alignItems: 'center', display: 'flex', gap: 8, justifyContent: 'space-between', padding: '10px 11px 8px' }}>
        <div><strong style={{ fontSize: 15 }}>{job.symbol}</strong><span style={{ color: MUTED, fontSize: 11, marginLeft: 7 }}>{job.assetClass}</span></div>
        <Badge color={statusColor(job.action)}>{job.action}</Badge>
      </div>
      <MiniCandleChart symbol={job.symbol} />
      <div style={{ display: 'grid', gap: 4, gridTemplateColumns: '1fr 1fr', padding: '9px 11px 11px' }}>
        <span style={{ color: MUTED, fontSize: 11 }}>Risk ceiling</span><span style={{ fontSize: 11, textAlign: 'right' }}>{money(job.maxLossUsd)}</span>
        <span style={{ color: MUTED, fontSize: 11 }}>Paper P/L</span><span style={{ color: (job.realizedPnlUsd || 0) >= 0 ? GREEN : RED, fontSize: 11, textAlign: 'right' }}>{money(job.realizedPnlUsd)}</span>
      </div>
    </button>
  );
}

type SliderSpec = { field: keyof TradingSettings; label: string; min: number; max: number;
  step: number; suffix?: string; description: string };

const SLIDERS: SliderSpec[] = [
  { field: 'paperBudgetUsd', label: 'Paper budget', min: 0, max: 1_000_000, step: 5_000, suffix: ' USD', description: 'Zero keeps new capital allocation blocked.' },
  { field: 'allocationPerJobPercent', label: 'Allocation per job', min: 0, max: 100, step: 1, suffix: '%', description: 'Maximum share of the paper budget assigned to one job.' },
  { field: 'maxConcurrentJobs', label: 'Concurrent Trade Jobs', min: 1, max: 20, step: 1, description: 'Limits simultaneous monitoring lifecycles.' },
  { field: 'maxOpenPositions', label: 'Open positions', min: 0, max: 20, step: 1, description: 'Zero prevents any position from being opened.' },
  { field: 'maxPlanLossPercent', label: 'Loss per plan', min: 0, max: 20, step: 0.25, suffix: '%', description: 'Hard paper-loss ceiling for one accepted plan.' },
  { field: 'maxDailyLossPercent', label: 'Daily loss', min: 0, max: 20, step: 0.25, suffix: '%', description: 'Daily fail-safe threshold across the portfolio.' },
  { field: 'minimumConfidencePercent', label: 'Minimum confidence', min: 0, max: 100, step: 1, suffix: '%', description: 'Required reasoning confidence before an ENTER outcome.' },
  { field: 'minimumRiskReward', label: 'Minimum risk / reward', min: 0, max: 10, step: 0.25, suffix: '×', description: 'Minimum expected reward relative to planned risk.' },
  { field: 'evaluationCadenceSeconds', label: 'Evaluation cadence', min: 15, max: 3600, step: 15, suffix: ' sec', description: 'Hermes reasoning cadence; continuous monitoring stays deterministic.' },
  { field: 'staleDataSeconds', label: 'Stale-data fail-safe', min: 15, max: 3600, step: 15, suffix: ' sec', description: 'Pause when required evidence is older than this threshold.' },
];

function RiskSettings({ value, canSave, onSave }: { value: TradingConfiguration; canSave: boolean;
  onSave?: (configuration: TradingConfiguration) => void }) {
  const [draft, setDraft] = useState(value);
  const [saved, setSaved] = useState(false);
  useEffect(() => { setDraft(value); }, [value]);
  const setNumber = (field: keyof TradingSettings, next: number) => {
    setSaved(false);
    setDraft((current) => ({ ...current, trading: { ...current.trading, [field]: next } }));
  };
  return (
    <section style={{ background: PANEL, border: `1px solid ${EDGE}`, borderRadius: 16, padding: 16 }}>
      <div style={{ alignItems: 'flex-start', display: 'flex', gap: 12, justifyContent: 'space-between', marginBottom: 14 }}>
        <div><h2 style={{ fontSize: 16, margin: 0 }}>Risk and runtime controls</h2><p style={{ color: MUTED, fontSize: 12, margin: '5px 0 0' }}>Saved on this Card. Agent Builder may edit the same fields through ordinary Card configuration.</p></div>
        <Badge color={RED}>Execution approval locked off</Badge>
      </div>
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(245px, 1fr))' }}>
        {SLIDERS.map((spec) => {
          const current = Number(draft.trading[spec.field]);
          return <label key={spec.field} style={{ background: PANEL_2, border: `1px solid ${EDGE}`, borderRadius: 12, padding: 12 }}>
            <span style={{ alignItems: 'center', display: 'flex', fontSize: 12, fontWeight: 700, justifyContent: 'space-between' }}><span>{spec.label}</span><output style={{ color: CYAN }}>{current.toLocaleString()}{spec.suffix || ''}</output></span>
            <input type="range" min={spec.min} max={spec.max} step={spec.step} value={current}
              onChange={(event) => setNumber(spec.field, Number(event.target.value))}
              style={{ accentColor: CYAN, margin: '10px 0 5px', width: '100%' }} />
            <span style={{ color: MUTED, display: 'block', fontSize: 11, lineHeight: 1.35 }}>{spec.description}</span>
          </label>;
        })}
      </div>
      <div style={{ alignItems: 'center', display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 14 }}>
        {saved && <span style={{ color: GREEN, fontSize: 12 }}>Saved to Card configuration</span>}
        <button type="button" disabled={!canSave} onClick={() => { onSave?.(draft); setSaved(true); }}
          style={{ background: canSave ? CYAN : '#34515b', border: 0, borderRadius: 10, color: '#041116',
            cursor: canSave ? 'pointer' : 'not-allowed', fontWeight: 800, padding: '10px 15px' }}>
          Save risk settings
        </button>
      </div>
    </section>
  );
}

function JobDetail({ job, onIntervene, busy }: { job: TradeJob;
  onIntervene: (action: InterventionAction, reason: string) => Promise<void>; busy: boolean }) {
  const [reason, setReason] = useState('');
  const chartSymbol = tradingViewSymbol(job);
  return (
    <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
      <section style={{ background: PANEL, border: `1px solid ${EDGE}`, borderRadius: 16, minHeight: 420, overflow: 'hidden' }}>
        <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between', padding: '11px 13px' }}><div><strong>{job.symbol}</strong><span style={{ color: MUTED, fontSize: 12, marginLeft: 8 }}>full chart</span></div><Badge color={statusColor(job.action)}>{job.action}</Badge></div>
        {chartSymbol ? <TradingViewChart symbol={chartSymbol} /> : <div style={{ color: MUTED, padding: 30 }}>The saved instrument cannot be mapped to a chart symbol.</div>}
      </section>
      <aside style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <section style={{ background: PANEL, border: `1px solid ${EDGE}`, borderRadius: 14, padding: 13 }}>
          <h3 style={{ fontSize: 13, margin: '0 0 10px' }}>Plan boundary</h3>
          <dl style={{ display: 'grid', fontSize: 12, gap: 7, gridTemplateColumns: '1fr 1fr', margin: 0 }}>
            <dt style={{ color: MUTED }}>Budget ceiling</dt><dd style={{ margin: 0, textAlign: 'right' }}>{money(job.budgetCeilingUsd)}</dd>
            <dt style={{ color: MUTED }}>Max loss</dt><dd style={{ margin: 0, textAlign: 'right' }}>{money(job.maxLossUsd)}</dd>
            <dt style={{ color: MUTED }}>State</dt><dd style={{ margin: 0, textAlign: 'right' }}>{job.state}</dd>
            <dt style={{ color: MUTED }}>Execution</dt><dd style={{ color: RED, margin: 0, textAlign: 'right' }}>{job.executionState}</dd>
            <dt style={{ color: MUTED }}>Updated</dt><dd style={{ margin: 0, textAlign: 'right' }}>{shortTime(job.updatedAt)}</dd>
          </dl>
        </section>
        <section style={{ background: PANEL, border: `1px solid ${EDGE}`, borderRadius: 14, padding: 13 }}>
          <h3 style={{ fontSize: 13, margin: '0 0 8px' }}>Authorized intervention</h3>
          <p style={{ color: MUTED, fontSize: 11, lineHeight: 1.4, margin: '0 0 9px' }}>These controls update monitored paper state. They cannot submit or close a broker order.</p>
          <textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Reason required" rows={3}
            style={{ background: '#07121a', border: `1px solid ${EDGE}`, borderRadius: 9, color: INK,
              padding: 9, resize: 'vertical', width: '100%' }} />
          <div style={{ display: 'grid', gap: 7, gridTemplateColumns: 'repeat(3, 1fr)', marginTop: 8 }}>
            {(['PAUSE', 'EXIT', 'FAIL_SAFE'] as InterventionAction[]).map((action) => <button key={action}
              type="button" disabled={busy || !reason.trim()}
              onClick={() => void onIntervene(action, reason).then(() => setReason(''))}
              style={{ background: action === 'PAUSE' ? '#2d342c' : '#382022', border: `1px solid ${action === 'PAUSE' ? AMBER : RED}66`,
                borderRadius: 8, color: action === 'PAUSE' ? AMBER : RED,
                cursor: busy || !reason.trim() ? 'not-allowed' : 'pointer', fontSize: 10,
                fontWeight: 800, opacity: busy || !reason.trim() ? .5 : 1, padding: '9px 4px' }}>
              {action.replace('_', ' ')}
            </button>)}
          </div>
        </section>
      </aside>
    </div>
  );
}

export default function TradingUI({ symbol, projectId, deckId = 'deck_builder', card,
  onConfigurationChange }: TradingUIProps) {
  const [searchParams] = useSearchParams();
  const explicitSymbol = String(symbol || searchParams.get('symbol') || '').trim().toUpperCase() || null;
  const cardId = card?.id || CARD_ID;
  const [tab, setTab] = useState<TradingTab>('overview');
  const [state, setState] = useState<TradingState | null>(null);
  const [stateError, setStateError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [interventionBusy, setInterventionBusy] = useState(false);
  const [interventionError, setInterventionError] = useState<string | null>(null);
  const configuration = useMemo(() => readTradingConfiguration(
    card?.runtimeOptions?.configuration || DEFAULT_TRADING_CONFIGURATION,
  ), [card?.runtimeOptions?.configuration]);

  const readState = useCallback(async () => {
    if (!projectId || !cardId) { setState(null); setStateError(null); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams({ projectId, deckId, cardId });
      const response = await fetch(`/trading/state?${params.toString()}`);
      const body = await response.json();
      if (!response.ok) throw new Error(String(body?.detail || `trading_state_${response.status}`));
      setState(body as TradingState);
      setStateError(null);
    } catch (reason: unknown) {
      setStateError(reason instanceof Error ? reason.message : 'Trading state unavailable');
    } finally { setLoading(false); }
  }, [cardId, deckId, projectId]);

  useEffect(() => { void readState(); }, [readState]);
  useEffect(() => {
    if (!projectId) return;
    const timer = window.setInterval(() => void readState(), 15_000);
    return () => window.clearInterval(timer);
  }, [projectId, readState]);

  const jobs = state?.jobs || [];
  const selectedJob = jobs.find((job) => job.jobId === selectedJobId) || null;
  useEffect(() => {
    if (selectedJobId && !jobs.some((job) => job.jobId === selectedJobId)) setSelectedJobId(null);
  }, [jobs, selectedJobId]);

  const intervene = async (action: InterventionAction, reason: string) => {
    if (!projectId || !selectedJob) return;
    setInterventionBusy(true);
    setInterventionError(null);
    try {
      const response = await fetch('/trading/intervene', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, deckId, cardId, jobId: selectedJob.jobId, action, reason }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(String(body?.detail || `trading_intervention_${response.status}`));
      await readState();
    } catch (reasonValue: unknown) {
      setInterventionError(reasonValue instanceof Error ? reasonValue.message : 'Intervention failed');
    } finally { setInterventionBusy(false); }
  };

  const activeJobs = jobs.filter((job) => !['completed', 'fail_safe'].includes(job.state));
  const blockedSettings = configuration.trading.paperBudgetUsd === 0
    || configuration.trading.maxOpenPositions === 0
    || configuration.trading.maxPlanLossPercent === 0
    || configuration.trading.maxDailyLossPercent === 0;
  const closed = state?.portfolio.closedTrades || 0;
  const winRate = closed ? ((state?.portfolio.wins || 0) / closed) * 100 : null;
  const runtimeProfile = card?.runtime.kind === 'hermes' ? card.runtime.profile : null;
  const runtimeOkay = card?.runtime.kind === 'hermes' && card.runtime.mode === 'delegate'
    && Boolean(runtimeProfile);

  return (
    <div style={{ background: BG, color: INK, height: '100%', minHeight: '100vh', overflow: 'auto' }}>
      <header style={{ background: '#09151eeb', borderBottom: `1px solid ${EDGE}`, position: 'sticky', top: 0, zIndex: 20 }}>
        <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between', padding: '12px 16px 9px' }}>
          <div>
            <div style={{ alignItems: 'center', display: 'flex', gap: 8 }}><span style={{ color: CYAN, fontSize: 11, fontWeight: 900, letterSpacing: '.15em' }}>TRADER</span><Badge color={RED}>Paper only</Badge><Badge color={runtimeOkay ? GREEN : AMBER}>{runtimeOkay ? `Hermes · ${runtimeProfile}` : 'Hermes profile pending'}</Badge></div>
            <h1 style={{ fontSize: 19, margin: '5px 0 0' }}>{card?.title || 'Trading Agent'}</h1>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}><Badge color={state?.engine.status === 'available' ? GREEN : AMBER}>Lumibot {state?.engine.version || state?.engine.status || 'not loaded'}</Badge><Badge color={RED}>Order submission blocked</Badge></div>
        </div>
        <nav aria-label="Trading workspace" style={{ display: 'flex', gap: 4, overflowX: 'auto', padding: '0 12px' }}>
          {([['overview', 'Overview'], ['jobs', `Trade Jobs ${jobs.length ? `(${jobs.length})` : ''}`],
            ['risk', 'Strategy & Risk'], ['evidence', 'Evidence']] as [TradingTab, string][]).map(([id, label]) =>
            <button key={id} type="button" onClick={() => setTab(id)} style={{ background: 'transparent',
              border: 0, borderBottom: `2px solid ${tab === id ? CYAN : 'transparent'}`,
              color: tab === id ? INK : MUTED, cursor: 'pointer', fontSize: 12, fontWeight: 750,
              padding: '9px 11px' }}>{label}</button>)}
        </nav>
      </header>

      <main style={{ margin: '0 auto', maxWidth: 1600, padding: 14 }}>
        {stateError && <div role="alert" style={{ background: '#31191c', border: `1px solid ${RED}77`, borderRadius: 11,
          color: '#ffaaa3', fontSize: 12, marginBottom: 12, padding: 11 }}>Trading state is unavailable: {stateError}. No execution state has been inferred.</div>}
        {interventionError && <div role="alert" style={{ color: RED, fontSize: 12, marginBottom: 10 }}>{interventionError}</div>}

        {tab === 'overview' && <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <section style={{ display: 'grid', gap: 9, gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))' }}>
            <Metric label="Active jobs" value={activeJobs.length} />
            <Metric label="Realized paper P/L" value={money(state?.portfolio.realizedPnlUsd)} tone={(state?.portfolio.realizedPnlUsd || 0) >= 0 ? GREEN : RED} />
            <Metric label="Win rate" value={winRate === null ? '—' : `${winRate.toFixed(1)}%`} />
            <Metric label="Risk configuration" value={blockedSettings ? 'Blocked' : 'Set'} tone={blockedSettings ? AMBER : GREEN} />
          </section>
          <section style={{ background: PANEL, border: `1px solid ${EDGE}`, borderRadius: 16, overflow: 'hidden' }}>
            <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between', padding: '12px 14px 0' }}><div><h2 style={{ fontSize: 15, margin: 0 }}>Portfolio outcome</h2><span style={{ color: MUTED, fontSize: 11 }}>Cumulative realized paper P/L · no synthetic marks</span></div><div style={{ display: 'flex', gap: 7 }}><Badge color={GREEN}>{state?.portfolio.wins || 0} wins</Badge><Badge color={RED}>{state?.portfolio.losses || 0} losses</Badge></div></div>
            <PortfolioChart jobs={jobs} />
          </section>
          <section>
            <div style={{ alignItems: 'end', display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}><div><h2 style={{ fontSize: 15, margin: 0 }}>Active Trade Jobs</h2><span style={{ color: MUTED, fontSize: 11 }}>One compact real-candle view per assignment</span></div>{loading && <span style={{ color: MUTED, fontSize: 11 }}>Refreshing…</span>}</div>
            {activeJobs.length ? <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
              {activeJobs.map((job) => <TradeJobCard key={job.jobId} job={job} selected={selectedJobId === job.jobId}
                onSelect={() => { setSelectedJobId(job.jobId); setTab('jobs'); }} />)}
            </div> : <div style={{ background: PANEL, border: `1px dashed ${EDGE}`, borderRadius: 16, color: MUTED,
              padding: '34px 20px', textAlign: 'center' }}><strong style={{ color: INK, display: 'block', marginBottom: 6 }}>No active Trade Jobs</strong>Main, an approved Mag One result, Graph Agent, or an explicitly connected Card can send a complete structured assignment. Missing execution terms are rejected.{explicitSymbol && <div style={{ color: CYAN, marginTop: 7 }}>Observed route instrument: {explicitSymbol}</div>}</div>}
          </section>
        </div>}

        {tab === 'jobs' && <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {jobs.length > 0 && <div style={{ display: 'flex', gap: 7, overflowX: 'auto', paddingBottom: 2 }}>
            {jobs.map((job) => <button key={job.jobId} type="button" onClick={() => setSelectedJobId(job.jobId)}
              style={{ background: selectedJobId === job.jobId ? '#16313b' : PANEL,
                border: `1px solid ${selectedJobId === job.jobId ? CYAN : EDGE}`, borderRadius: 10,
                color: INK, cursor: 'pointer', padding: '8px 11px', whiteSpace: 'nowrap' }}>
              {job.symbol} <span style={{ color: statusColor(job.action), fontSize: 10 }}>{job.action}</span>
            </button>)}
          </div>}
          {selectedJob ? <JobDetail job={selectedJob} onIntervene={intervene} busy={interventionBusy} />
            : <div style={{ background: PANEL, border: `1px dashed ${EDGE}`, borderRadius: 16, color: MUTED,
              padding: 40, textAlign: 'center' }}>{jobs.length ? 'Select a Trade Job to open its full chart and evidence.' : 'No Trade Jobs have been accepted.'}</div>}
        </div>}

        {tab === 'risk' && <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <RiskSettings value={configuration} canSave={Boolean(card && onConfigurationChange)} onSave={onConfigurationChange} />
          <section style={{ background: PANEL, border: `1px solid ${EDGE}`, borderRadius: 16, padding: 16 }}>
            <h2 style={{ fontSize: 15, margin: '0 0 10px' }}>Runtime division of work</h2>
            <div style={{ display: 'grid', gap: 9, gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
              {[
                ['Hermes', 'Profile, stable prompt, native skills, sessions, memory, tools, and optional bounded Team reasoning.'],
                ['Lumibot', 'Deterministic strategy lifecycle and paper-broker machinery beneath the Card. No live mode.'],
                ['Mag One', 'Outer mission manager. The saved Trading Card remains an independently runnable worker.'],
              ].map(([title, body]) => <div key={title} style={{ background: PANEL_2, border: `1px solid ${EDGE}`, borderRadius: 12, padding: 12 }}><strong style={{ color: CYAN, fontSize: 12 }}>{title}</strong><p style={{ color: MUTED, fontSize: 11, lineHeight: 1.45, margin: '5px 0 0' }}>{body}</p></div>)}
            </div>
          </section>
        </div>}

        {tab === 'evidence' && <section style={{ background: PANEL, border: `1px solid ${EDGE}`, borderRadius: 16, padding: 15 }}>
          <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}><div><h2 style={{ fontSize: 15, margin: 0 }}>Decision evidence</h2><span style={{ color: MUTED, fontSize: 11 }}>Typed outcomes and the evidence recorded with them</span></div><Badge>{state?.observedAt ? `Observed ${shortTime(state.observedAt)}` : 'No state read'}</Badge></div>
          {jobs.some((job) => job.decisions.length) ? jobs.flatMap((job) => job.decisions.map((decision) =>
            <article key={decision.decisionId} style={{ borderTop: `1px solid ${EDGE}`, padding: '12px 2px' }}>
              <div style={{ alignItems: 'center', display: 'flex', gap: 8 }}><strong>{job.symbol}</strong><Badge color={statusColor(decision.action)}>{decision.action}</Badge><span style={{ color: MUTED, fontSize: 11 }}>{(decision.confidence * 100).toFixed(0)}% · {shortTime(decision.createdAt)}</span></div>
              <p style={{ color: '#bfd0d7', fontSize: 12, lineHeight: 1.5, margin: '8px 0' }}>{decision.rationale}</p>
              <details><summary style={{ color: CYAN, cursor: 'pointer', fontSize: 11 }}>Recorded evidence and missing terms</summary><pre style={{ background: '#07121a', borderRadius: 8, color: MUTED, fontSize: 10, overflow: 'auto', padding: 9 }}>{JSON.stringify({ evidence: decision.evidence, missingTerms: decision.missingTerms, executionRequested: decision.executionRequested }, null, 2)}</pre></details>
            </article>))
            : <div style={{ color: MUTED, padding: 30, textAlign: 'center' }}>No decisions have been recorded. The UI will not manufacture evidence.</div>}
        </section>}
      </main>
    </div>
  );
}
