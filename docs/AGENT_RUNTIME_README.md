# LiquidAIty Agent Runtime Guide

This is the repo guide for future coding agents working on the local LiquidAIty agent runtime. Keep it factual and operational. The current priority is real demo agents running locally before more UI polish.

## Product Goal

LiquidAIty is building a visual AI agent system. React Flow is the visual programming surface for agent decks and cards. The frontend should describe and trigger agent runs. The backend should execute project, deck, and card runtime logic. Python should run AutoGen / Magentic-One orchestration. Postgres stores project, deck, and runtime state.

The system should eventually support direct MCP server/client tooling. Do not bring back LangChain wrappers to get there.

## Current Architecture

The current local runtime path is:

```text
React Flow Agent Builder
-> client/src/components/builder/useBuilderDeckRuntimeActions.ts
-> POST /api/v3/projects/:projectId/decks/run
-> apps/backend/src/v3/routes/decks.routes.ts
-> apps/backend/src/v3/runtime/deckRuntime.ts
-> apps/backend/src/v3/cards/runtime.ts
-> runMagenticCard
-> if runtimeOptions.executionBackend === "python_autogen"
-> apps/backend/src/services/autogen/autogenOrchestratorClient.ts
-> Python FastAPI sidecar /autogen/orchestrate
-> apps/python-models/app/python_models/autogen_orchestrator.py
-> AutoGen / Magentic-One
-> finalResponseText or clean provider/auth/model error
```

### React Flow Agent Builder

React Flow is the visual canvas. Do not treat the visual graph as the runtime itself. It is the authoring and trigger surface for decks/cards.

The frontend deck runtime actions live in `client/src/components/builder/useBuilderDeckRuntimeActions.ts`. That file posts deck or selected-card runs to the v3 backend endpoint. It should preserve the deck document and card runtime options, including `runtimeOptions.executionBackend`.

Do not touch React Flow visuals while debugging backend or sidecar runtime issues unless the user explicitly opens that scope.

### Backend v3 Deck/Card Runtime

The deck run route is `POST /api/v3/projects/:projectId/decks/run`, implemented in `apps/backend/src/v3/routes/decks.routes.ts`. It requires a `deckId` and `templates`, loads or accepts a deck document, calls `executeDeck`, then persists the run through the v3 deck store.

`apps/backend/src/v3/runtime/deckRuntime.ts` validates and schedules the deck. It calls `runCardWithContract` for runnable card steps.

`apps/backend/src/v3/cards/runtime.ts` dispatches by card runtime type. `runMagenticCard` is the Magentic-One path. It only routes to Python when:

```text
runtimeOptions.executionBackend === "python_autogen"
```

The backend v3 types and deck store already know about `executionBackend?: "python_autogen" | null`, and the store normalizes/preserves that option.

### Agent Canvas Projection

There is one Magentic-One agent. Magentic-One is the chat/orchestrator node, not a pool of hidden workers.

All other canvas agents are Assist-style nodes with prompts, tools, runtime bindings, roles, and config. They participate in a Magentic-One run only when they are connected to the active Magentic-One card on the Agent Canvas through a `magentic_option` edge.

The Python AutoGen payload must project the active canvas topology like this:

```text
Magentic-One node
-> connected Assist-style nodes only
-> one AutoGen participant per connected Assist node
```

Disconnected canvas agents are inactive for that run and must not be sent to Python. Python must not create hidden extra agents, suggested agents, or Python-only team members. Automatic agent creation and Plan Canvas proposal behavior are future scope, not part of the current runtime.

Connected `assistant_agent` cards are sent as AutoGen participants. Their `runtimeBinding`, role, configured tool names, skills, personas, knowledge sources, model config, and prompt should be preserved in the participant payload. `local_coder` and `graph_flow` cards are not Python AutoGen participants yet unless explicit support is implemented.

### Passive Object Awareness

Object awareness is passive. Magentic-One may read concise context about the currently open surface or selected object, but it must not mutate UI objects, fill fields, run disconnected agents, execute tools, or create plan steps from that context.

Frontend deck runs may send a compact `workspaceObjectContext`:

```text
activeSurface
workspaceView
selectedObjectId
selectedObjectType
selectedObjectTitle
selectedText
openObjectSummary
activeMagenticParticipants
availableCanvasAgents
excludedAgents
```

The backend caps this context before forwarding it to Python AutoGen: `selectedText` is limited to 240 characters, `openObjectSummary` to 400 characters, and each agent-name list to 12 entries. Do not send raw app state, full deck JSON, full Plan graphs, full Knowledge payloads, or full Energy object dumps as object awareness.

If Magentic-One recommends a next action, assignment, tool run, field fill, or object change, that belongs to future Plan Canvas proposal and approval flow. The current runtime should return only a concise plan-intent or recommended next-step summary.

### Default Visible Agent Canvas

The source-seeded Agent Canvas now keeps the current known agents visible by default. Visible does not mean active. A node becomes active for a Magentic-One run only when a `magentic_option` edge from Magentic-One points to it and the backend supports its runtime type for the selected execution backend.

Default visible nodes:

- `card_magentic`: Magentic-One, `runtimeType: "magentic_one"`, chat/orchestrator.
- `card_assist`: Assist, `runtimeType: "assistant_agent"`, `runtimeBinding: "assist"`, role `assistant`.
- `card_research_agent`: Research Agent, `runtimeType: "assistant_agent"`, `runtimeBinding: "research_agent"`, role `researcher`.
- `card_thinkgraph_agent`: ThinkGraph Agent, `runtimeType: "assistant_agent"`, `runtimeBinding: "thinkgraph_agent"`, role `thinkgraph`.
- `card_codegraph_agent`: CodeGraph Agent, `runtimeType: "assistant_agent"`, `runtimeBinding: "codegraph_agent"`, role `codegraph`.
- `card_knowgraph_agent`: KnowGraph Agent, `runtimeType: "assistant_agent"`, `runtimeBinding: "knowgraph_agent"`, role `knowgraph`.
- `card_plan_agent`: Plan Agent, visible planning/approval node, disconnected by default.
- `card_worldsignals_agent`: WorldSignals Agent, visible signal/context node, disconnected by default.
- `card_telescope_agent`: Telescope Agent, visible imagery/context node, disconnected by default.
- `card_energy_workbench`: NRGSim / Energy, visible workbench node, disconnected by default.
- `card_local_coder`: Local Coder, `runtimeType: "local_coder"`, visible but excluded from Python AutoGen participants.
- `card_trading_workbench`, `card_image_workbench`, `card_code_workbench`, `card_video_workbench`: visible staged workbench nodes, disconnected by default.

First-demo default Magentic-One edges:

- `card_magentic -> card_research_agent`
- `card_magentic -> card_assist`

These are the only default Python AutoGen participant candidates. They are prompt/model participants; configured tool names are preserved as metadata, but direct MCP/tool execution still requires explicit direct tooling later.

Visible but disconnected nodes are ready to connect later. Do not connect Local Coder, graph-flow cards, command-running workbenches, or unavailable tool bridges to Python AutoGen until safe execution and permission boundaries are implemented.

### Python AutoGen Sidecar

The backend AutoGen client is `apps/backend/src/services/autogen/autogenOrchestratorClient.ts`. It builds sidecar base URLs from:

```text
AUTOGEN_ORCHESTRATOR_URL
PYTHON_MODELS_URL
```

Then it posts JSON to:

```text
/autogen/orchestrate
```

The Python FastAPI app is `apps/python-models/app/main.py`. It exposes:

```text
GET /health
POST /autogen/orchestrate
```

`POST /autogen/orchestrate` calls `orchestrate_context_pack(req)` in `apps/python-models/app/python_models/autogen_orchestrator.py`. For card runtime contexts, that code builds an AutoGen Magentic-One team, runs it, synthesizes the transcript, and returns `finalResponseText` plus structured runtime reports.

Provider key handling lives in `apps/python-models/app/python_models/autogen_provider_env.py`. The Python process reads `OPENAI_API_KEY` or `OPENROUTER_API_KEY` from its process environment and checks likely local env files with `override=False`. Do not print secrets. Current local testing should prefer direct OpenAI API defaults (`provider: "openai"`, `modelKey: "gpt-5.1-chat-latest"`) unless the user explicitly selects OpenRouter.

## Postgres Dependency

Use the existing local Postgres database only.

Current intended local Postgres container:

```text
sim-pg
```

Expected host mapping:

```text
localhost:5433 -> container 5432
```

Backend `DATABASE_URL` currently points to:

```text
postgresql://liquidaity-user:***@localhost:5433/liquidaity?schema=public
```

Do not print the real password. Do not create another Postgres container. Do not create a new database. Do not delete databases. Do not delete containers or volumes. Do not prune volumes. Do not run `docker compose down -v`. Do not run `docker compose up db` unless the user explicitly approves it for the current task.

The checked-in `docker-compose.yml` still has a `db` service named `liquidaity-db` on host `5432`. That is not the current smoke target. The current local smoke target is the existing `sim-pg` container on host `5433`.

## Environment Variable Rules

Backend env source of truth:

```text
apps/backend/.env
```

Start the backend from the repo root because `apps/backend/src/main.ts` loads dotenv with:

```text
dotenv.config({ path: "apps/backend/.env" })
```

For local AutoGen smoke, keep explicit IPv4 sidecar URLs in `apps/backend/.env`:

```text
PYTHON_MODELS_URL=http://127.0.0.1:8003
AUTOGEN_ORCHESTRATOR_URL=http://127.0.0.1:8003
CORS_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,...
```

Use `http://127.0.0.1:8003`, not `http://localhost:8003`, on this Windows setup. `localhost` can resolve through IPv6 or collide with WSL/Docker listeners. Be explicit about IPv4 when testing the Python sidecar and backend handoff.

The OpenRouter key currently exists in `apps/backend/.env`, but the Python sidecar needs it in the Python process environment too. Do not duplicate secrets without reason. Do not print secrets. The safe check is whether a key exists, not its value.

## Local Startup Order

Canonical full-stack dev command (repo root):

```powershell
npm run dev
```

This starts:

1. `docker compose up python-models` (AutoGen sidecar + Redis dependency)
2. `nx serve backend`
3. `client` Vite dev server

Canonical AutoGen-only command:

```powershell
npm run dev:autogen
```

If AutoGen is unavailable, backend returns a hard failure diagnostic:

```text
AutoGen sidecar unavailable. checkedEndpoints=...
```

No TypeScript Magentic fallback is allowed on this runtime path.

1. Verify the existing Postgres host port:

```powershell
Test-NetConnection 127.0.0.1 -Port 5433
```

2. Verify backend `DATABASE_URL` points to `localhost:5433` before starting backend work.

3. Start the Python sidecar on explicit IPv4 port `8003` and verify:

```powershell
cd apps/python-models
.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8003
Invoke-RestMethod http://127.0.0.1:8003/health
```

Expected:

```json
{"status":"ok"}
```

4. From the repo root, start the backend. It loads `apps/backend/.env`, which should already point both AutoGen sidecar URLs at `http://127.0.0.1:8003`.

The repo's Nx serve path is:

```powershell
npx nx serve backend
```

Known Windows gotcha: in the latest smoke, `npx nx serve backend` compiled successfully and entered watch mode but did not bind `:4000`. The working fallback after build was:

```powershell
node apps/backend/dist/src/main.js
```

5. Verify backend health:

```powershell
Invoke-RestMethod http://127.0.0.1:4000/api/health
```

Expected:

```json
{"status":"ok"}
```

6. Start the frontend on the local Vite origin:

```powershell
cd client
npm run dev -- --host 127.0.0.1 --port 5173
```

7. Run the object-aware canvas smoke from the actual hydrated Agent Builder UI. Do not use a handcrafted deck payload for this proof. Open the Agent Builder, switch to Agents, and send:

```text
What object or surface am I looking at, and which agents are active? Answer in one short paragraph.
```

Expected result: Magentic-One routes to `python_autogen`, Python receives object awareness, only Research Agent and Assist are active participants, and the final response names the current surface plus those active agents.

## Prisma

The Prisma schema path in this repo is:

```text
prisma/schema.prisma
```

If backend startup says `@prisma/client` did not initialize, run Prisma generate against that schema:

```powershell
npx prisma generate --schema=prisma/schema.prisma
```

Do not use Prisma commands to create a new database during this local smoke work.

## Known Windows / Localhost Gotchas

- Prefer `127.0.0.1` for sidecar checks. Avoid `localhost:8003` on this Windows setup.
- `Test-NetConnection localhost -Port 5433` may resolve to IPv6 `::1`; use `127.0.0.1` when the boundary must be explicit.
- Port `4000` can be occupied by a stale backend. Check it with `Get-NetTCPConnection -LocalPort 4000 -State Listen`.
- Backend must be started from repo root so `apps/backend/.env` is loaded.
- If Nx serve compiles but never opens `:4000`, verify the compiled backend entrypoint directly before changing code.

## LangChain Policy

LangChain was purged because it crashed backend runtime through `@langchain/mcp-adapters`. Do not reinstall or reintroduce:

- `langchain`
- `@langchain/*`
- `langsmith`
- `langserve`
- `langfuse`
- LangChain MCP adapters
- `ChatOpenAI` from LangChain
- `DynamicStructuredTool` or `StructuredTool` from LangChain

If MCP tools are needed later, implement direct MCP client/server tooling owned by this app. Do not use LangChain wrappers.

## Known Verified Status

- Backend TypeScript compile passed after the AutoGen request typing fix.
- The AutoGen request type is exported/imported from `apps/backend/src/services/autogen/autogenOrchestratorClient.ts`.
- LangChain runtime crash was removed.
- Prisma generate fixed the previous `@prisma/client` initialization error.
- Backend health passed at `http://127.0.0.1:4000/api/health`.
- Python sidecar health passed at `http://127.0.0.1:8003/health`.
- Direct Python `POST /autogen/orchestrate` reached AutoGen and returned a real model/provider error.
- Backend Python AutoGen projection now sends only Magentic-connected `assistant_agent` cards as participants and preserves runtime binding, role, and configured tool metadata.
- Backend deck runtime smoke reached Python `/autogen/orchestrate` before env loading was fixed and returned:

```text
autogen_orchestrator_http_500:OPENROUTER_API_KEY is required for AutoGen research planning
```

- Python sidecar env loading was fixed so `OPENROUTER_API_KEY` is detected without printing the secret.
- Local AutoGen deck runtime smoke succeeded with Python sidecar on `http://127.0.0.1:8003`, backend health passing, real Python AutoGen model calls, and final response:

```text
Backend smoke.
```

- Actual hydrated Agent Builder UI object-aware smoke succeeded through the real canvas. Magentic-One used `provider: "openai"`, `modelKey: "gpt-5.1-chat-latest"`, `executionBackend: "python_autogen"`, received `workspaceObjectContext`, used only Research Agent and Assist as active participants, and returned:

```text
You are viewing the chat surface, and the active agents are Research Agent and Assist.
```

- Successful local OpenRouter smoke model: `openai/gpt-5.1-chat`.
- Current direct OpenAI default for local testing: `gpt-5.1-chat-latest`.
- Failed legacy alias from an earlier smoke attempt: `or-openai-gpt-5.1-chat-latest`.
- The Python provider helper sends OpenAI GPT-5 models with `max_completion_tokens` and default temperature-compatible options.

## Known Blockers / Next Checks

A. Local real AI testing is now ready on the proven rail.

B. Prefer direct OpenAI defaults for local AutoGen testing: `provider: "openai"` and `modelKey: "gpt-5.1-chat-latest"`.

C. Productize model selection and alias normalization so legacy app-level aliases do not leak into Python provider validation.

D. Direct MCP/tool execution for participant tool names is still future work; current tool names are preserved as metadata.

E. If a rerun returns an OpenRouter `402` credit or prompt-token-limit error, the rail is still reaching the provider. Fix account credits or smoke token budget; do not change the AutoGen architecture for that error.

F. Only after local agent execution is proven should Docker deployment be revisited.

## Readiness for Real AI Testing

- Ready: yes
- Working: React Flow can trigger v3 deck runs; backend deck/card runtime dispatches Magentic-One; `executionBackend: "python_autogen"` reaches the Python sidecar; backend and Python health checks pass; Postgres is reachable on `127.0.0.1:5433`; Python detects `OPENROUTER_API_KEY` without printing it; AutoGen makes real model calls; the deck runtime smoke returned `Backend smoke.`.
- Blocked: no rail blocker remains for local real AI testing. Remaining work is productizing model selection UX and later direct MCP/tool execution.
- Next exact test: rerun the actual hydrated Agent Builder object-aware canvas smoke from the UI after restarting Python on `127.0.0.1:8003`, backend on `127.0.0.1:4000`, and frontend on `127.0.0.1:5173`.
- Do not touch: UI, React Flow visuals, Docker volumes, databases, containers, LangChain/Lang* packages, or AutoGen architecture unless documenting a confirmed bug.
- Smallest next fix: keep the startup sequence repeatable and then productize model selection UX for non-smoke runs.

## What Not To Do

- Do not refactor while chasing runtime smoke.
- Do not touch UI or React Flow visuals for backend/provider failures.
- Do not create databases.
- Do not delete databases.
- Do not delete containers or volumes.
- Do not prune Docker volumes.
- Do not run `docker compose down -v`.
- Do not run `docker compose up db` unless explicitly approved.
- Do not create a second Postgres container.
- Do not bring back LangChain or any Lang* package.
- Do not replace the v3 deck/card runtime with a new route just to test AutoGen.
- Do not treat a clean provider/auth/model error as an architecture failure.
- Do not send disconnected canvas agents to Python for a Magentic-One run.
- Do not create hidden Python-only AutoGen agents.
- Do not let passive object awareness mutate UI objects or fill fields.
- Do not add `proposedObjectPatch` or Plan-as-tool behavior until that scope is explicitly opened.
- Do not add automatic agent-generation or Plan Canvas proposal behavior until that scope is explicitly opened.
