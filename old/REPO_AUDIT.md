# REPO_AUDIT

Generated: 2025-11-18
Scope: C:\\Projects\\LiquidAIty\\main

## Repo Map

### Apps (Nx projects)
- **apps/backend** – Express + LangGraph runtime, `/api/sol/*`, department tools, auth middleware, RAG routes.
- **apps/backend-e2e** – Jest/RQ scaffolding for end-to-end tests (currently minimal, unused).
- **apps/client** – Vite + React “lab” UI (agent manager, agentic dashboards, lab chat heads).
- **apps/python-models** – FastAPI service queuing training jobs through Redis/RQ (`/train`, `/status`).
- **apps/volt-svc** – Legacy VoltAgent proxy on port 3141 (now bypassed by `/api/sol/run`).

### Services & Utilities
- **services/esn_rls** – Standalone FastAPI microservice for ESN-RLS forecasting (not wired into UI/backend).
- **scripts/** & **make-*.ps1** – Dev helpers (audit/test runners), not part of runtime.
- **db/** – SQL migrations and full-stack setup scripts (Apache AGE + pgvector).
- **n8n/** & **n8n_data/** – Placeholder for workflow exports + runtime volume (empty except `.gitkeep`).
- **docs/** – Architecture notes (no repo audit until now).

### Client Highlights
- `client/src/pages/agentic.tsx` – 800+ line monolith mixing chat, trading UI, KG demos, and model-training placeholders.
- `client/src/pages/labagentchat.tsx` – Minimal mock/live chat shim for `/api/sol/run`.
- `client/src/pages/agentmanager.tsx` – “Agent manager” dashboard with hard-coded cards and mock data.

### Backend Highlights
- `apps/backend/src/routes/` – All HTTP entrypoints (sol, tools, models, rag, kg, auth, threads, webhook, etc.).
- `apps/backend/src/agents/` – LangGraph Agent-0, department tool registry, MCP/n8n connectors.
- `apps/backend/src/volt/sol.agent.ts` – Thin OpenAI wrapper (new Sol path) separate from legacy volt-svc.
- `apps/backend/src/security/password.ts` – Placeholder hashing helpers (argon2 TODO).

### Legacy / Experimental Zones
- `apps/backend/src/volt/*` & `apps/volt-svc` – Legacy Sol plumbing now superseded.
- `n8n/flows` – Empty placeholder; no workflows exported.
- `docs/` – Lacks consolidated repo health report until this audit.

## Half-done / Confusing Things
| Area | File(s) | What's half-done | Risk if we touch it | Recommended next step |
| --- | --- | --- | --- | --- |
| Agentic UI monolith | `client/src/pages/agentic.tsx` | 800+ line component mixing chat, KG demos, timeseries, mock training hooks; relies on unimplemented `/api/models/*` plumbing and fake data. | Hard to modify without breaking multiple tabs; no tests; unclear which features are live. | Split into smaller feature components (chat, KG, dashboard) before wiring real data; document which tabs are demo-only. |
| Lab Agent Chat mock toggle | `client/src/pages/labagentchat.tsx` | UI defaults to mock mode; live mode assumes `/api/sol/run` but lacks base-URL selection or history view. | Users may think Sol is broken when mock remains on; limited logging. | Add base URL input + status badge; clarify mock/live state; keep component lowercase per user convention. |
| Boss Agent planner hooks | `client/src/pages/agentmanager.tsx`, `agentchat.tsx` | Hard-coded cards reference department statuses and n8n flows that don’t exist; missing loading/error handling for `/api/agents/boss`. | UI promises automations that backend cannot supply yet; confuses operators. | Swap fake metrics for explicit “coming soon” states; gate buttons until APIs respond ok. |
| Threads persistence stub | `apps/backend/src/routes/threads.routes.ts` | In-memory `Map` with TODO for Prisma/Postgres checkpoints; no TTL or auth. | Memory loss on restart; potential OOM if exposed publicly. | Add persistence strategy note or disable route until DB-backed storage lands. |
| Auth bypass on /agents | `apps/backend/src/routes/index.ts` | Commented TODO “Restore auth middleware for /agents after testing”; currently unauthenticated. | Exposes internal agent registry & actions without auth in production. | Re-enable `authMiddleware` once smoke tests updated; document expected headers. |
| Password hashing placeholder | `apps/backend/src/security/password.ts` | Both `hashPassword` and `verifyPassword` return deterministic `hash_${password}`; TODO to install argon2. | Any auth feature would be insecure / trivial to bypass. | Install `argon2`, implement real hashing/verify with env-based salt rounds, add unit tests. |
| RAG tool mock embeddings | `apps/backend/src/agents/tools/rag.ts` | Uses random 1536-d vector instead of actual embeddings before hitting `/api/rag/search`. | Search quality meaningless; results unpredictable despite weighted RAG backend being real. | Wire to real embedding service (OpenAI text-embedding-3-small or local) via env + dependency injection. |
| Knowledge graph tool stubs | `apps/backend/src/agents/lang/tools/knowledgeGraphTools.ts` | `knowledge_graph` and `_query` tools return mock data with TODO to call real service. | Agents can “pretend” they updated KG; no persistence; downstream UI might trust fake responses. | Implement real HTTP client to `/api/kg/*` routes and add error handling/logging. |
| Legacy Volt service | `apps/volt-svc`, `apps/backend/src/volt/sol.agent.ts` | Dual Sol implementations: new `/api/sol/run` hits GPT directly, but volt-svc still exists with custom env loading. | Engineers may mistakenly start volt-svc thinking it’s required; env duplication risk. | Add README banner explaining legacy status or archive folder after confirming nobody depends on it. |
| Empty n8n workspace | `n8n/`, `n8n/flows/.gitkeep`, `docker-compose.n8n.yml` | Compose file + README exist, but no exported workflows; agents referencing n8n hooks will fail. | Team might believe automations exist; wasted debugging time on missing flows. | Either add sample workflows or annotate README that n8n is placeholder until real flows exported. |
| Docs gap | `docs/*.md` | Existing docs (Sol/dev, RAG) lack repo-wide health record; contributors rely on tribal knowledge. | Inconsistent fixes; duplicate effort on legacy modules. | Keep this `REPO_AUDIT.md` updated per release; link it from README. |

## Next 5 coding tasks
1. **Restore auth guard on `/api/agents`**  
   - Files to touch: `apps/backend/src/routes/index.ts`.  
   - Exact change: Re-enable `authMiddleware` when mounting `agentRoutes`; update comment to reflect current policy.  
   - Why it's safe: Only adjusts middleware wiring; does not change handler logic or Sol core.
2. **Document legacy status of volt-svc**  
   - Files to touch: `apps/volt-svc/src/index.ts`, `README.md`.  
   - Exact change: Add banner comment + README note stating `/api/sol/run` no longer depends on volt-svc and how to disable it.  
   - Why it's safe: Pure documentation/comment update; no runtime behavior change.
3. **Clarify mock/live behavior in labagentchat**  
   - Files to touch: `client/src/pages/labagentchat.tsx`.  
   - Exact change: Add explicit base-URL input + status pill showing “Mock” vs “Live”; default to live when backend reachable.  
   - Why it's safe: Touches isolated preview component; no shared state; keeps Sol backend untouched.
4. **Mark n8n directory as placeholder**  
   - Files to touch: `n8n/README.md`, optionally add `n8n/flows/README.md`.  
   - Exact change: Document that no workflows are shipped yet and list steps required before agents call n8n.  
   - Why it's safe: Documentation only; avoids accidental assumptions about automation coverage.
5. **Replace password hashing stub with argon2**  
   - Files to touch: `apps/backend/src/security/password.ts`, `apps/backend/package.json` (dependency add).  
   - Exact change: Install `argon2`, implement real `hashPassword/verifyPassword`, guard behind env-configured cost.  
   - Why it's safe: Self-contained utility; no API surface change; improves security without touching Sol routing.
