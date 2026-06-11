# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Agent Identity

Read before any implementation work, in this order:
1. `SOUL.md` — Sol identity and hard limits
2. `AGENTS.md` — workflow protocol, safe-80% rule, forbidden patterns
3. `.specify/memory/constitution.md` — governance and principles
4. Relevant `specs/*` for the task at hand

Use Code-Based Memory MCP before significant edits. Run inverse audit before implementation. See `docs/runbooks/code-based-memory-mcp.md` for tool status and workarounds.

Before editing AutoGen runtime assumptions, read `docs/runbooks/AUTOGEN_REACTFLOW_RUNTIME_ARCHITECTURE.md` and `docs/runbooks/VENDORED_ROOTS_AND_SUBREPOS.md`.

## Commands

```powershell
# Start full local stack (autogen sidecar + backend + frontend)
npm run dev

# Start individual services
npm run dev:frontend       # Vite client on port 5173
npm run dev:backend        # Express backend on port 4000
npm run dev:autogen        # Host Python sidecar on port 8003

# Type check
npx tsc -p apps/backend/tsconfig.app.json --noEmit
npx tsc -p client/tsconfig.app.json --noEmit --pretty false

# Run all tests
npm test

# Run a single test file
npx vitest run apps/backend/src/cards/runtime.spec.ts

# Health checks after start
Invoke-RestMethod http://127.0.0.1:4000/api/health
Invoke-RestMethod http://127.0.0.1:8003/health

# Prisma (schema is at prisma/schema.prisma — not libs/prisma/)
npx prisma generate --schema=prisma/schema.prisma
npx prisma studio --schema=prisma/schema.prisma
```

Backend builds via Nx esbuild (`nx build backend`), served via `nx serve backend`. The `npm run dev:backend` wrapper calls `nx serve backend`.

The backend does not start the Python sidecar. `npm run dev:autogen` starts it from host Python source.

## Architecture

### Execution Spine

```
client/ (React/Vite)
  → POST /api/projects/:projectId/decks/:deckId/run
  → apps/backend/src/routes/decks.routes.ts
  → apps/backend/src/decks/deckRuntime.ts (executeDeck)
  → apps/backend/src/cards/runtime.ts (runCardWithContract)
  → apps/backend/src/services/autogen/autogenOrchestratorClient.ts
  → HTTP POST AUTOGEN_ORCHESTRATOR_URL/autogen/orchestrate
  → apps/python-models/app/main.py (FastAPI)
  → apps/python-models/app/python_models/autogen_orchestrator.py (orchestrate_context_pack)
  → Standard AutoGen graph runtime
```

### Runtime Rules That Must Not Be Violated
- `AUTOGEN_ORCHESTRATOR_URL` must be set. If not set → hard throw at execution time, not boot.
- Runtime errors are never swallowed, and empty final output is always an error.
- `magentic_option` edges control participant scope. Cards without a `magentic_option` edge to the orchestrator are invisible to Magentic-One in locked mode.
- Locked mode is default. `discovery_proposal` mode requires explicit `card.runtimeOptions.mode` or `AGENT_DISCOVERY_MODE=discovery_proposal` env.
- No TypeScript fallback for real execution. No fake success paths. No silent failures.
- Model config source of truth: the ReactFlow card editor selection only. Backend reads `card.runtimeOptions.modelKey` and resolves it through `MODEL_REGISTRY`. Python executes the resolved contract.
- Missing participant card model config is a hard runtime error (`card_model_config_missing`). It is not a fallback trigger.
- `providerModelId='default'` must never appear in any payload. If seen, it is a bug.
- No model is inherited from env, hardcoded strings, or orchestrator fallback.

### Data Layer Split
- **PostgreSQL** (`ag_catalog` schema): all project/agent/deck/message state via raw `pg` pool. Pool defaults: `localhost:5433`. Docker Compose maps db to `5432`. These differ — set `POSTGRES_PORT` in `.env` explicitly.
- **Prisma**: manages only `User`, `Session`, `HealthCheck` tables. Connected via `DATABASE_URL`. Not used for core app state.
- **Neo4j** (bolt:7687): ThinkGraph and KnowGraph graph memory. Required for graph routes but backend won't crash without it — routes will return errors.
- **Redis**: not part of the AutoGen development runtime.

### TypeScript ↔ Python Contract
- TypeScript builds `PythonAutoGenPayloadShape` (see `apps/backend/src/contracts/runtimeContracts.ts`).
- Python receives `ContextPack` (see `apps/python-models/app/python_models/orchestration_contracts.py`).
- These are independently defined. Field mapping is not generated — any drift is silent.
- `plan`, `thinkGraph`, `knowGraph` fields in the payload are currently `undefined` — graph context does not flow into sidecar calls yet.

### Key File Map
| Purpose | File |
|---|---|
| Backend entry | `apps/backend/src/main.ts` |
| Route registry | `apps/backend/src/routes/index.ts` |
| Deck run route | `apps/backend/src/routes/decks.routes.ts` |
| Deck execution | `apps/backend/src/decks/deckRuntime.ts` |
| Card runtime + payload builder | `apps/backend/src/cards/runtime.ts` |
| AutoGen HTTP client | `apps/backend/src/services/autogen/autogenOrchestratorClient.ts` |
| Env loader | `apps/backend/src/config/env.ts` |
| PG pool | `apps/backend/src/db/pool.ts` |
| Model registry | `apps/backend/src/llm/models.config.ts` |
| Python FastAPI entry | `apps/python-models/app/main.py` |
| Python orchestrator | `apps/python-models/app/python_models/autogen_orchestrator.py` |
| Python contracts | `apps/python-models/app/python_models/orchestration_contracts.py` |
| Shared TS contracts | `apps/backend/src/contracts/runtimeContracts.ts` |

### Repo Layout
- `apps/backend/` — Express 5 backend (Nx esbuild)
- `client/` — React/Vite frontend
- `apps/python-models/` — FastAPI + AutoGen sidecar
- `specs/` — Spec Kit feature specs (spec.md / plan.md / tasks.md per feature)
- `docs/runbooks/` — operational runbooks
- `docs/decisions/` — architecture decisions
- `.specify/memory/constitution.md` — project governance
- `.skills/` — task-specific agent skill files (read only the matching one)
- `.agents/` — agentic workflow skills for repo development
- `services/knowgraph/` — separate KnowGraph Python service (not started in npm dev)
- `prisma/` — Prisma schema (User/Session/HealthCheck only)
- `db/migrations/` — raw SQL migrations for `ag_catalog` schema

### Env Requirements
`apps/backend/.env` must exist (throws at boot if missing). Required variables:
- `AUTOGEN_ORCHESTRATOR_URL` (e.g. `http://localhost:8003`) — sidecar endpoint
- `OPENAI_API_KEY` — current provider baseline
- `OPENROUTER_API_KEY` — optional; used only when a card explicitly selects an OpenRouter model key
- `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`
- `DATABASE_URL` (Prisma connection string, same DB)
- `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD` (needed for graph routes)

### Agent Card Wiring
- `runtimeType: 'magentic_one'` — the orchestrator card
- `runtimeType: 'assistant_agent'` — participant agent
- Edge `edgeType: 'magentic_option'` — connects participants to the orchestrator (direction-agnostic)
- Edge `edgeType: 'flow'` — directed execution wire (direction matters)
- Cards with `parentGraphId` set are sub-graph cards and are excluded from Magentic-One participants

### Python Sidecar
- FastAPI on port 8003 from host Python source
- `/autogen/orchestrate` — strict graph-runtime boundary; currently fails explicitly until the real standard AutoGen runtime is implemented
- `/health` — liveness
- Uses pinned standard AutoGen packages. `MagenticOneGroupChat` is the main orchestrator, tool-enabled `AssistantAgent` instances are graph-defined workers, and `Swarm` is reserved for same-kind parallel fan-out.

### What Not To Do
- Do not add TypeScript fallback for failed sidecar calls
- Do not use LangChain, Zorro, or Ghostfolio patterns
- Do not commit `apps/backend/.env`
- Do not create standalone audit Markdown files — route durable findings to the correct home per `AGENTS.md`
- Do not treat `DEBUG-TRACE` console.logs as permanent — they are cleanup targets
- Do not default participant cards to any model (no gpt-4o, gpt-5.1-chat-latest, or any other hardcoded default)
- Do not inherit orchestrator model config for participants unless the card UI explicitly supports an "inherit" setting
- Do not make runtime model fields (`provider`, `providerModelId`) optional
- Do not create fake env/example config as a runtime fix
