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

export type TradingSettings = {
  paperOnly: true;
  executionApproved: false;
  paperBudgetUsd: number;
  allocationPerJobPercent: number;
  maxConcurrentJobs: number;
  maxOpenPositions: number;
  maxPlanLossPercent: number;
  maxDailyLossPercent: number;
  minimumConfidencePercent: number;
  minimumRiskReward: number;
  evaluationCadenceSeconds: number;
  staleDataSeconds: number;
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
  origin?: { kind?: string; id?: string };
  [key: string]: unknown;
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
};

export type TradingEngineReadiness = {
  status?: string;
  version?: string | null;
  strategyClassAvailable?: boolean;
  traderClassAvailable?: boolean;
  paperOnly?: boolean;
  orderSubmission?: string;
  diagnostics?: string | null;
};

export type TradingState = {
  cardId: string;
  paperOnly: true;
  executionApproved: false;
  jobs: TradeJob[];
  portfolio: {
    realizedPnlUsd: number;
    wins: number;
    losses: number;
    flat: number;
    closedTrades: number;
  };
  engine: TradingEngineReadiness;
  observedAt: string;
};

export type MarketBar = {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type HistoricalBars = {
  provider?: string;
  feed?: string | null;
  symbol?: string;
  timeframe?: string;
  status?: string;
  fetchedAt?: string;
  bars?: MarketBar[];
  diagnostics?: string | null;
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
    minimumConfidencePercent: 70,
    minimumRiskReward: 2,
    evaluationCadenceSeconds: 60,
    staleDataSeconds: 90,
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
      minimumConfidencePercent: numeric(
        trading.minimumConfidencePercent,
        fallback.minimumConfidencePercent,
      ),
      minimumRiskReward: numeric(trading.minimumRiskReward, fallback.minimumRiskReward),
      evaluationCadenceSeconds: numeric(
        trading.evaluationCadenceSeconds,
        fallback.evaluationCadenceSeconds,
      ),
      staleDataSeconds: numeric(trading.staleDataSeconds, fallback.staleDataSeconds),
    },
  };
}
