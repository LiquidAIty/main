# Tasks: LiquidAIty Trading Intelligence Stack

**Spec**: `specs/003-trading-intelligence-stack/spec.md`
**Last updated**: 2026-06-03 (Stage 0 readiness audit)

---

## Stage 0 — Agent Workspace Launch Cleanup + Security Fence

### ✅ Code Changes Complete

- [x] Created `client/src/config/launchMode.ts` — single launch flag config
- [x] Gated `WORKBENCH_CARD_DESCRIPTORS` in `agentbuilder.tsx` via launch flags
- [x] Gated `deriveVisibleRailItems()` in `agentbuilder.tsx` via launch flags
- [x] Applied `authMiddleware` to `/api/knowgraph` in `apps/backend/src/routes/index.ts`
- [x] Fixed corrupted syntax in `services/knowgraph/schema.py` — imports cleanly (smoke checked: PASS)
- [x] Created `docs/disabled-features.md` — accurate restoration ledger (all statuses are feature-flagged, not removed)
- [x] Created `docs/stage0-launch-cleanup-report.md` — full change log
- [x] Updated `specs/003-trading-intelligence-stack/` — Stage 0 scope, WorldSignals preserved, ShadowBroker future-only

### ✅ Readiness Audit Verified

- [x] `launchMode.ts` flags confirmed: Trading ✅, WorldSignals ✅, Knowledge ✅, Plan ✅ — all others false
- [x] `WORKBENCH_CARD_DESCRIPTORS` gating confirmed in agentbuilder.tsx lines 877–958
- [x] `deriveVisibleRailItems()` gating confirmed in agentbuilder.tsx lines 1334–1395
- [x] `authMiddleware` on `/api/knowgraph` confirmed — no TEMP comment
- [x] `schema.py` Python import smoke check: PASS
- [x] No ALPACA or VITE_ALPACA references in `client/src` — CLEAN
- [x] No `/order`, `/execute`, `/buy`, `/sell` route handlers in backend routes — CLEAN

### ⏳ Intentionally Deferred (User Decision)

- [ ] `tradingui.tsx` mock UI cleanup — user explicitly deferred
  - ENTER TRADE / EXIT TRADE buttons still present (no-op console.log only)
  - Mock signals strip still present (hardcoded tickers, fake confidence)
  - Mock AI chat response still present (setTimeout fake response)
  - TradingView CDN widget still present
  - **Stage 1 backend work does NOT depend on tradingui.tsx being clean**
  - tradingui.tsx cleanup is the next UI task after the Alpaca candles endpoint is working

### ⏳ Env Hardening — Deferred Until Deployment/Launch Setup

- [ ] Key rotation (OpenAI, OpenRouter, LangSmith, Tavily, Alpaca) — deferred, not a Stage 1 blocker
- [ ] JWT_SECRET_KEY / SESSION_SECRET replacement — deferred, not a Stage 1 blocker
- [ ] `.env` gitignore verification — user verifies manually

> **Note**: Env hardening is deferred until the deployment/launch env-manager setup phase.
> For local Stage 1 development: no new secrets may be committed, and no Alpaca keys
> may be exposed to the frontend. This is already verified (VITE_ALPACA scan = clean).

---

## Stage 1 — Alpaca Candles Endpoint

**Status**: READY TO BEGIN — pending user approval to start.
**Prerequisite**: Stage 0 gates all pass (see readiness report).

### Stage 1 Rules (Non-Negotiable)

- Only market data endpoint — no Alpaca order or paper trading endpoints
- Alpaca keys come from `ALPACA_API_KEY_ID`, `ALPACA_API_SECRET_KEY`, `ALPACA_DATA_URL` in `.env`
- Never pass Alpaca keys to the frontend under any field name
- No `VITE_ALPACA_*` environment variables
- Missing keys → HTTP 503, not mock data
- Invalid symbol/timeframe/limit → HTTP 400
- Upstream Alpaca error → HTTP 502
- No mock candle fallback anywhere in the Alpaca code path

### Files to Create

- [ ] `apps/backend/src/routes/market.routes.ts` — new market data route file
  - `GET /api/market/alpaca/candles?symbol=&timeframe=&limit=`
  - Mount at `/api/market` via `apps/backend/src/routes/index.ts`
  - Protected by `authMiddleware`

- [ ] `apps/backend/src/services/alpacaService.ts` — data-only Alpaca client
  - Reads `ALPACA_API_KEY_ID`, `ALPACA_API_SECRET_KEY`, `ALPACA_DATA_URL` from process.env
  - Never exposes keys in responses
  - Returns normalized `Candle[]`: `{ t: string, o: number, h: number, l: number, c: number, v: number }`

- [ ] `types/trading.ts` (shared types)
  - `Candle` type: `{ t: string, o: number, h: number, l: number, c: number, v: number }`
  - `CandleTimeframe` type: `'1Min' | '5Min' | '15Min' | '1Hour' | '1Day'`

### Files to Modify

- [ ] `apps/backend/src/routes/index.ts`
  - Import `marketRoutes` from `./market.routes`
  - Mount: `router.use('/market', authMiddleware, marketRoutes)`

### Validation Rules

- [ ] `symbol` — must match `[A-Z]{1,10}`, reject otherwise → 400
- [ ] `timeframe` — must be one of `1Min | 5Min | 15Min | 1Hour | 1Day` → 400 if invalid
- [ ] `limit` — integer 1–1000, default 256 → 400 if out of range
- [ ] Missing `ALPACA_API_KEY_ID` or `ALPACA_API_SECRET_KEY` → 503 with `{ ok: false, error: { message: "Alpaca market data is not configured." } }`
- [ ] Alpaca upstream error → 502 with error forwarded (no key leakage in message)

### Tests to Write

- [ ] Missing keys → HTTP 503, not mock data
- [ ] Invalid symbol (`aapL`, `123`, empty) → HTTP 400
- [ ] Invalid timeframe (`2Min`, `Daily`) → HTTP 400
- [ ] Limit out of range (0, 1001) → HTTP 400
- [ ] Valid request → normalized `Candle[]` with no extra fields
- [ ] Response body does not contain any Alpaca key or secret string
- [ ] No mock candle generator is reachable from the market route

---

## Stages 2–10 — Pending User Approval

> Do not start any stage below until the user explicitly approves `spec.md`.
> Each stage is also gated by the prior stage passing its acceptance criteria.

- [ ] Stage 2 — Lightweight Charts Trading Desk UI (replaces TradingView CDN)
- [ ] Stage 3 — FinRL-X Engine Integration
- [ ] Stage 4 — SEC EDGAR + EdgarTools
- [ ] Stage 5 — Chronos-Bolt Small Forecast
- [ ] Stage 6 — Kronos Small Ghost Candles
- [ ] Stage 7 — OSINT / WorldSignals / Shodan Evidence Layer
- [ ] Stage 8 — Research-Only Signals
- [ ] Stage 9 — Backtest, Scoring, and Trust Layer
- [ ] Stage 10 — Future Modes Reopening

*Tasks for each stage will be filled here after the user approves the spec and each prior stage passes its gate.*
