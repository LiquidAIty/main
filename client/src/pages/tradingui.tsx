import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import './tradingui.css';
import type { AgentCardInstance } from '../types/agentgraph';
import { resolveInstrument } from '../features/trading/instrument';
import {
  readTradingConfiguration, reconcileTradingState,
  type TradeJob, type TradingInterventionAction, type TradingState, type TradingSettings,
} from '../features/trading/tradingState';

const DARK = { bg: '#0a0f1a', panel: '#111827', edge: '#1f2937', ink: '#e5e7eb' };
const GREEN = '#34d399';
const RED = '#fb7185';
const MUTED = '#94a3b8';
const CHART_INTERVALS = { '1Min': '1', '5Min': '5', '15Min': '15', '1Hour': '60', '1Day': 'D' } as const;
type ChartWidget = { remove?: () => void };
type ChartWindow = Window & { TradingView?: { widget: new (options: Record<string, unknown>) => ChartWidget } };

function TVChart({ symbol, timeframe, compact = false }: { symbol: string; timeframe: TradingSettings['defaultTimeframe']; compact?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId().replace(/:/g, '');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let widget: ChartWidget | undefined;
    setFailed(false);
    const mount = () => {
      if (cancelled || !ref.current) return;
      const chart = (window as ChartWindow).TradingView;
      if (!chart) { setFailed(true); return; }
      try {
        widget = new chart.widget({
          autosize: true, symbol, interval: CHART_INTERVALS[timeframe], style: '1',
          timezone: 'Etc/UTC', theme: 'dark', container_id: id,
          hide_top_toolbar: compact, hide_legend: compact, allow_symbol_change: !compact,
        });
      } catch { setFailed(true); }
    };
    const fail = () => { if (!cancelled) setFailed(true); };
    let script = document.querySelector<HTMLScriptElement>('#tv-script');
    if ((window as ChartWindow).TradingView) mount();
    else {
      if (!script) {
        script = document.createElement('script');
        script.id = 'tv-script';
        script.src = 'https://s3.tradingview.com/tv.js';
        script.async = true;
        document.head.appendChild(script);
      }
      script.addEventListener('load', mount);
      script.addEventListener('error', fail);
    }
    return () => {
      cancelled = true;
      script?.removeEventListener('load', mount);
      script?.removeEventListener('error', fail);
      // React can detach the iframe before the external widget tears down.
      try { widget?.remove?.(); } catch { /* The detached iframe is already gone. */ }
    };
  }, [id, symbol, timeframe, compact]);
  return <div style={{ height: '100%', width: '100%', position: 'relative' }}>
    <div id={id} ref={ref} data-testid="trading-candles" style={{ height: '100%', width: '100%' }} />
    {failed ? <span role="alert" style={{ position: 'absolute', top: 12, left: 12, color: RED }}>Chart unavailable</span> : null}
  </div>;
}

function LazyTradeChart({ symbol, timeframe }: { symbol: string; timeframe: TradingSettings['defaultTimeframe'] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <div ref={ref} style={{ height: '100%' }}>{visible ? <TVChart symbol={symbol} timeframe={timeframe} compact /> : null}</div>;
}

function money(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString(undefined, { style: 'currency', currency: 'USD' }) : null;
}

function PlanTerms({ job }: { job: TradeJob }) {
  return <dl className="trading-plan-terms">
    <div><dt>Budget</dt><dd>{money(job.budgetCeilingUsd)}</dd></div>
    <div><dt>Maximum loss</dt><dd>{money(job.maxLossUsd)}</dd></div>
    {job.plan.expectedRiskReward != null ? <div><dt>Risk/reward</dt><dd>{job.plan.expectedRiskReward}</dd></div> : null}
    {([['Entry', job.plan.entryConditions], ['Stop', job.plan.stopConditions], ['Target', job.plan.exitConditions], ['Invalidation', job.plan.invalidationConditions]] as const)
      .filter(([, values]) => values?.length).map(([label, values]) => <div key={label}><dt>{label}</dt><dd>{values!.join(' · ')}</dd></div>)}
    {job.plan.horizon ? <div><dt>Horizon</dt><dd>{job.plan.horizon}</dd></div> : null}
    {job.plan.expiresAt ? <div><dt>Expires</dt><dd>{new Date(job.plan.expiresAt).toLocaleString()}</dd></div> : null}
  </dl>;
}

function EquityChart({ points }: { points: TradingState['portfolio']['equityCurve'] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !points.length) return;
    const draw = () => {
      const width = canvas.clientWidth;
      if (!width) return;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = width * ratio;
      canvas.height = 200 * ratio;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.scale(ratio, ratio);
      const times = points.map(point => Date.parse(point.timestamp));
      const start = Math.min(...times);
      const duration = Math.max(1, Math.max(...times) - start);
      const line = (field: 'valueUsd' | 'drawdownUsd', top: number, size: number, color: string) => {
        const values = points.map(point => point[field]);
        const low = Math.min(...values);
        const high = Math.max(...values);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        points.forEach((point, index) => {
          const x = 8 + (times[index] - start) / duration * (width - 16);
          const y = top + (high - point[field]) / Math.max(1, high - low) * size;
          if (index) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        });
        ctx.stroke();
      };
      line('valueUsd', 8, 120, GREEN);
      line('drawdownUsd', 152, 40, RED);
    };
    draw();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(draw) : null;
    observer?.observe(canvas);
    return () => observer?.disconnect();
  }, [points]);
  return <canvas ref={ref} aria-label="Equity and drawdown" style={{ width: '100%', height: 200 }} />;
}

type TradingUIProps = {
  symbol?: string; projectId?: string | null; deckId?: string;
  card?: AgentCardInstance | null;
};

export default function TradingUI({ symbol, projectId, deckId = 'deck_builder', card }: TradingUIProps) {
  const [view, setView] = useState<'ticker' | 'portfolio' | 'journal'>('ticker');
  const [chartOpen, setChartOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [history, setHistory] = useState(false);
  const [state, setState] = useState<TradingState | null>(null);
  const [stateError, setStateError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [interventionError, setInterventionError] = useState(false);
  const [reason, setReason] = useState('');
  const cardId = card?.id || 'card_trading_workbench';
  const settings = readTradingConfiguration(card?.runtimeOptions?.configuration).trading;
  const timeframe = settings.defaultTimeframe;
  const showingChart = view === 'ticker' || (view === 'portfolio' && chartOpen);
  const query = useMemo(() => {
    if (!projectId) return null;
    const params = new URLSearchParams({ projectId, deckId, cardId, timeframe });
    if (selectedJobId) params.set('selectedJobId', selectedJobId);
    return params.toString();
  }, [projectId, deckId, cardId, timeframe, selectedJobId]);
  const acceptSnapshot = useCallback((incoming: TradingState) => {
    if (incoming?.cardId !== cardId) throw new Error('trading_snapshot_card_identity_mismatch');
    setState(current => reconcileTradingState(current, incoming));
    setStateError(false);
  }, [cardId]);
  useEffect(() => { setState(null); setSelectedJobId(null); setChartOpen(false); }, [projectId, deckId, cardId]);
  useEffect(() => {
    if (!query) return;
    const controller = new AbortController();
    void fetch('/api/trading/state?' + query, { credentials: 'include', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('trading_state_unavailable');
        const body = await response.json();
        if (!controller.signal.aborted) acceptSnapshot(body as TradingState);
      }).catch(() => { if (!controller.signal.aborted) setStateError(true); });
    if (typeof EventSource === 'undefined') return () => controller.abort();
    const stream = new EventSource('/api/trading/events?' + query, { withCredentials: true });
    stream.addEventListener('snapshot', event => {
      if (controller.signal.aborted) return;
      try { acceptSnapshot(JSON.parse((event as MessageEvent).data) as TradingState); }
      catch { setStateError(true); }
    });
    stream.addEventListener('transport_error', () => setStateError(true));
    stream.onerror = () => setStateError(true);
    return () => { controller.abort(); stream.close(); };
  }, [acceptSnapshot, query]);

  const jobs = state?.jobs || [];
  const selectedJob = jobs.find(job => job.jobId === selectedJobId) || null;
  const instrument = resolveInstrument(symbol || new URLSearchParams(window.location.search).get('symbol'));
  const chartSymbol = selectedJob?.symbol || instrument?.tradingViewSymbol;
  const visibleJobs = jobs.filter(job => ['completed', 'fail_safe'].includes(job.state) === history);
  const availableAction = selectedJob?.state === 'monitoring' ? 'PAUSE' : selectedJob?.state === 'paused' ? 'RESUME' : null;
  const border = { borderColor: DARK.edge, background: DARK.panel };
  const button: React.CSSProperties = { border: `1px solid ${DARK.edge}`, borderRadius: 8, background: '#0b1220', color: DARK.ink, padding: '6px 10px', cursor: 'pointer' };
  const openJob = (job: TradeJob) => { setSelectedJobId(job.jobId); setReason(''); setView('portfolio'); setChartOpen(true); };
  const showPortfolio = () => { setView('portfolio'); setChartOpen(false); setSelectedJobId(null); };
  const intervene = async (action: TradingInterventionAction) => {
    if (!projectId || !selectedJob || !reason.trim() || !state?.commands.pauseResume.available) return;
    setBusy(true); setInterventionError(false);
    try {
      const response = await fetch('/api/trading/intervene', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, deckId, cardId, jobId: selectedJob.jobId, action, reason }),
      });
      if (!response.ok) throw new Error('trading_intervention_failed');
      setReason('');
      const updated = await fetch('/api/trading/state?' + query, { credentials: 'include' });
      if (!updated.ok) throw new Error('trading_state_unavailable');
      acceptSnapshot(await updated.json() as TradingState);
    } catch { setInterventionError(true); }
    finally { setBusy(false); }
  };

  return <div data-testid="trading-agent-workspace" className="trading-workspace flex h-full min-h-0 flex-col"
    style={{ background: DARK.bg, color: DARK.ink, height: '100%', overflow: 'hidden', containerType: 'inline-size', containerName: 'trading' }}>
    <header className="trading-toolbar" style={border}>
      <nav aria-label="Trading" role="tablist" className="trading-tabs">
        <button type="button" role="tab" aria-selected={view === 'ticker'} onClick={() => { setView('ticker'); setSelectedJobId(null); }}>Add trade</button>
        <button type="button" role="tab" aria-selected={view === 'portfolio'} onClick={showPortfolio}>Portfolio</button>
        <button type="button" role="tab" aria-selected={view === 'journal'} onClick={() => setView('journal')}>Journal</button>
      </nav>
      <div className="trading-toolbar-actions">
        {showingChart ? <button type="button" style={button} aria-label={fullscreen ? 'Exit Fullscreen' : 'Fullscreen'} onClick={() => setFullscreen(value => !value)}>&#9974;</button> : null}
      </div>
    </header>
    <div className="flex shrink-0 items-center gap-2 border-b px-2 py-1" style={border}>
      <button type="button" disabled style={{ ...button, color: GREEN, opacity: .6, fontSize: 13 }}>Enter trade</button>
      <button type="button" disabled style={{ ...button, color: RED, opacity: .6, fontSize: 13 }}>Exit trade</button>
      {showingChart && view === 'portfolio' ? <button type="button" style={button} onClick={showPortfolio}>Back</button> : null}
      {showingChart && selectedJob ? <span>{selectedJob.symbol}</span> : null}
      {stateError ? <span role="alert" style={{ color: RED, fontSize: 12 }}>Connection unavailable</span> : null}
    </div>
    <main className={'trading-layout min-h-0 flex-1' + (showingChart ? ' trading-layout-chart' : '')}>
      <section aria-label={showingChart ? 'Market chart' : view === 'portfolio' ? 'Portfolio' : 'Journal'} className="trading-content relative min-h-0 flex-1 overflow-auto">
        {showingChart && chartSymbol ? <TVChart symbol={chartSymbol} timeframe={timeframe} /> : view === 'portfolio' ? <div className="grid gap-3 p-3" data-testid="trading-portfolio">
          <div className="flex gap-2">
            <button type="button" style={button} aria-pressed={!history} onClick={() => setHistory(false)}>Open</button>
            <button type="button" style={button} aria-pressed={history} onClick={() => setHistory(true)}>Closed</button>
          </div>
          <div aria-label="Trades" data-testid="active-trade-job-grid" className="trading-chart-grid">
            {visibleJobs.map(job => <article key={job.jobId} className="rounded-lg border overflow-hidden" style={border}>
              <button type="button" data-testid={'trade-job-' + job.jobId} className="w-full text-left" style={button} onClick={() => openJob(job)}>
                <strong>{job.symbol}</strong> · {job.action} {money(job.market.currentPrice)}
              </button>
              <div className="trading-tile-chart">
                <LazyTradeChart symbol={job.symbol} timeframe={timeframe} />
                <button type="button" className="trading-chart-open" aria-label={'Open ' + job.symbol + ' chart'} onClick={() => openJob(job)} />
              </div>
              <div className="flex justify-between px-3 py-2 text-xs"><span>{job.position?.side} {job.position?.quantity}</span><span>{money(job.position?.unrealizedPnlUsd ?? job.realizedPnlUsd)}</span></div>
            </article>)}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {([
              ['Value', state?.portfolio.portfolioValueUsd], ['Cash', state?.portfolio.cashUsd],
              ['Buying power', state?.portfolio.buyingPowerUsd], ['P/L', state?.portfolio.dailyPnlUsd],
              ['Realized', state?.portfolio.recordedRealizedPnlUsd], ['Unrealized', state?.portfolio.totalUnrealizedPnlUsd], ['Drawdown', state?.portfolio.maxDrawdownUsd],
            ] as const).filter(([, value]) => value != null).map(([label, value]) => <div key={label} className="rounded-xl border p-3" style={border}><span style={{ color: MUTED }}>{label}</span><div>{money(value)}</div></div>)}
          </div>
          {state?.portfolio.closedTrades ? <div>Win rate {((state.portfolio.wins / state.portfolio.closedTrades) * 100).toFixed(1)}%</div> : null}
          {state?.portfolio.equityCurve.length ? <div className="rounded-xl border p-3" style={border}><span>Equity</span><EquityChart points={state.portfolio.equityCurve} /></div> : null}
          {card ? <dl className="trading-plan-terms">
            <div><dt>Budget</dt><dd>{money(settings.paperBudgetUsd)}</dd></div>
            <div><dt>Risk/reward</dt><dd>{settings.minimumRiskReward}</dd></div>
          </dl> : null}
        </div> : <div className="grid gap-3 p-3" data-testid="trading-journal">
          {(selectedJob ? [selectedJob] : jobs).map(job => <article key={job.jobId} className="trading-plan">
            <button type="button" style={button} onClick={() => openJob(job)}>{job.symbol}</button>
            <PlanTerms job={job} />
            {job.events.map(event => <div key={event.eventId} className="border-t py-2 mt-2" style={{ borderColor: DARK.edge }}>
              <time style={{ color: MUTED, fontSize: 11 }}>{event.createdAt ? new Date(event.createdAt).toLocaleString() : ''}</time>
              <div>{event.action}</div><p>{event.summary}</p>
            </div>)}
            {job.fills.map(fill => <div key={fill.fillId} className="py-2">{fill.side} {fill.quantity} @ {money(fill.price)}</div>)}
          </article>)}
        </div>}
      </section>
      {!fullscreen && showingChart && selectedJob ? <aside aria-label="Trading controls" className="trading-controls min-h-0 overflow-y-auto border-t p-2" style={border}>
        <div data-testid="selected-trade-job" className="grid gap-2">
          {selectedJob.position ? <div className="trading-plan"><strong>{selectedJob.symbol}</strong><div>{selectedJob.position.quantity} {selectedJob.position.side}</div>{money(selectedJob.position.currentPrice)} {money(selectedJob.position.unrealizedPnlUsd)}</div> : null}
          <PlanTerms job={selectedJob} />
          {selectedJob.decisions.map(decision => <article key={decision.decisionId}><strong>{decision.action}</strong><p>{decision.rationale}</p></article>)}
          {selectedJob.orders.map(order => <div key={order.orderId}>{order.side} {order.quantity} {order.symbol} · {order.status}</div>)}
          {selectedJob.fills.map(fill => <div key={fill.fillId}>{fill.side} {fill.quantity} @ {money(fill.price)}</div>)}
          {availableAction ? <>
            {state?.commands.pauseResume.available ? <input aria-label="Reason" value={reason} onChange={event => setReason(event.target.value)} style={button} /> : null}
            <button type="button" style={button} disabled={busy || !reason.trim() || !state?.commands.pauseResume.available} onClick={() => void intervene(availableAction)}>{availableAction}</button>
          </> : null}
          {interventionError ? <span role="alert" style={{ color: RED }}>Action failed</span> : null}
        </div>
      </aside> : null}
    </main>
  </div>;
}
