# REPO_INTENT_MAP

Generated: 2025-11-21

## Overview

- Monorepo houses one Express/LangGraph backend, multiple React heads, Python sidecars, and assorted automation stubs under a single Nx workspace.
- Multiple agent concepts coexist: legacy SOL + volt-svc, LangGraph Agent-0 with department tools, boss agent endpoints, planner/runner nodes, and MCP/n8n bridges.
- Backend `apps/backend` is the canonical runtime exposing `/api/sol/*`, `/api/rag/*`, `/api/agents/*`, MCP, KG, tool registry, and auth middleware.
- Frontend `client/` (formerly `apps/client`) is the active Lab/Agent Manager head; other UI pages mix canonical chat flows with experimental dashboards.
- `db/`, `docs/`, `scripts/`, and `services/` provide helper assets (SQL setup, architecture notes, forecasting microservices) that rely on manual execution.
- `n8n/` and several agent tools remain placeholders or smoke-mode wiring; workflows and connectors must be filled in before production use.

## Legend

- **Canonical** – production or actively maintained path to build upon.
- **Helper** – supporting assets (docs, scripts, configs) without direct runtime impact.
- **Experiment** – exploratory implementations likely to evolve.
- **Legacy** – superseded but retained for reference/back-compat.
- **Stub** – placeholder wiring; functionality mocked or incomplete.

## apps/backend (Express + LangGraph runtime)

| Path | Intent | Notes |
| --- | --- | --- |
| `apps/backend/src/main.ts` | **Canonical** | Primary Express entry (port 4000) mounting `/api/*`, startup banner, JSON error middleware. Prefer this over `server.ts`. |
| `apps/backend/src/server.ts` | **Legacy** | Older standalone server (port 3000) mounting KG/reports/SOL routes without auth. Keep only for historical context. |
| `apps/backend/src/routes/` | **Canonical** | HTTP surfaces for `/sol`, `/tools`, `/agents`, `/rag`, `/kg`, `/mcp`, `/dispatch`, `/webhook`, `/models`, etc. `threads.routes.ts` still in-memory (experiment). |
| `apps/backend/src/agents/orchestrator/agent0.graph.ts` | **Canonical (with legacy mode)** | Agent-0 StateGraph defining full pipeline nodes plus legacy planner/run/reduce path. Several nodes (`plan`, `ingest_or_retrieve`, `build_kg`, `gap_enrich`, `forecast`) are currently stubbed. |
| `apps/backend/src/agents/lang/agentFactory.ts` | **Canonical** | Factory for department LangGraph agents (createDeptAgent). Handles MCP tool binding, personas, routing helpers. |
| `apps/backend/src/agents/lang/orchestratorGraph.ts` | **Experiment** | Alternative LangGraph orchestrator (`runOrchestrator`) with planner/executor loop and MCP auto-binding. Not wired into routes yet. |
| `apps/backend/src/agents/tools/*.ts` | Mixed | Department tools. Many canonical (`google.ts`, `openai.ts`, `memory.ts`, `scraper.ts`), but some are **stub** (`n8n.ts`, `rag.ts` random embeddings, `knowledgeGraphTools` mock). Verify intent per file before reuse. |
| `apps/backend/src/agents/mcp/*`, `mcp-tool-registry.ts`, `mcp-controller.ts` | **Canonical** | MCP controller + registry bridging external servers. Requires `mcp.config.json` + env wiring. |
| `apps/backend/src/orchestrator/*.ts` | **Experiment** | Planner/runner LangGraph nodes intended for future SOL rewrite. No current route references. |
| `apps/backend/src/volt/*` | **Legacy** | Old SOL agent wrappers and Volt service adapters hitting OpenAI directly (see `sol.agent.ts`). Superseded by `/api/sol/run`. |
| `apps/backend/src/llm/*` | **Canonical** | Central model registry (`models.config.ts`) + HTTP client (`client.ts`) with host allow-lists and provider selection. |
| `apps/backend/src/api/kg/*` | **Canonical** | Knowledge graph REST endpoints used by Agent KG UI (`/api/kg`, `/api/kg/agent`). Corresponding LangGraph tools still stubbed. |
| `apps/backend/n8n-workflows/` | **Helper** | Placeholder directory for exported n8n flows (currently empty JSON files only). |
| `apps/backend/10_myagent_core.sql` | **Stub** | Empty SQL placeholder at repo root; ignore until populated. |

### Backend supporting folders

- `config/`, `middleware/`, `security/`, `services/`, `types/`, `utils/`, `dispatch/` – **Canonical helpers** for auth, password handling (note: `security/password.ts` still stubbed), telemetry, shared types.
- `agents/unified/*`, `agents/sol.ts` – **Experiment/legacy** bridging older orchestrators to new LangGraph flows; review before extending.
- `tools/ui.ts`, `tools/python.ts`, `tools/esn.ts`, etc. – **Canonical** for `/api/tools/:id` direct invocation. Some rely on external services (ESN, python worker) set up elsewhere.

## client/ (Vite React Lab head)

| Path | Intent | Notes |
| --- | --- | --- |
| `client/src/app.tsx`, `client/src/main.tsx` | **Canonical** | Root wiring for Vite + Tailwind; loads pages via router/layout. |
| `client/src/pages/labagentchat.tsx` | **Canonical** | Primary Lab chat UI hitting `/api/sol/run`, includes mock/live toggle and base URL handling. Honors lowercase naming convention. |
| `client/src/pages/agentpage.tsx` | **Experiment** | Large single-file prototype mixing chat, plan tabs, knowledge graph mini viz. No backend integration yet. |
| `client/src/pages/agentmanager.tsx`, `agentchat.tsx`, `bossagent.tsx` | **Experiment** | Dashboard/Boss Agent heads referencing mocked KPIs and incomplete `/api/agents/boss` flows. |
| `client/src/components/*` | **Helper** | Shared UI atoms (cards, toggles, charts) consumed by experimental pages. |
| `client/src/lib/*` | **Helper** | Client-side mock data, request helpers, local storage utilities. |

## apps/python-models

| Path | Intent | Notes |
| --- | --- | --- |
| `apps/python-models/app/main.py` | **Stub** | FastAPI service queueing training jobs via Redis/RQ (`/train`, `/status`, `/health`). Minimal validation; assumes worker module exists. |
| `apps/python-models/app/python_models/` | **Stub** | Worker implementation referenced by queue; inspect before production use. |
| `apps/python-models/requirements.txt` | **Helper** | Redis/RQ/FastAPI dependency pins. |

## services/esn_rls

| Path | Intent | Notes |
| --- | --- | --- |
| `services/esn_rls/main.py` | **Experiment** | Standalone ESN-RLS forecasting API (FastAPI). Not currently invoked by backend routes; optional microservice. |
| `services/esn_rls/requirements.txt` | **Helper** | Scientific Python stack for ESN service. |

## db/

| Path | Intent | Notes |
| --- | --- | --- |
| `db/00_pg_age_timescale_postgis_vector_FULLSTACK.sql` | **Canonical** | Full-stack DB bootstrap (Postgres + Apache AGE + Timescale + PostGIS + pgvector). |
| `db/10_myagent_core.sql`, `db/11_myagent_api.sql` | **Canonical** | Core schema + API for Agent stack (RAG functions, chunk tables). Align with `DB_DOCUMENTATION.md`. |
| `db/DB_DOCUMENTATION.md` | **Helper** | Detailed description of schemas, functions, and ingest workflow. |
| `db/old/` | **Legacy** | Historical migrations and experiments; avoid unless auditing. |
| `db/run_and_smoke.ps1` | **Helper** | PowerShell script to set up DB and run smoke checks. |

## n8n/

| Path | Intent | Notes |
| --- | --- | --- |
| `n8n/README.md` | **Helper** | Instructions to start local n8n via Docker compose on port 5678. |
| `n8n/flows/` | **Stub** | Empty directory reserved for exported workflows. Agents referencing `n8n_call_webhook` currently rely on placeholders. |

## docs/

| Path | Intent | Notes |
| --- | --- | --- |
| `docs/REPO_AUDIT.md` | **Canonical Helper** | Prior repo audit (2025-11-18) summarizing health and TODOs. |
| `docs/LANGGRAPH_REPORT.md`, `docs/ORCHESTRATOR_SETUP.md` | **Helper** | Deep dives on LangGraph orchestration and boss agent setup. |
| `docs/RAG_SEARCH.md`, `docs/sol-dev.md` | **Helper** | RAG implementation reference + Sol development notes. |

## Additional helper areas

- `scripts/`, `audit.ps1`, `make-*.ps1`, `test_memory_stack.ps1` – **Helper** automation/testing utilities (PowerShell-first).
- `services/` (other than `esn_rls`), `tmp/`, `dist/`, `vendor/` – build artifacts or vendor bundles; ignore for new work.

## Guidance for contributors

1. **Build on canonical flows**: Extend `/api/sol/*`, `/api/tools/*`, LangGraph agent factory files (`apps/backend/src/agents/lang`), and `client/src/pages/labagentchat.tsx` for production UIs.
2. **Avoid legacy traps**: Do not rely on `apps/volt-svc` or `apps/backend/src/volt/*` unless targeting historical Sol deployments. Treat `server.ts` as read-only reference.
3. **Retire stubs deliberately**: Before enabling features, replace mocks in `knowledgeGraphTools`, `rag.ts`, `n8n.ts`, and `threads.routes.ts`. Update this map when a stub graduates to canonical.
4. **Coordinate experiments**: Planner/runner nodes under `apps/backend/src/orchestrator` and large React prototypes (`agentpage.tsx`, `agentmanager.tsx`) are safe sandboxes but not integrated; align with backend team before promotion.
5. **Use helper assets**: Follow `db/*.sql`, `docs/*.md`, `n8n/README.md`, and `scripts/*.ps1` for setup guidance. Keep configs synchronized when runtime contracts change.

> Empty directories or unreadable files (e.g., `n8n/flows/`, `apps/backend/n8n-workflows/`) were noted as placeholders per instructions. All listed paths were inspected where contents existed.
