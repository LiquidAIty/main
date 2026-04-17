# LiquidAIty Root Operating Guide

**Last Updated:** 2026-04-14  
**Purpose:** Single source of truth for repo operations, environment, databases, and critical rules

---

## ENVIRONMENT SOURCE OF TRUTH

### Backend Environment
- **ONLY SOURCE:** `apps/backend/.env`
- **DO NOT** create root `.env` for backend work
- **DO NOT** duplicate backend env config anywhere else
- Backend reads from `apps/backend/.env` via dotenv

### Database URLs
```
DATABASE_URL=postgresql://liquidaity-user:LiquidAIty@localhost:5433/liquidaity?schema=public
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=changeme
```

---

## DATABASES - WHAT EACH IS FOR

### 1. PostgreSQL (Port 5433)
**Purpose:** Application database, auth, projects, preferences

**Prisma Tables (public schema):**
- `User` - Auth users
- `Session` - Auth sessions
- `HealthCheck` - Service health

**PostgreSQL/AGE Tables (ag_catalog schema):**
- `projects` - Project metadata
- `project_goals` - Goals per project
- `project_plans` - Versioned plans
- `tasks` - Tasks per project
- `executions` - Task execution logs
- `preferences` - User preferences
- `rag_chunks` - RAG document chunks
- `rag_embeddings` - Vector embeddings

**Connection:**
- Host: `localhost`
- Port: `5433`
- Database: `liquidaity`
- User: `liquidaity-user`
- Password: `LiquidAIty`

### 2. Neo4j (Port 7687)
**Purpose:** Knowledge graph, code graph visualization

**Node Types:**
- `:File` - Source code files
- `:Function` - Functions/methods
- `:Entity` - Knowledge entities
- `:Concept` - Abstract concepts

**Relationship Types:**
- `:IMPORTS` - File imports
- `:CALLS` - Function calls
- `:RELATED_TO` - General relationships

**Connection:**
- URI: `bolt://localhost:7687`
- Browser: `http://localhost:7474`
- User: `neo4j`
- Password: `changeme`
- Container: `liquidaity-neo4j`

### 3. Redis (Port 6379)
**Purpose:** Caching (optional)

---

## START COMMANDS

### Start Everything (Local Dev)
```powershell
# Terminal 1: Neo4j
docker-compose up neo4j

# Terminal 2: Backend
cd apps/backend
npm run dev

# Terminal 3: Frontend
npm run dev
```

### Start with Docker Compose
```powershell
docker-compose up -d
```

### Database Setup
```powershell
# Create Prisma tables (User, Session, HealthCheck)
npx prisma db push --schema=prisma/schema.prisma

# Run PostgreSQL schema (AGE, projects, RAG)
Get-Content db/00_pg_age_timescale_postgis_vector_FULLSTACK.sql | psql -h localhost -p 5433 -U postgres -d liquidaity
Get-Content db/10_myagent_core.sql | psql -h localhost -p 5433 -U postgres -d liquidaity
Get-Content db/11_myagent_api.sql | psql -h localhost -p 5433 -U postgres -d liquidaity
```

---

## GRAPH IMPORT PATH

### Import Code Graph to Neo4j
```powershell
node scripts/ingest-repo-to-knowgraph.mjs
```

This creates:
- File nodes with `:File` label
- Function nodes with `:Function` label
- Import relationships
- All tagged with `project_id` property

### Verify Neo4j Data
```cypher
// Open http://localhost:7474
MATCH (n) WHERE n.project_id = 'ADMIN' RETURN count(n) as node_count;
MATCH ()-[r]->() WHERE r.project_id = 'ADMIN' RETURN count(r) as rel_count;
```

---

## KNOWN FAILURE MODES

### 1. Auth/Session Errors
**Symptom:** "Table User does not exist" or "Invalid session"

**Cause:** Prisma tables not created in PostgreSQL

**Fix:**
```powershell
npx prisma db push --schema=prisma/schema.prisma
```

### 2. Knowledge Graph Empty
**CRITICAL:** Follow this exact order:

1. **Test route health first:**
   ```powershell
   Invoke-RestMethod "http://localhost:4000/api/knowgraph/graph?projectId=ADMIN"
   ```

2. **If auth error:** Fix Prisma tables (see #1)

3. **If route succeeds:** Check Neo4j counts
   ```cypher
   MATCH (n) WHERE n.project_id = 'ADMIN' RETURN count(n);
   ```

4. **If Neo4j empty:** Import code graph
   ```powershell
   node scripts/ingest-repo-to-knowgraph.mjs
   ```

5. **If Neo4j has data but UI empty:** Check frontend transform in `agentbuilder.tsx` lines 1882-2083

### 3. Backend Won't Start
**Check:**
- Port 4000 available: `netstat -ano | findstr :4000`
- Postgres running: `Test-NetConnection localhost -Port 5433`
- Neo4j running: `Test-NetConnection localhost -Port 7687`
- Env file exists: `apps/backend/.env`

---

## NEVER DO THIS AGAIN

### ❌ NO EXTRA `.env` FILES
- Root `.env` is NOT used for backend runtime
- Only `apps/backend/.env` is the backend source of truth
- Do not create duplicate env files

### ❌ NO AUTH BYPASS
- Do not remove auth middleware
- Do not add "skip session" hacks
- Do not default to anonymous without proper flow

### ❌ NO PROJECT BYPASS
- Do not add fallback project IDs
- Do not hardcode project selection
- Do not skip project ownership checks

### ❌ NO GRAPH REPLACEMENT
- Knowledge surface is graph-first
- Do not replace graph with forms
- Do not replace graph with summary cards
- Graph must always be the main visible Knowledge surface

### ❌ NO STARTING AUDITS OVER
- Follow the exact debugging workflow (Layer 1-5)
- Do not guess - verify route health first
- Do not assume UI issue when backend is failing

### ❌ NO LEAVING JUNK FILES
- Delete temporary files after use
- Do not leave diagnostic logs in code
- Do not leave test files in production paths
- Clean up after every change

---

## CRITICAL FILES

### Frontend
- `client/src/pages/agentbuilder.tsx` (5,300+ lines) - **DO NOT REFACTOR WITHOUT APPROVAL**
- `client/src/components/builder/BuilderCanvas.tsx` - Main canvas
- `client/src/components/knowledge/KnowledgeGraphNVL.tsx` - Graph visualization

### Backend
- `apps/backend/src/routes/index.ts` - Route mounts (verify here)
- `apps/backend/src/routes/knowgraph.routes.ts` - Neo4j graph queries
- `apps/backend/src/routes/v2/projects.routes.ts` - Project CRUD
- `apps/backend/src/middleware/auth.ts` - Auth middleware
- `apps/backend/src/auth/sessionStore.ts` - Session management

### Database
- `prisma/schema.prisma` - Prisma models (User, Session, HealthCheck)
- `db/00_pg_age_timescale_postgis_vector_FULLSTACK.sql` - Main PostgreSQL schema
- `db/10_myagent_core.sql` - Project/task tables
- `db/11_myagent_api.sql` - API functions

---

## API ROUTES (MOUNTED)

```
/api/auth/*                    # Auth (Prisma User/Session)
/api/health                    # Health check
/api/v2/projects/*             # Project CRUD
/api/v2/projects/:id/agents/*  # Agent config
/api/v2/projects/:id/kg/*      # Knowledge graph ops
/api/v3/projects/:id/decks/*   # Deck execution
/api/knowgraph/*               # Neo4j graph queries
/api/mcp/*                     # MCP tools
/api/dispatch/*                # Task dispatch
```

**NOT MOUNTED (dormant):**
- `/api/v3/projects/:id/messages` - Future team messages
- `/api/v3/projects/:id/plan` - Future plan API

---

## PRODUCT TRUTH

### 4 Connected Surfaces
1. **Chat** - MainChat/Magentic-One orchestrator
2. **Canvas** - Agent building, deck editing
3. **Plan** - Execution plans, reasoning traces
4. **Knowledge** - Code graph + knowledge graph visualization

### Knowledge Surface Rules
- ✅ Knowledge is graph-first
- ✅ ThinkGraph and KnowGraph must remain visible
- ❌ DO NOT replace graph with forms or summary cards
- ✅ Graph must always be the main visible Knowledge surface

### Canvas Rules
- **Mini Chat-Side Canvas:** Quick connect/disconnect only, no full editing
- **Full Canvas:** Only place for add-agent, full editing, prompt/tool/runtime editing

### Plan Surface
- ✅ Blank before first real run is acceptable
- ✅ After a real run, Plan must visibly populate
- ❌ Plan is NOT logs

---

## DEBUGGING WORKFLOW (EXACT ORDER)

When graph looks blank, follow this **exact sequence:**

**Layer 1: Route Health**
```powershell
Invoke-RestMethod "http://localhost:4000/api/knowgraph/graph?projectId=ADMIN"
```

**Layer 2: Postgres Auth Gate**
- If route fails before graph query, fix Prisma tables first
- Check: Do `User`, `Session`, `HealthCheck` tables exist?

**Layer 3: Neo4j Graph Truth**
```cypher
MATCH (n) WHERE n.project_id = 'ADMIN' RETURN count(n);
MATCH ()-[r]->() WHERE r.project_id = 'ADMIN' RETURN count(r);
```

**Layer 4: Frontend Transform**
- If API returns data, verify transform in `agentbuilder.tsx` lines 1882-2083

**Layer 5: Renderer**
- Only then inspect render visibility, fit-to-view, opacity

---

## WORKSPACE SCRIPTS

```powershell
# Generate repo map
node scripts/build-repo-map.mjs

# Import code to Neo4j
node scripts/ingest-repo-to-knowgraph.mjs

# Verify APOC
node scripts/verify-apoc-graph-import.mjs
```

---

## PORTS

- **Frontend:** 5173 (Vite dev server)
- **Backend:** 4000 (Express)
- **PostgreSQL:** 5433
- **Neo4j Browser:** 7474
- **Neo4j Bolt:** 7687
- **Redis:** 6379
- **KnowGraph Service:** 8001

---

## TECH STACK

- **Frontend:** React 19 + TypeScript + Vite
- **Backend:** Node.js + Express + TypeScript
- **Databases:** PostgreSQL (Prisma + AGE), Neo4j, Redis
- **AI/LLM:** OpenAI, OpenRouter
- **Build:** Nx monorepo

---

## WHAT AGENTS MUST RETURN

Before claiming progress, agents **must return:**
- ✅ Exact live path audited
- ✅ Exact files changed
- ✅ Exact runtime counts found
- ✅ Exact route response observed
- ✅ Exact visible UI behavior after change
- ✅ Exact remaining blockers

❌ **DO NOT** say something is fixed unless screenshot or route output proves it

---

**End of Operating Guide**
