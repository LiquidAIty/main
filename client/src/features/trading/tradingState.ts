export const TRADE_ACTIONS = [
  'WAIT',
  'ENTER',
  'HOLD',
  'REDUCE',
  'EXIT',
  'PAUSE',
  'FAIL_SAFE',
] as const;

export type TradeAction = (typeof TRADE_ACTIONS)[number];
export type TradingInterventionAction = 'PAUSE' | 'RESUME';

export type TradingSettings = {
  paperOnly: true;
  executionApproved: false;
  paperBudgetUsd: number;
  allocationPerJobPercent: number;
  maxConcurrentJobs: number;
  maxOpenPositions: number;
  maxPlanLossPercent: number;
  maxDailyLossPercent: number;
  maxPortfolioDrawdownPercent: number;
  defaultStopLossPercent: number;
  minimumConfidencePercent: number;
  minimumRiskReward: number;
  evaluationCadenceSeconds: number;
  heartbeatSeconds: number;
  failSafeCooldownMinutes: number;
  staleDataSeconds: number;
  defaultTimeframe: '1Min' | '5Min' | '15Min' | '1Hour' | '1Day';
  chartWindowBars: number;
  compactChartHeightPx: number;
  brokerConnectionRef: string;
  marketSession: 'regular' | 'extended';
  strategyParameters: Record<string, string | number | boolean>;
};

export type TradingConfiguration = {
  schemaVersion: 'trading.card.v1';
  trading: TradingSettings;
};

export type TradeDecision = {
  decisionId: string;
  action: TradeAction;
  rationale: string;
  confidence: number;
  evidence: Array<Record<string, unknown>>;
  missingTerms: string[];
  executionRequested: false;
  sourceRunId: string;
  createdAt: string;
};

export type TradePlan = {
  instrument?: { symbol?: string; venue?: string };
  assetClass?: string;
  allowedDirections?: string[];
  budgetCeilingUsd?: number;
  maxLossUsd?: number;
  expectedRiskReward?: number;
  entryConditions?: string[];
  exitConditions?: string[];
  stopConditions?: string[];
  invalidationConditions?: string[];
  horizon?: string;
  expiresAt?: string;
  allowedOrderTypes?: string[];
  dataRequirements?: string[];
  executionPolicy?: string;
  origin?: { kind?: string; id?: string };
  [key: string]: unknown;
};

export type MarketBar = {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type TradeMarketObservation = {
  status: string;
  provider: string | null;
  feed: string | null;
  timeframe: string;
  fetchedAt: string | null;
  observedAt: string | null;
  freshness: string | null;
  currentPrice: number | null;
  bars: MarketBar[];
  diagnostics: string | null;
};

export type PaperPosition = {
  symbol: string;
  side: string | null;
  quantity: number | null;
  averageEntryPrice: number | null;
  currentPrice: number | null;
  marketValueUsd: number | null;
  unrealizedPnlUsd: number | null;
  strategy: string | null;
};

export type PaperOrder = {
  orderId: string;
  clientOrderId: string;
  symbol: string;
  side: string | null;
  quantity: number | null;
  filledQuantity: number | null;
  type: string | null;
  status: string | null;
  limitPrice: number | null;
  stopPrice: number | null;
  averageFillPrice: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  filledAt: string | null;
};

export type TradeFill = {
  fillId: string;
  orderId: string;
  side: string | null;
  quantity: number | null;
  price: number | null;
  timestamp: string | null;
};

export type TradeEvent = {
  eventId: string;
  kind: string;
  source: string;
  action: string;
  summary: string;
  createdAt: string | null;
};

export type TradeArtifact = {
  artifactId: string;
  kind: string;
  locator: string;
  mediaType: string | null;
  contentSha256: string | null;
  provenanceRef: string | null;
  sizeBytes: number | null;
  createdAt: string;
};

export type TradeIntervention = {
  interventionId: string;
  action: TradingInterventionAction | 'EXIT' | 'FAIL_SAFE';
  reason: string;
  actor: string;
  createdAt: string;
};

export type TradeJob = {
  jobId: string;
  symbol: string;
  assetClass: string;
  state: string;
  action: TradeAction;
  executionState: string;
  budgetCeilingUsd: number;
  maxLossUsd: number;
  realizedPnlUsd: number | null;
  plan: TradePlan;
  sourceRunId: string;
  createdAt: string;
  updatedAt: string;
  decisions: TradeDecision[];
  interventions: TradeIntervention[];
  market: TradeMarketObservation;
  position: PaperPosition | null;
  orders: PaperOrder[];
  fills: TradeFill[];
  events: TradeEvent[];
  artifacts: TradeArtifact[];
  lifecycle: { status: string; diagnostics: string | null };
};

export type TradingEngineReadiness = {
  status?: string;
  version?: string | null;
  strategyClassAvailable?: boolean;
  traderClassAvailable?: boolean;
  paperOnly?: boolean;
  orderSubmission?: string;
  diagnostics?: string | null;
  adapter?: {
    contractVersion: string;
    publicApiOnly: boolean;
    capabilities: string[];
  };
  lifecycle?: {
    status: string;
    activeStrategies: number;
    scheduler: string;
    diagnostics: string | null;
  };
  nativeAgents?: {
    enabled: boolean;
    authority: string;
    diagnostics: string | null;
  };
};

export type EquityPoint = {
  timestamp: string;
  valueUsd: number;
  drawdownUsd: number;
  drawdownPercent: number;
};

export type TradingLifecycleProof = {
  lifecycleRunId: string;
  cardId: string;
  mode: 'local_backtest';
  status: 'running' | 'completed' | 'failed';
  paperOnly: boolean;
  liveOrders: boolean;
  modelProviderCalls: boolean;
  symbol: string;
  dataProvenance: {
    kind?: string;
    source?: string;
    barCount?: number;
    start?: string;
    end?: string;
    actor?: string;
  };
  bars?: MarketBar[];
  portfolio?: {
    initialValueUsd: number;
    portfolioValueUsd: number | null;
    cashUsd: number | null;
    profitLossUsd: number | null;
    maxDrawdownUsd: number;
    maxDrawdownPercent: number;
    equityCurve: EquityPoint[];
  };
  positions?: PaperPosition[];
  orders?: Array<{
    orderId: string;
    symbol: string;
    side: string | null;
    quantity: number | null;
    filledQuantity: number | null;
    type: string | null;
    status: string | null;
  }>;
  events: TradeEvent[];
  artifacts: TradeArtifact[];
  errorCode?: string | null;
  startedAt: string | null;
  finishedAt: string | null;
};

export type TradingState = {
  cardId: string;
  paperOnly: true;
  executionApproved: false;
  timeframe: string;
  jobs: TradeJob[];
  portfolio: {
    portfolioValueUsd: number | null;
    cashUsd: number | null;
    buyingPowerUsd: number | null;
    dailyPnlUsd: number | null;
    totalUnrealizedPnlUsd: number | null;
    maxDrawdownUsd: number | null;
    maxDrawdownPercent: number | null;
    unavailableMetrics: string[];
    realizedPnlUsd: number;
    recordedRealizedPnlUsd: number;
    wins: number;
    losses: number;
    flat: number;
    closedTrades: number;
    equityCurve: EquityPoint[];
  };
  positions: PaperPosition[];
  connection: {
    provider: string;
    status: string;
    mode: string;
    accountStatus: string | null;
    fetchedAt: string;
    diagnostics: string | null;
  };
  commands: {
    pauseResume: { available: boolean; reason: string | null };
    exit: { available: boolean; reason: string | null };
    cancel: { available: boolean; reason: string | null };
  };
  engine: TradingEngineReadiness;
  lifecycleProof: TradingLifecycleProof | null;
  observedAt: string;
};

export const DEFAULT_TRADING_CONFIGURATION: TradingConfiguration = {
  schemaVersion: 'trading.card.v1',
  trading: {
    paperOnly: true,
    executionApproved: false,
    paperBudgetUsd: 0,
    allocationPerJobPercent: 0,
    maxConcurrentJobs: 3,
    maxOpenPositions: 0,
    maxPlanLossPercent: 0,
    maxDailyLossPercent: 0,
    maxPortfolioDrawdownPercent: 0,
    defaultStopLossPercent: 0,
    minimumConfidencePercent: 70,
    minimumRiskReward: 2,
    evaluationCadenceSeconds: 60,
    heartbeatSeconds: 60,
    failSafeCooldownMinutes: 60,
    staleDataSeconds: 90,
    defaultTimeframe: '5Min',
    chartWindowBars: 72,
    compactChartHeightPx: 116,
    brokerConnectionRef: 'alpaca-paper',
    marketSession: 'regular',
    strategyParameters: {},
  },
};

const numeric = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

export function readTradingConfiguration(value: unknown): TradingConfiguration {
  const source = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
  const trading = source.trading && typeof source.trading === 'object'
    ? source.trading as Record<string, unknown>
    : {};
  const fallback = DEFAULT_TRADING_CONFIGURATION.trading;
  return {
    schemaVersion: 'trading.card.v1',
    trading: {
      paperOnly: true,
      executionApproved: false,
      paperBudgetUsd: numeric(trading.paperBudgetUsd, fallback.paperBudgetUsd),
      allocationPerJobPercent: numeric(
        trading.allocationPerJobPercent,
        fallback.allocationPerJobPercent,
      ),
      maxConcurrentJobs: numeric(trading.maxConcurrentJobs, fallback.maxConcurrentJobs),
      maxOpenPositions: numeric(trading.maxOpenPositions, fallback.maxOpenPositions),
      maxPlanLossPercent: numeric(trading.maxPlanLossPercent, fallback.maxPlanLossPercent),
      maxDailyLossPercent: numeric(trading.maxDailyLossPercent, fallback.maxDailyLossPercent),
      maxPortfolioDrawdownPercent: numeric(
        trading.maxPortfolioDrawdownPercent,
        fallback.maxPortfolioDrawdownPercent,
      ),
      defaultStopLossPercent: numeric(
        trading.defaultStopLossPercent,
        fallback.defaultStopLossPercent,
      ),
      minimumConfidencePercent: numeric(
        trading.minimumConfidencePercent,
        fallback.minimumConfidencePercent,
      ),
      minimumRiskReward: numeric(trading.minimumRiskReward, fallback.minimumRiskReward),
      evaluationCadenceSeconds: numeric(
        trading.evaluationCadenceSeconds,
        fallback.evaluationCadenceSeconds,
      ),
      heartbeatSeconds: numeric(trading.heartbeatSeconds, fallback.heartbeatSeconds),
      failSafeCooldownMinutes: numeric(
        trading.failSafeCooldownMinutes,
        fallback.failSafeCooldownMinutes,
      ),
      staleDataSeconds: numeric(trading.staleDataSeconds, fallback.staleDataSeconds),
      defaultTimeframe: ['1Min', '5Min', '15Min', '1Hour', '1Day'].includes(
        String(trading.defaultTimeframe || ''),
      ) ? trading.defaultTimeframe as TradingSettings['defaultTimeframe'] : fallback.defaultTimeframe,
      chartWindowBars: numeric(trading.chartWindowBars, fallback.chartWindowBars),
      compactChartHeightPx: numeric(
        trading.compactChartHeightPx,
        fallback.compactChartHeightPx,
      ),
      brokerConnectionRef: typeof trading.brokerConnectionRef === 'string'
        && trading.brokerConnectionRef.trim()
        ? trading.brokerConnectionRef.trim()
        : fallback.brokerConnectionRef,
      marketSession: trading.marketSession === 'extended' ? 'extended' : 'regular',
      strategyParameters: trading.strategyParameters
        && typeof trading.strategyParameters === 'object'
        && !Array.isArray(trading.strategyParameters)
        ? trading.strategyParameters as TradingSettings['strategyParameters']
        : {},
    },
  };
}

function uniqueBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const id = key(item);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function reconcileJob(job: TradeJob): TradeJob {
  return {
    ...job,
    decisions: uniqueBy(job.decisions || [], (item) => item.decisionId),
    interventions: uniqueBy(job.interventions || [], (item) => item.interventionId),
    orders: uniqueBy(job.orders || [], (item) => item.orderId),
    fills: uniqueBy(job.fills || [], (item) => item.fillId),
    events: uniqueBy(job.events || [], (item) => item.eventId),
    artifacts: uniqueBy(job.artifacts || [], (item) => item.artifactId),
    market: {
      ...job.market,
      bars: uniqueBy(job.market?.bars || [], (item) => item.timestamp),
    },
  };
}

/** Reconcile initial and streamed full snapshots by native IDs. Older events
 * cannot replace a newer observation. */
export function reconcileTradingState(
  current: TradingState | null,
  incoming: TradingState,
): TradingState {
  const currentTime = current ? Date.parse(current.observedAt) : Number.NaN;
  const incomingTime = Date.parse(incoming.observedAt);
  if (current && Number.isFinite(currentTime) && Number.isFinite(incomingTime)
    && incomingTime < currentTime) {
    return current;
  }
  return {
    ...incoming,
    jobs: uniqueBy(incoming.jobs || [], (job) => job.jobId).map(reconcileJob),
    positions: uniqueBy(
      incoming.positions || [],
      (position) => `${position.symbol}:${position.side || ''}:${position.strategy || ''}`,
    ),
    portfolio: {
      ...incoming.portfolio,
      equityCurve: uniqueBy(
        incoming.portfolio?.equityCurve || [],
        (point) => point.timestamp,
      ),
    },
  };
}
