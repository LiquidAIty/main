# Plan: LiquidAIty Trading Intelligence Stack

**Branch**: `003-trading-intelligence-stack` | **Date**: 2026-06-03 | **Spec**: `specs/003-trading-intelligence-stack/spec.md`

**Status**: Draft — pending user approval. Current work is still the spec/plan/tasks truth pass, not implementation.

## Summary

Convert LiquidAIty into a focused AI Agentic Trading Desk MVP. The system ingests real Alpaca
candles, renders them in a controllable chart, uses FinRL-X as the quantitative backtest/
portfolio-weight engine, overlays Chronos/Kronos forecasts, ingests free SEC EDGAR intelligence,
collects Shodan/OSINT world signals as trading evidence, and produces research-only signal labels
(WAIT / BUY_WATCH / SELL_WATCH). No live trading. No order execution.

Before any of that implementation starts, the current requirement is to finish the truthful
specification reset: document reality, decide Stage 0 shell cleanup scope, and only then implement.

## Technical Context

**Language/Version**: TypeScript 5 (frontend + backend), Python 3.11 (model service, knowgraph)

**Primary Dependencies**:
- `lightweight-charts` (frontend chart)
- `@alpacahq/alpaca-trade-api` or direct HTTP (backend Alpaca client)
- `amazon/chronos-bolt-small` via `chronos-forecasting` (Python)
- `NeoQuasar/Kronos-small` + `NeoQuasar/Kronos-Tokenizer-base` (Python)
- `finrl` or `finrl-x` (Python quant engine)
- `edgartools` (Python EDGAR parser)
- Shodan Python SDK or direct Shodan Search API HTTP client

**Storage**:
- TimescaleDB (`market.*` schema in Postgres) for candles, forecast runs, backtest runs
- Neo4j for KnowGraph (filings, signals, evidence, forecast runs)
- Apache AGE / Postgres for ThinkGraph
- Redis for caching (SEC API responses, Shodan results)

**Testing**: Existing vitest (frontend), pytest (Python services), zod validation (backend)

**Target Platform**: Windows (i7-1265U, 32GB RAM, Intel Iris Xe) — CPU-only inference

**Performance Goals**: Chronos inference < 10s on target hardware. Alpaca candle fetch < 2s.

**Constraints**: CPU-only. No CUDA. No live order execution. No `VITE_ALPACA_*` env vars.

**Scale/Scope**: Single-user research desk, 1–5 symbols at a time, 10-stage rollout.

## Constitution Check

- Spec Kit heavy-mode: justified — multi-stage, cross-service, explicit safety constraints.
- No fake substitute product behavior: not yet satisfied. `tradingui.tsx` still has mock UI that must be removed in the cleanup/spec pass before implementation claims can be trusted.
- No standalone audit files: findings routed into this plan and `docs/disabled-features.md`.
- Runtime guardrails explicit: WAIT/BUY_WATCH/SELL_WATCH only; FinRL-X no live execution; Shodan API only.

## Project Structure

### Documentation (this feature)

```text
specs/003-trading-intelligence-stack/
├── spec.md          ← source of truth for all stages
├── plan.md          ← this file
└── tasks.md         ← filled after user approves spec

docs/
└── disabled-features.md   ← planning inventory for later shell cleanup / recovery
```

### Source Code (repository root)

```text
apps/backend/src/
├── routes/
│   ├── market.routes.ts          [NEW] alpaca candles, EDGAR, FinRL-X, Shodan, signals
│   └── index.ts                  [MODIFY] mount marketRoutes
├── services/
│   ├── alpacaService.ts          [NEW] Alpaca HTTP client
│   └── osintService.ts           [NEW] Shodan API client

apps/python-models/app/
├── routers/
│   ├── finrlx.py                 [NEW] POST /finrlx/backtest
│   ├── edgar.py                  [NEW] POST /edgar/parse
│   ├── chronos.py                [NEW] POST /forecast/chronos
│   └── kronos.py                 [NEW] POST /forecast/kronos
├── adapters/
│   ├── candle_to_finrlx.py       [NEW] CandleToFinRLXAdapter
│   └── finrlx_to_signal.py       [NEW] FinRLXToSignalAdapter
└── main.py                       [MODIFY] register routers, startup model loading

services/knowgraph/
└── schema.py                     [MODIFY] fix syntax + add new node/edge types

client/src/
├── components/trading/
│   ├── TradingChart.tsx           [NEW] lightweight-charts wrapper
│   └── useTradingChart.ts         [NEW] chart hook
├── lib/
│   └── alpacaClient.ts            [NEW] frontend API client (no secrets)
└── pages/
    └── tradingui.tsx              [MODIFY] replace CDN widget, remove mock UI, add overlays
```

## Stage Gate Summary

| Stage | Name | Key Gate Criteria |
|---|---|---|
| 0 | Active UI Reduction + Security Fence | launchMode removed, spec reset in progress, shell cleanup not yet implemented, mock UI cleanup still pending |
| 1 | Alpaca Candles Endpoint | Real OHLCV returned, HTTP 503 on missing keys |
| 2 | Lightweight Charts Trading Desk | Real candles render, CDN removed, overlays wired |
| 3 | FinRL-X Engine Integration | Backtest runs, weights sum ≈ 1.0, no lookahead, no live orders |
| 4 | SEC EDGAR + EdgarTools | CIK lookup works, filings in Neo4j with provenance, chunks in RAG |
| 5 | Chronos-Bolt Small Forecast | forecast_line + confidence_band, no NaN, < 10s on target HW |
| 6 | Kronos Small Ghost Candles | ghost_candles valid OHLC, chart renders translucent |
| 7 | OSINT / WorldSignals / Shodan | SignalEvidence in Neo4j, sidebar rendered, rate limits respected |
| 8 | Research-Only Signals | WAIT default, BUY/SELL forbidden, combined evidence works |
| 9 | Backtest + Scoring | ForecastRun scored, sharpe_ratio + max_drawdown finite |
| 10 | Future Modes Reopening | Any later mode cleanup/reopening handled one at a time using disabled-features.md as inventory |

## Affected Files

### Backend (Node.js)
- `apps/backend/src/routes/market.routes.ts` — [NEW]
- `apps/backend/src/routes/index.ts` — [MODIFY]
- `apps/backend/src/services/alpacaService.ts` — [NEW]
- `apps/backend/src/services/osintService.ts` — [NEW]
- `apps/backend/src/routes/v2/kg.routes.ts` — [MODIFY] add authMiddleware (Stage 0)

### Python Model Service
- `apps/python-models/requirements.txt` — [MODIFY] add finrl, chronos-forecasting, edgartools, torch CPU, shodan
- `apps/python-models/Dockerfile` — [MODIFY] CPU torch install
- `apps/python-models/app/main.py` — [MODIFY]
- `apps/python-models/app/routers/finrlx.py` — [NEW]
- `apps/python-models/app/routers/edgar.py` — [NEW]
- `apps/python-models/app/routers/chronos.py` — [NEW]
- `apps/python-models/app/routers/kronos.py` — [NEW]
- `apps/python-models/app/adapters/candle_to_finrlx.py` — [NEW]
- `apps/python-models/app/adapters/finrlx_to_signal.py` — [NEW]

### KnowGraph Service
- `services/knowgraph/schema.py` — [MODIFY] fix syntax + add Ticker, Company, Filing, FilingSection, FilingChunk, ForecastRun, BacktestRun, GhostCandle, SignalEvidence, Signal + edges

### Frontend (React/TypeScript)
- `client/src/pages/tradingui.tsx` — [MODIFY] cleanup + chart rewrite after Stage 0 shell/spec pass
- `client/src/components/trading/TradingChart.tsx` — [NEW]
- `client/src/components/trading/useTradingChart.ts` — [NEW]
- `client/src/lib/alpacaClient.ts` — [NEW]
- `client/src/app.tsx` — [MODIFY] route cleanup if/when Stage 0 shell reduction approves it

### Database / Schema
- New SQL file for `market.*` tables (candles, forecast_runs, forecast_points, ghost_candles, backtest_runs, backtest_weights)

### Docs
- `docs/disabled-features.md` — [CREATED] planning inventory for later shell cleanup and recovery

## Constraints

- No implementation claims should assume the shell cleanup is complete until the Stage 0 reset work is accepted and the code changes actually land.
- Spec Kit order for this work is: `spec.md` → `plan.md` → `tasks.md` → user approval → implementation.
- No package installs until user approves the spec.
- No live order execution anywhere in Stages 0–9.
- No mock candles, mock signals, or mock chat in the Alpaca path.
- No Alpaca credentials in frontend code or `VITE_*` env vars.
- No BUY, SELL, LONG, SHORT, OPEN, CLOSE signal labels.
- No Shodan exploit API. No aggressive scanning. Official search API only.
- FinRL-X paper trading integration is explicitly deferred past Stage 9.
- All Python inference runs CPU-only.

## Risks

- **Kronos HuggingFace gating**: `NeoQuasar/Kronos-small` may require a token. Needs pre-stage-6 confirmation.
- **FinRL-X CPU performance**: FinRL-X is designed for GPU. CPU-only backtest may be slow on large datasets. Limit to 252-bar (1-year) slices initially.
- **Chronos memory on 32GB**: `chronos-bolt-small` is the primary; `tiny` is the fallback. Monitor RSS during service startup.
- **Shodan rate limits**: Free tier is 1 req/s with monthly caps. 24h Redis cache per company mitigates this.
- **schema.py syntax corruption**: Must be fixed in Stage 0 before any graph schema work. Blocking dependency.
- **Key rotation timing**: Exposed keys must be rotated before Stage 0 completes. This is a manual step.
- **WorldSignals surface refactor risk**: The existing `WorldSignalSurface.tsx` canvas is 43KB. If a later Stage 0 cleanup trims shell surfaces, care is needed not to break the underlying signal wiring.

## Validation

- Backend: Run TypeScript build check (`npm run build` or `nx build backend`) after each stage.
- Frontend: Run `npm run typecheck` and `npm run test` in `client/` after Stage 2.
- Python: Run `pytest apps/python-models/tests/` after each Python stage.
- Graph: Run `services/knowgraph` startup and verify schema imports cleanly after Stage 0 fix.
- Integration: Use PowerShell `Invoke-RestMethod` to call each new endpoint manually.
- Lookahead test: Assert that candle slice max timestamp < `ran_at` before scoring in Stage 9.
- Signal label test: Assert that BUY, SELL, LONG, SHORT, OPEN, CLOSE do not appear in any signal response.
