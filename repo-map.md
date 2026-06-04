# LiquidAIty Repository Map

> Generated repository snapshot.
> This file is useful for orientation but is not a canonical source of truth for current architecture, workflow, or Stage 0 status.

**Generated:** 2026-04-11T22:41:31.374Z

---

## 1. Repository Purpose Summary

**LiquidAIty** is an agentic AI platform with a unified workspace:

- **Chat** - Front door for user interaction and conversation
- **Canvas** - Connected agent-building and orchestration surface
- **Plan Wiki** - Operational planning and reasoning surface
- **Knowledge Graph** - Semantic memory and exploration

All surfaces work together in a single integrated environment.

### Tech Stack
- **Frontend:** React 19 + TypeScript + Vite
- **Backend:** Node.js + Express + TypeScript
- **Database:** PostgreSQL (via Prisma) + Neo4j (knowledge graph)
- **AI/LLM:** OpenAI API, OpenRouter, custom agent runtime
- **Build:** Nx monorepo

---

## 2. Top-Level Subsystem Map

```
LiquidAIty/
├── client/                    # React frontend (Assist + Builder UI)
│   └── src/
│       ├── pages/             # Top-level routes
│       ├── components/        # UI components
│       └── hooks/             # React hooks
│
├── apps/backend/              # Express API server
│   └── src/
│       ├── main.ts            # Server entry point
│       ├── routes/            # API route handlers
│       │   ├── v2/            # Project/Agent/KG management
│       │   └── index.ts       # Route mounts
│       ├── v3/                # Deck runtime subsystem
│       │   ├── routes/        # Deck/card execution endpoints
│       │   ├── runtime/       # Deck execution engine
│       │   ├── cards/         # Card runtime logic
│       │   └── decks/         # Deck storage
│       ├── services/          # Business logic layer
│       ├── agents/            # Agent orchestration
│       ├── llm/               # LLM client wrappers
│       ├── db/                # Database connection pool
│       └── api/               # Additional API surfaces
│
└── libs/                      # Shared libraries (if any)
```

---

## 3. Actual Live Execution Paths

### Frontend Entry
- **Entry file:** `client/src/main.tsx`
- **Router:** `client/src/app.tsx`
- **Primary UI:** `client/src/pages/agentbuilder.tsx` (5,400+ lines - GIANT COORDINATOR)

### Backend Entry
- **Entry file:** `apps/backend/src/main.ts`
- **Port:** 4000 (default)
- **Route mount:** `apps/backend/src/routes/index.ts`

### Active API Surface
```
/api/auth/*                    # Authentication
/api/health                    # Health check
/api/v2/projects/*             # Project CRUD + state management
/api/v2/projects/:id/agents/*  # Agent configuration
/api/v2/projects/:id/kg/*      # Knowledge graph operations
/api/v3/projects/:id/decks/*   # Deck execution runtime
/api/v3/projects/:id/cards/*   # Single card execution
/api/mcp/*                     # MCP (Model Context Protocol) tools
/api/dispatch/*                # Task dispatch
/api/tools/*                   # Tool registry
/api/knowgraph/*               # Knowledge graph queries
```

---

## 4. Frontend Map

### Pages (8 files)
- **client/src/pages/agentbuilder.setup.spec.ts** (915 lines)
- **client/src/pages/agentbuilder.tsx** (5183 lines)
- **client/src/pages/agentbuilder.ui.spec.tsx** (997 lines)
- **client/src/pages/agentpage.tsx** (1093 lines)
- **client/src/pages/detailedmode.tsx** (290 lines)
- **client/src/pages/login.tsx** (57 lines)
- **client/src/pages/tradingui.tsx** (224 lines)
- **client/src/pages/userpanel.tsx** (359 lines)

### Components (30 files)
**Key components:**
- AgentManager.spec.tsx (434 lines)
- AgentManager.tsx (1203 lines)
- PlanWikiLexicalView.tsx (262 lines)
- PlanWikiSurface.spec.tsx (113 lines)
- PlanWikiSurface.tsx (416 lines)
- assistPlanSurface.ts (402 lines)
- BuilderCanvas.spec.ts (609 lines)
- BuilderCanvas.tsx (1168 lines)
- BuilderChat.tsx (148 lines)
- BuilderDrawer.tsx (58 lines)
- contractMaker.ts (74 lines)
- DeckEdgeInspector.tsx (93 lines)
- deckExecution.ts (244 lines)
- DeckExecutionPathSummary.tsx (83 lines)
- deckPresets.ts (195 lines)
- DeckQuickAddPanel.tsx (151 lines)
- deckRunState.ts (369 lines)
- deckRuntime.ts (26 lines)
- deckScoring.ts (120 lines)
- deckValidation.ts (300 lines)

### Hooks (0 files)


---

## 5. Backend Route Map

### V2 Routes (Project/Agent/KG Management)
**Mount:** `/api/v2`

#### apps/backend/src/routes/v2/agentBuilder.routes.ts
- `POST /:projectId/agent_builder/chat` (line 304)
- `POST /:projectId/agents/:agentType/test` (line 350)

#### apps/backend/src/routes/v2/chunking.ts


#### apps/backend/src/routes/v2/config.routes.ts
- `POST /:projectId/agents/system/repair` (line 70)
- `GET /:projectId/agents/:agentType/config` (line 94)
- `PUT /:projectId/agents/:agentType/config` (line 149)
- `POST /:projectId/agents/:agentType/config/create` (line 257)
- `POST /:projectId/agents/:agentType/config/restore` (line 301)
- `GET /:projectId/agents/:agentType/config/versions` (line 346)

#### apps/backend/src/routes/v2/dev.routes.ts
- `POST /create_clean_test_project` (line 8)

#### apps/backend/src/routes/v2/index.ts
- `USE /projects` (line 10)
- `USE /projects` (line 11)
- `USE /projects` (line 12)
- `USE /projects/:projectId/kg` (line 13)
- `USE /dev` (line 14)

#### apps/backend/src/routes/v2/kg.routes.ts


#### apps/backend/src/routes/v2/projects.routes.ts
- `GET /` (line 18)
- `POST /` (line 30)
- `DELETE /:projectId` (line 53)
- `GET /:projectId/state` (line 77)
- `PUT /:projectId/state` (line 88)
- `GET /:projectId/kg/last-trace` (line 116)

#### apps/backend/src/routes/v2/query.ts


### V3 Routes (Deck Runtime)
**Mount:** `/api/v3`

#### apps/backend/src/v3/routes/cards.routes.ts
- `POST /:projectId/cards/run` (line 7)

#### apps/backend/src/v3/routes/decks.routes.ts
- `GET /:projectId/decks/:deckId` (line 12)
- `PUT /:projectId/decks/:deckId` (line 22)
- `POST /:projectId/decks/run` (line 47)

#### apps/backend/src/v3/routes/index.ts


#### apps/backend/src/v3/routes/messages.routes.ts
- `GET /:projectId/messages` (line 6)
- `POST /:projectId/messages` (line 17)
- `GET /:projectId/plan` (line 37)
- `PUT /:projectId/plan` (line 47)

### Root-Level Routes
#### apps/backend/src/routes/artifacts.routes.ts
- `POST /execute`
- `GET /`
- `POST /`

#### apps/backend/src/routes/auth.routes.ts
- (mount point)

#### apps/backend/src/routes/config.routes.ts
- `GET /models`

#### apps/backend/src/routes/diagnostic.routes.ts
- `GET /schema-check`

#### apps/backend/src/routes/dispatch.routes.ts
- `POST /`

#### apps/backend/src/routes/graph.routes.ts
- `POST /:projectId/run`

#### apps/backend/src/routes/health.routes.ts
- `GET /`
- `GET /health`

#### apps/backend/src/routes/index.ts
- `USE /auth`
- `USE /health`
- `USE /diagnostic`
- `USE /mcp`
- `USE /mcp`
- `USE /mcp`
- `USE /dispatch`
- `USE /tools`
- `USE /artifacts`
- `USE /webhook`
- `USE /graph`
- `USE /models`
- `USE /rag`
- `USE /kg`
- `USE /receipts`
- `USE /config`
- `USE /knowgraph`
- `USE /v2`
- `USE /v3`

#### apps/backend/src/routes/knowgraph.routes.ts
- `GET /health`
- `GET /graph`
- `GET /expand`
- `POST /ingest`

#### apps/backend/src/routes/mcp-tools.routes.ts
- `GET /available-tools`
- `GET /installed-tools`
- `POST /install-tool`
- `POST /uninstall-tool`
- `POST /collect-youtube`
- `POST /collect-news`
- `GET /knowledge-graph`
- `POST /build-knowledge-graph`
- `POST /check-hallucination`
- `POST /graphlit/ingest`
- `POST /graphlit/retrieve`
- `POST /infranodus/content-gaps`
- `POST /infranodus/generate-questions`

#### apps/backend/src/routes/mcp.catalog.routes.ts
- `GET /catalog`
- `GET /catalog/:category`
- `GET /catalog/find`

#### apps/backend/src/routes/mcp.routes.ts
- `GET /mcp/tools`
- `POST /mcp/refresh`

#### apps/backend/src/routes/models.routes.ts
- `POST /train`
- `GET /status/:jobId`

#### apps/backend/src/routes/ragsearch.routes.ts
- `POST /search`

#### apps/backend/src/routes/receipts.routes.ts
- `POST /:run_id/rate`
- `GET /latest`

#### apps/backend/src/routes/tools.routes.ts
- `POST /:name`
- `GET /try/:name`

#### apps/backend/src/routes/webhook.routes.ts
- (mount point)

---

## 6. Runtime/Deck Execution Chain

### Deck Execution Flow
1. **Client Request:** `POST /api/v3/projects/:id/decks/run`
2. **Route Handler:** `apps/backend/src/v3/routes/decks.routes.ts`
3. **Runtime Engine:** `apps/backend/src/v3/runtime/deckRuntime.ts`
4. **Card Execution:** `apps/backend/src/v3/cards/runtime.ts`
5. **Storage:** `apps/backend/src/v3/decks/store.ts`

### Key Files
- **Deck runtime:** `apps/backend/src/v3/runtime/deckRuntime.ts`
- **Card runtime:** `apps/backend/src/v3/cards/runtime.ts`
- **Runtime binding:** `apps/backend/src/v3/runtimeBinding.ts`

---

## 7. Knowledge Graph / Research Chain

### KG Ingestion Flow
1. **Chat Turn:** User sends message in chat interface
2. **Ingest Trigger:** `POST /api/v2/projects/:id/kg/ingest_chat_turn`
3. **Route:** `apps/backend/src/routes/v2/kg.routes.ts` (1,800+ lines)
4. **Chunking:** `apps/backend/src/routes/v2/chunking.ts`
5. **Agent Resolution:** `apps/backend/src/services/resolveAgents.ts`
6. **Neo4j Sync:** `apps/backend/src/services/v2/kgNeo4jSink.ts`

### KG Query Flow
1. **Client Query:** `POST /api/v2/projects/:id/kg/query`
2. **Route:** `apps/backend/src/routes/v2/kg.routes.ts`
3. **Query Builder:** `apps/backend/src/routes/v2/query.ts`
4. **Neo4j Execution:** `apps/backend/src/connectors/neo4j.ts`

### Key Files
- **KG routes:** `apps/backend/src/routes/v2/kg.routes.ts` (1,800 lines - GIANT)
- **KG service:** `apps/backend/src/services/graphService.ts`
- **Neo4j connector:** `apps/backend/src/connectors/neo4j.ts`
- **Research service:** `apps/backend/src/services/research/researchService.ts`

---

## 8. Auth/Session Path

### Authentication Flow
1. **Route:** `/api/auth/*`
2. **Handler:** `apps/backend/src/routes/auth.routes.ts`
3. **Middleware:** `apps/backend/src/middleware/auth.ts`
4. **Session Store:** `apps/backend/src/auth/sessionStore.ts`
5. **Security:** `apps/backend/src/security/requestAccess.ts`

---

## 9. Mounted vs Unmounted Surfaces

### ✅ Mounted Routes
All routes in:
- `apps/backend/src/routes/*.routes.ts` (except messages.routes.ts)
- `apps/backend/src/routes/v2/*.routes.ts`
- `apps/backend/src/v3/routes/cards.routes.ts`
- `apps/backend/src/v3/routes/decks.routes.ts`

### ❓ Unmounted Routes (Status Uncertain)
- **apps/backend/src/v3/routes/messages.routes.ts**
  - Currently unmounted, not imported in v3/routes/index.ts
  - Defines `/messages` and `/plan` endpoints
  - Possible future use: team-message stream surface
  - **Decision needed:** Keep for future or delete as dead code

---

## 10. Likely Dead/Legacy-Risk Areas

### High-Risk Files
1. **`client/src/pages/agentbuilder.tsx`** - 5,400+ lines, single-file coordinator
   - Risk: Any change could break multiple subsystems
   - Contains: Project management, deck runtime, KG visualization, chat, canvas

2. **`apps/backend/src/routes/v2/kg.routes.ts`** - 1,800+ lines
   - Risk: Giant route file with complex ingest logic
   - Contains: Chat turn ingest, file ingest, research, query endpoints

3. **`apps/backend/src/v3/routes/messages.routes.ts`** - UNMOUNTED
   - Status: Currently unmounted, not part of live path
   - Possible future use: team-message stream surface
   - **Decision needed:** Keep for future or delete as dead code

### Versioning Confusion
- **v2** and **v3** are NOT iterations - they're separate subsystems:
  - **v2** = Project/Agent/KG management
  - **v3** = Deck runtime execution
- Misleading names cause agent confusion

### Duplicate-Looking Surfaces
- `/api/kg` (root) vs `/api/v2/projects/:id/kg` - Different purposes
- `/api/knowgraph` vs `/api/v2/projects/:id/kg` - Different query surfaces

---

## 11. How Not to Break This Repo

### Critical Invariants
1. **Never modify `agentbuilder.tsx` without full context** - it's the frontend orchestrator
2. **v2 and v3 routes serve different purposes** - don't merge them
3. **Deck runtime is stateful** - changes to v3/runtime affect execution
4. **KG ingest is async** - chat must never block on it
5. **Route mounts in `routes/index.ts`** - verify mounts before adding routes

### Safe Change Patterns
- ✅ Add new routes in their own files
- ✅ Create new services in `services/`
- ✅ Add new components in `components/`
- ❌ Don't refactor `agentbuilder.tsx` without explicit approval
- ❌ Don't rename v2/v3 without coordinated client/backend migration
- ❌ Don't add unnecessary admin controls to production chat interface

### Testing Before Deploy
```bash
# Build check
nx build backend
nx build client

# Route audit
node scripts/routeMap.ts

# Dependency check
npm run audit:deps
```

---

## 12. Recommended Reading Order for New Coding Agents

### Phase 1: Entry Points (Start Here)
1. **`apps/backend/src/main.ts`** - Backend entry, server setup
2. **`apps/backend/src/routes/index.ts`** - Route mounts, API surface
3. **`client/src/app.tsx`** - Frontend router
4. **`client/src/pages/agentbuilder.tsx`** - Main UI (WARNING: 5,400 lines)

### Phase 2: Core Subsystems
5. **`apps/backend/src/routes/v2/projects.routes.ts`** - Project CRUD
6. **`apps/backend/src/routes/v2/config.routes.ts`** - Agent configuration
7. **`apps/backend/src/v3/routes/decks.routes.ts`** - Deck execution API
8. **`apps/backend/src/v3/runtime/deckRuntime.ts`** - Deck execution engine

### Phase 3: Knowledge Graph
9. **`apps/backend/src/routes/v2/kg.routes.ts`** - KG API (WARNING: 1,800 lines)
10. **`apps/backend/src/services/graphService.ts`** - KG operations

### Phase 4: Supporting Services
11. **`apps/backend/src/services/agentBuilderStore.ts`** - Project state
12. **`apps/backend/src/services/v2/agentConfigStore.ts`** - Agent config
13. **`apps/backend/src/llm/client.ts`** - LLM client wrapper
14. **`apps/backend/src/middleware/auth.ts`** - Auth middleware

### Phase 5: Frontend Components
15. **`client/src/components/builder/BuilderCanvas.tsx`** - Deck canvas
16. **`client/src/components/builder/BuilderChat.tsx`** - Chat interface
17. **`client/src/hooks/useBuilderProjects.ts`** - Project management hook
18. **`client/src/hooks/useBuilderDeckRuntimeActions.ts`** - Deck runtime hook

---

## File Inventory Summary

| Category | Count |
|----------|-------|
| other | 30 |
| frontend_component | 30 |
| frontend_page | 8 |
| backend_agent | 24 |
| backend_api | 3 |
| backend_auth | 1 |
| backend_connector | 7 |
| backend_controller | 2 |
| backend_db | 1 |
| backend_llm | 4 |
| backend_middleware | 1 |
| backend_route | 17 |
| backend_v2_route | 8 |
| script | 1 |
| backend_security | 4 |
| backend_service | 25 |
| backend_v3 | 19 |
| backend_v3_route | 4 |
| test | 1 |
| **TOTAL** | **190** |

---

## Graph Statistics

- **Total Files:** 190
- **Total Imports:** 377
- **Total Routes:** 88
- **Total Symbols:** 800

---

## Biggest Confusion/Risk Areas Discovered

### 1. Giant Coordinator Files
- **`agentbuilder.tsx`** (5,400 lines) - Single-file frontend orchestrator
- **`kg.routes.ts`** (1,800 lines) - Monolithic KG route handler

### 2. Versioning Confusion
- v2 and v3 are NOT versions - they're separate subsystems
- Misleading names cause agents to think v3 replaces v2

### 3. Unmounted Routes (Status Uncertain)
- `v3/routes/messages.routes.ts` exists but is not mounted
- Possible future use: team-message stream surface
- Decision needed on disposition

### 4. Dual Graph Systems
- `/api/kg` vs `/api/v2/projects/:id/kg` vs `/api/knowgraph`
- Different purposes but overlapping names

### 5. Workspace Surface Roles
- Chat, Canvas, Plan Wiki, and Knowledge Graph are integrated surfaces in a unified workspace
- Chat is the front door for user interaction
- Canvas provides agent-building and orchestration capabilities
- Plan Wiki and Knowledge Graph are shared across all surfaces
- **Risk:** Agents often try to add unnecessary admin controls to the chat interface
- **Guideline:** Keep chat simple and focused, use canvas for orchestration complexity

---

---

## Analysis Metadata

**Method:** Tree-sitter + regex pattern analysis  
**Files Analyzed:** 190 TypeScript/TSX/JavaScript files  
**Generated:** April 11, 2026

### Output Files

1. **`repo-map.md`** (this file)
   - Human-readable repository guide
   - Subsystem maps, execution paths, route inventory
   - Reading order for coding agents

2. **`repo-map.json`** (310 KB)
   - Machine-readable structured inventory
   - Complete file metadata (paths, imports, exports, routes, symbols)
   - Categorized buckets
   - Import graph edges

3. **`repo-map.graph.json`** (78 KB)
   - Graph-oriented format for Neo4j/GraphRAG ingest
   - Nodes: files with categories
   - Edges: import relationships

---

## Open Questions / Uncertain Items

### 1. **messages.routes.ts Disposition**
- **File:** `apps/backend/src/v3/routes/messages.routes.ts`
- **Status:** Currently unmounted, not part of live path
- **Possible future use:** Team-message stream surface
- **Decision needed:** Keep for future use or delete as dead code?

### 2. **Chat vs Canvas Surface Roles**
- **Current state:** Unified workspace with distinct surface purposes
- **Chat role:** Front door, conversation, simple interaction
- **Canvas role:** Agent orchestration, deck building, visual workflow
- **Shared surfaces:** Plan Wiki and Knowledge Graph available everywhere
- **Recommendation:** Keep chat simple, use canvas for complexity

### 3. **v2/v3 Naming Confusion**
- **Issue:** Names suggest versioning, but they're separate subsystems
- **Reality:** v2 = Project/Agent/KG management, v3 = Deck runtime
- **Consideration:** Rename to semantic paths (e.g., `/api/projects`, `/api/decks`)
- **Trade-off:** Breaking change vs improved clarity

### 4. **Dual Graph Systems**
- **Surfaces:** `/api/kg`, `/api/v2/projects/:id/kg`, `/api/knowgraph`
- **Uncertainty:** Whether consolidation is needed or intentional separation
- **Current state:** Different purposes but overlapping names
- **Recommendation:** Document clear boundaries and use cases

### 5. **Giant Coordinator Files**
- **Files:** `agentbuilder.tsx` (5,183 lines), `kg.routes.ts` (1,800 lines)
- **Trade-off:** Refactor vs stability
- **Current recommendation:** Do NOT refactor without explicit approval
- **Future consideration:** Incremental extraction when safe

---

**End of Repository Map**
