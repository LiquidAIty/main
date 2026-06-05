# LiquidAIty — Graph Responsibilities

**Date**: 2026-06-03
**Status**: Authoritative — do not blur these responsibilities.

---

## The Rule

**KnowGraph** stores grounded external evidence — what happened and what source supports it.

**ThinkGraph** stores reasoning and learning — what we tried, did it work, and should we try it again.

**Do not store strategy performance memory in KnowGraph.**
**Do not store raw external evidence in ThinkGraph.**

For Agent Workspace research planning, keep the default flow explicit:

```
ThinkGraph intent/context
  → Research source gathering
  → KnowGraph evidence ingestion
  → Context Builder / Magentic-One next-turn context
```

KnowGraph is not the external search worker. New research plans should not call `knowgraph_query`; existing-KnowGraph search can only use a query tool when that tool is actually implemented and explicitly requested by the user.

---

## KnowGraph (Neo4j)

KnowGraph is the durable external evidence graph.

### What It Stores

| Category | Examples |
|---|---|
| SEC EDGAR filings | 10-K, 10-Q, 8-K, Form 4, 13F-HR, XBRL |
| News and research | Articles, blogs, reports, analyst notes |
| Company / ticker / entity relationships | Ticker → CIK → Company → Sector → Peers |
| Insider transactions | Form 4 buy/sell by insiders |
| Institutional holdings | 13F quarterly positions |
| Macro events | Fed decisions, CPI/PPI releases, GDP prints |
| WorldSignals events | Geospatial events, infrastructure signals, OSINT |
| Prediction-market odds | Crowd-implied probabilities for real-world outcomes |
| Geospatial / world events | Conflict, weather, shipping, port activity |
| Source provenance | URL, retrieved_at, confidence, disclaimer |

### What It Answers

- What happened?
- What source supports it?
- What entity / ticker / sector does it relate to?
- Can we cite or trace it?
- What is the provenance confidence?

### Key Node Types (Planned)

```
Ticker         — symbol, name, exchange, sector
Company        — CIK, name, SIC, description
Filing         — form_type, filed_at, period, CIK, source: "sec_edgar"
FilingSection  — section_name, content_hash
FilingChunk    — text, embedding_text, provenance_confidence
Signal         — label (WAIT/BUY_WATCH/SELL_WATCH), disclaimer, provenance
SignalEvidence — source, evidence_type, confidence, retrieved_at, disclaimer
ForecastRun    — model, ran_at, forecast_steps, model_status
BacktestRun    — strategy, ran_at, symbols, directional_accuracy, sharpe_ratio
PredictionMarketSignal — source, market_id, question, outcome, probability, related_tickers
NewsItem       — headline, source_url, published_at, sentiment
MacroEvent     — event_type, release_date, actual, forecast, prior
WorldSignalEvent — event_type, geography, source, confidence, retrieved_at
```

---

## ThinkGraph (Apache AGE / Postgres)

ThinkGraph is the active reasoning and learning graph.

### What It Stores

| Category | Examples |
|---|---|
| Trading hypotheses | "AAPL breakout likely because of Form 4 cluster + Chronos BUY_WATCH" |
| Agent decisions | Which strategy tool was selected, why |
| Signal outcomes | Was BUY_WATCH followed by an upward move? |
| Forecast scoring | Chronos directional accuracy, MAE, band calibration |
| Backtest results | FinRL-X sharpe_ratio, max_drawdown, per-strategy |
| Market regime memory | "In high-VIX regime, Kronos ghost candles had wider spread" |
| Strategy tool selection history | Which bot/template performed in which regime |
| What worked | Conditions under which signals were validated |
| What failed | Conditions under which signals were wrong |
| Why confidence changed | Evidence changes that updated signal confidence |

### What It Answers

- What did we try?
- Did it work?
- Under what market condition?
- Should this tool/strategy be used again?
- What is the agent's current confidence level and why?

### Key Node Types (Planned)

```
Hypothesis     — statement, created_at, status, confidence
Decision       — agent_id, selected_tool, reasoning, created_at
SignalOutcome  — signal_id, actual_direction, correct, evaluated_at
ForecastScore  — forecast_run_id, directional_accuracy, mae, band_calibration
BacktestScore  — backtest_run_id, sharpe_ratio, max_drawdown, period
RegimeMemory   — regime_label, conditions, performance_summary
StrategyRecord — tool_id, regime, performance_score, use_count, last_used
```

---

## Data Flow

```
External World
  │
  ├── SEC EDGAR → EdgarTools → Filing / Chunk nodes → KnowGraph
  ├── News / Research → NewsItem → KnowGraph
  ├── WorldSignals / Crucix → WorldSignalEvent / SignalEvidence → KnowGraph
  ├── Prediction Markets → PredictionMarketSignal → KnowGraph
  ├── Alpaca Candles → Candle (TimescaleDB market.candles) → [not in graph]
  ├── Chronos Forecast → ForecastRun → KnowGraph + ThinkGraph
  ├── Kronos Ghost Candles → GhostCandle (TimescaleDB) + ThinkGraph
  └── FinRL-X Backtest → BacktestRun → KnowGraph (result) + ThinkGraph (learning)
        │
        ↓
  Signal Engine
  → Signal (WAIT / BUY_WATCH / SELL_WATCH) → KnowGraph
        │
        ↓
  Agent Decision → ThinkGraph
        │
        ↓
  Outcome Evaluation → ThinkGraph
        │
        ↓ (feedback loop)
  Future signal confidence updated
```

---

## QuantMind's Planned Role

QuantMind (planned — not yet integrated) is expected to provide a **finance-aware structured knowledge extraction** layer:

```
Raw financial source (EDGAR filing, news article, research paper)
  → QuantMind knowledge objects (Paper, News, Factor, Thesis)
  → Finance-aware structured representation
  → KnowGraph import (Filing, NewsItem, Concept nodes)
```

This fills the gap between raw text/HTML and clean Neo4j graph nodes.

**QuantMind is not a replacement for KnowGraph, ThinkGraph, EdgarTools, or any other component.**
It is a candidate extraction helper that will be audited before any integration.
