# LiquidAIty Stack Guide

**Last Updated:** 2026-04-14  
**Purpose:** Root-level operating guide for developers and AI agents working on LiquidAIty  
**Status:** Working draft from repo audit notes and current debugging evidence  
**Audience:** Jeremiah + coding agents working on the repo

---

## What This Repo Is Trying To Be

LiquidAIty MVP is a **4-surface workspace:**
- **Chat** - MainChat/Magentic-One orchestrator, user input
- **Canvas** - Agent building, deck editing, visual workflow
- **Plan** - Execution plans, reasoning traces
- **Knowledge** - Code graph + knowledge graph visualization

**MainChat = Magentic-One**
- Central orchestrator
- Lives in Chat surface
- User input, plan context, and graph context belong here
- Coordinates canvas agents

**Current Phase:** Operator-first readiness (not public launch)  
**Immediate Goal:** Make the system usable by Jeremiah on the project itself before broader cleanup and launch

---

## Product Truth That Must Not Drift

### Knowledge Surface
- ✅ **Knowledge is graph-first**
- ✅ ThinkGraph and KnowGraph must remain visible
- ❌ **DO NOT** replace graph with forms, summary cards, or list-manager UI
- ✅ Summary, evidence, and source details are **secondary** surfaces (side panel, inspector, overlay)
- ✅ Graph must always be the main visible Knowledge surface

### Canvas Surfaces

**Mini Chat-Side Canvas:**
- ✅ Uses same canvas language as full canvas
- ✅ Shows MainChat and available nearby agents
- ✅ Allows only quick connect/disconnect to MainChat
- ❌ **NOT** a form surface
- ❌ **NOT** a list manager
- ❌ **NO** full editing behavior

**Full Canvas:**
- ✅ Only place for full editing
- ✅ Add-agent works here
- ✅ Prompt/tool/runtime editing here
- ✅ Full graph authoring here

### Plan Surface
- ✅ Blank before first real run is acceptable
- ✅ After a real run, Plan must visibly populate
- ❌ Plan is **NOT** logs

### Messages Layer
- `messages.routes.ts` is conceptually the message layer between Magentic-One and agents
- **Current status:** NOT mounted in runtime (audit confirmed)
- ❌ Do not dismiss it conceptually
- ❌ Do not use it for current mounted-path fixes unless verified active

---

## Stack Overview

### Core Technologies
- **Frontend:** React 19 + TypeScript + Vite
- **Backend:** Node.js + Express + TypeScript  
- **Databases:**
  - PostgreSQL (Prisma ORM) - Auth, projects, preferences
  - Neo4j 5 - Knowledge graph, code graph
  - Redis - Caching
- **AI/LLM:** OpenAI, OpenRouter, custom agent runtime
- **Build:** Nx monorepo

---

## Local Development Setup

### Prerequisites
```bash
# Required services
- Docker Desktop (for Neo4j, optional Postgres)
- Node.js 20+
- PostgreSQL 15+ (port 5433)
```

### Environment Files
- **Main config:** `apps/backend/.env`
- **Database:** `DATABASE_URL=postgresql://liquidaity-user:LiquidAIty@localhost:5433/liquidaity`
- **Neo4j:** `NEO4J_URI=bolt://localhost:7687`, user: `neo4j`, password: `changeme`
- **Backend port:** `4000`
- **Frontend port:** `5173` (Vite dev server)

### Start Services

**Option 1: Docker (Neo4j only)**
```bash
docker-compose up neo4j -d
```

**Option 2: Full Docker Stack**
```bash
docker-compose up -d
```

**Option 3: Local Dev (recommended)**
```bash
# Terminal 1: Start Neo4j
docker-compose up neo4j

# Terminal 2: Start backend
cd apps/backend
npm run dev

# Terminal 3: Start frontend
npm run dev
```

### Database Setup

**Postgres Tables (Prisma)**
```bash
# From repo root
npx prisma db push
```

This creates:
- `User` - Auth users
- `Session` - Auth sessions  
- `HealthCheck` - Service health

**Neo4j Graph**
```bash
# Import code graph for current project
node scripts/ingest-repo-to-knowgraph.mjs
```

---

## Architecture

### 4 Connected Surfaces

1. **Chat** - MainChat/Magentic-One orchestrator, user input
2. **Canvas** - Agent building, deck editing, visual workflow
3. **Plan** - Execution plans, reasoning traces
4. **Knowledge** - Code graph + knowledge graph visualization

### Key Concepts

**MainChat = Magentic-One**
- Central orchestrator
- Lives in Chat surface
- Coordinates canvas agents

**Deck = Agent Workflow**
- Visual graph of connected agents
- Executed via `/api/v3/projects/:id/decks/run`
- Runtime in `apps/backend/src/v3/runtime/`

**Project Scoping**
- All data scoped to `activeProject` ID
- Frontend: `useBuilderProjects` hook
- Backend: `projectId` param in routes

---

## API Routes

### Mounted Routes (Live)

```
/api/auth/*                    # Auth (Prisma User/Session)
/api/health                    # Health check
/api/v2/projects/*             # Project CRUD
/api/v2/projects/:id/agents/*  # Agent config
/api/v2/projects/:id/kg/*      # Knowledge graph ops
/api/v3/projects/:id/decks/*   # Deck execution
/api/v3/projects/:id/cards/*   # Single card execution
/api/knowgraph/*               # Neo4j graph queries
/api/mcp/*                     # MCP tools
/api/dispatch/*                # Task dispatch
/api/tools/*                   # Tool registry
```

### Unmounted Routes (Dormant)

```
/api/v3/projects/:id/messages  # NOT MOUNTED - future team messages
/api/v3/projects/:id/plan      # NOT MOUNTED - future plan API
```

**File:** `apps/backend/src/v3/routes/messages.routes.ts` exists but is NOT imported in `v3/routes/index.ts`

---

## Critical Files

### Frontend Giant Coordinator
- **`client/src/pages/agentbuilder.tsx`** (5,300+ lines)
  - ⚠️ **DO NOT REFACTOR WITHOUT APPROVAL**
  - Contains: Project mgmt, deck runtime, KG viz, chat, canvas
  - Any change can break multiple subsystems

### Backend Route Mounts
- **`apps/backend/src/routes/index.ts`** - All route mounts
- **`apps/backend/src/v3/routes/index.ts`** - V3 route mounts

### Canvas
- **`client/src/components/builder/BuilderCanvas.tsx`** - Main canvas component
- **`client/src/components/builder/nodes/AgentCardNode.tsx`** - Agent card rendering

### Knowledge Graph
- **Backend:** `apps/backend/src/routes/knowgraph.routes.ts`
- **Frontend:** `client/src/components/knowledge/KnowledgeGraphNVL.tsx`
- **Transform:** `agentbuilder.tsx` lines 1882-2083

---

## Common Tasks

### Add New API Route

1. Create route file: `apps/backend/src/routes/myroute.routes.ts`
2. Mount in `apps/backend/src/routes/index.ts`:
   ```typescript
   import myRoute from './myroute.routes';
   router.use('/myroute', authMiddleware, myRoute);
   ```

### Query Neo4j Knowledge Graph

**From Backend:**
```typescript
import { getNeo4jDriver } from '../connectors/neo4j';

const driver = getNeo4jDriver();
const session = driver.session();
const result = await session.run(
  'MATCH (n) WHERE n.project_id = $projectId RETURN n LIMIT 10',
  { projectId }
);
```

**From API:**
```bash
curl http://localhost:4000/api/knowgraph/graph?projectId=ADMIN
```

### Import Code to Knowledge Graph

```bash
# From repo root
node scripts/ingest-repo-to-knowgraph.mjs
```

This creates Neo4j nodes/relationships for:
- Files (`:File` label)
- Functions (`:Function` label)  
- Imports (`:IMPORTS` relationship)
- All tagged with `project_id` property

---

## Debugging Workflow (CRITICAL)

### Required Audit Order for Graph Problems

When the graph looks blank, follow this **exact sequence:**

**Layer 1: Route Health**
- Check whether backend route returns graph JSON or auth/database error
- Test: `curl http://localhost:4000/api/knowgraph/graph?projectId=ADMIN`

**Layer 2: Postgres Auth Gate**
- If route fails before graph query, fix DB target / Prisma table availability first
- Check: Do `User`, `Session`, `HealthCheck` tables exist?

**Layer 3: Neo4j Graph Truth**
- Verify counts for active project and ADMIN:
```cypher
MATCH (n) WHERE n.project_id = 'ADMIN' RETURN count(n) as node_count;
MATCH ()-[r]->() WHERE r.project_id = 'ADMIN' RETURN count(r) as rel_count;
```
- Repeat for actual active project ID

**Layer 4: Frontend Transform**
- If API returns data, verify transform into `KnowledgeGraphNVL` entities/relationships
- Check: `agentbuilder.tsx` lines 1882-2083 (transform logic)

**Layer 5: Renderer**
- Only then inspect render visibility, fit-to-view, opacity, size, positioning
- Check: `KnowledgeGraphNVL` component render logic

### What Coding Agents Must Do Before Claiming Progress

Agents **must return:**
- ✅ Exact live path audited
- ✅ Exact files changed
- ✅ Exact runtime counts found
- ✅ Exact route response observed
- ✅ Exact visible UI behavior after change
- ✅ Exact remaining blockers

❌ **DO NOT** say something is fixed unless screenshot or route output proves it

---

## Known Anti-Patterns to Avoid

1. ❌ **DO NOT** replace the graph with forms or summary cards
2. ❌ **DO NOT** treat a blank graph as proof that import failed until route actually succeeds
3. ❌ **DO NOT** start random schema churn when schema was intentionally locked
4. ❌ **DO NOT** use dormant or unmounted files as if they are active runtime truth
5. ❌ **DO NOT** let agents spin on UI changes when backend route health is failing upstream
6. ❌ **DO NOT** redesign Knowledge surface without explicit approval
7. ❌ **DO NOT** guess mounted routes - verify in `apps/backend/src/routes/index.ts`

---

## Current Runtime Connection Facts

### Postgres
**Current backend DB target (from audit):**
- Host: `localhost`
- Port: `5433`
- Database: `liquidaity`
- User: `liquidaity-user`
- Password: `LiquidAIty`
- Source: `apps/backend/.env`

**Audit findings:**
- ✅ Connection succeeds
- ✅ Database contains tables like `preferences`
- ❌ Prisma auth tables (`User`, `Session`, `HealthCheck`) are **missing**

**Interpretation:**
- Backend pointed at real Postgres instance
- Expected Prisma tables absent in that DB
- Route auth fails before KnowGraph read can complete

### Neo4j
- URI: `bolt://localhost:7687`
- User: `neo4j`
- Password: `changeme`
- Container: `liquidaity-neo4j`
- Status: Running (verified)

---

## Troubleshooting

### Auth Errors: "Table User does not exist"

**Cause:** Prisma schema not deployed to Postgres

**Fix:**
```bash
npx prisma db push
```

### Knowledge Graph Empty

**IMPORTANT:** Follow debugging workflow (Layer 1-5) before assuming import failure

**Possible causes:**
1. Auth middleware blocking route before Neo4j query runs
2. Project ID mismatch (frontend vs Neo4j)
3. No data imported for active project
4. Transform error in frontend
5. Render visibility issue

**Diagnostic sequence:**
```bash
# 1. Test route health (bypasses frontend)
curl http://localhost:4000/api/knowgraph/graph?projectId=ADMIN

# 2. If auth error, check Prisma tables
# See "Auth Errors" section

# 3. If route succeeds, check Neo4j counts
# Open http://localhost:7474
# Run: MATCH (n) WHERE n.project_id = 'ADMIN' RETURN count(n);

# 4. If Neo4j empty, import code
node scripts/ingest-repo-to-knowgraph.mjs

# 5. If Neo4j has data but UI empty, check frontend transform
# Open browser console, check for errors
```

### Backend Won't Start

**Check:**
1. Port 4000 available: `netstat -ano | findstr :4000`
2. Postgres running on 5433: `Test-NetConnection localhost -Port 5433`
3. Neo4j running on 7687: `Test-NetConnection localhost -Port 7687`
4. `.env` file exists: `apps/backend/.env`

### Frontend Build Errors

```bash
# Clear cache and rebuild
rm -rf node_modules/.vite
npm run dev
```

---

## Testing

### Manual Smoke Tests

```bash
# Backend health
curl http://localhost:4000/api/health

# Neo4j connection
curl http://localhost:4000/api/knowgraph/health

# Projects list
curl http://localhost:4000/api/v2/projects
```

### Automated Tests

```bash
# Run all tests
npm test

# Run specific test
npm test -- agentbuilder.spec
```

---

## Versioning Confusion (IMPORTANT)

**v2 and v3 are NOT versions** - they are separate subsystems:

- **v2** = Project/Agent/KG management routes
- **v3** = Deck runtime execution routes

They coexist and serve different purposes. Do not try to "upgrade" v2 to v3.

---

## Deployment

### Docker Production

```bash
# Build all services
docker-compose build

# Start production stack
docker-compose up -d

# View logs
docker-compose logs -f backend
```

### Environment Variables

**Required for production:**
- `NODE_ENV=production`
- `DATABASE_URL` - Postgres connection
- `NEO4J_URI` - Neo4j connection
- `OPENAI_API_KEY` - LLM provider
- `JWT_SECRET_KEY` - Auth signing
- `SESSION_SECRET` - Session encryption

---

## Knowledge Graph Schema

### Node Labels
- `:File` - Source code files
- `:Function` - Functions/methods
- `:Class` - Classes
- `:Module` - Modules/packages
- `:Entity` - Knowledge entities
- `:Concept` - Abstract concepts

### Relationship Types
- `:IMPORTS` - File imports
- `:CALLS` - Function calls
- `:CONTAINS` - Containment
- `:RELATED_TO` - General relationship
- `:DEPENDS_ON` - Dependencies

### Properties
- `project_id` - Project scope (REQUIRED)
- `name` - Entity name
- `type` - Entity type
- `source` - "think" or "know"
- `scope` - "project", "grounded_research", etc.

---

## Code Import Process

1. **Scan:** `scripts/ingest-repo-to-knowgraph.mjs` scans TypeScript files
2. **Parse:** Extracts functions, imports, exports
3. **Transform:** Converts to Neo4j nodes/relationships
4. **Ingest:** Writes to Neo4j with `project_id` tag
5. **Query:** Frontend fetches via `/api/knowgraph/graph?projectId=X`
6. **Render:** `KnowledgeGraphNVL` visualizes with D3

---

## Security Notes

### Auth Middleware

**File:** `apps/backend/src/middleware/auth.ts`

**Behavior:**
- Checks `sid` cookie for session
- If no session + localhost: creates anonymous user
- If no session + remote: returns 401

**Bypass for Testing:**
```typescript
// apps/backend/src/routes/index.ts
router.use('/knowgraph', knowgraphRoutes); // Remove authMiddleware
```

### CORS

**Allowed origins:** `http://localhost:5173`, `http://localhost:3000`

**File:** `apps/backend/src/main.ts`

---

## Performance

### Neo4j Indexes

```cypher
CREATE INDEX project_id_index FOR (n) ON (n.project_id);
CREATE INDEX entity_type_index FOR (n:Entity) ON (n.type);
```

### Postgres Indexes

Prisma auto-creates indexes on:
- Primary keys (`id`)
- Unique fields (`email`)
- Foreign keys (`userId`)

---

## Useful Scripts

```bash
# Generate repo map
node scripts/build-repo-map.mjs

# Import code to Neo4j
node scripts/ingest-repo-to-knowgraph.mjs

# Verify Neo4j APOC
node scripts/verify-apoc-graph-import.mjs

# Smoke test KG
pwsh scripts/smoke_test_kg.ps1
```

---

## External Services

### Neo4j Browser
- **URL:** http://localhost:7474
- **User:** neo4j
- **Password:** changeme

### Postgres Admin
```bash
# Connect via psql
psql -h localhost -p 5433 -U liquidaity-user -d liquidaity
# Password: LiquidAIty
```

---

## PowerShell Checks (Keep Handy)

### Check Backend Route Response
```powershell
Invoke-RestMethod "http://localhost:4000/api/knowgraph/graph?projectId=ADMIN"
```

### Check Postgres Port
```powershell
Test-NetConnection -ComputerName localhost -Port 5433
```

### Check Postgres Tables
```powershell
$env:PGPASSWORD='LiquidAIty'
# Using docker postgres client
docker run --rm postgres:15-alpine psql "postgresql://liquidaity-user:LiquidAIty@host.docker.internal:5433/liquidaity" -c "SELECT tablename FROM pg_tables WHERE schemaname='public';"
```

### Check Neo4j Counts
```cypher
// Open http://localhost:7474
MATCH (n) WHERE n.project_id = 'ADMIN' RETURN count(n) as node_count;
MATCH ()-[r]->() WHERE r.project_id = 'ADMIN' RETURN count(r) as rel_count;
```

---

## Definition of Done (Current Graph Issue)

Done means **all** of these are true:

1. ✅ `/api/knowgraph/graph?projectId=<active>` returns valid graph JSON (not auth failure)
2. ✅ Neo4j counts are known for ADMIN and active project
3. ✅ Knowledge surface shows either:
   - Real nodes/edges from Neo4j data, OR
   - Truthful empty state based on actual graph data
4. ✅ No forms/cards replaced the graph
5. ✅ Project scoping is still correct
6. ✅ Screenshot or route output proves visible behavior

---

## Quick Reference

### Start Everything
```bash
docker-compose up neo4j -d
cd apps/backend && npm run dev &
npm run dev
```

### Stop Everything
```bash
docker-compose down
# Kill backend/frontend processes
```

### Reset Databases
```bash
# Postgres
npx prisma db push --force-reset

# Neo4j
docker-compose down -v
docker-compose up neo4j -d
node scripts/ingest-repo-to-knowgraph.mjs
```

---

## Getting Help

1. **Check logs:** `apps/backend/backend-dev.log`
2. **Check browser console:** F12 in browser
3. **Check Neo4j browser:** http://localhost:7474
4. **Read docs:** `docs/entity-relationship-architecture-spec.md`
5. **Read launch readiness:** `launch-readiness.md`
6. **Read repo map:** `repo-map.md`

---

## Short Repo Memory for Future Agents

If you are a coding agent touching this repo:

1. ✅ **Read this file first**
2. ❌ **Do not redesign Knowledge** (graph-first is non-negotiable)
3. ❌ **Do not guess mounted routes** (verify in `routes/index.ts`)
4. ✅ **Verify route health before UI work** (follow Layer 1-5 debugging)
5. ✅ **Preserve graph-first behavior** (no forms, no summary cards replacing graph)
6. ✅ **Report facts, not vibes** (exact counts, exact responses, exact files changed)
7. ✅ **No success claims without proof** (screenshot or route output required)

---

## What Has Already Been Established

### Proven or Previously Claimed True
- ✅ Backend Neo4j code graph import works (by design)
- ✅ Overlay import works
- ✅ `knowledgeProjectId` should resolve from active project ID
- ✅ `messages.routes.ts` is NOT mounted in current runtime (audit confirmed)
- ✅ Fake Knowledge summary-card regression was removed
- ✅ `KnowledgeGraphNVL` is back as main Knowledge surface
- ✅ Current Knowledge UI shows truthful empty state

### Current Visible Truth
- ✅ Graph surface is back (not replaced by cards)
- ⚠️ Current selected project returns no visible graph data in UI
- ⚠️ Next blocker is data path or backend gating (not UI replacement)

### Biggest Current Blocker
- ❌ `/api/knowgraph/graph` fails before Neo4j query
- ❌ Auth middleware touches Prisma
- ❌ Prisma expects `User`/`Session` tables that don't exist in current Postgres
- ⚠️ Empty graph UI does NOT prove Neo4j has no data
- ⚠️ Request blocked before graph query runs
- ⚠️ This is Postgres auth/runtime issue, NOT Neo4j graph failure

---

**End of Stack Guide**
