# Backend Runtime Canonicalization

## Problem Statement
The backend architecture has fragmented into `apps/backend/src/v2` and `apps/backend/src/v3`. The `v3` directory is currently housing the active AgentCanvas card/deck runtime and `v2` houses the active worldsignal, dev, and legacy kg routes. This creates confusion, hides duplicate systems (e.g., config stores), and makes it unsafe to implement new features like the Interactive Graph Research Loop without risking regressions or compounding tech debt.

## Target Canonical Backend Layout
All runtime logic will be flattened into canonical directories directly under `apps/backend/src/`:
- `apps/backend/src/cards/` (runtime logic for individual agents/cards)
- `apps/backend/src/decks/` (orchestration and execution of full graphs)
- `apps/backend/src/projects/` (project persistence)
- `apps/backend/src/routes/` (all API endpoints)
- `apps/backend/src/runtime/` (core orchestrator loops and bindings)
- `apps/backend/src/contracts/` (type definitions and IO shapes)
- `apps/backend/src/agents/` (agent configurations)
- `apps/backend/src/services/` (shared utilities like config store, queues, etc.)
- `apps/backend/src/graph/` (semantic language and graph structures)
- `apps/backend/src/knowledge/` (seed operations)
- `apps/backend/src/types/` (shared interfaces)

## Active Route Map Summary
- `/api/v2/kg/*` -> Active (handles RAG chunks and legacy direct ingestion).
- `/api/v2/dev/*` -> Active.
- `/api/v2/worldsignal/*` -> Active (called by `WorldSignalSurface.tsx`).
- `/api/v2/agent_builder/*` -> Active (testing/chat endpoints).
- `/api/v3/projects/:projectId/knowledge_seed/*` -> Active.
- `/api/v3/projects/:projectId/media/video/*` -> Active.
- `/api/projects/:projectId/decks/:deckId/execute` -> Active (canonical route calling `v3/runtime/deckRuntime.ts`).

## Active Magentic-One Runtime Path
1. **Frontend**: `client/src/pages/agentbuilder.tsx` triggers run.
2. **Backend Route**: `apps/backend/src/routes/decks.routes.ts` handles the API.
3. **Backend Runtime**: `apps/backend/src/v3/runtime/deckRuntime.ts` calls `apps/backend/src/v3/cards/runtime.ts`.
4. **Python Sidecar**: `autogen_orchestrator.py` receives the payload.
5. **UI**: Results bubble back up as `CardRunResult`.

## Duplicate Systems Found
- **Card/Deck Runtime**: None. `v3` is the sole source of truth for cards/decks.
- **Agent Config Store**: `apps/backend/src/services/v2/agentConfigStore.ts`. Needs moving to `src/services/agentConfigStore.ts`.
- **Graph routes**: `routes/v2/kg.routes.ts` overlaps with Python KnowGraph agent logic.

## Migration Rules
- Move one directory at a time.
- Use `git mv` to preserve history.
- Preserve existing API paths (e.g., `/api/v2/worldsignal`) in the Express routers to avoid breaking frontend clients.
- Update internal relative imports (`../v3/` -> `../`).
- Tests must pass before the next move.

## Non-goals
- Do not implement the Interactive Graph Research Loop during this canonicalization.
- Do not change AgentCanvas wiring or AutoGen logic.
- Do not rewrite existing frontend queries or API signatures.
- Do not add discovery/autowiring.

## Acceptance Criteria
- No active imports from `apps/backend/src/v2` or `apps/backend/src/v3`.
- `grep -r "src/v3"` and `grep -r "src/v2"` return empty.
- Backend compiles and passes `npm run mcp:check`.
- Existing Magentic-One endpoint functions normally.
- `apps/backend/src/v2` and `apps/backend/src/v3` are deleted.
- Interactive Graph Research Loop specs reference canonical backend paths only.

## Rollback Strategy
- Perform changes in atomic `git mv` commits. If tests or builds fail, use `git reset --hard HEAD` to restore the pre-migration tree.
