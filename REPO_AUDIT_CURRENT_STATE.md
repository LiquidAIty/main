# REPO_AUDIT_CURRENT_STATE

This file is the plain-language audit of what the repo actually looks like now.
It is meant to reduce confusion, keep the active reading set honest, and separate current architecture from stale or historical notes.

## Active Documentation Set

These are the active docs that should stay exposed:

- `README.md`
- `mvp.md`
- `REPO_AUDIT_CURRENT_STATE.md`
- `docs/RAG_SEARCH.md` when working on the weighted-RAG path
- `db/DB_DOCUMENTATION.md` when working on database shape/details

These files are no longer active root truth and have been archived:

- `legacy/docs/README_LANGGRAPH_SOL.md`
- `legacy/docs/PROJECT_FULL_SCOPE_V0.md`
- `legacy/docs/QUICKSTART_RAG.md`
- `legacy/docs/RAG_FILES.txt`
- `legacy/config/sol.policy.yaml`

Historical notes remain in `old/`.

## What Exists

The repo is still a mixed monorepo with several generations of work present.

Main apps:

- `apps/backend`: Express API server and the current backend runtime center
- `client`: React + Vite frontend
- `apps/python-models`: Python sidecar area for model/runtime work
- `apps/volt-svc`: older optional service path that is no longer the main runtime

Main services:

- `services/knowgraph`: Python service for PDF-to-Neo4j ingestion
- `services/esn_rls`: time-series service

Other important infra:

- `db`: SQL and database docs
- `n8n` and `apps/backend/n8n-workflows`: n8n setup and workflow artifacts

## What Appears To Be The Real Active Product Surface

The current active product surface is still centered on:

- `client/src/pages/agentbuilder.tsx`
- `client/src/components/AgentManager.tsx`
- `client/src/components/builder/*`

Important active builder truth:

- cards render on a React Flow canvas
- edges are plain visible `source -> target` links
- the runtime follows visible links only
- the selected card is edited through the existing `AgentManager` right panel flow
- blackboard participation is only real when the blackboard link is visible in the active v3 path

Important limit:

- active state is still split between `builder_state` and `v3_state`
- `agentbuilder.tsx` still carries too much mixed product logic
- deck persistence/runtime unification is not clean yet

## Frontend Runtime Shape

Current active frontend path:

- `client/src/pages/agentbuilder.tsx`
- `client/src/components/AgentManager.tsx`
- `client/src/components/builder/BuilderCanvas.tsx`

The older builder-like path:

- `client/src/components/assist/BuilderAdminCanvas.tsx`
- `client/src/components/assist/builderCanvasState.ts`

should be treated as stale or secondary drift unless proven otherwise. It overlaps the active React Flow builder and should not be treated as the current design center.

## Backend Runtime Shape

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

Important current reality:

- `/api/agents/boss` is still an active front-door route
- `/api/agents/boss` still contains too much orchestration intelligence
- `apps/python-models` now exists as the AutoGen/Magentic sidecar area and is the foundation direction for orchestration
- `/api/sol/run` and older Sol/LangGraph paths still exist, but they are not the current architecture source of truth

## State And Storage

State is still split across several systems:

- project state in the database via `agentBuilderStore.ts`
- project agent configs in `projectAgentsStore.ts`
- v3 runtime and blackboard state in `apps/backend/src/v3/decks/store.ts`
- graph state through ThinkGraph / KnowGraph APIs
- plan/wiki style state inside the Assist runtime path

This means the repo has working state surfaces, but they are not yet unified under the final orchestration architecture.

## What Looks Active Enough To Preserve

- `client/src/pages/agentbuilder.tsx`
- `client/src/components/AgentManager.tsx`
- `client/src/components/builder/*`
- `apps/backend/src/routes/agent.routes.ts`
- `apps/backend/src/routes/projects.routes.ts`
- `apps/backend/src/routes/projectAgents.routes.ts`
- `apps/backend/src/routes/knowgraph.routes.ts`
- `apps/backend/src/routes/v2/*`
- `apps/backend/src/v3/*`
- `apps/python-models/*`
- `services/knowgraph/*`
- `db/*`

## What Looks Confusing, Duplicated, Or Drifted

- `apps/volt-svc` is legacy relative to the current runtime paths
- `/api/sol/run` and older Sol/LangGraph materials still exist beside the newer Assist/builder/sidecar direction
- the React Flow builder coexists with an older `tldraw` builder admin path
- `agentbuilder.tsx` is still carrying multiple generations of product logic
- `agent.routes.ts` is still acting as both ingress and orchestration brain
- some older root docs were stale enough to be misleading and have now been moved into `legacy/`

## Root-Level Cleanup Candidates

The following root-level non-doc artifacts are still confusing and are reasonable deep-clean candidates later:

- `error.log`
- `image.png`
- `tmp-nx.json.new`

They were not moved in this pass because this pass is focused on documentation hygiene and safe precleaning.

## Current Reading Order

If someone needs to understand the repo quickly, read in this order:

1. `README.md`
2. `mvp.md`
3. this file
4. `client/src/pages/agentbuilder.tsx`
5. `client/src/components/builder/*`
6. `client/src/components/AgentManager.tsx`
7. `apps/backend/src/routes/index.ts`
8. `apps/backend/src/routes/agent.routes.ts`
9. `apps/backend/src/v3/*`
10. `apps/python-models/*`

## Current Conclusion

The repo is not clean, but the active center is now clearer:

- one main frontend workspace
- one active builder/runtime path
- one active Assist ingress path
- one AutoGen/Magentic sidecar direction
- one set of truth surfaces: plan/wiki, blackboard, ThinkGraph, and KnowGraph

Anything outside that should be treated either as active-but-messy infrastructure, or as legacy material that belongs in `legacy/` or `old/`.
