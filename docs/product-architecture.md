# LiquidAIty — Product Architecture

**Version**: 1.0
**Date**: 2026-06-03
**Status**: Authoritative overview. Current cleanup status must match `specs/003-trading-intelligence-stack/*`, not hidden launch flags or stale notes.

---

## Core Product Identity

LiquidAIty is a **chat-first agent workspace**.

It is not a plain trading app.
It is not a generic ChatGPT/Claude competitor.
It is not a random multi-tool wrapper.

The first launch workflow is the **AI Agentic Trading Desk** — trading is the proving ground because it demands:
- Real market data
- Forecasts with measurable outcomes
- Graph memory (KnowGraph + ThinkGraph)
- AI agents
- WorldSignals / world-event evidence
- Prediction-market crowd odds
- EDGAR/news/research provenance
- FinRL-X quantitative engine
- Future stablecoin / tokenized finance fit

The broader AI canvas platform vision remains alive. Trading is first because it is fundable, shippable, and proves every core system simultaneously.

---

## Product Operating Order

> Follow this order for every new feature, library, or external repo.

1. **Product/spec plan first** — write docs before any code
2. **Stage 0 spec/cleanup pass** — specify the cleanup truthfully before changing the shell
3. **Add/eat outside repos and libraries** — place at repo root, audit in place
4. **Audit and adapt external code** — understand before integrating
5. **Build implementation stages** — sequential, gated
6. **Promote external code deeper** — only after: audit → adaptation plan → tests → approval

---

## External Code Convention

External repos placed at the repo root are **audit candidates**, not production code.

They are placed at the root when the user unzips them. They stay there until audited.

They graduate into `apps/`, `services/`, `packages/`, or other app directories only after:
- Audit completed and documented in `docs/`
- Adaptation plan written and approved
- Tests pass
- User explicitly approves promotion

**There are no intake folders.** External code goes directly to the repo root.

### Known External Code Candidates

| Candidate | Location | Status | Purpose |
|---|---|---|---|
| `quant-mind-master/` | Repo root (planned — not yet unzipped) | Pending spec/cleanup completion | Finance-aware knowledge models, extraction flows |
| `data-formulator-main/` | Repo root | Present — not yet approved for Stage 0 shell cleanup | Data transformation UI; future trading/EDGAR/WorldSignals data shaping only if needed |

---

## Architecture Overview

```
LiquidAIty Canvas (chat-first agent workspace)
  │
  ├── AgentBuilder (main shell)
  │     ├── Chat-first workflow
  │     ├── Trading Desk surface (Stage 1+ primary)
  │     ├── WorldSignals surface (preserved / evidence)
  │     ├── KnowGraph / ThinkGraph rail
  │     └── [legacy and future surfaces still exist; no approved shell reduction yet]
  │
  ↕ API / WebSocket
  │
Backend (Node.js / Express)
  │
  ├── Alpaca Market Data API ─────────── market candles, paper-trading bridge
  ├── SEC EDGAR (EdgarTools / free API) ─ filings, 10-K, 10-Q, 8-K, Form 4, 13F
  ├── WorldSignals / Crucix sidecar ───── world events, OSINT, geospatial signals
  ├── Prediction Market APIs ──────────── crowd odds (Polymarket, Kalshi, Manifold)
  │
  ├── Python Model Service (FastAPI)
  │     ├── Chronos-Bolt Small ────────── close-price forecast line + confidence band
  │     ├── Kronos Small ──────────────── ghost-candle OHLCV K-line forecast
  │     ├── EdgarTools ────────────────── structured EDGAR filing parser
  │     ├── FinRL-X ───────────────────── quant strategy / backtest / portfolio weights
  │     └── [QuantMind — planned after audit] finance-aware knowledge extraction
  │
  ├── KnowGraph (Neo4j) ──────────────── durable external evidence graph
  ├── ThinkGraph (Apache AGE / Postgres) ─ active reasoning / learning graph
  └── Redis ──────────────────────────── caching (SEC API, prediction markets, OSINT)
```

---

## Component Roles (Single Source of Truth)

| Component | Role |
|---|---|
| **AgentBuilder** | Chat-first workspace shell. Always the main entry point. |
| **Trading Desk** | First launch workflow/surface inside AgentBuilder. |
| **WorldSignals** | World-event evidence feed. Crucix-based. Preserved. |
| **Alpaca** | Market data (candles) and paper-trading broker bridge. |
| **EdgarTools** | SEC EDGAR structured filing parser. Preferred EDGAR tool. |
| **FinRL-X** | Python quantitative trading engine (strategy, backtest, portfolio weights). |
| **Chronos** | Future close-price forecast line (`amazon/chronos-bolt-small`). |
| **Kronos** | Future ghost-candle OHLCV K-line forecast (`NeoQuasar/Kronos-small`). |
| **QuantMind** | Planned: finance-aware knowledge extraction → KnowGraph import layer. |
| **Prediction Markets** | Crowd-implied probability evidence layer for WorldSignals and trading signals. |
| **KnowGraph** | Durable external evidence (filings, news, odds, events). See `docs/graph-responsibilities.md`. |
| **ThinkGraph** | Active reasoning memory (decisions, outcomes, strategy learning). See `docs/graph-responsibilities.md`. |
| **Redis** | Response caching for rate-limited external APIs. |

---

## Research-Only Signal Labels

| Label | Meaning |
|---|---|
| `WAIT` | No actionable signal. Default when no data. |
| `BUY_WATCH` | Multiple bullish signals converge. Research only. |
| `SELL_WATCH` | Multiple bearish signals converge. Research only. |

**Forbidden MVP labels**: BUY, SELL, LONG, SHORT, OPEN, CLOSE.
**No live order execution in MVP.**

---

## Current Stage Summary

| Stage | Name | Status |
|---|---|---|
| 0 | Agent Workspace Launch Cleanup + Security Fence | 🔄 Specification reset in progress |
| 0.5 | QuantMind Audit + Adaptation Plan | 🔜 Next — after spec docs complete |
| 1 | Alpaca Candles Backend | ⏳ Pending approval |
| 2 | Trading Chart / Data Path | ⏳ Pending |
| 3 | EdgarTools / SEC EDGAR | ⏳ Pending |
| 4 | FinRL-X Integration | ⏳ Pending |
| 5 | Chronos / Kronos Forecasts | ⏳ Pending |
| 6 | WorldSignals Evidence Adapter | ⏳ Pending |
| 7 | Prediction-Market Odds Layer | ⏳ Pending |
| 8 | Backtest / Scoring / Trust Layer | ⏳ Pending |
| Future | Strategy Tool Registry | 🔮 Not MVP |
| Future | Energy Transition Desk | 🔮 Not MVP |
| Future | Solar Scouting Agent | 🔮 Not MVP |
| Future | Social / Video Trade Reports | 🔮 Not MVP |
| Future | Stablecoin / Tokenized Finance Rails | 🔮 Not MVP |

---

## Future / Legacy Modes (Planning Inventory, Not Proof Of Removal)

See `docs/disabled-features.md` for planning inventory and later recovery notes if Stage 0 removes anything. Do not read this section as proof that the current shell has already been reduced.

| Mode | Description | Gate |
|---|---|---|
| **Design Mode** | Understand Anything dashboard (UA) | Planning inventory only until a real Stage 0 decision is accepted |
| **Code Mode** | CodeGraph, Code Agent, Detailed Mode | Planning inventory only until a real Stage 0 decision is accepted |
| **Building Mode** | NRGSim / Energy Surface | Planning inventory only until a real Stage 0 decision is accepted |
| **Media Mode** | Image Maker, Video Agent (social sharing, trade reports, signal explainers, marketing) | Planning inventory only until a real Stage 0 decision is accepted |
| **Science Mode** | Telescope / Skyview, Protein | Planning inventory only until a real Stage 0 decision is accepted |
| **Energy Transition Desk** | Geospatial/satellite/AIS/weather/commodities/prediction-market energy trades | Future vertical |
| **Solar Scouting Agent** | Land/roof solar scouting, valuation, outreach, tokenized PPA workflows | Future vertical |
| **Shopping Mode** | Not yet built | Future vertical |
| **WorldSignals Mode** | Full standalone WorldSignals canvas | Trading evidence layer first (Stage 6), then fuller mode decisions later |

---

## Classic Strategy Tools (Future — Not MVP)

> The user means **classic retail trading bots and TradingView-style strategy templates**, not full quant repos.

Examples:
- Pine Script strategies
- Alert/webhook bots
- Indicator bots (RSI, MACD, Bollinger, VWAP, etc.)
- Scanner bots
- Simple broker bots
- MT4/MT5 Expert Advisors
- Breakout / reversal / volume / news / liquidity bots

**Future concept: Strategy Tool Registry**

Purpose: Agents select the right tool/bot/template based on market regime, ticker, timeframe, WorldSignals, EDGAR, forecasts, FinRL-X, and prediction-market odds.

Constraints:
- No untrusted code execution
- No live execution
- Not MVP
