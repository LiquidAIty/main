# LiquidAIty

This root README is intentionally short.

Only current documentation should stay exposed at the repo root.
Stale plans, obsolete quickstarts, and historical architecture notes belong in `legacy/` or `old/`.

## Active Docs

- [`mvp.md`](C:/Projects/LiquidAIty/main/mvp.md): current architecture direction and implementation plan.
- [`REPO_AUDIT_CURRENT_STATE.md`](C:/Projects/LiquidAIty/main/REPO_AUDIT_CURRENT_STATE.md): plain-language audit of what is actually active in the repo now.
- [`docs/RAG_SEARCH.md`](C:/Projects/LiquidAIty/main/docs/RAG_SEARCH.md): specialized weighted-RAG endpoint/tool documentation if you are working on that path.
- [`db/DB_DOCUMENTATION.md`](C:/Projects/LiquidAIty/main/db/DB_DOCUMENTATION.md): database-specific reference.

## Current Reading Order

1. [`mvp.md`](C:/Projects/LiquidAIty/main/mvp.md)
2. [`REPO_AUDIT_CURRENT_STATE.md`](C:/Projects/LiquidAIty/main/REPO_AUDIT_CURRENT_STATE.md)
3. the active backend/frontend/runtime files referenced by the audit

## Current Runtime Snapshot

- React Flow builder plus the v3 runtime are the active visible orchestration surface.
- `/api/agents/boss` is still an active front-door route, but it is not the intended long-term orchestration brain.
- `apps/python-models` is the AutoGen/Magentic sidecar area and the foundation direction for orchestration.
- ThinkGraph, KnowGraph, plan/wiki, and blackboard remain the system truth surfaces.

## Archived Docs

- [`legacy/`](C:/Projects/LiquidAIty/main/legacy): archived root docs and retired config notes that should not be treated as current source of truth.
- [`old/`](C:/Projects/LiquidAIty/main/old): older historical notes, audits, and prior planning documents.

## Doc Hygiene Rule

If a document is not current enough to guide implementation safely, it should be rewritten, moved to `legacy/`, or moved to `old/`.
