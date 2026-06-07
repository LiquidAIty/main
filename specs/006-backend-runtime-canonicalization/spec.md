# Backend Runtime Canonical Rebuild

## Problem Statement
The backend architecture has fragmented into `apps/backend/src/v2` and `apps/backend/src/v3`. The `v3` directory is currently housing the active AgentCanvas card/deck runtime and `v2` houses the active worldsignal, dev, and legacy kg routes. Directly moving these directories risks breaking the active system. Instead, we must rebuild clean canonical replacements beside the old version, prove the new canonical runtime works, switch routing over, and only then delete the old versioned folders.

## Strategy
1. Keep existing v2/v3 running as fallback.
2. Build canonical non-versioned runtime in `apps/backend/src`.
3. Do not import from v2/v3 in new canonical files unless explicitly temporary and marked.
4. Prove canonical runtime works via tests.
5. Switch active route handlers/imports to canonical runtime.
6. Run validation on the full stack.
7. Delete v2/v3 only after no internal imports/references remain.

## Target Canonical Backend Layout
The rebuilt runtime logic will be structured under `apps/backend/src/`:
- `apps/backend/src/cards/` (clean card runtime)
- `apps/backend/src/decks/` (clean deck execution orchestration)
- `apps/backend/src/runtime/` (core orchestrator loops)
- `apps/backend/src/graph/` (graph definitions and extractions)
- `apps/backend/src/knowledge/` (seed operations)
- `apps/backend/src/types/` (shared interfaces)
- `apps/backend/src/routes/` (flattened API endpoints)
- `apps/backend/src/services/` (flattened utilities like config store)

## Logic Not To Copy from v2/v3
When rebuilding, the following stale concepts must be dropped:
- `task_ledger` / `progress_ledger` remnants.
- PlanDraft remnants from `missionSpec` legacy.
- Graph schema pressure embedded in Magentic-One default instructions.
- Stale `v2` / `v3` naming in interfaces or logging.
- Fallback to "all agents" if disconnected (Magentic-One must strictly use connected options).

## Active Route Adapters Preserved
The external HTTP API signatures must remain unchanged to avoid breaking the frontend:
- `POST /api/projects/:projectId/decks/:deckId/execute`
- `GET /api/v2/worldsignal/health`
- `GET /api/v2/kg/*`
- `GET /api/v3/projects/:projectId/media/video/*`
*Note: The URI paths keep "v2" or "v3" but their handler files will reside in canonical `src/routes/`.*

## Acceptance Criteria
- Existing Magentic-One deck execution still works through the same frontend API path.
- Backend TypeScript passes without emitting errors.
- Runtime/card tests pass.
- MCP checks pass.
- `git diff --check` passes cleanly.
- No active internal imports from `v2` or `v3` remain in the `src/` codebase.
- External API route compatibility is fully preserved.
- `v2` and `v3` directories are successfully deleted only after canonical replacements are proven to work.
- Research-loop specs and tasks reference only canonical paths.

## Rollback Strategy
- Because the rebuild happens beside the active `v3` codebase, rollback during the rebuild phase is trivial (delete the canonical draft folders).
- If the switch-over fails, revert the `src/routes/decks.routes.ts` imports back to `../v3/runtime/deckRuntime`.
