# LiquidAIty — WorldSignals Architecture

**Date**: 2026-06-03
**Status**: Authoritative — WorldSignals is preserved in source and currently still part of the active product surface discussion.

---

## Status

**WorldSignals is preserved and active.**

It is already wired as a Crucix-based sidecar (`worldsignal/` at repo root, `client/src/components/worldsignal/`).

Do not archive, delete, or hide WorldSignals. It is a show-off and evidence surface for the Trading Desk.

---

## Role

WorldSignals is the **world-event evidence feed** for the AI Agentic Trading Desk.

```
Real-world signals
  → WorldSignals / Crucix collection
  → SignalEvidence nodes → KnowGraph
  → Trading Desk context / research sidebar
  → ThinkGraph hypotheses (if used in a decision)
```

WorldSignals is **not default clutter**.
It is a **connected evidence surface** that grounds trading signals in world events.

---

## Current Implementation

| Layer | Location | Status |
|---|---|---|
| Frontend surface | `client/src/components/worldsignal/WorldSignalSurface.tsx` (43KB) | Preserved — no `launchMode.ts` gating remains |
| Crucix renderer | `client/src/components/worldsignal/crucixNativeRenderer.ts` (19KB) | Preserved |
| Backend sidecar | `worldsignal/` at repo root | Preserved |

---

## Future WorldSignals Signal Types

WorldSignals should eventually collect and structure:

### Financial / Market Intelligence
- Commodity prices and flows
- Energy infrastructure activity (pipelines, LNG terminals, refineries)
- Shipping / AIS vessel tracking
- Port congestion and activity
- Tanker flow and oil storage levels
- Gas flaring (via satellite)

### Geospatial / Geopolitical
- Conflict and military activity
- Trade route disruptions (Suez, Strait of Hormuz, Taiwan Strait, Panama Canal)
- Sanctions and embargo events
- Election and policy outcomes
- Diplomatic events

### Environmental / Climate
- Severe weather events (hurricanes, drought, floods)
- Crop condition and yield signals
- Solar and wind resource signals
- Grid stress events
- Wildfire / natural disaster

### Cyber / Infrastructure Risk
- Critical infrastructure exposure (optional Shodan connector — not a blocker)
- Cyber incident reports
- Data breach events affecting tracked companies

### Prediction-Market Odds
- Crowd-implied probabilities for any of the above outcomes
- See `docs/prediction-markets-layer.md` for full spec

### Macro Signals
- Central bank decisions and forward guidance
- CPI / PPI / GDP / employment releases
- Currency intervention signals
- Sovereign debt events

---

## ShadowBroker

ShadowBroker is a **future reference and inspiration source** for remaking WorldSignals.

- Not currently integrated
- Not a dependency
- Not a Stage 1–8 blocker
- May become a repo-eating candidate when WorldSignals Mode is reopened

---

## Shodan

Shodan is an **optional future connector** for the cyber/infrastructure risk signal type.

- Not currently integrated
- Not required for MVP
- Official Shodan Search API only — no aggressive scanning
- See `specs/003-trading-intelligence-stack/spec.md` Stage 7 for constraints

---

## Stage Roadmap

| Stage | WorldSignals Work |
|---|---|
| Stage 0 | No approved removal. WorldSignals stays preserved while cleanup is still being specified |
| Stage 6 | WorldSignals Evidence Adapter — wire Crucix events into `SignalEvidence` nodes in KnowGraph |
| Stage 7 | Prediction-Market Odds Layer integrated into WorldSignals feed |
| Future | Full WorldSignals Mode (standalone canvas surface reopened) |
| Future | ShadowBroker-style dashboard ideas incorporated |
| Future | Geospatial prediction-market mapping (see `docs/prediction-markets-layer.md`) |
