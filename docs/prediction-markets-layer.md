# LiquidAIty — Prediction Markets Layer

**Date**: 2026-06-03
**Status**: Planned — Stage 7. Not MVP for Stages 1–6.

---

## Purpose

Prediction markets provide **crowd-implied probabilities** for real-world outcomes.

These odds are a distinct evidence layer for the Trading Desk — different from news, filings, or price data. They represent what the crowd believes will happen, with money behind those beliefs.

Prediction-market odds can support:
- Trading signal confidence
- Sector / commodity / policy / geopolitical risk assessment
- Event-driven strategy selection
- WorldSignals dashboard cards
- Future `PredictionMarketResearchAgent`

---

## Two-Way Relationship with Trading Signals

Trading signals can also **feed** prediction-market research:

1. Trading Desk detects a market / news / geospatial signal
2. System checks whether prediction-market odds lag or lead that signal
3. Research agent identifies possible mispricing between securities markets and event markets
4. Result: a research note in ThinkGraph, not an automated bet

**No automated betting in MVP.**

---

## PredictionMarketSignal (KnowGraph Node)

This is a first-class KnowGraph evidence node.

```typescript
type PredictionMarketSignal = {
  // Identity
  source: string;               // e.g. "polymarket", "kalshi", "manifold"
  market_id: string;
  market_url: string;
  question: string;             // e.g. "Will the Fed cut rates in September 2026?"
  outcome: string;              // e.g. "Yes", "No", "Biden wins"
  
  // Odds
  probability: number;          // 0.0–1.0
  probability_change_1h: number | null;
  probability_change_24h: number | null;
  probability_change_7d: number | null;
  
  // Liquidity
  volume: number | null;        // total volume in USD
  liquidity: number | null;     // current liquidity pool depth
  
  // Timing
  close_date: string;           // ISO 8601 — when the market closes
  expires_at: string | null;    // ISO 8601
  retrieved_at: string;         // ISO 8601
  
  // Resolution
  resolution_source: string | null;  // e.g. "AP News", "official government source"
  
  // Classification
  event_category: string;       // e.g. "monetary_policy", "geopolitical", "weather", "election"
  geography: string | null;     // e.g. "US", "EU", "Strait of Hormuz", "Iowa"
  
  // Relationships (linked to KnowGraph nodes)
  related_entities: string[];   // company names, people, organizations
  related_tickers: string[];    // e.g. ["XOM", "BP", "SHEL"]
  related_sectors: string[];    // e.g. ["energy", "shipping", "agriculture"]
  related_commodities: string[]; // e.g. ["crude_oil", "wheat", "LNG"]
  related_laws_or_policies: string[]; // e.g. ["IRA", "Basel III", "MiCA"]
  
  // Provenance
  confidence: number;           // 0.0–1.0 — data quality confidence
  provenance: {
    source_url: string;
    retrieved_at: string;
    disclaimer: string;         // "Research only — not investment advice."
  };
};
```

---

## Graph Responsibilities

### KnowGraph
Stores `PredictionMarketSignal` nodes as external evidence.
Relates them to `Ticker`, `Company`, `Sector`, `MacroEvent`, `WorldSignalEvent` nodes.

### ThinkGraph
Stores how the system **used** odds in hypotheses, signal generation, strategy selection, and outcome evaluation.

```
ThinkGraph node: Hypothesis
  → USED_ODDS → KnowGraph: PredictionMarketSignal
  → PRODUCED → KnowGraph: Signal (BUY_WATCH / SELL_WATCH / WAIT)
  → OUTCOME → ThinkGraph: SignalOutcome
```

---

## Geospatialized Prediction Markets

Prediction-market events should be **geospatialized** when possible.

This means connecting event odds to geographic regions, chokepoints, supply chains, and the tickers/commodities exposed to those geographies.

### Examples

| Event | Geography | Related Tickers / Commodities |
|---|---|---|
| Strait of Hormuz conflict | Persian Gulf chokepoint | Crude oil, LNG, tankers (FRO, STNG, DHT) |
| Midwest drought | US Corn Belt, Iowa, Illinois | Corn, wheat, soybeans, food companies (ADM, BG, INGR) |
| US presidential election | US (state-level exposure) | Policy-exposed sectors (defense, pharma, energy) |
| Russia–Ukraine conflict escalation | Eastern Europe | Wheat, natural gas, fertilizer, defense (LMT, RTX, NOC) |
| Atlantic hurricane season | US Gulf Coast, Caribbean | Insurance (ALL, TRV), utilities (D, SO), energy infrastructure |
| Crypto bill passage | US federal | Crypto sector, coinbase (COIN), stablecoin-exposed banks |
| Taiwan conflict | Taiwan Strait | Semiconductors (TSM, ASML, AMAT), shipping (MAERSK) |
| Iran nuclear deal | Middle East | Crude oil, Iran-exposed energy companies |
| Panama Canal drought | Central America | Dry bulk shipping, commodities, agricultural exports |

### Implementation Note

Geospatialization is done at ingest time:
- The `geography` field on `PredictionMarketSignal` contains the geographic scope
- `related_tickers`, `related_sectors`, `related_commodities` are populated by the ingest agent
- Future: map overlay on WorldSignals surface showing live event odds by geography

---

## Supported Prediction Market Sources (Planned)

| Source | Type | Notes |
|---|---|---|
| Polymarket | Decentralized, crypto-settled | High volume, broad coverage |
| Kalshi | Regulated US exchange | CFTC-regulated, USD-settled |
| Manifold Markets | Play-money, community | Research signal quality, not financial |
| PredictIt | Political markets | US elections and policy |

---

## Out of Scope for MVP

| Item | Reason |
|---|---|
| Automated betting | No automated execution in MVP |
| Polymarket / Kalshi order execution | No wallet, no execution API integration |
| Wallet management | Not MVP |
| Legal / jurisdiction routing | Not designed yet |
| Stablecoin settlement for betting | Future stablecoin/tokenized finance work |
| `PredictionMarketBettingAgent` | Requires legal/risk/wallet/user-control design |

---

## Stage Roadmap

| Stage | Prediction Market Work |
|---|---|
| Stages 1–6 | Not yet implemented |
| Stage 7 | `PredictionMarketSignal` ingest → KnowGraph. WorldSignals dashboard cards. Basic research signal integration. |
| Stage 8 | Prediction-market odds used in research signal generation (WAIT / BUY_WATCH / SELL_WATCH with odds as evidence) |
| Future | `PredictionMarketResearchAgent` — cross-market mispricing research |
| Future | `PredictionMarketBettingAgent` — only after legal/risk/wallet/user-control design is approved |
| Future | Geospatial map overlay on WorldSignals surface |
