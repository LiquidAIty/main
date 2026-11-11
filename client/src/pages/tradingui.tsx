/**
 * Entity: Trading
 * Relationship: Presents market and forecast candles, retained model outputs, paper portfolio state, plan and journal evidence, and bounded interventions for the selected Trading Card.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './tradingui.css';
import type { AgentCardInstance } from '../types/agentgraph';
import { applicationFetch } from '../lib/applicationApi';
import { resolveInstrument } from '../features/trading/instrument';
import KronosForecastPanel from '../features/trading/KronosForecastPanel';
import {
  readTradingConfiguration, reconcileTradingState,
  type TradeJob, type TradeDecision, type TradingBacktest, type TradingInterventionAction, type TradingState, type TradingSettings,
} from '../features/trading/tradingState';

const DARK = { bg: '#0a0f1a', panel: '#111827', edge: '#1f2937', ink: '#e5e7eb' };
const GREEN = '#34d399';
const RED = '#fb7185';
const MUTED = '#94a3b8';
const CHART_INTERVALS = { '1Min': '1', '5Min': '5', '15Min': '15', '1Hour': '60', '1Day': 'D' } as const;
function TVChart({ symbol, timeframe, compact = false, locked = false }: { symbol: string; timeframe: TradingSettings['defaultTimeframe']; compact?: boolean; locked?: boolean }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [navigation, setNavigation] = useState<'loading' | 'navigated' | 'failed'>('loading');
  const [attempt, setAttempt] = useState({ key: 0, retries: 0 });
  // This is the same hosted chart that tv.js creates. Mount it directly so
  // Trading does not require third-party script execution in the app document.
  const url = new URL('https://www.tradingview.com/widgetembed/');
  url.searchParams.set('hideideas', '1');
  url.searchParams.set('overrides', '{}');
  url.searchParams.set('enabled_features', '[]');
  url.searchParams.set('disabled_features', JSON.stringify(locked ? ['header_resolutions', 'show_interval_dialog_on_key_press'] : []));
  url.hash = encodeURIComponent(JSON.stringify({
    symbol, interval: CHART_INTERVALS[timeframe], style: '1',
    timezone: 'Etc/UTC', theme: 'dark',
    hide_top_toolbar: compact ? '1' : '0', hide_legend: compact ? '1' : '0',
    allow_symbol_change: compact || locked ? '0' : '1',
  }));
  const src = url.href;
  const stillBlank = () => {
    try { return !frame.current?.contentWindow || frame.current.contentWindow.location.href === 'about:blank'; }
    catch (error) {
      // Leaving our inherited about:blank document makes location cross-origin.
      // This proves navigation only, not that TradingView painted market data.
      return !(error instanceof DOMException && error.name === 'SecurityError');
    }
  };
  useEffect(() => {
    setNavigation('loading');
    const timer = window.setTimeout(() => {
      if (!stillBlank()) { setNavigation('navigated'); return; }
      if (attempt.retries === 0) setAttempt(value => ({ key: value.key + 1, retries: 1 }));
      else setNavigation('failed');
    }, 8000);
    return () => window.clearTimeout(timer);
  }, [src, attempt.key, attempt.retries]);
  return <div className="trading-tv-chart">
    <div className="trading-chart-status">
      <span role={navigation === 'failed' ? 'alert' : 'status'}>{navigation === 'failed' ? 'TradingView did not open. Reload the chart to try again.' : navigation === 'loading' ? (attempt.retries ? 'Retrying blank chart…' : 'Opening TradingView…') : 'TradingView · market data'}</span>
      <button type="button" onClick={() => setAttempt(value => ({ key: value.key + 1, retries: 0 }))}>Reload chart</button>
    </div>
    <iframe ref={frame} key={`${src}:${attempt.key}`} title={`${symbol} chart`} src={src} data-testid="trading-candles"
      allowFullScreen onLoad={() => { if (!stillBlank()) setNavigation('navigated'); }}
      onError={() => setNavigation('failed')} />
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

function JournalDecision({ decision, backtests }: { decision: TradeDecision; backtests: TradingBacktest[] }) {
  const downloadJournal = () => {
    const text = (decision.journalEntries || []).map(entry =>
      `## ${entry.phase} — ${entry.created_at}\n\nAuthor: ${entry.source_execution.profile}\nEntry: ${entry.entry_id}\nDecision: ${entry.decision_id}\n\n${entry.markdown}`,
    ).join('\n\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `journal-${decision.decisionId}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return <article className="border-t py-2 mt-2" style={{ borderColor: DARK.edge }}>
    <time style={{ color: MUTED, fontSize: 11 }}>{new Date(decision.createdAt).toLocaleString()}</time>
    <div><strong>{decision.action}</strong> · {decision.subject}{decision.kind === 'research' ? ' · Research decision' : ''}</div>
    <p>{decision.rationale}</p>
    {decision.missingTerms.length > 0 && <p>Unresolved: {decision.missingTerms.join(' · ')}</p>}
    {!!decision.journalEntries?.length && <section aria-label="Dated trade journal">
      <button type="button" onClick={downloadJournal}>Download journal .md</button>
      {decision.journalWindowComplete === false && <p>Recent entries shown; the full trail remains available through Trading evidence.</p>}
      {decision.journalEntries.map(entry => <details key={entry.entry_id} open={entry.phase === 'BEFORE'}>
        <summary>{entry.phase} · {entry.source_execution.profile} · {new Date(entry.created_at).toLocaleString()}</summary>
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'inherit' }}>{entry.markdown}</pre>
        <details><summary>References</summary><pre className="whitespace-pre-wrap break-all">{JSON.stringify({
          entryId: entry.entry_id, proposalIds: entry.proposal_ids, assessmentIds: entry.assessment_ids,
          evidence: entry.evidence, review: entry.review, execution: entry.source_execution,
        }, null, 2)}</pre></details>
      </details>)}
    </section>}
    {decision.evidence.filter(item => typeof item.backtestId === 'string').map((item, index) => {
      const receipt = backtests.find(result => result.backtestId === item.backtestId);
      return receipt ? <details key={`${item.backtestId}:${index}`}>
        <summary>{receipt.bot} · {receipt.symbols.join(', ')} · {receipt.sourceExecution.profile}</summary>
        <p>Historical simulation · {receipt.start} to {receipt.endExclusive} (exclusive) · No broker orders</p>
        <p>{money(receipt.initialCapital)} → {money(receipt.endingPortfolioValue)}</p>
        <p>Costs per side: {receipt.costs.feeBpsPerSide} bps + {money(receipt.costs.slippagePerSharePerSide)}/share</p>
        <p>Data cutoff: {receipt.dataCutoffExclusive}</p>
        <pre className="whitespace-pre-wrap break-all">{JSON.stringify(receipt, null, 2)}</pre>
      </details> : <p key={`${item.backtestId}:${index}`}>Referenced backtest unavailable: {String(item.backtestId)}</p>;
    })}
    <details><summary>Evidence and provenance</summary>
      <p>Reported confidence: {(decision.confidence * 100).toFixed(0)}% · {decision.sourceExecution.profile}</p>
      <pre className="whitespace-pre-wrap break-all">{JSON.stringify({ evidence: decision.evidence,
        producerCardId: decision.producerCardId, cardRevisionId: decision.cardRevisionId,
        execution: decision.sourceExecution }, null, 2)}</pre>
    </details>
  </article>;
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
  forecastCard?: AgentCardInstance | null;
};

export default function TradingUI({ symbol, projectId, deckId = 'deck_builder', card, forecastCard }: TradingUIProps) {
  const [view, setView] = useState<'ticker' | 'portfolio' | 'journal' | 'forecast'>('ticker');
  const [chartOpen, setChartOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [history, setHistory] = useState(false);
  const [state, setState] = useState<TradingState | null>(null);
  const [stateError, setStateError] = useState(false);
  const [readRevision, setReadRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [interventionError, setInterventionError] = useState(false);
  const [reason, setReason] = useState('');
  const cardId = card?.id || 'card_trading_workbench';
  const settings = readTradingConfiguration(card?.runtimeOptions?.configuration).trading;
  const timeframe = settings.defaultTimeframe;
  const initialSymbol = (symbol || new URLSearchParams(window.location.search).get('symbol') || '').trim().toUpperCase();
  const [market, setMarket] = useState({ symbol: initialSymbol, timeframe });
  const [symbolDraft, setSymbolDraft] = useState(initialSymbol);
  useEffect(() => { setMarket({ symbol: initialSymbol, timeframe }); setSymbolDraft(initialSymbol); }, [initialSymbol, timeframe, projectId, deckId, cardId]);
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
    void applicationFetch('/api/trading/state?' + query, { credentials: 'include', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('trading_state_unavailable');
        const body = await response.json();
        if (!controller.signal.aborted) acceptSnapshot(body as TradingState);
      }).catch(() => { if (!controller.signal.aborted) setStateError(true); });
    return () => controller.abort();
  }, [acceptSnapshot, query, readRevision]);

  const jobs = state?.jobs || [];
  const selectedJob = jobs.find(job => job.jobId === selectedJobId) || null;
  const chartSymbol = selectedJob?.symbol || resolveInstrument(market.symbol)?.tradingViewSymbol || market.symbol;
  const chartTimeframe = selectedJob ? timeframe : market.timeframe;
  const openForecastMarket = (selected: { symbol: string; timeframe: string }) => {
    if (!Object.hasOwn(CHART_INTERVALS, selected.timeframe)) return;
    setMarket({ symbol: selected.symbol, timeframe: selected.timeframe as TradingSettings['defaultTimeframe'] });
    setSymbolDraft(selected.symbol);
  };
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
      const response = await applicationFetch('/api/trading/intervene', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, deckId, cardId, jobId: selectedJob.jobId, action, reason }),
      });
      if (!response.ok) throw new Error('trading_intervention_failed');
      setReason('');
      const updated = await applicationFetch('/api/trading/state?' + query, { credentials: 'include' });
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
        <button type="button" role="tab" aria-selected={view === 'journal'} onClick={() => { setView('journal'); setReadRevision(value => value + 1); }}>Journal</button>
        <button type="button" role="tab" aria-selected={view === 'forecast'} onClick={() => setView('forecast')}>Forecast</button>
      </nav>
      <div className="trading-toolbar-actions">
        {view === 'journal' && <button type="button" style={button} onClick={() => setReadRevision(value => value + 1)}>Refresh journal</button>}
        {showingChart ? <button type="button" style={button} aria-label={fullscreen ? 'Exit Fullscreen' : 'Fullscreen'} onClick={() => setFullscreen(value => !value)}>&#9974;</button> : null}
      </div>
    </header>
    {view !== 'forecast' && <div className="flex shrink-0 items-center gap-2 border-b px-2 py-1" style={border}>
      <button type="button" disabled style={{ ...button, color: GREEN, opacity: .6, fontSize: 13 }}>Enter trade</button>
      <button type="button" disabled style={{ ...button, color: RED, opacity: .6, fontSize: 13 }}>Exit trade</button>
      {showingChart && view === 'portfolio' ? <button type="button" style={button} onClick={showPortfolio}>Back</button> : null}
      {showingChart && selectedJob ? <span>{selectedJob.symbol}</span> : null}
      {stateError ? <span role="alert" style={{ color: RED, fontSize: 12 }}>Connection unavailable</span> : null}
    </div>}
    {view === 'forecast' || (view === 'ticker' && !chartSymbol) ? <form className="trading-market-controls" onSubmit={event => { event.preventDefault(); if (symbolDraft.trim()) setMarket(value => ({ ...value, symbol: symbolDraft.trim().toUpperCase() })); }}>
      <label>Ticker<input aria-label="Trading ticker" required maxLength={32} value={symbolDraft} onChange={event => setSymbolDraft(event.target.value.toUpperCase())} /></label>
      <button type="submit">Load ticker</button>
      <label>Timeframe<select aria-label="Trading timeframe" value={market.timeframe} onChange={event => setMarket(value => ({ ...value, timeframe: event.target.value as TradingSettings['defaultTimeframe'] }))}>{Object.keys(CHART_INTERVALS).map(value => <option key={value}>{value}</option>)}</select></label>
    </form> : null}
    <main className={'trading-layout min-h-0 flex-1' + (showingChart ? ' trading-layout-chart' : '') + (view === 'forecast' ? ' trading-layout-forecast' : '')}>
      <section aria-label={showingChart ? 'Market chart' : view === 'portfolio' ? 'Portfolio' : view === 'forecast' ? 'Forecast' : 'Journal'} className={'trading-content relative min-h-0 flex-1 ' + (view === 'forecast' ? 'trading-forecast-content' : 'overflow-auto')}>
        <div hidden={!showingChart} className="trading-main-chart">
          {chartSymbol ? <TVChart key={`${chartSymbol}:${chartTimeframe}`} symbol={chartSymbol} timeframe={chartTimeframe} locked={!!selectedJob} /> : <p>Choose a ticker to open its chart.</p>}
        </div>
        {view === 'forecast' && <div className="trading-forecast-section">
          {projectId && forecastCard ? <KronosForecastPanel key={`${projectId}:${deckId}:${forecastCard.id}`} projectId={projectId} deckId={deckId} cardId={forecastCard.id} symbol={market.symbol} timeframe={market.timeframe} onOpenForecast={openForecastMarket} /> : <p>Select a Project with one enabled forecast Card.</p>}
        </div>}
        {!showingChart && view === 'portfolio' ? <div className="grid gap-3 p-3" data-testid="trading-portfolio">
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
        </div> : view === 'journal' ? <div className="grid gap-3 p-3" data-testid="trading-journal">
          {!selectedJob && state?.researchDecisions.map(decision =>
            <JournalDecision key={decision.decisionId} decision={decision} backtests={state.backtests} />)}
          {(selectedJob ? [selectedJob] : jobs).map(job => <article key={job.jobId} className="trading-plan">
            <button type="button" style={button} onClick={() => openJob(job)}>{job.symbol}</button>
            <PlanTerms job={job} />
            {job.decisions.map(decision => <JournalDecision key={decision.decisionId} decision={decision} backtests={state?.backtests || []} />)}
            {job.events.filter(event => event.kind !== 'decision').map(event => <div key={event.eventId} className="border-t py-2 mt-2" style={{ borderColor: DARK.edge }}>
              <time style={{ color: MUTED, fontSize: 11 }}>{event.createdAt ? new Date(event.createdAt).toLocaleString() : ''}</time>
              <div>{event.action}</div><p>{event.summary}</p>
            </div>)}
            {job.fills.map(fill => <div key={fill.fillId} className="py-2">{fill.side} {fill.quantity} @ {money(fill.price)}</div>)}
          </article>)}
        </div> : null}
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
