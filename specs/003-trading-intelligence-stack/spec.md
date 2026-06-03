# Feature Specification: LiquidAIty Trading Intelligence Stack

**Feature Branch**: `003-trading-intelligence-stack`

**Created**: 2026-06-03

**Status**: Draft — awaiting user approval. Do not implement from this file yet.

**Input**: User description: "LiquidAIty Trading Intelligence Stack — AI Agentic Trading Desk MVP using FinRL-X as the quant engine, Chronos/Kronos forecast overlays, SEC EDGAR intelligence, and a Shodan-backed OSINT/WorldSignals evidence layer."

**Use When**: Spec Kit heavy-mode is warranted because this is a large, multi-stage, cross-service feature spanning frontend, backend, two Python services, Neo4j, Postgres, Redis, and new Python engine packages, with explicit no-execution safety constraints.

---

> ⚠️ **Implementation Guardrails — Read before any implementation work begins**
>
> - No implementation until the user explicitly approves this spec.
> - No package installs until approved.
> - No live trading. No order execution. No Alpaca order routes.
> - No BUY or SELL or LONG or SHORT or OPEN or CLOSE signal labels.
> - Only WAIT, BUY_WATCH, SELL_WATCH are permitted signal labels.
> - No Alpaca API credentials exposed to the frontend.
> - No mock candle data in the Alpaca path. If keys are missing, return HTTP 503.
> - EDGAR data must use free SEC public APIs first (no paid data).
> - Shodan and external OSINT feeds use official APIs only. No aggressive scanning.
> - FinRL-X is a Python quant engine — it does not touch live order execution in this spec.
> - Paid market data or SEC APIs are rejected unless explicitly approved by the user later.
> - FinRL-X paper trading integration requires its own approval gate after backtest gates pass.

---

## Platform Architecture

LiquidAIty is being narrowed to a focused **AI Agentic Trading Desk** for the MVP launch.
The broader AI canvas/platform vision remains alive but is hidden until each future mode is ready.

```
LiquidAIty Canvas (user-facing AI trading desk)
  ↕ API / WebSocket
Backend (Node.js / Express)
  ↕ proxies
  ├── Alpaca Market Data API ← market data + paper-trading broker bridge
  ├── SEC EDGAR (free) ← public company filings intelligence
  ├── Shodan / OSINT feeds ← external infrastructure signals (Stage 7)
  ├── Python Model Service (FastAPI)
  │     ├── Chronos-Bolt Small ← close-price forecast line + confidence band
  │     ├── Kronos Small ← ghost-candle OHLCV forecast
  │     ├── EdgarTools ← structured filing parser
  │     └── FinRL-X ← quantitative strategy / backtest / portfolio-weight engine
  ├── KnowGraph (Neo4j) ← durable evidence graph (EDGAR, signals, forecasts)
  ├── ThinkGraph (Apache AGE / Postgres) ← active reasoning graph
  └── Redis ← caching layer
```

**Architecture roles (single source of truth):**

| Component | Role |
|---|---|
| Alpaca | Market data and broker/paper-trading bridge |
| FinRL-X | Quantitative strategy, backtest, portfolio-weight engine |
| Chronos | Future close-price forecast line |
| Kronos | Future ghost-candle OHLCV forecast |
| EDGAR / EdgarTools | Public company filings intelligence |
| Shodan / OSINT | External infrastructure and world-signal evidence |
| KnowGraph | Durable evidence graph (Neo4j) |
| ThinkGraph | Active reasoning graph (Apache AGE) |
| LiquidAIty Canvas | User-facing AI trading desk |

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — View Real Alpaca Candles in a Controllable Chart (Priority: P1)

As Jeremiah, I want to see real OHLCV candlestick data from Alpaca rendered in a chart I control,
so I can visually analyze price history without relying on the TradingView CDN widget that cannot
accept custom data or render overlays.

**Why this priority**: This is the foundational visual surface. Without real candles in a controllable
chart, no overlay, forecast, or signal feature can be built or validated.

**Independent Test**: Navigate to the trading UI, select AAPL 1Day, verify real OHLCV bars appear
from Alpaca with correct timestamps using `lightweight-charts` and no TradingView CDN script tag.

**Acceptance Scenarios**:

1. **Given** valid Alpaca keys, **When** the user selects AAPL / 1Day, **Then** real candles render
   in a `lightweight-charts` candlestick series.
2. **Given** missing Alpaca keys, **When** candles are requested, **Then** HTTP 503 is returned
   and the chart shows a clear error state — not mock data.
3. **Given** an invalid symbol, **When** submitted, **Then** HTTP 400 with a validation message.
4. **Given** candles render, **When** the browser network tab is inspected, **Then** no Alpaca key
   or secret appears in any HTTP response.

---

### User Story 2 — View SEC EDGAR Filing Events on the Chart (Priority: P2)

As Jeremiah, I want SEC EDGAR filing events for a stock to appear as event markers on the chart,
so I can correlate filing dates with price action without leaving the research view.

**Why this priority**: Filing event context is the core differentiator. It uses only free SEC APIs.

**Independent Test**: Ingest AAPL EDGAR filings, view the AAPL chart, confirm filing markers appear
at correct bar timestamps with correct form type labels.

**Acceptance Scenarios**:

1. **Given** EDGAR filings ingested for AAPL, **When** the chart loads, **Then** filing date markers
   appear at the correct bar timestamps.
2. **Given** a ticker-to-CIK lookup for AAPL, **When** it resolves, **Then** CIK is `0000320193`
   from `sec.gov/files/company_tickers.json`.
3. **Given** the ingest endpoint is called, **When** it completes, **Then** Ticker, Company, and
   Filing nodes exist in Neo4j with `source: "sec_edgar"` and `provenance_confidence: 1.0`.

---

### User Story 3 — FinRL-X Backtest and Portfolio Weight Output (Priority: P2)

As Jeremiah, I want to run a FinRL-X backtest on historical Alpaca candle data for a symbol set,
and see portfolio weights and performance metrics in the research sidebar, so I can evaluate
strategy quality without executing any trades.

**Why this priority**: FinRL-X is the quant engine. Without it, the system is a chart viewer with
overlays. With it, the system can produce strategy-quality research signals grounded in backtest
evidence.

**Independent Test**: Call `POST /api/market/finrlx/backtest` with AAPL / MSFT / NVDA candle data,
verify a `BacktestRun` record is written to Postgres and Neo4j, and verify portfolio weights sum
to approximately 1.0.

**Acceptance Scenarios**:

1. **Given** historical candles for AAPL/MSFT/NVDA, **When** a FinRL-X backtest is triggered,
   **Then** a `BacktestRun` node is created in Neo4j and a `market.backtest_runs` row in Postgres.
2. **Given** a completed backtest, **When** portfolio weights are returned, **Then**
   `sum(weights) ≈ 1.0` and all weights are `≥ 0.0`.
3. **Given** backtest data, **When** `directional_accuracy` and `sharpe_ratio` are returned,
   **Then** both values are finite (not NaN or infinity).
4. **Given** FinRL-X is the engine, **When** backtest runs, **Then** no order is submitted to
   Alpaca or any broker. The backtest is purely historical.

---

### User Story 4 — View Chronos Forecast Overlay on the Chart (Priority: P2)

As Jeremiah, I want a Chronos-Bolt Small close-price forecast overlay on the chart, clearly labeled
as research-only, so I can see a model projection without trusting it as execution guidance.

**Independent Test**: Call Chronos forecast endpoint with AAPL 1Day data, verify `forecast_line`
and `confidence_band` appear on the chart labeled "Chronos forecast (research only)".

**Acceptance Scenarios**:

1. **Given** the model is loaded at startup, **When** forecast is called, **Then** `forecast_line`
   and `confidence_band` are returned with correct length, no NaN, and future timestamps.
2. **Given** the model is unavailable, **When** called, **Then** `model_status: "not_configured"`
   with HTTP 200.
3. **Given** forecast is rendered, **When** the page is inspected, **Then** a disclaimer reads
   "Research only — not investment advice."

---

### User Story 5 — View Kronos Ghost Candles on the Chart (Priority: P3)

As Jeremiah, I want Kronos Small OHLCV ghost candles after the last real candle, rendered
translucently, so I can see a projected future K-line shape as a research-only visual signal.

**Independent Test**: Call Kronos forecast endpoint with AAPL 1Day data, verify 20 ghost candles
appear on chart after the last real candle with valid OHLC relationships.

**Acceptance Scenarios**:

1. **Given** the model is loaded, **When** called, **Then** every ghost candle satisfies
   `h >= max(o,c)` and `l <= min(o,c)`.
2. **Given** ghost candles render, **When** inspected, **Then** they are visually distinct from
   real candles (translucent fill, different border).
3. **Given** input candles lack `amount`, **When** processed, **Then** `a = close * volume`
   is derived automatically.

---

### User Story 6 — View OSINT/WorldSignals Evidence in the Research Sidebar (Priority: P3)

As Jeremiah, I want external infrastructure and world signals relevant to a ticker to appear in
the research sidebar as grounded evidence items, so I can see company/sector risk factors
alongside price action without any offensive security tooling.

**Why this priority**: OSINT evidence adds research depth beyond filings and price. It belongs in
the backend evidence layer, not a visible exploration mode.

**Independent Test**: Call `POST /api/market/worldsignal/ingest` with a ticker and sector, verify
`SignalEvidence` nodes appear in Neo4j connected to the relevant `Ticker` node, and verify those
evidence items appear in the research sidebar.

**Acceptance Scenarios**:

1. **Given** a ticker with Shodan-derived infrastructure exposure data, **When** ingested,
   **Then** a `SignalEvidence` node is written to Neo4j with `source: "shodan"`,
   `evidence_type: "infrastructure_exposure"`, and `disclaimer: "Research only."`.
2. **Given** a signal evidence item, **When** retrieved, **Then** it has provenance:
   `ticker`, `sector`, `collected_at`, `source_url`, `confidence`.
3. **Given** OSINT evidence in Neo4j, **When** rendered in the sidebar, **Then** it appears
   under a "World Signals" section distinct from EDGAR events and forecast results.
4. **Given** the Shodan integration, **When** examined, **Then** no aggressive scanning
   is performed. Only official Shodan API queries using public, organization-attributed data.

---

### User Story 7 — View Research-Only Signals (Priority: P3)

As Jeremiah, I want WAIT, BUY_WATCH, and SELL_WATCH research signals for a selected symbol,
with reason, evidence, confidence, and a disclaimer, so I can see a synthesized research view
without any execution implication.

**Independent Test**: Request signals for AAPL — verify response contains exactly one of
WAIT / BUY_WATCH / SELL_WATCH with reason, confidence, and disclaimer.

**Acceptance Scenarios**:

1. **Given** no forecast data available, **When** signals requested, **Then**
   `label: "WAIT"`, `confidence: 0.0`, with explanation.
2. **Given** signals returned, **When** inspected, **Then** BUY, SELL, LONG, SHORT, OPEN,
   CLOSE do not appear anywhere.
3. **Given** a signal stored, **When** Neo4j is queried, **Then** a `Signal` node exists
   with `disclaimer: "Research only — not investment advice."`.
4. **Given** FinRL-X backtest results and Chronos forecast both support a direction,
   **When** a BUY_WATCH or SELL_WATCH signal is generated, **Then** it includes
   `supported_by` referencing both a `BacktestRun` and at least one `ForecastRun`.

---

## Edge Cases

- **Alpaca returns zero bars**: HTTP 404, `{ "ok": false, "error": { "message": "No candles returned" } }`. No mock data.
- **SEC `company_tickers.json` unavailable**: HTTP 502. Serve from Redis (24h TTL). If cache empty, fail with error.
- **Chronos OOM on 32GB RAM**: Log OOM, set `model_status: "error"`, fall back to `chronos-bolt-tiny`. If neither loads, `model_status: "not_configured"`.
- **Kronos gated on HuggingFace without token**: `model_status: "not_configured"` immediately. Do not crash. Requires `HUGGINGFACE_API_KEY` in env before download.
- **KnowGraph unreachable during ingest**: HTTP 503. Do not partial-write to Neo4j without provenance.
- **Forecast timestamp lands on non-trading day**: Stage 5 extrapolates mechanically. Market calendar correction is a Stage 9 refinement.
- **User requests BUY or SELL signal**: Return `label: "WAIT"` with reason explaining only WAIT/BUY_WATCH/SELL_WATCH are supported.
- **`schema.py` still corrupted**: Stage 0 must fix this before any graph schema work begins. Stage 3 is blocked until Stage 0 passes its gate.
- **FinRL-X backtest lookahead**: Candle slice passed to FinRL-X must contain only bars with `bar_time < ran_at`. Lookahead test must fail before backtest gates pass.
- **Shodan rate limit exceeded**: Cache results for 24 hours per company. Respect Shodan API rate limits. Surface rate limit error to sidebar without crash.

---

## Requirements *(mandatory)*

### Functional Requirements

#### Security and Guardrails

- **FR-001**: The Alpaca candles endpoint MUST return HTTP 503, not mock data, when Alpaca keys are missing.
- **FR-002**: No Alpaca API credential MUST appear in any HTTP response body.
- **FR-003**: No `VITE_` prefixed env var MUST contain an Alpaca key or secret.
- **FR-004**: No route MUST be named `/order`, `/execute`, `/buy`, `/sell`, `/place`, or `/submit-order`.
- **FR-005**: Signal engine MUST NOT produce BUY, SELL, LONG, SHORT, OPEN, or CLOSE labels.
- **FR-006**: Every signal response MUST include `disclaimer: "Research only — not investment advice."`.
- **FR-007**: Mock candle generators MUST NOT be reachable from any market data route serving the trading chart.
- **FR-008**: `/api/knowgraph` routes MUST have `authMiddleware` applied (Stage 0 gate).
- **FR-009**: `services/knowgraph/schema.py` syntax MUST be fixed before any graph schema modifications (Stage 0 gate).
- **FR-010**: Shodan queries MUST use the official Shodan API only. No raw socket scanning. No aggressive enumeration.

#### Stage 0 — Clean House + Security Fence

- **FR-011**: `apps/backend/.env` MUST be confirmed in `.gitignore`.
- **FR-012**: All committed API keys (OpenAI, OpenRouter, LangSmith, Tavily, Alpaca) MUST be rotated.
- **FR-013**: `JWT_SECRET_KEY` MUST be replaced with a ≥ 64-character cryptographically random hex string.
- **FR-014**: `SESSION_SECRET` MUST be replaced with a ≥ 64-character cryptographically random hex string.
- **FR-015**: `authMiddleware` MUST be applied to `/api/knowgraph` routes before Stage 1 ships.
- **FR-016**: `services/knowgraph/schema.py` syntax errors on lines 91–99 MUST be fixed.
- **FR-017**: Mock trading buttons (ENTER TRADE, EXIT TRADE) MUST be removed from `tradingui.tsx`.
- **FR-018**: Mock signals strip and mock chat responses MUST be removed from `tradingui.tsx`.
- **FR-019**: TradingView CDN widget MUST be removed from `tradingui.tsx`.
- **FR-020**: All hidden/removed features MUST be documented in `docs/disabled-features.md` before removal.

#### Stage 1 — Alpaca Candles Endpoint

- **FR-021**: MUST expose `GET /api/market/alpaca/candles?symbol=&timeframe=&limit=`.
- **FR-022**: Candles MUST be normalized to `{ t, o, h, l, c, v, a? }`.
- **FR-023**: `timeframe` MUST be validated against: `1Min`, `5Min`, `15Min`, `1Hour`, `1Day`.
- **FR-024**: `symbol` MUST match `[A-Z]{1,10}`.
- **FR-025**: `limit` MUST be 1–1000, default 256.

#### Stage 2 — Lightweight Charts Trading Desk UI

- **FR-026**: `TradingChart` MUST use `lightweight-charts` npm package.
- **FR-027**: TradingView CDN (`s3.tradingview.com/tv.js`) MUST be removed.
- **FR-028**: Chart MUST accept `forecastLine`, `confidenceBand`, `ghostCandles`, `eventMarkers`, `osintMarkers` as optional props.
- **FR-029**: The page MUST display "Research only — not investment advice." visibly.
- **FR-030**: ENTER TRADE and EXIT TRADE buttons MUST be absent.

#### Stage 3 — FinRL-X Engine Integration

- **FR-031**: FinRL-X MUST be installed in `apps/python-models/`.
- **FR-032**: A `CandleToFinRLXAdapter` MUST convert LiquidAIty `{ t, o, h, l, c, v }` candles to FinRL-X `DataFrame` format.
- **FR-033**: A `FinRLXToSignalAdapter` MUST convert FinRL-X portfolio weights to LiquidAIty `ResearchSignal` / `ForecastRun` records.
- **FR-034**: MUST expose `POST /api/market/finrlx/backtest`.
- **FR-035**: Backtest MUST use only bars with `bar_time < ran_at` (no lookahead).
- **FR-036**: FinRL-X MUST NOT submit orders to Alpaca or any broker in this spec.
- **FR-037**: `BacktestRun` records MUST be written to both `market.backtest_runs` (Postgres) and Neo4j.

#### Stage 4 — SEC EDGAR + EdgarTools

- **FR-038**: CIK lookup MUST use `https://www.sec.gov/files/company_tickers.json` (free, no auth).
- **FR-039**: Submissions MUST use `https://data.sec.gov/submissions/CIK{padded_cik}.json` (free, no auth).
- **FR-040**: CIK MUST be cached in Redis with 24h TTL. Submissions with 6h TTL.
- **FR-041**: Only `10-K`, `10-Q`, `8-K`, `4`, `13F-HR` form types MUST be ingested.
- **FR-042**: Every Filing node MUST include `source: "sec_edgar"`, `provenance_confidence: 1.0`, `created_at`.
- **FR-043**: `edgartools` MUST be added to `apps/python-models/requirements.txt`.
- **FR-044**: Parsed filing chunks MUST appear in `ag_catalog.rag_chunks`.

#### Stage 5 — Chronos-Bolt Small Forecast

- **FR-045**: Primary model: `amazon/chronos-bolt-small`. Fallback: `amazon/chronos-bolt-tiny`.
- **FR-046**: Model MUST be loaded once at startup, not per request.
- **FR-047**: Inference MUST run CPU-only (`device: "cpu"`). No CUDA.
- **FR-048**: Response MUST include `forecast_line` and `confidence_band` of equal length to `forecast_steps`.
- **FR-049**: No NaN or infinity in `forecast_line` or `confidence_band`.
- **FR-050**: `confidence_band[i].hi >= confidence_band[i].lo` MUST hold for every element.

#### Stage 6 — Kronos Small Ghost Candles

- **FR-051**: Primary: `NeoQuasar/Kronos-small`. Tokenizer: `NeoQuasar/Kronos-Tokenizer-base`. Fallback: `NeoQuasar/Kronos-mini`.
- **FR-052**: Inference MUST run CPU-only. No CUDA.
- **FR-053**: If input lacks `a` (amount), derive `a = close * volume`.
- **FR-054**: Every ghost candle MUST satisfy `h >= max(o, c)` and `l <= min(o, c)`.
- **FR-055**: Ghost candles MUST render visually distinct (translucent fill, different border).

#### Stage 7 — OSINT / WorldSignals / Shodan Evidence Layer

- **FR-056**: MUST expose `POST /api/market/worldsignal/ingest` accepting `{ ticker, sector?, query_type }`.
- **FR-057**: Only official Shodan Search API (`https://api.shodan.io/shodan/host/search`) MUST be used.
- **FR-058**: Every `SignalEvidence` node MUST include `source`, `evidence_type`, `ticker`, `collected_at`, `confidence`, `disclaimer: "Research only."`.
- **FR-059**: Shodan results MUST be cached in Redis for 24h per company to respect rate limits.
- **FR-060**: OSINT evidence MUST appear in the research sidebar under a "World Signals" section.
- **FR-061**: OSINT evidence MUST NOT be presented as investment advice or execution signals.

#### Stage 8 — Research-Only Signals

- **FR-062**: Signal engine MUST default to `label: "WAIT"` when no data is available.
- **FR-063**: `BUY_WATCH` MUST require both a Chronos/FinRL-X upward signal AND at least one positive filing/OSINT event.
- **FR-064**: `SELL_WATCH` MUST require both a Chronos/FinRL-X downward signal AND at least one negative filing/OSINT event.
- **FR-065**: Signal nodes MUST be stored in Neo4j with the `Signal` label and full provenance.

#### Stage 9 — Backtest, Scoring, and Trust Layer

- **FR-066**: Every ForecastRun MUST write a row to `market.forecast_runs`.
- **FR-067**: Scoring MUST be blocked until all forecast bar times have elapsed.
- **FR-068**: No lookahead: candle slice MUST contain only bars with `bar_time < ran_at`.
- **FR-069**: Scoring MUST compute `directional_accuracy`, `mae`, `band_calibration`.
- **FR-070**: FinRL-X backtest scoring MUST compute `sharpe_ratio` and `max_drawdown`.

### Key Entities

- **Candle**: OHLCV + amount from Alpaca. `{ t, o, h, l, c, v, a? }`. TimescaleDB `market.candles`.
- **Filing**: SEC EDGAR filing metadata. Neo4j `Filing` node.
- **FilingSection**: Named section from EdgarTools. Neo4j `FilingSection` node.
- **FilingChunk**: Text chunk. Neo4j `FilingChunk` + `ag_catalog.rag_chunks`.
- **ForecastRun**: Chronos inference run record. Postgres `market.forecast_runs` + Neo4j `ForecastRun`.
- **GhostCandle**: Kronos future OHLCV. Postgres `market.ghost_candles`.
- **BacktestRun**: FinRL-X backtest result. Postgres `market.backtest_runs` + Neo4j `BacktestRun`.
- **SignalEvidence**: OSINT/Shodan evidence item. Neo4j `SignalEvidence`.
- **Signal**: Research-only label. Neo4j `Signal`. Constrained to WAIT / BUY_WATCH / SELL_WATCH.
- **Ticker**: Symbol-to-CIK mapping. Neo4j `Ticker`.
- **Company**: SEC company record. Neo4j `Company`.

---

## Implementation Stages

> Stage 0 must complete and pass its gate criteria before any other stage begins.
> Stages proceed sequentially. Do not start Stage N+1 before Stage N passes its gate.

### Stage 0 — Clean House + Security Fence
*Gate: `.env` is gitignored. Keys rotated. Secrets replaced. `schema.py` imports cleanly. Auth on `/api/knowgraph`. No order routes. Mock UI removed from tradingui.tsx. `docs/disabled-features.md` exists and is populated.*

- Confirm `apps/backend/.env` is in `.gitignore`.
- Rotate all committed API keys.
- Replace `JWT_SECRET_KEY` and `SESSION_SECRET` with 64-char random hex strings.
- Apply `authMiddleware` to `/api/knowgraph` routes.
- Fix corrupted syntax in `services/knowgraph/schema.py` lines 91–99.
- Remove mock buttons, mock signals, mock chat, TradingView CDN from `tradingui.tsx`.
- Audit and hide non-trading UI surfaces (see `docs/disabled-features.md`).
- Confirm no `/order`, `/execute`, `/buy`, `/sell` routes exist.
- Confirm no `VITE_ALPACA_*` variables exist.

### Stage 1 — Alpaca Candles Endpoint
*Gate: Live candle endpoint returns real OHLCV. HTTP 503 on missing keys. Validation tests pass.*

- New: `apps/backend/src/routes/market.routes.ts`
- New: `apps/backend/src/services/alpacaService.ts`
- New: `types/trading.ts` (shared TypeScript types)
- Modified: `apps/backend/src/routes/index.ts` (mount `marketRoutes`)

### Stage 2 — Lightweight Charts Trading Desk UI
*Gate: Chart renders Alpaca candles. TradingView CDN removed. Overlay props accepted. Disclaimer visible.*

- Install: `lightweight-charts` in `client/`
- New: `client/src/components/trading/TradingChart.tsx`
- New: `client/src/components/trading/useTradingChart.ts`
- New: `client/src/lib/alpacaClient.ts`
- Modified: `client/src/pages/tradingui.tsx`

### Stage 3 — FinRL-X Engine Integration
*Gate: Backtest endpoint works. Portfolio weights valid. No lookahead. BacktestRun in Postgres + Neo4j.*

- Install: `finrl` or `finrl-x` in `apps/python-models/requirements.txt`
- New: `apps/python-models/app/adapters/candle_to_finrlx.py` — `CandleToFinRLXAdapter`
- New: `apps/python-models/app/adapters/finrlx_to_signal.py` — `FinRLXToSignalAdapter`
- New: `apps/python-models/app/routers/finrlx.py` — `POST /finrlx/backtest`
- Modified: `apps/backend/src/routes/market.routes.ts` — proxy `POST /api/market/finrlx/backtest`
- Modified: `services/knowgraph/schema.py` — add `BacktestRun`, `PRODUCED_BY`
- New SQL: `market.backtest_runs`, `market.backtest_weights` tables

### Stage 4 — SEC EDGAR + EdgarTools
*Gate: Ticker-to-CIK works. Submissions fetched. Ticker + Company + Filing nodes in Neo4j with provenance. Chunks in RAG pipeline.*

- Modified: `apps/backend/src/routes/market.routes.ts` — add SEC endpoints
- Modified: `services/knowgraph/schema.py` — add Ticker, Company, Filing, IDENTIFIES, FILED
- Modified: `apps/python-models/requirements.txt` — add `edgartools`, `httpx`
- Modified: `apps/python-models/app/main.py` — add `POST /edgar/parse`
- New Endpoints: `GET /api/market/sec/ticker/:symbol`, `GET /api/market/sec/submissions/:cik`, `POST /api/market/sec/ingest`, `POST /api/market/sec/parse`

### Stage 5 — Chronos-Bolt Small Forecast
*Gate: `forecast_line` + `confidence_band` returned. No NaN. Chart renders overlay. Model loaded once.*

- Modified: `apps/python-models/requirements.txt` — add `chronos-forecasting`, `torch` (CPU), `pandas`, `numpy`
- Modified: `apps/python-models/Dockerfile` — CPU torch install
- Modified: `apps/python-models/app/main.py` — add `POST /forecast/chronos`
- Modified: `apps/backend/src/routes/market.routes.ts` — proxy `POST /api/market/forecast/chronos`
- Modified: `client/src/components/trading/TradingChart.tsx` — render LineSeries + AreaSeries

### Stage 6 — Kronos Small Ghost Candles
*Gate: `ghost_candles` returned. OHLC valid. Chart renders ghost series translucent. Amount derived correctly.*

- New: Kronos source (`vendor/Kronos/` submodule or `apps/python-models/app/python_models/kronos/` vendor copy)
- Modified: `apps/python-models/app/main.py` — add `POST /forecast/kronos`
- Modified: `apps/backend/src/routes/market.routes.ts` — proxy `POST /api/market/forecast/kronos`
- Modified: `client/src/components/trading/TradingChart.tsx` — render ghost CandlestickSeries

### Stage 7 — OSINT / WorldSignals / Shodan Evidence Layer
*Gate: Shodan ingest endpoint works. SignalEvidence nodes in Neo4j with provenance. Evidence appears in research sidebar. Rate limits respected.*

- New: `apps/backend/src/services/osintService.ts` — Shodan API client
- Modified: `apps/backend/src/routes/market.routes.ts` — add `POST /api/market/worldsignal/ingest`
- Modified: `services/knowgraph/schema.py` — add SignalEvidence, EVIDENCES
- Modified: `client/src/pages/tradingui.tsx` — render World Signals section in sidebar
- **Shodan use case**: Infrastructure exposure per company org name, public service fingerprints for company IP ranges, open port / CVE exposure as risk signals. Use `https://api.shodan.io/shodan/host/search` with `org:` filter. Never scan specific IPs. Never use the Shodan Exploits API.

### Stage 8 — Research-Only Signals
*Gate: WAIT is default. BUY/SELL never appear. Disclaimer in response and UI. Signals stored in Neo4j. Combined evidence (Chronos + FinRL-X + EDGAR + OSINT) works.*

- Modified: `apps/backend/src/routes/market.routes.ts` — add `GET /api/market/ticker/:symbol/signals`
- Modified: `services/knowgraph/schema.py` — add Signal, ForecastRun, PRODUCES_SIGNAL, SUPPORTED_BY

### Stage 9 — Backtest, Scoring, and Trust Layer
*Gate: ForecastRun in Postgres. Scoring works. Lookahead test passes. directional_accuracy, mae, sharpe_ratio, max_drawdown all computed.*

- New SQL: `market.forecast_runs`, `market.forecast_points`, `market.ghost_candles` tables
- Modified: `apps/backend/src/routes/market.routes.ts` — add `POST /api/market/backtest/score`

### Stage 10 — Future Modes Reopening
*Gate: Trading Desk MVP Stages 0–9 complete. Each mode reopened one at a time using `docs/disabled-features.md`.*

- Reopen Design Mode (Understand Anything dashboard)
- Reopen Code Mode (CodeGraph, Data Formulator, Detailed Mode)
- Reopen Building Mode (NRGSim / Energy Surface)
- Reopen Media Mode (Media Studio Canvas)
- Reopen Science Mode (Skyview/Telescope, Protein)
- Reopen WorldSignals Mode (as visible canvas surface after Stage 7 evidence layer is working)
- Reopen Shopping Mode (no current code — future build)

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `GET /api/market/alpaca/candles?symbol=AAPL&timeframe=1Day&limit=5` returns 5 real OHLCV candles when Alpaca keys are configured.
- **SC-002**: Missing Alpaca keys → HTTP 503 (not mock data) within 200ms.
- **SC-003**: `GET /api/market/sec/ticker/AAPL` returns CIK `0000320193` using only free SEC APIs.
- **SC-004**: `POST /api/market/sec/ingest` with MSFT creates Ticker + Company + Filing nodes in Neo4j.
- **SC-005**: `POST /api/market/finrlx/backtest` with 3 symbols returns portfolio weights summing to approximately 1.0 with no lookahead.
- **SC-006**: `POST /api/market/forecast/chronos` returns `forecast_line` with 20 items, no NaN, within 10 seconds on the i7-1265U.
- **SC-007**: `POST /api/market/forecast/kronos` returns `ghost_candles` where `h >= max(o,c)` and `l <= min(o,c)` for all items.
- **SC-008**: `POST /api/market/worldsignal/ingest` returns `SignalEvidence` nodes in Neo4j with `source: "shodan"` and no aggressive scanning.
- **SC-009**: `GET /api/market/ticker/AAPL/signals` returns `label: "WAIT"` when no forecast data is available.
- **SC-010**: BUY, SELL, LONG, SHORT, OPEN, CLOSE labels do not appear in any API response, Neo4j node, or UI element.
- **SC-011**: No Alpaca key or secret appears in any browser-observable HTTP response.
- **SC-012**: `disclaimer: "Research only — not investment advice."` appears in every signal response and is visible in the UI.
- **SC-013**: A completed backtest has finite `directional_accuracy` (0.0–1.0) and finite `sharpe_ratio`.
- **SC-014**: The trading chart renders real Alpaca candles with no TradingView CDN script tag in the DOM.
- **SC-015**: All disabled features are documented in `docs/disabled-features.md` with git restore steps.

---

## Assumptions

- The user will rotate all exposed API keys before any implementation work begins (Stage 0 gate).
- `ALPACA_DATA_URL` already contains the correct Alpaca market data base URL.
- The Alpaca account is paper-only. This spec does not change that.
- `NeoQuasar/Kronos-small` may require a HuggingFace token. This must be confirmed before Stage 6 and `HUGGINGFACE_API_KEY` added to `.env` if needed.
- Kronos installation method (git submodule vs vendor copy) is decided at Stage 6 implementation time.
- TimescaleDB is already active in the Postgres Docker container. The `market` schema is created fresh.
- `ag_catalog.rag_chunks` and `rag_embeddings` pipeline is reused for filing chunk embeddings without modification.
- FinRL-X paper trading integration (using Alpaca as live/paper broker) is explicitly deferred past Stage 9. It requires its own approval gate.
- Shodan API key (`SHODAN_API_KEY`) must be added to `.env` before Stage 7. The key is not committed.
- All inference is CPU-only. No CUDA, ROCm, or MPS.
- The NX monorepo build system and Docker Compose stack are not modified. No new Docker services are added.
- The broader platform (Understand Anything, NRGSim, Media Studio, etc.) is hidden in Stage 0 but remains in the codebase and recoverable from git at any time.

---

## Business Context

LiquidAIty was originally being built as both a trading platform and a broader AI work/canvas platform.

The broader platform is still possible, and the research was valuable, but launch focus is being
narrowed to trading because:

- Market timing is strong: PDT rule changes may expand retail access.
- Tokenized stocks and digital asset rails are emerging infrastructure.
- Stablecoins and agent payments fit trading desk workflows.
- Alpaca and FinRL-X give a serious, proven trading infrastructure path.
- Chronos/Kronos forecasting models already run locally on CPU.
- SEC EDGAR gives free, authoritative public company intelligence.
- The existing graph/agent/canvas architecture fits trading research very well.
- A focused trading desk is more fundable and shippable than a general AI platform.

The platform modes are preserved in code and documented for recovery, not abandoned.
