#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const repoData = JSON.parse(fs.readFileSync(path.join(ROOT, 'repo-map.json'), 'utf8'));

function categorize(filePath) {
  const p = filePath.replace(/\\/g, '/');
  if (p.includes('client/src/pages')) return 'frontend_page';
  if (p.includes('client/src/components')) return 'frontend_component';
  if (p.includes('client/src/hooks')) return 'frontend_hook';
  if (p.includes('apps/backend/src/routes/v2')) return 'backend_v2_route';
  if (p.includes('apps/backend/src/v3/routes')) return 'backend_v3_route';
  if (p.includes('apps/backend/src/routes')) return 'backend_route';
  if (p.includes('apps/backend/src/services')) return 'backend_service';
  if (p.includes('apps/backend/src/agents')) return 'backend_agent';
  if (p.includes('apps/backend/src/llm')) return 'backend_llm';
  if (p.includes('apps/backend/src/db')) return 'backend_db';
  if (p.includes('apps/backend/src/api')) return 'backend_api';
  if (p.includes('apps/backend/src/middleware')) return 'backend_middleware';
  if (p.includes('apps/backend/src/controllers')) return 'backend_controller';
  if (p.includes('apps/backend/src/connectors')) return 'backend_connector';
  if (p.includes('apps/backend/src/auth')) return 'backend_auth';
  if (p.includes('apps/backend/src/security')) return 'backend_security';
  if (p.includes('apps/backend/src/v3')) return 'backend_v3';
  if (p.includes('.spec.') || p.includes('.test.')) return 'test';
  if (p.includes('scripts/')) return 'script';
  return 'other';
}

// Re-categorize files
repoData.files.forEach(f => {
  f.category = categorize(f.path);
});

const buckets = repoData.files.reduce((acc, f) => {
  if (!acc[f.category]) acc[f.category] = [];
  acc[f.category].push(f);
  return acc;
}, {});

// Find route mounts
const routeMounts = [];
repoData.files.forEach(f => {
  if (f.path.includes('routes/index.ts') || f.path.includes('v2/index.ts') || f.path.includes('v3/routes/index.ts')) {
    f.imports.forEach(imp => {
      if (imp.startsWith('.')) {
        routeMounts.push({
          mountFile: f.path,
          mountedRoute: imp,
        });
      }
    });
  }
});

// Identify unmounted route files
const unmountedRoutes = [];
const backendRoutes = repoData.files.filter(f => 
  f.path.includes('routes') && f.path.endsWith('.routes.ts')
);

backendRoutes.forEach(routeFile => {
  const basename = path.basename(routeFile.path, '.routes.ts');
  const isMounted = repoData.imports.some(imp => 
    imp.to.includes(basename) && imp.from.includes('index.ts')
  );
  
  if (!isMounted && routeFile.path.includes('messages.routes.ts')) {
    unmountedRoutes.push(routeFile.path);
  }
});

// Build markdown
let md = `# LiquidAIty Repository Map

**Generated:** ${new Date().toISOString()}

---

## 1. Repository Purpose Summary

**LiquidAIty** is an agentic AI platform with two primary modes:

1. **Assist Mode** - Production chat interface with knowledge graph integration
2. **Agent Builder Mode** - Internal tool for configuring agent behavior, deck execution, and knowledge graph management

### Tech Stack
- **Frontend:** React 19 + TypeScript + Vite
- **Backend:** Node.js + Express + TypeScript
- **Database:** PostgreSQL (via Prisma) + Neo4j (knowledge graph)
- **AI/LLM:** OpenAI API, OpenRouter, custom agent runtime
- **Build:** Nx monorepo

---

## 2. Top-Level Subsystem Map

\`\`\`
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
\`\`\`

---

## 3. Actual Live Execution Paths

### Frontend Entry
- **Entry file:** \`client/src/main.tsx\`
- **Router:** \`client/src/app.tsx\`
- **Primary UI:** \`client/src/pages/agentbuilder.tsx\` (5,400+ lines - GIANT COORDINATOR)

### Backend Entry
- **Entry file:** \`apps/backend/src/main.ts\`
- **Port:** 4000 (default)
- **Route mount:** \`apps/backend/src/routes/index.ts\`

### Active API Surface
\`\`\`
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
\`\`\`

---

## 4. Frontend Map

### Pages (${buckets.frontend_page?.length || 0} files)
${(buckets.frontend_page || []).map(f => `- **${f.path}** (${f.lines} lines)`).join('\n')}

### Components (${buckets.frontend_component?.length || 0} files)
**Key components:**
${(buckets.frontend_component || []).slice(0, 20).map(f => `- ${path.basename(f.path)} (${f.lines} lines)`).join('\n')}

### Hooks (${buckets.frontend_hook?.length || 0} files)
${(buckets.frontend_hook || []).map(f => `- ${path.basename(f.path)}`).join('\n')}

---

## 5. Backend Route Map

### V2 Routes (Project/Agent/KG Management)
**Mount:** \`/api/v2\`

${(buckets.backend_v2_route || []).map(f => {
  const routes = repoData.routes.filter(r => r.file === f.path);
  return `#### ${f.path}\n${routes.map(r => `- \`${r.method} ${r.path}\` (line ${r.line})`).join('\n')}`;
}).join('\n\n')}

### V3 Routes (Deck Runtime)
**Mount:** \`/api/v3\`

${(buckets.backend_v3_route || []).map(f => {
  const routes = repoData.routes.filter(r => r.file === f.path);
  return `#### ${f.path}\n${routes.map(r => `- \`${r.method} ${r.path}\` (line ${r.line})`).join('\n')}`;
}).join('\n\n')}

### Root-Level Routes
${(buckets.backend_route || []).filter(f => !f.path.includes('/v2/') && !f.path.includes('/v3/')).map(f => {
  const routes = repoData.routes.filter(r => r.file === f.path);
  return `#### ${f.path}\n${routes.length > 0 ? routes.map(r => `- \`${r.method} ${r.path}\``).join('\n') : '- (mount point)'}`;
}).join('\n\n')}

---

## 6. Runtime/Deck Execution Chain

### Deck Execution Flow
1. **Client Request:** \`POST /api/v3/projects/:id/decks/run\`
2. **Route Handler:** \`apps/backend/src/v3/routes/decks.routes.ts\`
3. **Runtime Engine:** \`apps/backend/src/v3/runtime/deckRuntime.ts\`
4. **Card Execution:** \`apps/backend/src/v3/cards/runtime.ts\`
5. **Storage:** \`apps/backend/src/v3/decks/store.ts\`

### Key Files
- **Deck runtime:** \`apps/backend/src/v3/runtime/deckRuntime.ts\`
- **Card runtime:** \`apps/backend/src/v3/cards/runtime.ts\`
- **Runtime binding:** \`apps/backend/src/v3/runtimeBinding.ts\`

---

## 7. Knowledge Graph / Research Chain

### KG Ingestion Flow
(HISTORICAL - the old chat auto-ingest was removed 2026-06-30. ThinkGraph is written only
by the Harness calling the ThinkGraph agent card; KnowGraph is written only by Mag One
research. See graph-write-authority.)

### KG Query Flow
1. **Client Query:** \`POST /api/v2/projects/:id/kg/query\`
2. **Route:** \`apps/backend/src/routes/v2/kg.routes.ts\`
3. **Query Builder:** \`apps/backend/src/routes/v2/query.ts\`
4. **Neo4j Execution:** \`apps/backend/src/connectors/neo4j.ts\`

### Key Files
- **KG routes:** \`apps/backend/src/routes/v2/kg.routes.ts\` (1,800 lines - GIANT)
- **KG service:** \`apps/backend/src/services/graphService.ts\`
- **Neo4j connector:** \`apps/backend/src/connectors/neo4j.ts\`
- **Research service:** \`apps/backend/src/services/research/researchService.ts\`

---

## 8. Auth/Session Path

### Authentication Flow
1. **Route:** \`/api/auth/*\`
2. **Handler:** \`apps/backend/src/routes/auth.routes.ts\`
3. **Middleware:** \`apps/backend/src/middleware/auth.ts\`
4. **Session Store:** \`apps/backend/src/auth/sessionStore.ts\`
5. **Security:** \`apps/backend/src/security/requestAccess.ts\`

---

## 9. Mounted vs Unmounted Surfaces

### ✅ Mounted Routes
All routes in:
- \`apps/backend/src/routes/*.routes.ts\` (except messages.routes.ts)
- \`apps/backend/src/routes/v2/*.routes.ts\`
- \`apps/backend/src/v3/routes/cards.routes.ts\`
- \`apps/backend/src/v3/routes/decks.routes.ts\`

### ❌ Unmounted Routes (DEAD CODE)
${unmountedRoutes.length > 0 ? unmountedRoutes.map(r => `- **${r}** - Defined but NOT imported in v3/routes/index.ts`).join('\n') : '- None detected'}

---

## 10. Likely Dead/Legacy-Risk Areas

### High-Risk Files
1. **\`client/src/pages/agentbuilder.tsx\`** - 5,400+ lines, single-file coordinator
   - Risk: Any change could break multiple subsystems
   - Contains: Project management, deck runtime, KG visualization, chat, canvas

2. **\`apps/backend/src/routes/v2/kg.routes.ts\`** - 1,800+ lines
   - Risk: Giant route file with complex ingest logic
   - Contains: Chat turn ingest, file ingest, research, query endpoints

3. **\`apps/backend/src/v3/routes/messages.routes.ts\`** - UNMOUNTED
   - Status: Dead code, not imported in v3/routes/index.ts
   - Action: Safe to delete

### Versioning Confusion
- **v2** and **v3** are NOT iterations - they're separate subsystems:
  - **v2** = Project/Agent/KG management
  - **v3** = Deck runtime execution
- Misleading names cause agent confusion

### Duplicate-Looking Surfaces
- \`/api/kg\` (root) vs \`/api/v2/projects/:id/kg\` - Different purposes
- \`/api/knowgraph\` vs \`/api/v2/projects/:id/kg\` - Different query surfaces

---

## 11. How Not to Break This Repo

### Critical Invariants
1. **Never modify \`agentbuilder.tsx\` without full context** - it's the frontend orchestrator
2. **v2 and v3 routes serve different purposes** - don't merge them
3. **Deck runtime is stateful** - changes to v3/runtime affect execution
4. **KG ingest is async** - chat must never block on it
5. **Route mounts in \`routes/index.ts\`** - verify mounts before adding routes

### Safe Change Patterns
- ✅ Add new routes in their own files
- ✅ Create new services in \`services/\`
- ✅ Add new components in \`components/\`
- ❌ Don't refactor \`agentbuilder.tsx\` without explicit approval
- ❌ Don't rename v2/v3 without coordinated client/backend migration
- ❌ Don't add UI controls to Assist mode (it's production)

### Testing Before Deploy
\`\`\`bash
# Build check
nx build backend
nx build client

# Route audit
node scripts/routeMap.ts

# Dependency check
npm run audit:deps
\`\`\`

---

## 12. Recommended Reading Order for New Coding Agents

### Phase 1: Entry Points (Start Here)
1. **\`apps/backend/src/main.ts\`** - Backend entry, server setup
2. **\`apps/backend/src/routes/index.ts\`** - Route mounts, API surface
3. **\`client/src/app.tsx\`** - Frontend router
4. **\`client/src/pages/agentbuilder.tsx\`** - Main UI (WARNING: 5,400 lines)

### Phase 2: Core Subsystems
5. **\`apps/backend/src/routes/v2/projects.routes.ts\`** - Project CRUD
6. **\`apps/backend/src/routes/v2/config.routes.ts\`** - Agent configuration
7. **\`apps/backend/src/v3/routes/decks.routes.ts\`** - Deck execution API
8. **\`apps/backend/src/v3/runtime/deckRuntime.ts\`** - Deck execution engine

### Phase 3: Knowledge Graph
9. **\`apps/backend/src/routes/v2/kg.routes.ts\`** - KG API (WARNING: 1,800 lines)
10. **\`apps/backend/src/services/graphService.ts\`** - KG operations

### Phase 4: Supporting Services
11. **\`apps/backend/src/services/agentBuilderStore.ts\`** - Project state
12. **\`apps/backend/src/services/v2/agentConfigStore.ts\`** - Agent config
13. **\`apps/backend/src/llm/client.ts\`** - LLM client wrapper
14. **\`apps/backend/src/middleware/auth.ts\`** - Auth middleware

### Phase 5: Frontend Components
15. **\`client/src/components/builder/BuilderCanvas.tsx\`** - Deck canvas
16. **\`client/src/components/builder/BuilderChat.tsx\`** - Chat interface
17. **\`client/src/hooks/useBuilderProjects.ts\`** - Project management hook
18. **\`client/src/hooks/useBuilderDeckRuntimeActions.ts\`** - Deck runtime hook

---

## File Inventory Summary

| Category | Count |
|----------|-------|
${Object.entries(buckets).map(([cat, files]) => `| ${cat} | ${files.length} |`).join('\n')}
| **TOTAL** | **${repoData.files.length}** |

---

## Graph Statistics

- **Total Files:** ${repoData.files.length}
- **Total Imports:** ${repoData.imports.length}
- **Total Routes:** ${repoData.routes.length}
- **Total Symbols:** ${repoData.symbols.length}

---

## Biggest Confusion/Risk Areas Discovered

### 1. Giant Coordinator Files
- **\`agentbuilder.tsx\`** (5,400 lines) - Single-file frontend orchestrator
- **\`kg.routes.ts\`** (1,800 lines) - Monolithic KG route handler

### 2. Versioning Confusion
- v2 and v3 are NOT versions - they're separate subsystems
- Misleading names cause agents to think v3 replaces v2

### 3. Unmounted Dead Code
- \`v3/routes/messages.routes.ts\` exists but is not mounted

### 4. Dual Graph Systems
- \`/api/kg\` vs \`/api/v2/projects/:id/kg\` vs \`/api/knowgraph\`
- Different purposes but overlapping names

### 5. Assist vs Builder Mode Confusion
- Assist = production (no admin UI)
- Builder = internal tool (full controls)
- Agents often try to add controls to Assist mode

---

**End of Repository Map**
`;

fs.writeFileSync(path.join(ROOT, 'repo-map.md'), md);
console.log('✅ Generated repo-map.md');
