import React, { useCallback, useEffect, useMemo, useState } from 'react';

import type { AgentCardInstance } from '../types/agentgraph';
import {
  DEFAULT_TRADING_CONFIGURATION,
  type EquityPoint,
  type MarketBar,
  type PaperPosition,
  readTradingConfiguration,
  reconcileTradingState,
  type TradeAction,
  type TradeFill,
  type TradeJob,
  type TradingInterventionAction,
  type TradingLifecycleProof,
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

type TradingTab = 'overview' | 'jobs' | 'history' | 'evidence';
type StreamStatus = 'connecting' | 'live' | 'disconnected' | 'unavailable';
type TradingUIProps = {
  symbol?: string;
  projectId?: string | null;
  deckId?: string;
  card?: AgentCardInstance | null;
  onInspectorRequest?: () => void;
};

const TIMEFRAMES = ['1Min', '5Min', '15Min', '1Hour', '1Day'] as const;

function statusColor(action: TradeAction): string {
  if (action === 'ENTER' || action === 'HOLD') return GREEN;
  if (action === 'REDUCE' || action === 'WAIT' || action === 'PAUSE') return AMBER;
  if (action === 'EXIT' || action === 'FAIL_SAFE') return RED;
  return '#9aaec7';
}

function money(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'Unavailable';
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 2,
  }).format(value);
}

function number(value: number | null | undefined, suffix = ''): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'Unavailable';
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 4 })}${suffix}`;
}

function shortTime(value: string | null | undefined): string {
  if (!value) return 'Unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function toneForValue(value: number | null | undefined): string {
  if (value === null || value === undefined) return MUTED;
  return value >= 0 ? GREEN : RED;
}

function Badge({ children, color = MUTED }: { children: React.ReactNode; color?: string }) {
  return <span style={{ background: `${color}13`, border: `1px solid ${color}55`, borderRadius: 999,
    color, fontSize: 10, fontWeight: 800, letterSpacing: '.05em', padding: '5px 8px', whiteSpace: 'nowrap' }}>{children}</span>;
}

function Metric({ label, value, tone = INK, detail }: {
  label: string; value: React.ReactNode; tone?: string; detail?: string;
}) {
  return <div style={{ background: PANEL_2, border: `1px solid ${EDGE}`, borderRadius: 12,
    minWidth: 122, padding: '10px 12px' }}>
    <div style={{ color: MUTED, fontSize: 9, letterSpacing: '.09em', textTransform: 'uppercase' }}>{label}</div>
    <div style={{ color: tone, fontSize: 17, fontWeight: 780, marginTop: 4 }}>{value}</div>
    {detail ? <div style={{ color: MUTED, fontSize: 9, marginTop: 3 }}>{detail}</div> : null}
  </div>;
}

function chartMessage(job: TradeJob): string {
  if (job.market.status === 'not_requested') return job.market.diagnostics || 'Market evidence not requested';
  if (job.market.status === 'provider_unconfigured') return 'Paper market-data credentials are not configured';
  if (job.market.status !== 'available' && job.market.status !== 'empty') {
    return job.market.diagnostics || `Market data ${job.market.status}`;
  }
  return 'No candles were returned for this real market-data window';
}

function nearestBarIndex(bars: MarketBar[], timestamp: string | null): number | null {
  const target = timestamp ? Date.parse(timestamp) : Number.NaN;
  if (!Number.isFinite(target) || bars.length === 0) return null;
  let best = 0;
  let distance = Number.POSITIVE_INFINITY;
  bars.forEach((bar, index) => {
    const current = Math.abs(Date.parse(bar.timestamp) - target);
    if (Number.isFinite(current) && current < distance) {
      distance = current;
      best = index;
    }
  });
  return best;
}

function CandleChart({ job, height, compact = false }: {
  job: TradeJob; height: number; compact?: boolean;
}) {
  const bars = job.market.bars || [];
  if (bars.length === 0) {
    return <div aria-label={`${job.symbol} candle chart unavailable`} style={{ alignItems: 'center',
      background: '#08131c', color: MUTED, display: 'flex', fontSize: compact ? 10 : 12,
      height, justifyContent: 'center', padding: 14, textAlign: 'center' }}>{chartMessage(job)}</div>;
  }
  const width = compact ? 360 : 900;
  const padX = compact ? 6 : 24;
  const padY = compact ? 6 : 18;
  const markerPrices = job.fills.map((fill) => fill.price).filter((value): value is number => value !== null);
  const prices = bars.flatMap((bar) => [bar.high, bar.low]).concat(markerPrices);
  if (job.market.currentPrice !== null) prices.push(job.market.currentPrice);
  const high = Math.max(...prices);
  const low = Math.min(...prices);
  const range = Math.max(high - low, 0.000001);
  const step = (width - padX * 2) / bars.length;
  const candleWidth = Math.max(1.2, Math.min(compact ? 7 : 12, step * .62));
  const y = (value: number) => padY + ((high - value) / range) * (height - padY * 2);
  return <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none"
    aria-label={`${job.symbol} real ${job.market.timeframe} candle chart`}
    style={{ background: '#08131c', display: 'block', height, width: '100%' }}>
    {[.25, .5, .75].map((ratio) => <line key={ratio} x1={0} y1={height * ratio}
      x2={width} y2={height * ratio} stroke="#19313e" strokeWidth={1} />)}
    {bars.map((bar, index) => {
      const x = padX + index * step + step / 2;
      const color = bar.close >= bar.open ? GREEN : RED;
      const top = Math.min(y(bar.open), y(bar.close));
      return <g key={bar.timestamp}>
        <line x1={x} y1={y(bar.high)} x2={x} y2={y(bar.low)} stroke={color} />
        <rect x={x - candleWidth / 2} y={top} width={candleWidth}
          height={Math.max(1.5, Math.abs(y(bar.open) - y(bar.close)))} rx={.5} fill={color} />
      </g>;
    })}
    {job.market.currentPrice !== null ? <g>
      <line x1={0} y1={y(job.market.currentPrice)} x2={width}
        y2={y(job.market.currentPrice)} stroke={CYAN} strokeDasharray="4 4" />
      {!compact ? <text x={width - 6} y={y(job.market.currentPrice) - 5}
        fill={CYAN} fontSize={11} textAnchor="end">{job.market.currentPrice.toFixed(2)}</text> : null}
    </g> : null}
    {!compact ? job.fills.map((fill: TradeFill) => {
      const index = nearestBarIndex(bars, fill.timestamp);
      if (index === null || fill.price === null) return null;
      const x = padX + index * step + step / 2;
      const fillColor = String(fill.side).toLowerCase().includes('buy') ? GREEN : RED;
      return <g key={fill.fillId}>
        <circle cx={x} cy={y(fill.price)} r={6} fill={fillColor} stroke={INK} strokeWidth={1.5} />
        <text x={x + 9} y={y(fill.price) - 7} fill={fillColor} fontSize={10}>
          {String(fill.side || 'fill').toUpperCase()} {fill.price.toFixed(2)}
        </text>
      </g>;
    }) : null}
  </svg>;
}

function ReplayCandleChart({ proof }: { proof: TradingLifecycleProof }) {
  const bars = proof.bars || [];
  if (!bars.length) return <div style={{ alignItems: 'center', color: MUTED, display: 'flex',
    height: 190, justifyContent: 'center' }}>No replay bars were recorded.</div>;
  const width = 760;
  const height = 190;
  const high = Math.max(...bars.map((bar) => bar.high));
  const low = Math.min(...bars.map((bar) => bar.low));
  const range = Math.max(high - low, .000001);
  const step = (width - 28) / bars.length;
  const y = (value: number) => 12 + ((high - value) / range) * (height - 24);
  return <svg data-testid="lumibot-proof-candles" viewBox={`0 0 ${width} ${height}`}
    preserveAspectRatio="none" aria-label={`${proof.symbol} LumiBot local replay candles`}
    style={{ background: '#08131c', display: 'block', height, width: '100%' }}>
    {[.25, .5, .75].map((ratio) => <line key={ratio} x1={0} y1={height * ratio}
      x2={width} y2={height * ratio} stroke="#19313e" strokeWidth={1} />)}
    {bars.map((bar, index) => {
      const x = 14 + index * step + step / 2;
      const color = bar.close >= bar.open ? GREEN : RED;
      const top = Math.min(y(bar.open), y(bar.close));
      return <g key={bar.timestamp}>
        <line x1={x} y1={y(bar.high)} x2={x} y2={y(bar.low)} stroke={color} />
        <rect x={x - Math.min(10, step * .3)} y={top} width={Math.min(20, step * .6)}
          height={Math.max(2, Math.abs(y(bar.open) - y(bar.close)))} fill={color} />
      </g>;
    })}
  </svg>;
}

function LifecycleProofPanel({ proof }: { proof: TradingLifecycleProof | null | undefined }) {
  if (!proof) return <section data-testid="lumibot-proof-empty" style={{ background: PANEL,
    border: `1px dashed ${EDGE}`, borderRadius: 16, color: MUTED, padding: 16 }}>
    <strong style={{ color: INK }}>No bounded LumiBot lifecycle proof is recorded.</strong>
    <p style={{ fontSize: 10, lineHeight: 1.5, margin: '6px 0 0' }}>Run local proof executes a fixed,
      credential-free Pandas replay through LumiBot’s public Trader and Strategy. It cannot select a
      live broker or call a LumiBot model provider.</p>
  </section>;
  const portfolio = proof.portfolio;
  return <section data-testid="lumibot-lifecycle-proof" style={{ background: PANEL,
    border: `1px solid ${proof.status === 'completed' ? GREEN : proof.status === 'failed' ? RED : AMBER}66`,
    borderRadius: 16, overflow: 'hidden' }}>
    <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8,
      justifyContent: 'space-between', padding: '12px 14px' }}>
      <div><h2 style={{ fontSize: 14, margin: 0 }}>Latest bounded LumiBot lifecycle</h2>
        <span style={{ color: MUTED, fontSize: 10 }}>{proof.mode} · {proof.symbol} · Run {proof.lifecycleRunId}</span></div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}><Badge color={proof.status === 'completed' ? GREEN : AMBER}>{proof.status}</Badge>
        <Badge color={proof.liveOrders ? RED : GREEN}>{proof.liveOrders ? 'Live orders detected' : 'No live orders'}</Badge>
        <Badge color={proof.modelProviderCalls ? RED : GREEN}>{proof.modelProviderCalls ? 'Provider call detected' : 'No LumiBot AI calls'}</Badge></div>
    </div>
    {proof.status === 'completed' && portfolio ? <>
      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(128px, 1fr))', padding: '0 14px 12px' }}>
        <Metric label="Replay portfolio" value={money(portfolio.portfolioValueUsd)} />
        <Metric label="Replay P/L" value={money(portfolio.profitLossUsd)} tone={toneForValue(portfolio.profitLossUsd)} />
        <Metric label="Replay drawdown" value={`${portfolio.maxDrawdownPercent.toFixed(4)}%`} tone={toneForValue(portfolio.maxDrawdownUsd)} />
        <Metric label="Lifecycle events" value={proof.events.length} />
        <Metric label="Artifacts" value={proof.artifacts.length} />
        <Metric label="Replay bars" value={proof.dataProvenance.barCount ?? proof.bars?.length ?? 0} />
      </div>
      <ReplayCandleChart proof={proof} />
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', padding: 14 }}>
        <div><strong style={{ fontSize: 11 }}>Actual public lifecycle events</strong>
          {proof.events.slice(-8).map((event) => <div key={event.eventId} style={{ borderTop: `1px solid ${EDGE}`,
            fontSize: 10, padding: '7px 0' }}><strong>{event.action} · {event.kind}</strong>
            <div style={{ color: MUTED, marginTop: 2 }}>{event.summary} · {shortTime(event.createdAt)}</div></div>)}</div>
        <div><strong style={{ fontSize: 11 }}>Generated artifacts</strong>
          {proof.artifacts.map((artifact) => <div key={artifact.artifactId} style={{ borderTop: `1px solid ${EDGE}`,
            fontSize: 10, padding: '7px 0' }}><strong>{artifact.kind}</strong>
            <div style={{ color: CYAN, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{artifact.locator}</div>
            <div style={{ color: MUTED }}>{artifact.sizeBytes?.toLocaleString() || 0} bytes · SHA-256 {artifact.contentSha256?.slice(0, 12)}…</div></div>)}</div>
      </div>
    </> : <div style={{ color: proof.status === 'failed' ? RED : MUTED, padding: 14 }}>
      {proof.errorCode || 'The bounded lifecycle is still running.'}
    </div>}
  </section>;
}

function pathPoints(points: EquityPoint[], field: 'valueUsd' | 'drawdownUsd', width: number, height: number): string {
  if (!points.length) return '';
  const values = points.map((point) => point[field]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 1);
  return points.map((point, index) => {
    const x = 12 + (index / Math.max(points.length - 1, 1)) * (width - 24);
    const y = 10 + ((max - point[field]) / range) * (height - 20);
    return `${x},${y}`;
  }).join(' ');
}

function PortfolioHistoryChart({ points }: { points: EquityPoint[] }) {
  if (!points.length) return <div style={{ alignItems: 'center', color: MUTED, display: 'flex',
    height: 230, justifyContent: 'center', padding: 24, textAlign: 'center' }}>
    Historical paper-account equity and drawdown are unavailable from the current broker connection.
  </div>;
  const width = 760;
  return <svg viewBox={`0 0 ${width} 230`} preserveAspectRatio="none"
    aria-label="Historical paper portfolio equity and drawdown" style={{ display: 'block', height: 230, width: '100%' }}>
    <rect x={0} y={0} width={width} height={145} fill="#08131c" />
    <rect x={0} y={151} width={width} height={79} fill="#0a151d" />
    <polyline points={pathPoints(points, 'valueUsd', width, 135)} fill="none" stroke={CYAN}
      strokeWidth={3} vectorEffect="non-scaling-stroke" />
    <polyline points={pathPoints(points, 'drawdownUsd', width, 68)} transform="translate(0 154)"
      fill="none" stroke={RED} strokeWidth={2} vectorEffect="non-scaling-stroke" />
    <text x={12} y={20} fill={MUTED} fontSize={10}>EQUITY</text>
    <text x={12} y={172} fill={MUTED} fontSize={10}>DRAWDOWN</text>
  </svg>;
}

function PnlContributionChart({ positions, jobs }: { positions: PaperPosition[]; jobs: TradeJob[] }) {
  const items = [
    ...positions.filter((position) => position.unrealizedPnlUsd !== null).map((position) => ({
      id: `position:${position.symbol}:${position.strategy || ''}`,
      label: `${position.symbol} unrealized`, value: position.unrealizedPnlUsd || 0,
    })),
    ...jobs.filter((job) => job.realizedPnlUsd !== null).slice(0, 12).map((job) => ({
      id: `job:${job.jobId}`, label: `${job.symbol} realized`, value: job.realizedPnlUsd || 0,
    })),
  ];
  if (!items.length) return <div style={{ alignItems: 'center', color: MUTED, display: 'flex',
    minHeight: 230, justifyContent: 'center', padding: 24, textAlign: 'center' }}>
    Combined realized and unrealized P/L contributions will appear when the paper broker or a closed Trade Job supplies them.
  </div>;
  const maximum = Math.max(1, ...items.map((item) => Math.abs(item.value)));
  return <div aria-label="Combined portfolio profit and loss contributions" style={{ display: 'grid', gap: 8, padding: 14 }}>
    {items.map((item) => {
      const width = Math.max(2, Math.abs(item.value) / maximum * 48);
      const positive = item.value >= 0;
      return <div key={item.id} style={{ alignItems: 'center', display: 'grid', gap: 8,
        gridTemplateColumns: 'minmax(80px, 120px) 1fr 78px', minWidth: 0 }}>
        <span style={{ color: MUTED, fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
        <div style={{ background: '#08131c', height: 15, position: 'relative' }}>
          <span style={{ background: EDGE, height: '100%', left: '50%', position: 'absolute', width: 1 }} />
          <span style={{ background: positive ? GREEN : RED, borderRadius: 3, height: 9,
            left: positive ? '50%' : `${50 - width}%`, position: 'absolute', top: 3,
            width: `${width}%` }} />
        </div>
        <strong style={{ color: positive ? GREEN : RED, fontSize: 10, textAlign: 'right' }}>{money(item.value)}</strong>
      </div>;
    })}
  </div>;
}

function TradeJobCard({ job, chartHeight, onSelect }: {
  job: TradeJob;
  chartHeight: number;
  onSelect: () => void;
}) {
  const lastDecision = job.decisions[0] || null;
  const side = job.position?.side || job.plan.allowedDirections?.join('/') || 'Unavailable';
  const stop = job.plan.stopConditions?.join(' · ') || 'Unavailable';
  const target = job.plan.exitConditions?.join(' · ') || 'Unavailable';
  return <button type="button" data-testid={`trade-job-${job.jobId}`} onClick={onSelect}
    style={{ background: PANEL, border: `1px solid ${EDGE}`, borderRadius: 14, color: INK,
      cursor: 'pointer', minWidth: 0, overflow: 'hidden', padding: 0, textAlign: 'left', width: '100%' }}>
    <div style={{ alignItems: 'center', display: 'flex', gap: 8, justifyContent: 'space-between', padding: '9px 10px 7px' }}>
      <div><strong style={{ fontSize: 14 }}>{job.symbol}</strong><span style={{ color: MUTED, fontSize: 10, marginLeft: 7 }}>{side}</span></div>
      <Badge color={statusColor(job.action)}>{job.action}</Badge>
    </div>
    <CandleChart job={job} compact height={chartHeight} />
    <div style={{ display: 'grid', gap: '4px 8px', gridTemplateColumns: '1fr 1fr', padding: '8px 10px 10px' }}>
      <span style={{ color: MUTED, fontSize: 10 }}>Qty / entry</span><span style={{ fontSize: 10, textAlign: 'right' }}>{number(job.position?.quantity)} / {money(job.position?.averageEntryPrice)}</span>
      <span style={{ color: MUTED, fontSize: 10 }}>Current / P&amp;L</span><span style={{ color: toneForValue(job.position?.unrealizedPnlUsd), fontSize: 10, textAlign: 'right' }}>{money(job.market.currentPrice)} / {money(job.position?.unrealizedPnlUsd)}</span>
      <span style={{ color: MUTED, fontSize: 10 }}>State / decision</span><span style={{ fontSize: 10, textAlign: 'right' }}>{job.state} / {lastDecision?.action || job.action}</span>
      <span style={{ color: MUTED, fontSize: 10 }}>Stop</span><span title={stop} style={{ fontSize: 10, overflow: 'hidden', textAlign: 'right', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{stop}</span>
      <span style={{ color: MUTED, fontSize: 10 }}>Target</span><span title={target} style={{ fontSize: 10, overflow: 'hidden', textAlign: 'right', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{target}</span>
      <span style={{ color: MUTED, fontSize: 10 }}>Updated</span><span style={{ fontSize: 10, textAlign: 'right' }}>{shortTime(job.updatedAt)}</span>
    </div>
  </button>;
}

function PlanList({ label, values }: { label: string; values: string[] | undefined }) {
  return <div><strong style={{ color: MUTED, display: 'block', fontSize: 9, letterSpacing: '.08em', textTransform: 'uppercase' }}>{label}</strong>
    <div style={{ fontSize: 11, lineHeight: 1.45, marginTop: 3 }}>{values?.length ? values.join(' · ') : 'Unavailable'}</div></div>;
}

function JobDetail({ job, timeframe, onTimeframe, onBack, onIntervene, busy, commands }: {
  job: TradeJob; timeframe: typeof TIMEFRAMES[number];
  onTimeframe: (value: typeof TIMEFRAMES[number]) => void; onBack: () => void;
  onIntervene: (action: TradingInterventionAction, reason: string) => Promise<void>; busy: boolean;
  commands: TradingState['commands'];
}) {
  const [reason, setReason] = useState('');
  const availableAction: TradingInterventionAction | null = job.state === 'monitoring'
    ? 'PAUSE' : job.state === 'paused' ? 'RESUME' : null;
  return <div data-testid="selected-trade-job" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
    <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' }}>
      <button type="button" onClick={onBack} style={{ background: PANEL, border: `1px solid ${EDGE}`, borderRadius: 9, color: INK, cursor: 'pointer', padding: '7px 10px' }}>← All active Trade Jobs</button>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {TIMEFRAMES.map((value) => <button key={value} type="button" onClick={() => onTimeframe(value)}
          style={{ background: timeframe === value ? '#17333d' : PANEL, border: `1px solid ${timeframe === value ? CYAN : EDGE}`,
            borderRadius: 8, color: timeframe === value ? CYAN : MUTED, cursor: 'pointer', fontSize: 10, padding: '6px 8px' }}>{value}</button>)}
      </div>
    </div>
    <section style={{ background: PANEL, border: `1px solid ${EDGE}`, borderRadius: 16, overflow: 'hidden' }}>
      <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between', padding: '11px 13px' }}>
        <div><strong>{job.symbol}</strong><span style={{ color: MUTED, fontSize: 11, marginLeft: 8 }}>{job.market.provider || 'No provider'} · {job.market.timeframe}</span></div><Badge color={statusColor(job.action)}>{job.action}</Badge>
      </div>
      <CandleChart job={job} height={390} />
    </section>
    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(285px, 1fr))' }}>
      <section style={{ background: PANEL, border: `1px solid ${EDGE}`, borderRadius: 14, padding: 13 }}>
        <h3 style={{ fontSize: 13, margin: '0 0 10px' }}>Position and deterministic risk</h3>
        <dl style={{ display: 'grid', fontSize: 11, gap: 7, gridTemplateColumns: '1fr 1fr', margin: 0 }}>
          <dt style={{ color: MUTED }}>Side / quantity</dt><dd style={{ margin: 0, textAlign: 'right' }}>{job.position?.side || job.plan.allowedDirections?.join('/') || 'Unavailable'} / {number(job.position?.quantity)}</dd>
          <dt style={{ color: MUTED }}>Entry / current</dt><dd style={{ margin: 0, textAlign: 'right' }}>{money(job.position?.averageEntryPrice)} / {money(job.market.currentPrice)}</dd>
          <dt style={{ color: MUTED }}>Unrealized / realized</dt><dd style={{ color: toneForValue(job.position?.unrealizedPnlUsd), margin: 0, textAlign: 'right' }}>{money(job.position?.unrealizedPnlUsd)} / {money(job.realizedPnlUsd)}</dd>
          <dt style={{ color: MUTED }}>Budget / max loss</dt><dd style={{ margin: 0, textAlign: 'right' }}>{money(job.budgetCeilingUsd)} / {money(job.maxLossUsd)}</dd>
          <dt style={{ color: MUTED }}>Risk / reward</dt><dd style={{ margin: 0, textAlign: 'right' }}>{number(job.plan.expectedRiskReward, '×')}</dd>
          <dt style={{ color: MUTED }}>State / execution</dt><dd style={{ color: job.executionState.includes('blocked') ? AMBER : INK, margin: 0, textAlign: 'right' }}>{job.state} / {job.executionState}</dd>
        </dl>
        <div style={{ display: 'grid', gap: 9, marginTop: 12 }}>
          <PlanList label="Entry" values={job.plan.entryConditions} /><PlanList label="Stop" values={job.plan.stopConditions} />
          <PlanList label="Target / exit" values={job.plan.exitConditions} /><PlanList label="Invalidation" values={job.plan.invalidationConditions} />
          <PlanList label="Evidence requirements" values={job.plan.dataRequirements} />
        </div>
      </section>
      <section style={{ background: PANEL, border: `1px solid ${EDGE}`, borderRadius: 14, padding: 13 }}>
        <h3 style={{ fontSize: 13, margin: '0 0 8px' }}>Authorized intervention</h3>
        <p style={{ color: MUTED, fontSize: 10, lineHeight: 1.4, margin: '0 0 9px' }}>Pause and resume are enabled only when a real LumiBot Trader lifecycle is attached. They never submit an order.</p>
        <textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Reason required" rows={3}
          style={{ background: '#07121a', border: `1px solid ${EDGE}`, borderRadius: 9, color: INK, padding: 9, resize: 'vertical', width: '100%' }} />
        <button type="button" disabled={busy || !reason.trim() || !availableAction || !commands.pauseResume.available}
          onClick={() => availableAction && void onIntervene(availableAction, reason).then(() => setReason(''))}
          style={{ background: '#2d342c', border: `1px solid ${AMBER}66`, borderRadius: 8, color: AMBER,
            cursor: busy || !reason.trim() || !availableAction || !commands.pauseResume.available ? 'not-allowed' : 'pointer', fontSize: 10,
            fontWeight: 800, marginTop: 8, opacity: busy || !reason.trim() || !availableAction || !commands.pauseResume.available ? .5 : 1, padding: '9px 12px', width: '100%' }}>
          {availableAction || 'PAUSE / RESUME UNAVAILABLE FOR THIS STATE'}
        </button>
        <div style={{ background: '#171b20', border: `1px solid ${EDGE}`, borderRadius: 9, color: MUTED, fontSize: 10, lineHeight: 1.45, marginTop: 9, padding: 9 }}>
          <strong style={{ color: RED }}>Paper exit unavailable:</strong> {commands.exit.reason || 'No authorized command'}<br />
          <strong style={{ color: RED }}>Cancel unavailable:</strong> {commands.cancel.reason || 'No authorized command'}
        </div>
      </section>
    </div>
    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
      <section style={{ background: PANEL, border: `1px solid ${EDGE}`, borderRadius: 14, padding: 13 }}>
        <h3 style={{ fontSize: 13, margin: '0 0 8px' }}>Orders and fills</h3>
        {job.orders.length ? job.orders.map((order) => <div key={order.orderId} style={{ borderTop: `1px solid ${EDGE}`, fontSize: 10, padding: '8px 0' }}>
          <strong>{order.side} {number(order.quantity)} {order.symbol}</strong><span style={{ color: MUTED }}> · {order.type} · {order.status}</span><div style={{ color: MUTED, marginTop: 3 }}>Fill {number(order.filledQuantity)} @ {money(order.averageFillPrice)} · {shortTime(order.filledAt || order.updatedAt)}</div>
        </div>) : <p style={{ color: MUTED, fontSize: 10 }}>No broker order is deterministically linked to this Trade Job. Existing account orders are not matched by symbol alone.</p>}
      </section>
      <section style={{ background: PANEL, border: `1px solid ${EDGE}`, borderRadius: 14, padding: 13 }}>
        <h3 style={{ fontSize: 13, margin: '0 0 8px' }}>Lifecycle events and failures</h3>
        <p style={{ color: job.lifecycle.status === 'broker_observed' ? GREEN : MUTED, fontSize: 10 }}>{job.lifecycle.diagnostics || job.lifecycle.status}</p>
        {job.events.length ? job.events.map((event) => <div key={event.eventId} style={{ borderTop: `1px solid ${EDGE}`, fontSize: 10, padding: '8px 0' }}><strong>{event.source} · {event.action}</strong><div style={{ color: MUTED, marginTop: 3 }}>{event.summary} · {shortTime(event.createdAt)}</div></div>) : <p style={{ color: MUTED, fontSize: 10 }}>No recorded lifecycle events.</p>}
      </section>
      <section style={{ background: PANEL, border: `1px solid ${EDGE}`, borderRadius: 14, padding: 13 }}>
        <h3 style={{ fontSize: 13, margin: '0 0 8px' }}>Hermes decisions and evidence</h3>
        {job.decisions.length ? job.decisions.map((decision) => <details key={decision.decisionId} style={{ borderTop: `1px solid ${EDGE}`, padding: '8px 0' }}><summary style={{ color: statusColor(decision.action), cursor: 'pointer', fontSize: 10, fontWeight: 800 }}>{decision.action} · {(decision.confidence * 100).toFixed(0)}% · {shortTime(decision.createdAt)}</summary><p style={{ fontSize: 10, lineHeight: 1.45 }}>{decision.rationale}</p><pre style={{ background: '#07121a', borderRadius: 8, color: MUTED, fontSize: 9, overflow: 'auto', padding: 8 }}>{JSON.stringify({ evidence: decision.evidence, missingTerms: decision.missingTerms }, null, 2)}</pre></details>) : <p style={{ color: MUTED, fontSize: 10 }}>No Hermes decision evidence recorded.</p>}
      </section>
      <section style={{ background: PANEL, border: `1px solid ${EDGE}`, borderRadius: 14, padding: 13 }}>
        <h3 style={{ fontSize: 13, margin: '0 0 8px' }}>Run artifacts</h3>
        {job.artifacts.length ? job.artifacts.map((artifact) => <div key={artifact.artifactId} style={{ borderTop: `1px solid ${EDGE}`, fontSize: 10, padding: '8px 0' }}><strong>{artifact.kind}</strong><div title={artifact.locator} style={{ color: CYAN, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{artifact.locator}</div><div style={{ color: MUTED, marginTop: 3 }}>{artifact.sizeBytes === null ? 'Size unavailable' : `${artifact.sizeBytes.toLocaleString()} bytes`} · {shortTime(artifact.createdAt)}</div></div>) : <p style={{ color: MUTED, fontSize: 10 }}>No backtest, trace, or report artifact is attached to this job’s source Run.</p>}
      </section>
    </div>
  </div>;
}

export default function TradingUI({
  symbol,
  projectId,
  deckId = 'deck_builder',
  card,
  onInspectorRequest,
}: TradingUIProps) {
  const explicitSymbol = String(symbol || '').trim().toUpperCase() || null;
  const cardId = card?.id || CARD_ID;
  const [tab, setTab] = useState<TradingTab>('overview');
  const [timeframe, setTimeframe] = useState(() => readTradingConfiguration(
    card?.runtimeOptions?.configuration || DEFAULT_TRADING_CONFIGURATION,
  ).trading.defaultTimeframe);
  const [state, setState] = useState<TradingState | null>(null);
  const [stateError, setStateError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>('connecting');
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [interventionBusy, setInterventionBusy] = useState(false);
  const [interventionError, setInterventionError] = useState<string | null>(null);
  const [proofBusy, setProofBusy] = useState(false);
  const [proofError, setProofError] = useState<string | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const configuration = useMemo(() => readTradingConfiguration(
    card?.runtimeOptions?.configuration || DEFAULT_TRADING_CONFIGURATION,
  ), [card?.runtimeOptions?.configuration]);

  const query = useMemo(() => {
    if (!projectId || !cardId) return null;
    const params = new URLSearchParams({ projectId, deckId, cardId, timeframe });
    if (selectedJobId) params.set('selectedJobId', selectedJobId);
    return params.toString();
  }, [cardId, deckId, projectId, selectedJobId, timeframe]);

  const acceptSnapshot = useCallback((incoming: TradingState) => {
    if (incoming?.cardId !== cardId) throw new Error('trading_snapshot_card_identity_mismatch');
    setState((current) => reconcileTradingState(current, incoming));
    setStateError(null);
  }, [cardId]);

  const readState = useCallback(async () => {
    if (!query) { setState(null); setStateError(null); setStreamStatus('unavailable'); return; }
    setLoading(true);
    try {
      const response = await fetch(`/api/trading/state?${query}`, { credentials: 'include' });
      const body = await response.json();
      if (!response.ok) throw new Error(String(body?.error || body?.detail || `trading_state_${response.status}`));
      acceptSnapshot(body as TradingState);
    } catch (reason: unknown) {
      setStateError(reason instanceof Error ? reason.message : 'Trading state unavailable');
    } finally { setLoading(false); }
  }, [acceptSnapshot, query]);

  useEffect(() => { void readState(); }, [readState]);
  useEffect(() => {
    if (!query || typeof EventSource === 'undefined') { setStreamStatus('unavailable'); return; }
    setStreamStatus('connecting');
    const stream = new EventSource(`/api/trading/events?${query}`, { withCredentials: true });
    stream.onopen = () => setStreamStatus('live');
    stream.addEventListener('snapshot', (event) => {
      try { acceptSnapshot(JSON.parse((event as MessageEvent).data) as TradingState); }
      catch (error) { setStateError(error instanceof Error ? error.message : 'Trading event invalid'); }
    });
    stream.addEventListener('transport_error', (event) => {
      try { setStateError(String(JSON.parse((event as MessageEvent).data)?.error || 'Trading event read failed')); }
      catch { setStateError('Trading event read failed'); }
    });
    stream.onerror = () => setStreamStatus('disconnected');
    return () => stream.close();
  }, [acceptSnapshot, query]);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, []);

  const jobs = state?.jobs || [];
  const activeJobs = jobs.filter((job) => !['completed', 'fail_safe'].includes(job.state));
  const closedJobs = jobs.filter((job) => ['completed', 'fail_safe'].includes(job.state));
  const selectedJob = jobs.find((job) => job.jobId === selectedJobId) || null;
  useEffect(() => {
    if (selectedJobId && !jobs.some((job) => job.jobId === selectedJobId)) setSelectedJobId(null);
  }, [jobs, selectedJobId]);

  const intervene = async (action: TradingInterventionAction, reason: string) => {
    if (!projectId || !selectedJob) return;
    setInterventionBusy(true);
    setInterventionError(null);
    try {
      const response = await fetch('/api/trading/intervene', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, deckId, cardId, jobId: selectedJob.jobId, action, reason }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(String(body?.error || body?.detail || `trading_intervention_${response.status}`));
      await readState();
    } catch (reasonValue: unknown) {
      setInterventionError(reasonValue instanceof Error ? reasonValue.message : 'Intervention failed');
    } finally { setInterventionBusy(false); }
  };

  const runLocalProof = async () => {
    if (!projectId) return;
    setProofBusy(true);
    setProofError(null);
    try {
      const idempotencyKey = globalThis.crypto?.randomUUID?.()
        || `local-backtest-${Date.now()}`;
      const response = await fetch('/api/trading/lifecycle/backtest', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, deckId, cardId, idempotencyKey }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(String(body?.error || body?.detail || `trading_lifecycle_${response.status}`));
      await readState();
    } catch (reason: unknown) {
      setProofError(reason instanceof Error ? reason.message : 'Local LumiBot proof failed');
    } finally { setProofBusy(false); }
  };

  const snapshotAge = state?.observedAt ? Math.max(0, (clock - Date.parse(state.observedAt)) / 1000) : null;
  const stale = snapshotAge !== null && Number.isFinite(snapshotAge)
    && snapshotAge > configuration.trading.staleDataSeconds;
  const blockedSettings = configuration.trading.paperBudgetUsd === 0
    || configuration.trading.maxOpenPositions === 0
    || configuration.trading.maxPlanLossPercent === 0
    || configuration.trading.maxDailyLossPercent === 0;
  const closed = state?.portfolio.closedTrades || 0;
  const winRate = closed ? ((state?.portfolio.wins || 0) / closed) * 100 : null;
  const runtimeProfile = card?.runtime.kind === 'hermes' ? card.runtime.profile : null;
  const runtimeOkay = card?.runtime.kind === 'hermes' && card.runtime.mode === 'delegate' && Boolean(runtimeProfile);
  const brokerConnected = state?.connection.status === 'available' && state.connection.mode === 'paper';
  const commands = state?.commands || {
    pauseResume: { available: false, reason: 'No canonical Trading snapshot is loaded.' },
    exit: { available: false, reason: 'No canonical Trading snapshot is loaded.' },
    cancel: { available: false, reason: 'No canonical Trading snapshot is loaded.' },
  };

  const openJob = (job: TradeJob) => { setSelectedJobId(job.jobId); setTab('jobs'); };
  return <div data-testid="trading-agent-workspace" style={{ background: BG, color: INK, height: '100%', minHeight: '100vh', overflow: 'auto' }}>
    <header style={{ background: '#09151eeb', borderBottom: `1px solid ${EDGE}`, position: 'sticky', top: 0, zIndex: 20 }}>
      <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between', padding: '12px 16px 9px' }}>
        <div><div style={{ alignItems: 'center', display: 'flex', gap: 7 }}><span style={{ color: CYAN, fontSize: 10, fontWeight: 900, letterSpacing: '.15em' }}>TRADER</span><Badge color={RED}>Paper only</Badge><Badge color={runtimeOkay ? GREEN : AMBER}>{runtimeOkay ? `Hermes · ${runtimeProfile}` : 'Hermes profile pending'}</Badge></div><h1 style={{ fontSize: 18, margin: '5px 0 0' }}>{card?.title || 'Trading Agent'}</h1></div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}><Badge color={brokerConnected ? GREEN : AMBER}>{brokerConnected ? `Paper broker · ${state?.connection.accountStatus || 'connected'}` : `Paper broker · ${state?.connection.status || 'not read'}`}</Badge><Badge color={streamStatus === 'live' && !stale ? GREEN : AMBER}>{stale ? 'Snapshot stale' : `Events · ${streamStatus}`}</Badge><Badge color={RED}>Order submission blocked</Badge><button type="button" onClick={() => void runLocalProof()} disabled={!projectId || proofBusy} style={{ background: PANEL_2, border: `1px solid ${GREEN}88`, borderRadius: 8, color: GREEN, cursor: !projectId || proofBusy ? 'not-allowed' : 'pointer', fontSize: 10, opacity: !projectId || proofBusy ? .55 : 1, padding: '5px 8px' }}>{proofBusy ? 'Running real LumiBot…' : 'Run local proof'}</button>{onInspectorRequest ? <button type="button" onClick={onInspectorRequest} style={{ background: PANEL_2, border: `1px solid ${CYAN}88`, borderRadius: 8, color: CYAN, cursor: 'pointer', fontSize: 10, padding: '5px 8px' }}>Settings</button> : null}<button type="button" onClick={() => void readState()} disabled={loading} style={{ background: PANEL_2, border: `1px solid ${EDGE}`, borderRadius: 8, color: INK, cursor: loading ? 'wait' : 'pointer', fontSize: 10, padding: '5px 8px' }}>{loading ? 'Refreshing…' : 'Refresh'}</button></div>
      </div>
      <nav aria-label="Trading workspace" style={{ display: 'flex', gap: 3, overflowX: 'auto', padding: '0 12px' }}>
        {([['overview', 'Portfolio'], ['jobs', `Trade Jobs${activeJobs.length ? ` (${activeJobs.length})` : ''}`], ['history', `History${closedJobs.length ? ` (${closedJobs.length})` : ''}`], ['evidence', 'Evidence']] as [TradingTab, string][]).map(([id, label]) => <button key={id} type="button" onClick={() => { setTab(id); if (id !== 'jobs') setSelectedJobId(null); }} style={{ background: 'transparent', border: 0, borderBottom: `2px solid ${tab === id ? CYAN : 'transparent'}`, color: tab === id ? INK : MUTED, cursor: 'pointer', fontSize: 11, fontWeight: 750, padding: '9px 10px' }}>{label}</button>)}
      </nav>
    </header>
    <main style={{ margin: '0 auto', maxWidth: 1680, padding: 14 }}>
      {!projectId ? <div role="status" style={{ background: PANEL, border: `1px dashed ${EDGE}`, borderRadius: 12, color: MUTED, marginBottom: 12, padding: 12 }}>Select a Project to read this saved Trading Card’s paper state.</div> : null}
      {stateError ? <div role="alert" style={{ background: '#31191c', border: `1px solid ${RED}77`, borderRadius: 11, color: '#ffaaa3', fontSize: 11, marginBottom: 12, padding: 11 }}>Trading state is unavailable: {stateError}. No portfolio or execution value has been inferred.</div> : null}
      {state && !brokerConnected ? <div role="status" style={{ background: '#2a2215', border: `1px solid ${AMBER}66`, borderRadius: 11, color: AMBER, fontSize: 11, marginBottom: 12, padding: 11 }}>Paper broker disconnected: {state.connection.diagnostics || state.connection.status}. Account balances, positions, historical equity, and drawdown remain unavailable.</div> : null}
      {stale ? <div role="status" style={{ background: '#2a2215', border: `1px solid ${AMBER}66`, borderRadius: 11, color: AMBER, fontSize: 11, marginBottom: 12, padding: 11 }}>Snapshot is stale ({Math.floor(snapshotAge || 0)} seconds old). Controls remain visible, but freshness is not claimed.</div> : null}
      {interventionError ? <div role="alert" style={{ color: RED, fontSize: 11, marginBottom: 10 }}>{interventionError}</div> : null}
      {proofError ? <div role="alert" style={{ color: RED, fontSize: 11, marginBottom: 10 }}>LumiBot lifecycle proof failed: {proofError}</div> : null}

      {tab === 'overview' ? <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
        <LifecycleProofPanel proof={state?.lifecycleProof} />
        <section style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(132px, 1fr))' }}>
          <Metric label="Portfolio value" value={money(state?.portfolio.portfolioValueUsd)} />
          <Metric label="Cash" value={money(state?.portfolio.cashUsd)} />
          <Metric label="Buying power" value={money(state?.portfolio.buyingPowerUsd)} />
          <Metric label="Daily P/L" value={money(state?.portfolio.dailyPnlUsd)} tone={toneForValue(state?.portfolio.dailyPnlUsd)} />
          <Metric label="Recorded realized" value={money(state?.portfolio.recordedRealizedPnlUsd)} tone={toneForValue(state?.portfolio.recordedRealizedPnlUsd)} detail="Trade Jobs only" />
          <Metric label="Broker unrealized" value={money(state?.portfolio.totalUnrealizedPnlUsd)} tone={toneForValue(state?.portfolio.totalUnrealizedPnlUsd)} />
          <Metric label="Max drawdown" value={state?.portfolio.maxDrawdownPercent === null || state?.portfolio.maxDrawdownPercent === undefined ? 'Unavailable' : `${state.portfolio.maxDrawdownPercent.toFixed(2)}%`} tone={toneForValue(state?.portfolio.maxDrawdownUsd)} detail={money(state?.portfolio.maxDrawdownUsd)} />
          <Metric label="Active / closed" value={`${activeJobs.length} / ${closedJobs.length}`} detail={winRate === null ? 'Win rate unavailable' : `${winRate.toFixed(1)}% recorded win rate`} />
        </section>
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'minmax(0, 1.45fr) minmax(280px, .8fr)' }}>
          <section style={{ background: PANEL, border: `1px solid ${EDGE}`, borderRadius: 16, overflow: 'hidden' }}><div style={{ padding: '12px 14px 0' }}><h2 style={{ fontSize: 14, margin: 0 }}>Paper portfolio history</h2><span style={{ color: MUTED, fontSize: 10 }}>Broker equity with drawdown beneath it · {state?.connection.fetchedAt ? `read ${shortTime(state.connection.fetchedAt)}` : 'not read'}</span></div><PortfolioHistoryChart points={state?.portfolio.equityCurve || []} /></section>
          <section style={{ background: PANEL, border: `1px solid ${EDGE}`, borderRadius: 16, overflow: 'hidden' }}><div style={{ padding: '12px 14px 0' }}><h2 style={{ fontSize: 14, margin: 0 }}>Combined P/L</h2><span style={{ color: MUTED, fontSize: 10 }}>Current broker unrealized plus recorded Trade Job realized contributions</span></div><PnlContributionChart positions={state?.positions || []} jobs={jobs} /></section>
        </div>
        <section style={{ background: PANEL, border: `1px solid ${EDGE}`, borderRadius: 16, padding: 14 }}><div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between' }}><div><h2 style={{ fontSize: 14, margin: 0 }}>Current exposure</h2><span style={{ color: MUTED, fontSize: 10 }}>Real paper positions grouped by the broker’s native symbols</span></div><Badge color={brokerConnected ? GREEN : AMBER}>{state?.positions.length || 0} positions</Badge></div>{state?.positions.length ? <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', marginTop: 10 }}>{state.positions.map((position) => <div key={`${position.symbol}:${position.side}:${position.strategy}`} style={{ background: PANEL_2, border: `1px solid ${EDGE}`, borderRadius: 10, fontSize: 10, padding: 10 }}><strong>{position.symbol} · {position.side || 'side unavailable'}</strong><div style={{ color: MUTED, display: 'grid', gap: 4, gridTemplateColumns: '1fr 1fr', marginTop: 7 }}><span>{number(position.quantity)} units</span><span style={{ textAlign: 'right' }}>{money(position.marketValueUsd)}</span><span>Entry {money(position.averageEntryPrice)}</span><span style={{ color: toneForValue(position.unrealizedPnlUsd), textAlign: 'right' }}>{money(position.unrealizedPnlUsd)}</span></div></div>)}</div> : <p style={{ color: MUTED, fontSize: 10, margin: '12px 0 0' }}>{brokerConnected ? 'The connected paper account has no open positions.' : 'Exposure is unavailable until the paper broker is connected.'}</p>}</section>
        <section style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}><Metric label="Wins" value={state?.portfolio.wins ?? 'Unavailable'} tone={GREEN} /><Metric label="Losses" value={state?.portfolio.losses ?? 'Unavailable'} tone={RED} /><Metric label="Flat" value={state?.portfolio.flat ?? 'Unavailable'} /><Metric label="Risk configuration" value={blockedSettings ? 'Blocked' : 'Set'} tone={blockedSettings ? AMBER : GREEN} /></section>
      </div> : null}

      {tab === 'jobs' ? selectedJob ? <JobDetail job={selectedJob} timeframe={timeframe} onTimeframe={setTimeframe}
        onBack={() => setSelectedJobId(null)} onIntervene={intervene} busy={interventionBusy} commands={commands} />
        : <section><div style={{ alignItems: 'end', display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}><div><h2 style={{ fontSize: 15, margin: 0 }}>Active Trade Jobs</h2><span style={{ color: MUTED, fontSize: 10 }}>One compact real candle chart per assignment · select a tile for full evidence</span></div>{loading ? <span style={{ color: MUTED, fontSize: 10 }}>Refreshing…</span> : null}</div>{activeJobs.length ? <div data-testid="active-trade-job-grid" style={{ display: 'grid', gap: 9, gridTemplateColumns: 'repeat(auto-fit, minmax(225px, 1fr))' }}>{activeJobs.map((job) => <TradeJobCard key={job.jobId} job={job} chartHeight={configuration.trading.compactChartHeightPx} onSelect={() => openJob(job)} />)}</div> : <div style={{ background: PANEL, border: `1px dashed ${EDGE}`, borderRadius: 16, color: MUTED, padding: '34px 20px', textAlign: 'center' }}><strong style={{ color: INK, display: 'block', marginBottom: 6 }}>No active Trade Jobs</strong>Main, an approved Mag One result, Graph Agent, or an explicitly connected Card can send a complete structured assignment. Missing execution terms are rejected.{explicitSymbol ? <div style={{ color: CYAN, marginTop: 7 }}>Observed presentation instrument: {explicitSymbol}</div> : null}</div>}</section> : null}

      {tab === 'history' ? <section><h2 style={{ fontSize: 15, margin: '0 0 4px' }}>Closed Trade Job history</h2><p style={{ color: MUTED, fontSize: 10, margin: '0 0 10px' }}>Bounded to the 100 most recently updated jobs from the canonical snapshot.</p>{closedJobs.length ? <div style={{ display: 'grid', gap: 9, gridTemplateColumns: 'repeat(auto-fit, minmax(225px, 1fr))' }}>{closedJobs.map((job) => <TradeJobCard key={job.jobId} job={job} chartHeight={configuration.trading.compactChartHeightPx} onSelect={() => openJob(job)} />)}</div> : <div style={{ background: PANEL, border: `1px dashed ${EDGE}`, borderRadius: 16, color: MUTED, padding: 32, textAlign: 'center' }}>No closed Trade Jobs are recorded.</div>}</section> : null}

      {tab === 'evidence' ? <section style={{ background: PANEL, border: `1px solid ${EDGE}`, borderRadius: 16, padding: 15 }}><div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}><div><h2 style={{ fontSize: 14, margin: 0 }}>All recorded Hermes decisions</h2><span style={{ color: MUTED, fontSize: 10 }}>Typed outcomes, citations/evidence, missing terms, and source Run identity</span></div><Badge>{state?.observedAt ? `Observed ${shortTime(state.observedAt)}` : 'No state read'}</Badge></div>{jobs.some((job) => job.decisions.length) ? jobs.flatMap((job) => job.decisions.map((decision) => <article key={decision.decisionId} style={{ borderTop: `1px solid ${EDGE}`, padding: '12px 2px' }}><div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 7 }}><strong>{job.symbol}</strong><Badge color={statusColor(decision.action)}>{decision.action}</Badge><span style={{ color: MUTED, fontSize: 10 }}>{(decision.confidence * 100).toFixed(0)}% · {shortTime(decision.createdAt)} · Run {decision.sourceRunId}</span></div><p style={{ color: '#bfd0d7', fontSize: 11, lineHeight: 1.5, margin: '8px 0' }}>{decision.rationale}</p><details><summary style={{ color: CYAN, cursor: 'pointer', fontSize: 10 }}>Recorded evidence and missing terms</summary><pre style={{ background: '#07121a', borderRadius: 8, color: MUTED, fontSize: 9, overflow: 'auto', padding: 9 }}>{JSON.stringify({ evidence: decision.evidence, missingTerms: decision.missingTerms, executionRequested: decision.executionRequested }, null, 2)}</pre></details></article>)) : <div style={{ color: MUTED, padding: 30, textAlign: 'center' }}>No decisions have been recorded. The UI will not manufacture evidence.</div>}</section> : null}
    </main>
  </div>;
}
