# LiquidAIty

LiquidAIty is now intentionally narrowed to a code-first, self-dogfooding agent operating system.

The current product story is not "general AI for everything." The current product story is:

- graph the codebase
- plan work in PlanWiki
- execute scoped code tasks through agent cards
- update Blackboard, ThinkGraph, and KnowGraph
- use the system on this repository first

## Active Docs

- [`mvp.md`](./mvp.md): current source of truth
- [`REPO_AUDIT_CURRENT_STATE.md`](./REPO_AUDIT_CURRENT_STATE.md): optional plain-language audit of the current repo state

## Reading Order

1. [`mvp.md`](./mvp.md)
2. [`REPO_AUDIT_CURRENT_STATE.md`](./REPO_AUDIT_CURRENT_STATE.md)

## Current Repo Direction

- `client/src/pages/agentbuilder.tsx` remains the main visual control plane.
- `apps/backend/src/v3/*` remains the visible graph runtime.
- `apps/backend/src/repo-graph/*`, `apps/backend/src/planwiki/*`, and `apps/backend/src/tools/*` are scaffolds for the narrowed MVP.

## Archived Material

- `legacy/` holds retired docs and older config notes.
- `old/` holds historical plans and previous architecture cuts.

If a doc does not support the code-first self-dogfooding MVP, it should be consolidated or moved out of the active set.
