# Graph Entity Schema — Repo Brain

## Overview

This document defines the entity types, relationships, and properties for importing the LiquidAIty codebase into KnowGraph (Neo4j).

The goal is to create a **queryable, truthful representation** of the codebase that supports:
- Architecture understanding
- Dead code detection
- Dependency analysis
- Refactoring planning
- Prompt generation for coding tools

---

## Core Principles

1. **Truth over completeness** — Better to have accurate partial data than complete but wrong data
2. **Status labels matter** — Distinguish ACTIVE, PARTIAL, STUB, LEGACY, PLANNED, UNCERTAIN
3. **Relationships are first-class** — Edges carry semantic meaning, not just connections
4. **Queryable by intent** — Schema supports questions developers actually ask

---

## Entity Types

### 1. Repo

**Label:** `Repo`

**Properties:**
- `name` (string) — Repository name
- `path` (string) — Absolute path on filesystem
- `language` (string) — Primary language (e.g., "TypeScript")
- `framework` (string) — Primary framework (e.g., "React + Express")
- `created` (datetime) — When repo was created
- `lastModified` (datetime) — Last modification time

**Example:**
```cypher
CREATE (r:Repo {
  name: "LiquidAIty",
  path: "c:/Projects/LiquidAIty/main",
  language: "TypeScript",
  framework: "React + Express",
  created: datetime(),
  lastModified: datetime()
})
```

---

### 2. Directory

**Label:** `Directory`

**Properties:**
- `name` (string) — Directory name
- `path` (string) — Relative path from repo root
- `absolutePath` (string) — Absolute filesystem path
- `purpose` (string) — Purpose (e.g., "backend", "frontend", "services")
- `fileCount` (integer) — Number of files (direct children)
- `subdirCount` (integer) — Number of subdirectories

**Example:**
```cypher
CREATE (d:Directory {
  name: "backend",
  path: "apps/backend",
  absolutePath: "c:/Projects/LiquidAIty/main/apps/backend",
  purpose: "backend",
  fileCount: 15,
  subdirCount: 8
})
```

---

### 3. File

**Label:** `File`

**Properties:**
- `name` (string) — Filename with extension
- `path` (string) — Relative path from repo root
- `absolutePath` (string) — Absolute filesystem path
- `extension` (string) — File extension (e.g., ".ts", ".tsx")
- `language` (string) — Language (e.g., "TypeScript", "JavaScript")
- `size` (integer) — File size in bytes
- `lines` (integer) — Line count
- `status` (string) — ACTIVE | PARTIAL | STUB | LEGACY | PLANNED | UNCERTAIN
- `purpose` (string) — Purpose (e.g., "route", "service", "component")
- `lastModified` (datetime) — Last modification time

**Example:**
```cypher
CREATE (f:File {
  name: "agentbuilder.tsx",
  path: "client/src/pages/agentbuilder.tsx",
  absolutePath: "c:/Projects/LiquidAIty/main/client/src/pages/agentbuilder.tsx",
  extension: ".tsx",
  language: "TypeScript",
  size: 252000,
  lines: 5000,
  status: "ACTIVE",
  purpose: "page",
  lastModified: datetime()
})
```

---

### 4. Page

**Label:** `Page`

**Properties:**
- `name` (string) — Page component name
- `route` (string) — URL route (e.g., "/agentbuilder")
- `filePath` (string) — Relative path to file
- `status` (string) — ACTIVE | PARTIAL | STUB | LEGACY
- `description` (string) — Purpose description

**Example:**
```cypher
CREATE (p:Page {
  name: "AgentBuilder",
  route: "/agentbuilder",
  filePath: "client/src/pages/agentbuilder.tsx",
  status: "ACTIVE",
  description: "Main agent builder canvas with React Flow"
})
```

---

### 5. Route

**Label:** `Route`

**Properties:**
- `path` (string) — API route path (e.g., "/api/projects/list")
- `method` (string) — HTTP method (GET, POST, PUT, DELETE)
- `filePath` (string) — Relative path to route definition
- `status` (string) — ACTIVE | PARTIAL | STUB | LEGACY
- `protected` (boolean) — Requires authentication
- `description` (string) — Purpose description

**Example:**
```cypher
CREATE (r:Route {
  path: "/api/projects/list",
  method: "GET",
  filePath: "apps/backend/src/routes/projects.routes.ts",
  status: "ACTIVE",
  protected: true,
  description: "List all projects for current user"
})
```

---

### 6. Component

**Label:** `Component`

**Properties:**
- `name` (string) — Component name
- `filePath` (string) — Relative path to file
- `type` (string) — Component type (e.g., "functional", "class")
- `status` (string) — ACTIVE | PARTIAL | STUB | LEGACY
- `exported` (boolean) — Is exported
- `description` (string) — Purpose description

**Example:**
```cypher
CREATE (c:Component {
  name: "KnowledgeGraphNVL",
  filePath: "client/src/components/knowledge/KnowledgeGraphNVL.tsx",
  type: "functional",
  status: "ACTIVE",
  exported: true,
  description: "Neo4j Visualization Library graph component"
})
```

---

### 7. Service

**Label:** `Service`

**Properties:**
- `name` (string) — Service name
- `filePath` (string) — Relative path to file
- `status` (string) — ACTIVE | PARTIAL | STUB | LEGACY | MOCK_FALLBACK
- `purpose` (string) — Service purpose
- `hasMockFallback` (boolean) — Falls back to mock data
- `description` (string) — Purpose description

**Example:**
```cypher
CREATE (s:Service {
  name: "agentBuilderStore",
  filePath: "apps/backend/src/services/agentBuilderStore.ts",
  status: "ACTIVE",
  purpose: "persistence",
  hasMockFallback: false,
  description: "Project and deck state persistence"
})
```

---

### 8. Connector

**Label:** `Connector`

**Properties:**
- `name` (string) — Connector name
- `filePath` (string) — Relative path to file
- `status` (string) — ACTIVE | PARTIAL | STUB | UNCONFIGURED
- `externalService` (string) — External service name (e.g., "Neo4j", "n8n")
- `requiresConfig` (boolean) — Requires env vars
- `description` (string) — Purpose description

**Example:**
```cypher
CREATE (c:Connector {
  name: "n8n",
  filePath: "apps/backend/src/agents/connectors/n8n.ts",
  status: "STUB",
  externalService: "n8n",
  requiresConfig: true,
  description: "n8n workflow automation connector (stubbed)"
})
```

---

### 9. Function

**Label:** `Function`

**Properties:**
- `name` (string) — Function name
- `filePath` (string) — Relative path to file
- `lineStart` (integer) — Starting line number
- `lineEnd` (integer) — Ending line number
- `async` (boolean) — Is async function
- `exported` (boolean) — Is exported
- `parameters` (array<string>) — Parameter names
- `description` (string) — Purpose description

**Example:**
```cypher
CREATE (f:Function {
  name: "executeClaudeCode",
  filePath: "apps/backend/src/agents/tools/claude-code.ts",
  lineStart: 45,
  lineEnd: 120,
  async: true,
  exported: false,
  parameters: ["params"],
  description: "Execute Claude Code CLI with bounded context"
})
```

---

### 10. Doc

**Label:** `Doc`

**Properties:**
- `name` (string) — Document name
- `path` (string) — Relative path from repo root
- `type` (string) — Document type (e.g., "architecture", "spec", "readme")
- `status` (string) — CURRENT | ARCHIVED | LEGACY
- `description` (string) — Purpose description

**Example:**
```cypher
CREATE (d:Doc {
  name: "SYSTEM_OVERVIEW",
  path: "docs/architecture/SYSTEM_OVERVIEW.md",
  type: "architecture",
  status: "CURRENT",
  description: "High-level system topology and components"
})
```

---

## Relationship Types

### 1. CONTAINS

**From:** `Repo` → `Directory`, `Directory` → `Directory`, `Directory` → `File`

**Properties:**
- `depth` (integer) — Nesting depth

**Meaning:** Hierarchical containment

---

### 2. IMPLEMENTS

**From:** `File` → `Page`, `File` → `Route`, `File` → `Component`, `File` → `Service`, `File` → `Connector`

**Properties:** None

**Meaning:** File implements this entity

---

### 3. IMPORTS

**From:** `File` → `File`

**Properties:**
- `importType` (string) — "default" | "named" | "namespace"
- `importedSymbols` (array<string>) — Specific symbols imported

**Meaning:** File imports from another file

---

### 4. DEPENDS_ON

**From:** `Component` → `Component`, `Service` → `Service`, `Route` → `Service`

**Properties:**
- `dependencyType` (string) — "direct" | "indirect"

**Meaning:** Entity depends on another entity

---

### 5. CALLS

**From:** `Function` → `Function`, `Route` → `Function`, `Component` → `Function`

**Properties:**
- `callCount` (integer) — Estimated call frequency (if known)

**Meaning:** Entity calls this function

---

### 6. ROUTES_TO

**From:** `Page` → `Route`

**Properties:** None

**Meaning:** Page makes API calls to this route

---

### 7. PERSISTS_TO

**From:** `Service` → `Database`, `Route` → `Database`

**Properties:**
- `table` (string) — Database table name (if applicable)

**Meaning:** Entity persists data to database

---

### 8. DOCUMENTS

**From:** `Doc` → `File`, `Doc` → `Component`, `Doc` → `Service`

**Properties:** None

**Meaning:** Documentation describes this entity

---

### 9. SUPERSEDES

**From:** `File` → `File`, `Component` → `Component`

**Properties:**
- `reason` (string) — Why it supersedes (e.g., "refactored", "replaced")

**Meaning:** Entity replaces an older entity

---

### 10. RELATED_TO

**From:** Any → Any

**Properties:**
- `relationType` (string) — Type of relationship
- `confidence` (float) — Confidence score (0-1)

**Meaning:** Generic relationship when specific type doesn't fit

---

## Status Labels

All entities should have a `status` property with one of these values:

- **ACTIVE** — Currently in production use, core to system
- **PARTIAL** — Exists and wired, but incomplete or has fake parts
- **STUB** — Interface exists but returns mock/fake data only
- **LEGACY** — Older implementation kept as adapter or reference
- **PLANNED** — Intended future implementation, partially done
- **UNCERTAIN** — Status unclear, needs investigation
- **DRIFT** — Alternate implementation overlapping with active path
- **UNCONFIGURED** — Real implementation but missing env vars/config
- **MOCK_FALLBACK** — Real API calls exist but fall back to mocks

---

## Query Examples

### Find all STUB services

```cypher
MATCH (s:Service {status: "STUB"})
RETURN s.name, s.filePath, s.description
```

### Find files that import agentBuilderStore

```cypher
MATCH (target:File {name: "agentBuilderStore.ts"})
MATCH (source:File)-[:IMPORTS]->(target)
RETURN source.name, source.path
```

### Find the execution path for v3 runtime

```cypher
MATCH path = (entry:Route {path: "/api/v3/execute"})-[:CALLS*]->(f:Function)
RETURN path
```

### Find all ACTIVE pages and their routes

```cypher
MATCH (p:Page {status: "ACTIVE"})-[:ROUTES_TO]->(r:Route)
RETURN p.name, p.route, r.path, r.method
```

### Find components with no imports (potentially dead)

```cypher
MATCH (c:Component)
WHERE NOT (c)<-[:IMPORTS]-()
RETURN c.name, c.filePath, c.status
```

### Find services with mock fallbacks

```cypher
MATCH (s:Service {hasMockFallback: true})
RETURN s.name, s.filePath, s.status
```

---

## Import Priority

### Phase 1 (Essential)
1. Repo
2. Directories
3. Files
4. CONTAINS relationships
5. IMPORTS relationships

### Phase 2 (Semantic)
6. Pages
7. Routes
8. Components
9. Services
10. IMPLEMENTS relationships

### Phase 3 (Detailed)
11. Functions
12. Connectors
13. Docs
14. CALLS relationships
15. DEPENDS_ON relationships

### Phase 4 (Enrichment)
16. ROUTES_TO relationships
17. PERSISTS_TO relationships
18. DOCUMENTS relationships
19. SUPERSEDES relationships

---

## Next Steps

See `docs/CODEBASE_IMPORT_PIPELINE.md` for implementation details on how to parse the codebase and create these entities/relationships in Neo4j.
