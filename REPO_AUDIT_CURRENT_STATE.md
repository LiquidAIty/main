# REPO_AUDIT_CURRENT_STATE

This file is the plain-language audit of what the repo actually looks like now.
It is meant to reduce confusion for v0, not to propose a bigger architecture.

## What Exists

The repo is a mixed monorepo with several generations of work still present.

Main apps:
- `apps/backend`: Express API server and the main backend runtime.
- `client`: React + Vite frontend. This is where the current builder and main working UI live.
- `apps/backend-e2e`: test scaffold.
- `apps/python-models`: separate Python app space.
- `apps/volt-svc`: older optional service path that is no longer the main runtime.

Main services:
- `services/knowgraph`: Python service for PDF-to-Neo4j ingestion.
- `services/esn_rls`: time-series service.

Other important infra:
- `db`: SQL and database docs.
- `n8n` and `apps/backend/n8n-workflows`: n8n setup and workflow artifacts.

## What Appears To Be The Real Active Flow

For v0, the real active product surface is centered on `client/src/pages/agentbuilder.tsx`.

That page currently acts as the main workspace and already contains:
- project selection
- assist/chat flows
- graph views
- deck builder state
- right-panel editing
- deck validation / execution planning / local deck runtime debug

The newer builder path is present in:
- `client/src/components/builder/BuilderCanvas.tsx`
- `client/src/components/builder/nodes/AgentCardNode.tsx`
- `client/src/components/builder/deckValidation.ts`
- `client/src/components/builder/deckExecution.ts`
- `client/src/components/builder/contractMaker.ts`
- `client/src/components/builder/deckScoring.ts`
- `client/src/components/builder/deckRuntime.ts`
- `client/src/types/agentgraph.ts`

This builder path is meaningful now:
- cards render on a React Flow canvas
- edges define simple deck order
- the selected card is edited through the existing `AgentManager` right panel flow
- simple deck validation, planning, contract creation, scoring, and local execution exist

Important limit:
- deck runtime is still client-side and local-state based
- `agentbuilder.tsx` still contains a TODO to persist deck state to backend project state
- the deck runtime currently uses a mock handshake and local execution fallback

## Frontend Runtime Shape

The frontend is not cleanly separated yet.

Current active frontend path:
- `client/src/pages/agentbuilder.tsx` is the main working surface.
- `client/src/components/AgentManager.tsx` is the active right-panel editor.
- `client/src/lib/api.ts` calls `/api/agents/boss` for Assist-like work and `/api/sol/run` for Sol paths used elsewhere.

Current builder flow:
- local `DeckDocument` state lives in `agentbuilder.tsx`
- the center canvas uses `BuilderCanvas`
- node and edge selection are local UI state
- the right panel resolves a selected card into `AgentManager` local config mode
- `Run Deck` uses `executeSimpleDeck(...)`

There is also a second builder-like path:
- `client/src/components/assist/BuilderAdminCanvas.tsx`
- `client/src/components/assist/builderCanvasState.ts`

That path looks stale or at least secondary right now:
- it uses `tldraw`
- it is not imported anywhere else in `client/src`
- it overlaps conceptually with the new React Flow builder

For v0, this second canvas should be treated as inactive drift, not expanded.

## Backend Runtime Shape

The backend is also mixed, but there is one clear active center.

Main entrypoint:
- `apps/backend/src/main.ts`

Mounted API root:
- `apps/backend/src/routes/index.ts`

Important active routes:
- `/api/agents/boss`
- `/api/v2/projects/:projectId/kg/*`
- `/api/projects/*`
- `/api/projects/:projectId/agents/*`
- `/api/knowgraph/*`
- `/api/sol/run`
- `/api/rag/search`

What appears active:
- `/api/agents/boss` is treated in code comments as the authoritative Assist runtime
- `agent.routes.ts` is large and appears to coordinate current Assist / plan-wiki / ThinkGraph / KnowGraph behavior
- `projects.routes.ts` and `projectAgents.routes.ts` still provide project and agent CRUD, with several legacy paths explicitly disabled behind flags or returning legacy-path responses
- `/api/sol/run` still exists and is used by separate chat pages
- `knowgraph.routes.ts` is active for PDF ingest and graph exploration

## State And Storage

State is split across a few different systems:

- project state in the database via `agentBuilderStore.ts`
- project agent configs in `projectAgentsStore.ts`
- client-local deck state in `agentbuilder.tsx`
- graph state through ThinkGraph / KnowGraph APIs
- plan/wiki style state inside the Assist runtime path

This means the repo already has a working project/state idea, but deck persistence is not yet aligned with it.

## What Looks Active

These parts look live enough to preserve for v0:
- `client/src/pages/agentbuilder.tsx`
- `client/src/components/AgentManager.tsx`
- `client/src/components/builder/*`
- `client/src/types/agentgraph.ts`
- `apps/backend/src/routes/agent.routes.ts`
- `apps/backend/src/routes/projects.routes.ts`
- `apps/backend/src/routes/projectAgents.routes.ts`
- `apps/backend/src/routes/knowgraph.routes.ts`
- `apps/backend/src/routes/sol.routes.ts`
- `apps/backend/src/routes/v2/*`
- `services/knowgraph/*`
- `db/*`

## What Looks Stale, Duplicated, Or Drifted

- `apps/volt-svc` is legacy relative to `/api/sol/run`.
- there are multiple overlapping agent/orchestrator concepts in backend code
- the new React Flow deck builder coexists with an unused `tldraw` builder admin canvas
- `agentbuilder.tsx` is doing too much and contains several generations of product logic
- project agent CRUD still exists beside newer deck/card ideas
- many historical markdown docs described older directions and have been archived into `/old`

## What Needs To Stay For v0

For v0, keep the repo centered on one practical loop:
- one main frontend page: `agentbuilder.tsx`
- one active right-panel editor: `AgentManager`
- one active visual builder path: React Flow deck builder
- one active Assist backend path: `/api/agents/boss`
- one project state path backed by existing database tables
- one active graph ingest/explore path through ThinkGraph / KnowGraph routes already in use

## What Should Stay Untouched Until After Untangling

These areas should be changed carefully only after the repo shape is cleaner:
- `client/src/pages/agentbuilder.tsx`
- `apps/backend/src/routes/agent.routes.ts`
- `apps/backend/src/routes/projects.routes.ts`
- `apps/backend/src/routes/projectAgents.routes.ts`
- `apps/backend/src/services/agentBuilderStore.ts`
- `apps/backend/src/services/projectAgentsStore.ts`

Reason:
- they are central
- they mix active and legacy responsibilities
- they are already carrying live behavior

## Practical v0 Reading Order

If someone needs to understand the repo quickly, read in this order:

1. `PROJECT_FULL_SCOPE_V0.md`
2. this file
3. `client/src/pages/agentbuilder.tsx`
4. `client/src/components/builder/*`
5. `client/src/components/AgentManager.tsx`
6. `apps/backend/src/routes/index.ts`
7. `apps/backend/src/routes/agent.routes.ts`
8. `apps/backend/src/routes/projects.routes.ts`
9. `apps/backend/src/routes/projectAgents.routes.ts`
10. `apps/backend/src/routes/knowgraph.routes.ts`

## Current v0 Conclusion

The repo is not clean, but it does have a real active core:
- one main frontend workspace
- one active Assist runtime path
- one active visual deck builder path
- one existing project state / graph / agent config backend

v0 should stabilize that core first and avoid waking up more legacy systems.
