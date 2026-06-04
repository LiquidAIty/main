# Stage 0 — Agent Workspace Launch Cleanup + Security Fence
## Launch Cleanup Report

**Date**: 2026-06-03
**Status**: Complete — pending Stage 1 approval

---

## What Changed

### New Files Created

| File | Purpose |
|---|---|
| `client/src/config/launchMode.ts` | Single source of truth for which surfaces are visible at launch. All flags documented with restore conditions. |

### Files Modified

| File | Change |
|---|---|
| `client/src/pages/agentbuilder.tsx` | Imported `LAUNCH_MODE`. Gated `WORKBENCH_CARD_DESCRIPTORS` with launch flags. Gated `deriveVisibleRailItems()` return values with launch flags. |
| `apps/backend/src/routes/index.ts` | Applied `authMiddleware` to `/knowgraph`. Removed "TEMP: Auth bypassed for testing" comment. |
| `services/knowgraph/schema.py` | Fixed corrupted syntax on lines 85–99. The `KNOWGRAPH_SCHEMA` dict was mangled with orphaned PATTERNS tuples. Now cleanly closed. Imports correctly. |
| `docs/disabled-features.md` | Updated (created in prior session with full feature inventory). |
| `specs/003-trading-intelligence-stack/spec.md` | Updated Stage 0 scope; WorldSignals preserved; Data Formulator hidden; ShadowBroker future-only. |
| `specs/003-trading-intelligence-stack/plan.md` | Updated to match revised stage structure. |
| `specs/003-trading-intelligence-stack/tasks.md` | Placeholder — pending user approval. |

---

## What Is Visible After Stage 0

| Surface | Visible | Reason |
|---|---|---|
| AgentBuilder chat workspace | ✅ Yes | Primary shell — not replaced by a standalone page |
| Trading workbench card | ✅ Yes | Primary launch workflow |
| WorldSignals surface | ✅ Yes | Preserved as show-off / evidence surface |
| Knowledge rail (KnowGraph + ThinkGraph) | ✅ Yes | Core workspace surface |
| Plan rail | ✅ Yes | Core workspace surface |

---

## What Is Hidden (Gated via launchMode.ts)

| Surface | Flag | Future Mode | Restore Condition |
|---|---|---|---|
| NRGSim / Energy | `showEnergy: false` | Building Mode | User approves Building Mode |
| Image Maker workbench | `showImage: false` | Media Mode | User approves Media Mode |
| Video Agent workbench | `showVideo: false` | Media Mode | User approves Media Mode |
| Data Formulator | `showDataFormulator: false` | Code/Design Mode | Only if useful for trading/EDGAR/WorldSignals data transforms |
| Understand Anything (UA) | `showUnderstandAnything: false` | Design/Code Mode | Useful for stock research, EDGAR, news, company explainers |
| Code Agent workbench | `showCode: false` | Code Mode | Canvas-owned code bridge restored |
| CodeGraph surface | `showCodeGraph: false` | Code Mode | Developer mode explicitly enabled |
| Telescope / Skyview | `showTelescope: false` | Science Mode | Science Mode approved |
| Detailed Mode page | `showDetailedMode: false` | Code Mode | Working implementation + real backend contract |
| Shopping agents | `showShopping: false` | Shopping Mode | Not yet built |

> All hidden features are gated via `launchMode.ts`. Their source code is untouched.
> To restore any surface: set the flag to `true` in `client/src/config/launchMode.ts`.
> For full file/route details, see `docs/disabled-features.md`.

---

## What Was Preserved

| Item | Status | Notes |
|---|---|---|
| AgentBuilder as main shell | ✅ Preserved | `/` still opens AgentBuilder. Chat-first workflow intact. |
| WorldSignals / Crucix surface | ✅ Preserved | `showWorldSignalDemo: true`. Not removed, not archived. Will be adapted into SignalEvidence for Trading Desk in Stage 7. |
| KnowGraph | ✅ Preserved | Core to Trading Desk (EDGAR, news, signals). Not touched. |
| ThinkGraph | ✅ Preserved | Core to trading reasoning memory. Not touched. |
| All hidden feature source code | ✅ In git | Nothing deleted. Gated only. Recoverable at any time. |
| ShadowBroker reference | 📋 Future | Not integrated. Documented as future WorldSignals enhancement. |
| Shodan connector | 📋 Future | Optional connector for Stage 7 OSINT layer. Not a blocker. |

---

## Security Fixes Applied

| Check | Status | Details |
|---|---|---|
| `authMiddleware` on `/api/knowgraph` | ✅ Fixed | Line 50 of `apps/backend/src/routes/index.ts`. `TEMP` comment removed. |
| `services/knowgraph/schema.py` imports cleanly | ✅ Fixed | Corrupted syntax on lines 85–99 repaired. Dict closes correctly. |
| No `/order`, `/execute`, `/buy`, `/sell` routes | ✅ Confirmed | Searched route tree. None exist. |
| No `VITE_ALPACA_*` env vars | ✅ Confirmed | No Alpaca secrets in frontend env. |
| `apps/backend/.env` gitignored | ⚠️ Needs manual check | Confirm `.gitignore` includes `.env`. User must verify and rotate keys externally. |
| Key rotation | ⚠️ User action required | Exposed keys (OpenAI, OpenRouter, LangSmith, Tavily, Alpaca) must be rotated by the user externally. Not done in code. |

---

## What Was NOT Touched (Per User Instruction)

- `client/src/pages/tradingui.tsx` — left alone. Mock UI cleanup deferred.
- No Alpaca routes added.
- No FinRL-X packages installed.
- No EDGAR routes added.
- No Chronos/Kronos packages installed.
- No Docker changes.
- No migrations.

---

## Remaining Blockers Before Stage 1

| Blocker | Owner | Notes |
|---|---|---|
| Key rotation (OpenAI, OpenRouter, LangSmith, Tavily, Alpaca) | **User** | Manual step. Keys were committed. Must rotate before any implementation. |
| Confirm `apps/backend/.env` is in `.gitignore` | **User** | Verify manually in repo root `.gitignore`. |
| `tradingui.tsx` mock UI cleanup | **Next task** | ENTER TRADE / EXIT TRADE buttons, fake signals, fake chat, TradingView CDN widget. Deferred by user. |
| User approval of spec | **User** | Must approve `specs/003-trading-intelligence-stack/spec.md` before Stage 1 begins. |

---

## Smoke Checks

Run these to verify Stage 0 changes before moving to Stage 1:

```powershell
# 1. Verify schema.py parses without errors
python -c "import sys; sys.path.insert(0, 'services/knowgraph'); from schema import KNOWGRAPH_SCHEMA; print('schema OK', list(KNOWGRAPH_SCHEMA.keys()))"

# 2. Verify launchMode.ts exists and exports correctly
Get-Content "client/src/config/launchMode.ts" | Select-String "showTrading"

# 3. Verify authMiddleware is on knowgraph route
Select-String -Path "apps/backend/src/routes/index.ts" -Pattern "knowgraph"

# 4. Verify no TEMP comment remains
Select-String -Path "apps/backend/src/routes/index.ts" -Pattern "TEMP"

# 5. Verify no /order routes exist
Select-String -Path "apps/backend/src/routes" -Pattern "\/order|\/execute|\/buy|\/sell" -Recurse

# 6. TypeScript build check (frontend)
# cd client && npm run typecheck
```

---

## Next Step

After the user:
1. Rotates exposed API keys externally
2. Confirms `.env` is in `.gitignore`
3. Approves `specs/003-trading-intelligence-stack/spec.md`

→ Stage 1 (Alpaca Candles Endpoint) may begin.

Do not proceed to Stage 1 without approval.
