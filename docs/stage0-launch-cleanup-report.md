# Stage 0 Reset Note

**Date**: 2026-06-03
**Status**: Reset in progress

## Current Truth

The earlier Stage 0 story that relied on `client/src/config/launchMode.ts` was not accepted as the target architecture.

That file has now been removed.

AgentBuilder is no longer supposed to depend on a hidden visibility-gate file to decide which surfaces are "active."
Old feature code remains in the repo and in the canvas ecosystem for reference, but the product direction is:

- spec first
- then deliberate cleanup
- then implementation

## What Changed

- `client/src/config/launchMode.ts` was deleted.
- `client/src/pages/agentbuilder.tsx` was restored to the pre-launch-mode git baseline, so the builder is no longer running the launch-flag experiment.
- Old workbench/surface code was kept available so the current board can still be saved with legacy features present.
- AgentBuilder project/deck runtime now uses the canonical non-versioned `/api/projects/*` path instead of a mixed `/api/v2/projects` + `/api/v3/projects` split.
- The canvas no longer uses giant roadsign banners to explain missing project state.
- The saved project deck path is again the live persistence spine for node, edge, and run state.

## What This Does Not Mean

- It does **not** mean the old non-trading features were deleted from source.
- It does **not** mean the AgentBuilder cleanup is finished.
- It does **not** mean the trading MVP shell has been fully reduced yet.
- It does **not** mean legacy cards, canvases, or side surfaces are already removed from the current builder.

## Correct Next Step

The next cleanup pass should be driven by the trading spec, not by hidden flags.

That means:

- decide which legacy cards stay on the saved board for reference
- decide which cards are removed from the active default deck
- decide which companion surfaces are fully removed from the active shell
- keep source files recoverable for later re-add

Before that feature cleanup, the current foundation repair must stay true:

- project-backed AgentBuilder first
- one canonical `/api/projects/*` route family for the builder
- no local pretend board behavior
- no optional-node resurrection after deletion

## Verified Code Facts Still Relevant To Future Stage 0 Planning

- `/api/knowgraph` is protected by `authMiddleware`
- `services/knowgraph/schema.py` imports cleanly
- no frontend `VITE_ALPACA_*` variables were found
- no trading order routes were found in the earlier route scan
- `tradingui.tsx` cleanup is still deferred

## Working Rule

Use specs to decide product cleanup.
Do not use hidden launch gates as the long-term architecture.
