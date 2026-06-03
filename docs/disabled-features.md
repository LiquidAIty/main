# Disabled Features Restoration Ledger

**Created**: 2026-06-03
**Purpose**: Track all features hidden, feature-flagged, or removed during Stage 0
(Clean House + Security Fence) so that the broader LiquidAIty platform can be
restored cleanly when each future mode is ready.

**Philosophy**: The broader AI canvas/platform vision stays alive. This ledger
records where it went, not that it was destroyed.

---

> ⚠️ This file must be updated every time a feature is hidden or removed.
> Do not hide or remove features without adding a row here first.
> Restore steps must use `git` — do not restore from memory.

---

## Ledger Format

Each section describes one feature that was disabled.

| Field | Meaning |
|---|---|
| **Status** | `hidden` (route/nav removed but code intact) / `feature-flagged` (guarded behind env or prop) / `archived` (code moved to `src/_archive/`) / `removed` (deleted, git-recoverable) |
| **Future Mode** | Which platform mode will restore it |
| **Restore** | Git command to view or recover the file state |

---

## Features Disabled in Stage 0

---

### 1. Detailed Mode (Model Training Experiment)

| Field | Value |
|---|---|
| **Name** | Detailed Mode |
| **Files** | `client/src/pages/detailedmode.tsx` |
| **Route** | `/detailed` in `client/src/app.tsx` |
| **Status** | `hidden` — route removed from `app.tsx`; source file left intact |
| **Why disabled** | The page is a raw scaffolding experiment: Monaco editor, hardcoded `dash/alpha` / `knowledge/graph` selectors, Start Model Training button with no production backend contract. It looks unfinished to a first-time visitor. |
| **Future Mode** | Code Mode |
| **Restore route** | Add back to `app.tsx`: `<Route path="/detailed" element={<DetailedMode />} />` |
| **Restore git** | `git show HEAD:client/src/pages/detailedmode.tsx` |
| **Owner** | future |

---

### 2. NRGSim / Energy Surface (Building Modeling)

| Field | Value |
|---|---|
| **Name** | NRGSim Energy Surface |
| **Files** | `client/src/features/energy/` (6 files: createEnergyRunPrepManifest.ts, energyModelSchema.ts, energyModelValidation.ts, jeplusFacadeTemplate.ts, pascalEnergyAdapter.ts, solarPosition.ts), `client/src/components/energy/EnergyFacadeSurface` (lazy-loaded in agentbuilder.tsx), `client/src/features/modelWizard/pascal/` |
| **Surface ID** | `'energy'` in `WorkbenchSurfaceId` |
| **Workbench card** | `card_energy_workbench` / `template_energy_workbench` |
| **Status** | `hidden` — the workbench card descriptor will be moved behind a feature flag; source files left intact |
| **Why disabled** | The energy simulation backend (EnergyPlus / NRGSIM / JEPlus runner) does not exist in the Docker Compose stack. The `EnergyFacadeSurface` already has an error boundary labeled "Energy canvas unavailable". Showing it in the card list misleads users. |
| **Future Mode** | Building Mode |
| **Restore** | Remove the feature flag check around `WORKBENCH_CARD_DESCRIPTORS` entry `id: 'energy'` in `agentbuilder.tsx`. |
| **Restore git** | `git show HEAD:client/src/pages/agentbuilder.tsx` |
| **Owner** | future |

---

### 3. Media Studio Canvas (Image / Video Generation)

| Field | Value |
|---|---|
| **Name** | Media Studio Canvas |
| **Files** | `client/src/features/media/MediaStudioCanvas.tsx` (52KB), `client/src/features/media/SceneGraphThreeBlockout.tsx`, `client/src/features/media/generationPacket.ts`, `client/src/features/media/sceneAssetRegistry.ts` (27KB), `client/src/features/media/sceneGraphSource.ts` (21KB), `client/src/features/media/modelCascadePlan.ts`, `client/src/features/media/videoGraphScript.ts`, `client/src/features/media/objectAwareCanvasContext.ts`, `client/src/features/media/sceneGraphMotionPlan.ts`, `client/src/features/media/mediaStudioTypes.ts` |
| **Surface IDs** | `'image'`, `'video'` in `WorkbenchSurfaceId` |
| **Workbench cards** | `card_image_workbench` / `template_image_workbench`, `card_video_workbench` / `template_video_workbench` |
| **Status** | `hidden` — workbench card descriptors moved behind feature flag; source files left intact |
| **Why disabled** | Image generation bridge and video generation bridge are explicitly marked in their `disabledCopy` as "Runtime is disabled until the ... bridge exists." No backend image/video pipeline exists in the current stack. Showing them is misleading. |
| **Future Mode** | Media Mode |
| **Restore** | Remove feature flag check around `id: 'image'` and `id: 'video'` entries in `WORKBENCH_CARD_DESCRIPTORS`. |
| **Restore git** | `git show HEAD:client/src/pages/agentbuilder.tsx` |
| **Owner** | future |

---

### 4. Data Formulator Surface

| Field | Value |
|---|---|
| **Name** | Data Formulator |
| **Files** | `client/src/components/dataformulator/DataFormulatorSurface.tsx` (3.5KB) |
| **Workbench card** | `card_data_formulator_workbench` / `template_data_formulator_workbench` |
| **Surface ID** | `'data-formulator'` |
| **Status** | `hidden` — workbench card moved behind feature flag; source file left intact |
| **Why disabled** | Data Formulator is a useful tool for data exploration but not part of the Trading Desk MVP. Its presence in the card list adds visual noise. |
| **Future Mode** | Code Mode or Design Mode (TBD) |
| **Restore** | Remove feature flag check around `id: 'data-formulator'` entry in `WORKBENCH_CARD_DESCRIPTORS`. |
| **Restore git** | `git show HEAD:client/src/pages/agentbuilder.tsx` |
| **Owner** | future |

---

### 5. WorldSignal Surface (Standalone Canvas Mode)

| Field | Value |
|---|---|
| **Name** | WorldSignal Surface (canvas/standalone mode) |
| **Files** | `client/src/components/worldsignal/WorldSignalSurface.tsx` (43KB), `client/src/components/worldsignal/crucixNativeRenderer.ts` (19KB) |
| **Import** | `WorldSignalSurface` imported directly in `agentbuilder.tsx` line 25 |
| **Surface** | Rendered as a canvas surface inside agentbuilder when `worldsignal` mode is active |
| **Status** | `hidden` from navigation/visible mode list; source files left intact |
| **Why disabled** | WorldSignals is being restructured as a backend OSINT/evidence feed layer rather than a visible canvas surface (Stage 7). The current standalone canvas mode is unfinished and not part of the Trading Desk MVP surface. The backend signal logic will remain. |
| **Future Mode** | WorldSignals Mode (as a trading intelligence evidence layer first, then later as a visible mode) |
| **Restore** | Re-add WorldSignal surface mode to the canvas surface switcher in `agentbuilder.tsx`. |
| **Restore git** | `git show HEAD:client/src/components/worldsignal/WorldSignalSurface.tsx` |
| **Owner** | hidden — backend use continues in Stage 7 |

---

### 6. Understand-Anything (UA) Dashboard Surface

| Field | Value |
|---|---|
| **Name** | Understand Anything Dashboard |
| **Files** | `client/src/runtime/uaAgentDefinitions.ts`, `client/src/components/agents/ua/` (full directory), `client/src/components/agents/ua/real-dashboard/` |
| **Surface ID** | `'ua_dashboard'` |
| **Workbench card** | `template_understand_anything_workbench` |
| **Status** | `hidden` from primary navigation — code intact |
| **Why disabled** | The UA workbench is functional but belongs to the broader canvas platform vision, not the Trading Desk MVP. It adds nav complexity and can confuse a first-time trading user. |
| **Future Mode** | Design Mode or Code Mode (as an analysis tool) |
| **Restore** | Re-add `ua_dashboard` to the primary nav/rail. It is already wired as a `WorkbenchCardDescriptor` via `getUiUaAgentDefinitions()`. |
| **Restore git** | `git show HEAD:client/src/runtime/uaAgentDefinitions.ts` |
| **Owner** | hidden |

---

### 7. CodeGraph Surface

| Field | Value |
|---|---|
| **Name** | CodeGraph Surface |
| **Files** | `client/src/components/codegraph/CodeGraphSurface.tsx`, `client/src/components/codegraph/CodeGraphScene.tsx`, `client/src/components/codegraph/CodeGraphFilterPanel.tsx`, `client/src/components/codegraph/types.ts`, `client/src/components/codegraph/colors.ts` |
| **Surface type** | `'codegraph'` in `WorkspaceTestingSurface` |
| **Status** | `hidden` — surface not exposed in MVP nav; code intact |
| **Why disabled** | CodeGraph is a developer/platform tool, not a trading desk surface. Exposing it to a first-time trading user adds confusion. |
| **Future Mode** | Code Mode |
| **Restore** | Add codegraph back to the canvas surface switcher and nav rail. |
| **Restore git** | `git show HEAD:client/src/components/codegraph/CodeGraphSurface.tsx` |
| **Owner** | future |

---

### 8. Skyview / Telescope Canvas (Astronomy/Geospatial Experiment)

| Field | Value |
|---|---|
| **Name** | Skyview / Telescope / JWST Explorer |
| **Files** | `client/src/components/skyview/JwstImageExplorer.tsx`, `client/src/components/skyview/TelescopeCanvas.tsx`, `client/src/components/skyview/TelescopeOverlay.tsx`, `client/src/components/skyview/SkyDirectionSelector.tsx`, `client/src/components/skyview/SkyObjectPanel.tsx`, `client/src/components/skyview/skyTiles.ts`, `client/src/components/skyview/telescopeMetadata.ts`, `client/src/components/skyview/types.ts` |
| **Status** | `hidden` — not wired to any active route; code intact |
| **Why disabled** | A telescope/astronomy experiment unrelated to the trading desk. Interesting research but not part of MVP. |
| **Future Mode** | Science Mode |
| **Restore** | Add a route and surface card for `skyview`. |
| **Restore git** | `git show HEAD:client/src/components/skyview/TelescopeCanvas.tsx` |
| **Owner** | future |

---

### 9. Protein Starter Pack (AlphaFold/Science Experiment)

| Field | Value |
|---|---|
| **Name** | Protein / Science Surface |
| **Files** | `client/src/components/protein/proteinStarterPack.ts` |
| **Status** | `hidden` — not wired to any active surface |
| **Why disabled** | Science mode research artifact (AlphaFold-style protein analysis). Not part of trading desk MVP. |
| **Future Mode** | Science Mode |
| **Restore** | Wire into science mode surface when Science Mode is reopened. |
| **Restore git** | `git show HEAD:client/src/components/protein/proteinStarterPack.ts` |
| **Owner** | future |

---

### 10. Modeling / 3D Smoke Test (R3F Scene)

| Field | Value |
|---|---|
| **Name** | R3F / Three.js Smoke Test |
| **Files** | `client/src/components/modeling/R3FSmokeTest.tsx` |
| **Status** | `hidden` — not wired to any route |
| **Why disabled** | Development smoke test for Three.js/R3F. Not a user-facing feature. |
| **Future Mode** | Building Mode or Media Mode |
| **Restore** | Add as a dev route `/dev/r3f-smoke` if needed. |
| **Restore git** | `git show HEAD:client/src/components/modeling/R3FSmokeTest.tsx` |
| **Owner** | archived |

---

### 11. Mock Trading Buttons (ENTER TRADE / EXIT TRADE)

| Field | Value |
|---|---|
| **Name** | Mock Trading Buttons |
| **Files** | `client/src/pages/tradingui.tsx` — `GradientBtn` with `onEnterTrade` / `onExitTrade` |
| **Status** | `removed` from tradingui.tsx in Stage 2 — code is in git history |
| **Why disabled** | These buttons call `console.log()` only. They look like execution buttons to a user and would immediately undermine the "research only" trust position. |
| **Future Mode** | Trading Mode (if a paper trading simulation mode is added in Stage 9+) |
| **Restore** | `git show HEAD:client/src/pages/tradingui.tsx` for the original version. Do not restore until execution safety requirements are re-evaluated. |
| **Owner** | removed |

---

### 12. Mock Signals Strip

| Field | Value |
|---|---|
| **Name** | Hardcoded Mock Signals Strip |
| **Files** | `client/src/pages/tradingui.tsx` — `signals` useMemo with hardcoded YLV8/TLOB/CRON/ARMA/OPTM/OPTA tickers and fake confidence percentages |
| **Status** | `removed` from tradingui.tsx in Stage 2 — replaced with real signal display wired to `/api/market/ticker/:symbol/signals` |
| **Why disabled** | Mock signals could be confused for real research data. They have no source, no model, no provenance. |
| **Future Mode** | Trading Mode (real signals replace mock signals in Stage 8) |
| **Restore** | `git show HEAD:client/src/pages/tradingui.tsx` |
| **Owner** | removed |

---

### 13. Mock Chat Responses

| Field | Value |
|---|---|
| **Name** | Hardcoded Mock AI Chat |
| **Files** | `client/src/pages/tradingui.tsx` — `sendChat` function that calls `setTimeout` to insert `"Noted. Confidence checking…"` |
| **Status** | `removed` from tradingui.tsx in Stage 2 — replaced with placeholder or real agent chat |
| **Why disabled** | A fake AI response pretending to be a real agent. Violates the "no fake substitute product behavior" rule. |
| **Future Mode** | Trading Mode (real agent chat wired to backend in a future stage) |
| **Restore** | `git show HEAD:client/src/pages/tradingui.tsx` |
| **Owner** | removed |

---

### 14. TradingView CDN Widget

| Field | Value |
|---|---|
| **Name** | TradingView CDN Widget (`tv.js`) |
| **Files** | `client/src/pages/tradingui.tsx` — `TVChart` component, `<script src="https://s3.tradingview.com/tv.js">` dynamic loader |
| **Status** | `removed` from tradingui.tsx in Stage 2 — replaced with `lightweight-charts` |
| **Why disabled** | Cannot accept custom candle data, cannot render forecast overlays, cannot show ghost candles or EDGAR event markers. Also adds an external CDN dependency that makes the chart harder to control. |
| **Future Mode** | n/a — replaced permanently with `lightweight-charts` |
| **Restore** | `git show HEAD:client/src/pages/tradingui.tsx` for the original CDN version. |
| **Owner** | removed |

---

## Platform Mode Roadmap

When the Trading Desk MVP is stable (Stages 0–9 complete), the following modes
will be reopened one at a time using this ledger as the restoration guide.

| Mode | Features to Restore | Ledger Items |
|---|---|---|
| **Trading Mode** | Trading desk is the MVP — already the primary mode | Items 11–14 (mock removal only) |
| **Design Mode** | Understand Anything dashboard | Item 6 |
| **Code Mode** | CodeGraph, Data Formulator, Detailed Mode | Items 4, 5 (CodeGraph), 1 |
| **Building Mode** | NRGSim / Energy Surface, R3F scene | Items 2, 10 |
| **Media Mode** | Media Studio Canvas (image/video), R3F | Items 3, 10 |
| **Science Mode** | Skyview/Telescope, Protein starter | Items 8, 9 |
| **WorldSignals Mode** | WorldSignal standalone canvas (backend evidence layer first in Stage 7) | Item 5 |
| **Shopping Mode** | No current code — future build | — |

---

## How to Recover Any Disabled Feature

```powershell
# View a file at HEAD (before any Stage 0 changes)
git show HEAD:client/src/pages/tradingui.tsx

# View a specific component before it was disabled
git show HEAD:client/src/components/worldsignal/WorldSignalSurface.tsx

# Restore a deleted or modified file to its HEAD state
git checkout HEAD -- client/src/pages/tradingui.tsx

# See all files changed in Stage 0 commit
git show --stat <stage-0-commit-sha>

# List all commits that touched a file
git log --oneline -- client/src/pages/agentbuilder.tsx
```

---

*This file is a living document. Update it whenever a feature is hidden, archived, or removed.*
*Do not delete rows — mark them as restored and note the restoration commit instead.*
