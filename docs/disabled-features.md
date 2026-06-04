# Legacy Feature Inventory (Planning Only)

**Created**: 2026-06-03
**Last Updated**: 2026-06-03
**Purpose**: Track non-trading and non-MVP features that still exist in source and may be removed from the active shell later without losing recovery paths.

## Current Truth

This file is a planning inventory.

It does **not** prove that a feature is already turned off, hidden, or removed from the current shell.
Until a Stage 0 cleanup pass is explicitly implemented, assume legacy features may still be present in the board, shell, routes, or source.

## Important Correction

This file is no longer based on `launchMode.ts`.

That file was removed because hidden visibility flags are not the target architecture.
If a feature is inactive, the preferred end state is:

- not seeded into the active default deck, or
- not mounted in the active shell, or
- kept only as source/registry code until explicitly re-added

## Restore Rule

Restore does **not** mean "flip a flag."
Restore means re-adding the relevant card, surface wiring, or route from the real source code that still exists in the repo.

Useful recovery tools:

```powershell
git log --oneline -- client/src/pages/agentbuilder.tsx
git log --oneline -- client/src/runtime/agentCardRegistry.ts
git show HEAD:client/src/pages/agentbuilder.tsx
```

## Status Legend

| Status | Meaning |
|---|---|
| `present-in-source` | Source files and registry/template definitions still exist. |
| `current-shell-presence-possible` | May still be seeded or mounted in the current pre-cleanup shell. |
| `cleanup-candidate` | Planned candidate for a later explicit cleanup pass. |
| `planned-keep` | Intended to remain available for the trading-first shell unless a later spec changes that. |
| `future-restore` | Keep available for later deliberate re-add. |

## Legacy / Non-MVP Features

| Feature | Status | Primary locations | Restore path |
|---|---|---|---|
| NRGSim / Energy | `present-in-source`, `current-shell-presence-possible`, `cleanup-candidate` | `client/src/components/energy/`, `client/src/features/energy/`, `client/src/pages/agentbuilder.tsx` | Re-add or keep the energy card/surface intentionally from source. |
| Image Maker | `present-in-source`, `current-shell-presence-possible`, `cleanup-candidate` | `client/src/features/media/`, `client/src/pages/agentbuilder.tsx` | Re-add image workbench from card/template definitions. |
| Video Agent | `present-in-source`, `current-shell-presence-possible`, `cleanup-candidate` | `client/src/features/media/`, `client/src/pages/agentbuilder.tsx` | Re-add video workbench from card/template definitions. |
| Data Formulator | `present-in-source`, `current-shell-presence-possible`, `cleanup-candidate` | `client/src/components/dataformulator/`, `data-formulator-main/` | Reconnect the real surface if product direction justifies it. |
| Understand Anything | `present-in-source`, `current-shell-presence-possible`, `cleanup-candidate` | `client/src/components/agents/ua/`, `client/src/runtime/uaAgentDefinitions.ts` | Re-add the UA workbench intentionally from its templates and surface host. |
| Code Agent / Local coder adjunct surfaces | `present-in-source`, `current-shell-presence-possible`, `cleanup-candidate` | `client/src/pages/agentbuilder.tsx`, `localcoder/` | Keep or re-add intentionally; do not rely on hidden shell gating. |
| CodeGraph developer surface | `present-in-source`, `future-restore` | `client/src/components/codegraph/` | Rewire into the shell only when developer mode is intentionally brought back. |
| Telescope / Skyview | `present-in-source`, `future-restore` | `client/src/components/skyview/` | Re-add through real route/surface wiring if science mode returns. |
| Detailed Mode | `present-in-source`, `future-restore` | `client/src/pages/detailedmode.tsx`, `client/src/app.tsx` | Re-enable only with a real backend contract. |
| Protein / science helpers | `present-in-source`, `future-restore` | `client/src/components/protein/` | Rewire later if science mode returns. |

## Preserved For Trading Context

| Feature | Status | Notes |
|---|---|---|
| Trading workbench | `present-in-source`, `planned-keep` | Current MVP direction. |
| WorldSignals | `present-in-source`, `planned-keep` | Preserved because it may feed trading evidence. |
| Knowledge surfaces | `present-in-source`, `planned-keep` | Needed for KnowGraph / ThinkGraph / research context. |
| Plan surface | `present-in-source`, `planned-keep` | Still part of the workspace shell directionally, but not used here as proof of current UI state. |

## tradingui.tsx Cleanup Still Pending

These items are still documented for a later cleanup pass:

| Item | Status |
|---|---|
| ENTER TRADE / EXIT TRADE buttons | `to-remove` |
| Mock signals strip | `to-remove` |
| Mock AI chat response | `to-remove` |
| TradingView CDN widget | `to-remove` |

## Working Rule

Use this file as an inventory, not as a fake-flag ledger or a claim that cleanup already happened.
Spec first, then board cleanup, then implementation.
