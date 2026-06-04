# Disabled Features Restoration Ledger

**Created**: 2026-06-03
**Last Updated**: 2026-06-03 (Stage 0 — Agent Workspace Launch Cleanup)
**Purpose**: Track all features hidden or gated during Stage 0 so the broader
LiquidAIty platform can be restored cleanly when each future mode is ready.

**Philosophy**: The broader AI canvas/platform vision stays alive.
This ledger records where features went, not that they were destroyed.

---

> ⚠️ **Accuracy rule**: Do not say "removed" if only gated. Do not say "hidden"
> unless a launch flag or route gate actually suppresses it. Every entry must
> reflect real code state. Update this file when code state changes.

---

## How to Restore Any Feature

**To show a surface again**: Set the flag to `true` in
[`client/src/config/launchMode.ts`](../client/src/config/launchMode.ts).
The source code is untouched. No git recovery needed for gated features.

**To recover a deleted resource from git**:
```powershell
# View a file before a specific commit
git show HEAD:client/src/pages/tradingui.tsx

# Restore a file to its HEAD state
git checkout HEAD -- client/src/pages/tradingui.tsx

# List commits touching a file
git log --oneline -- client/src/pages/agentbuilder.tsx
```

---

## Status Legend

| Status | Meaning |
|---|---|
| `feature-flagged` | Launch flag in `launchMode.ts` set to `false`. Source code untouched. Toggle to restore. |
| `route-removed` | Route removed from `app.tsx`. Source file kept. Add route back to restore. |
| `removed` | Code deleted. Recoverable from git only. |
| `hidden` | Surface not wired to any route or rail. Code exists but not reachable. |

---

## Features Gated in Stage 0

---

### 1. NRGSim / Energy Surface

| Field | Value |
|---|---|
| **Name** | NRGSim / Energy Surface |
| **Launch flag** | `showEnergy: false` in `client/src/config/launchMode.ts` |
| **Status** | `feature-flagged` — source untouched |
| **Affected files** | `client/src/features/energy/` (6 files), `client/src/components/energy/EnergyFacadeSurface` (lazy-loaded), `client/src/features/modelWizard/pascal/` |
| **Affected surface** | `WORKBENCH_CARD_DESCRIPTORS` entry `id: 'energy'` excluded when flag is false; `deriveVisibleRailItems` `showEnergy` gated |
| **Why hidden** | Energy simulation backend (EnergyPlus / NRGSIM / JEPlus) does not exist in Docker Compose stack. Surface already shows an error boundary. Showing the card misleads users. |
| **Future mode** | Building Mode |
| **Restore** | Set `showEnergy: true` in `launchMode.ts`. The `EnergyFacadeSurface` error boundary already handles missing backend gracefully. |
| **Restore condition** | Building Mode explicitly approved by user. |

---

### 2. Image Maker Workbench

| Field | Value |
|---|---|
| **Name** | Image Maker Agent |
| **Launch flag** | `showImage: false` in `client/src/config/launchMode.ts` |
| **Status** | `feature-flagged` — source untouched |
| **Affected files** | `client/src/features/media/MediaStudioCanvas.tsx`, related media feature files |
| **Affected surface** | `WORKBENCH_CARD_DESCRIPTORS` entry `id: 'image'` excluded; `deriveVisibleRailItems` `showImage` gated |
| **Why hidden** | No image generation backend bridge exists. Card copy already says "Runtime is disabled until the image generation bridge exists." Showing it misleads users. |
| **Future mode** | Media Mode — social sharing, trade reports, signal explainers, marketing clips |
| **Restore** | Set `showImage: true` in `launchMode.ts`. |
| **Restore condition** | Media Mode approved. Image generation backend bridge exists. |

---

### 3. Video Agent Workbench

| Field | Value |
|---|---|
| **Name** | Video Agent |
| **Launch flag** | `showVideo: false` in `client/src/config/launchMode.ts` |
| **Status** | `feature-flagged` — source untouched |
| **Affected files** | `client/src/features/media/` (video-related files) |
| **Affected surface** | `WORKBENCH_CARD_DESCRIPTORS` entry `id: 'video'` excluded; `deriveVisibleRailItems` `showVideo` gated |
| **Why hidden** | No video generation backend bridge exists. |
| **Future mode** | Media Mode — social sharing, trade report recaps, signal explainer clips |
| **Restore** | Set `showVideo: true` in `launchMode.ts`. |
| **Restore condition** | Media Mode approved. Video generation backend bridge exists. |

---

### 4. Data Formulator

| Field | Value |
|---|---|
| **Name** | Data Formulator |
| **Launch flag** | `showDataFormulator: false` in `client/src/config/launchMode.ts` |
| **Status** | `feature-flagged` — source untouched |
| **Affected files** | `client/src/components/dataformulator/DataFormulatorSurface.tsx` |
| **Affected surface** | `WORKBENCH_CARD_DESCRIPTORS` entry `id: 'data-formulator'` excluded; `deriveVisibleRailItems` `showDataFormulator` gated |
| **Why hidden** | Not working. Must not weaken the MVP. |
| **Future mode** | Code Mode or Design Mode (TBD) |
| **Restore** | Set `showDataFormulator: true` in `launchMode.ts`. |
| **Restore condition** | Only if directly useful for trading data transforms, chart transforms, EDGAR data shaping, or WorldSignals data shaping. Explicit user approval required. |

---

### 5. Understand Anything (UA Dashboard)

| Field | Value |
|---|---|
| **Name** | Understand Anything Workbench |
| **Launch flag** | `showUnderstandAnything: false` in `client/src/config/launchMode.ts` |
| **Status** | `feature-flagged` — source untouched |
| **Affected files** | `client/src/runtime/uaAgentDefinitions.ts`, `client/src/components/agents/ua/`, `client/src/components/agents/ua/real-dashboard/` |
| **Affected surface** | `WORKBENCH_CARD_DESCRIPTORS` UA agent entries excluded; `deriveVisibleRailItems` `uaAgents` returns `[]` when flag is false |
| **Why hidden** | Belongs to the broader canvas platform vision, not the Trading Desk MVP. Adds nav complexity for a first-time trading user. |
| **Future mode** | Design Mode or Code Mode |
| **Restore** | Set `showUnderstandAnything: true` in `launchMode.ts`. UA agent definitions are already fully wired. |
| **Restore condition** | Useful for stock research, EDGAR interpretation, news research, or company explainers. |

---

### 6. Code Agent Workbench

| Field | Value |
|---|---|
| **Name** | Code Agent |
| **Launch flag** | `showCode: false` in `client/src/config/launchMode.ts` |
| **Status** | `feature-flagged` — source untouched |
| **Affected surface** | `WORKBENCH_CARD_DESCRIPTORS` entry `id: 'code'` excluded; `deriveVisibleRailItems` `showCode` gated |
| **Why hidden** | Canvas-owned code bridge is not restored. |
| **Future mode** | Code Mode |
| **Restore** | Set `showCode: true` in `launchMode.ts`. |
| **Restore condition** | Canvas-owned code bridge restored and working. |

---

### 7. CodeGraph Surface

| Field | Value |
|---|---|
| **Name** | CodeGraph Surface |
| **Launch flag** | `showCodeGraph: false` in `client/src/config/launchMode.ts` |
| **Status** | `feature-flagged` — not currently wired to the card rail; source untouched |
| **Affected files** | `client/src/components/codegraph/CodeGraphSurface.tsx`, `CodeGraphScene.tsx`, `CodeGraphFilterPanel.tsx` |
| **Why hidden** | Developer tool, not a trading desk surface. Confusing for first-time trading users. |
| **Future mode** | Code Mode (internal developer mode) |
| **Restore** | Set `showCodeGraph: true` in `launchMode.ts` and wire CodeGraph into the canvas surface switcher. |
| **Restore condition** | Developer mode explicitly enabled by user. |

---

### 8. Skyview / Telescope / JWST Explorer

| Field | Value |
|---|---|
| **Name** | Skyview / Telescope / Citizen Science |
| **Launch flag** | `showTelescope: false` in `client/src/config/launchMode.ts` |
| **Status** | `hidden` — not wired to any active route or card rail; source untouched |
| **Affected files** | `client/src/components/skyview/JwstImageExplorer.tsx`, `TelescopeCanvas.tsx`, `TelescopeOverlay.tsx`, `SkyDirectionSelector.tsx`, `SkyObjectPanel.tsx`, `skyTiles.ts`, `telescopeMetadata.ts`, `types.ts` |
| **Why hidden** | Astronomy/geospatial experiment unrelated to the trading desk. |
| **Future mode** | Science Mode |
| **Restore** | Add a route and surface card for `skyview`. Set `showTelescope: true` in `launchMode.ts`. |
| **Restore condition** | Science Mode approved by user. |

---

### 9. Detailed Mode Page

| Field | Value |
|---|---|
| **Name** | Detailed Mode (Model Training Experiment) |
| **Launch flag** | `showDetailedMode: false` in `client/src/config/launchMode.ts` |
| **Status** | `route-removed` — the `/detailed` route is present in `app.tsx` but the page is a raw scaffold. Route should be removed or gated when tradingui cleanup occurs. |
| **Affected files** | `client/src/pages/detailedmode.tsx` |
| **Affected route** | `/detailed` in `client/src/app.tsx` |
| **Why hidden** | Monaco editor scaffold with hardcoded `dash/alpha` selectors and a "Start Model Training" button with no production backend contract. Looks unfinished. |
| **Future mode** | Code Mode |
| **Restore** | Keep route in `app.tsx` or add it back. Source file needs real backend contract before it is useful. |
| **Restore condition** | Working implementation with real `/api/models/train` backend contract. |

---

### 10. Protein / Science Surface

| Field | Value |
|---|---|
| **Name** | Protein Starter Pack (AlphaFold/Science) |
| **Status** | `hidden` — not wired to any route or surface |
| **Affected files** | `client/src/components/protein/proteinStarterPack.ts` |
| **Why hidden** | Science mode research artifact. Not part of trading desk MVP. |
| **Future mode** | Science Mode |
| **Restore** | Wire into science mode surface. |
| **Restore condition** | Science Mode approved by user. |

---

### 11. R3F / Three.js Smoke Test

| Field | Value |
|---|---|
| **Name** | R3F Smoke Test |
| **Status** | `hidden` — not wired to any route |
| **Affected files** | `client/src/components/modeling/R3FSmokeTest.tsx` |
| **Why hidden** | Development smoke test, not user-facing. |
| **Future mode** | Building Mode or Media Mode |
| **Restore** | Add as `/dev/r3f-smoke` dev route if needed. |
| **Restore condition** | Active development of Building Mode or Media Mode. |

---

## WorldSignals — Preserved (NOT Hidden)

| Field | Value |
|---|---|
| **Name** | WorldSignals / Crucix Surface |
| **Launch flag** | `showWorldSignalDemo: true` — **deliberately kept visible** |
| **Status** | `preserved` — source untouched, flag is `true` |
| **Files** | `client/src/components/worldsignal/WorldSignalSurface.tsx` (43KB), `client/src/components/worldsignal/crucixNativeRenderer.ts` (19KB) |
| **Why kept** | WorldSignals is a show-off and evidence surface. It will later be adapted into the SignalEvidence layer for the Trading Desk (Stage 7). Do not archive or delete it. |
| **Future path** | Stage 7 will use WorldSignals as a backend evidence feed (OSINT/Shodan results). The canvas surface may be enhanced with ShadowBroker-style ideas. |
| **ShadowBroker** | Future reference/inspiration for WorldSignals enhancement. Not currently integrated. |
| **Shodan** | Optional future connector for Stage 7 OSINT layer. Not a blocker. Not currently integrated. |

---

## Mock UI Items in tradingui.tsx (Deferred — Not Yet Cleaned)

These items were identified as needing removal but the user deferred `tradingui.tsx` cleanup.
They are documented here for the next cleanup task.

| Item | Status | Notes |
|---|---|---|
| ENTER TRADE / EXIT TRADE buttons | `to-remove` | `console.log()` only. Look like execution buttons. |
| Mock signals strip | `to-remove` | Hardcoded YLV8/TLOB/CRON/ARMA tickers with fake confidence. |
| Mock AI chat response | `to-remove` | `setTimeout` fake response. Violates no-fake-product-behavior rule. |
| TradingView CDN widget (`tv.js`) | `to-remove` | Cannot accept custom candles. Replaced by `lightweight-charts` in Stage 2. |

---

## Platform Mode Roadmap

| Mode | Features to Restore | launchMode.ts flag |
|---|---|---|
| **Trading Mode (MVP)** | Already primary mode | `showTrading: true` |
| **WorldSignals Mode** | Already visible as demo; full mode later | `showWorldSignalDemo: true` |
| **Design Mode** | Understand Anything | `showUnderstandAnything: true` |
| **Code Mode** | Code Agent, CodeGraph, Detailed Mode | `showCode: true`, `showCodeGraph: true`, `showDetailedMode: true` |
| **Building Mode** | NRGSim / Energy, R3F | `showEnergy: true` |
| **Media Mode** | Image Maker, Video Agent | `showImage: true`, `showVideo: true` |
| **Science Mode** | Telescope/Skyview, Protein | `showTelescope: true` |
| **Shopping Mode** | Not yet built | `showShopping: true` (future) |

*This file is a living document. Update it whenever a feature is hidden, restored, or its status changes.*
