---
name: codebasedmemoryskill
description: Authoritative operating guide for Code Based Memory (CBM) inside LiquidAIty. CBM is mandatory for repository analysis, cleanup, architecture, refactoring, deletion-impact, and code changes.
version: 2.0.0
cbm_version: 0.6.1
project: C-Projects-main
---

# Code Based Memory Skill

## What CBM Is

Code Based Memory is a Tree-Sitter knowledge graph of the repository, exposed via MCP. It answers structural questions that grep cannot: who calls this, what breaks if I change this, which routes hit this handler, is this function dead.

The research paper (arXiv 2603.27277, Vogel et al.) benchmarked CBM against file-exploration agents: 83% quality at 10x fewer tokens and 2.1x fewer tool calls. Graph queries resolve in <1ms vs 10-30s for file exploration.

CBM stores **relationships**, not source text. For exact text matching, use `rg`.

## When CBM Is Mandatory

CBM is mandatory for repository work. Use it at the correct structural points:

**CBM first:**
- Who calls/imports/depends on X
- What X calls/imports
- Route-to-handler-to-runtime tracing
- Architecture boundaries, hubs, clusters
- Deletion impact analysis
- Duplicate authority detection
- Feature-slice discovery
- Cross-file ownership
- Test-to-symbol relationships

**rg first:**
- Exact strings, comments, TODO/FIXME/HACK
- Markdown, config keys, env vars
- Stale card IDs, old terminology
- Commented-out code
- Files outside CBM coverage
- Exhaustive text matching (search_code is broken on Windows)

**Hybrid (CBM + rg + source reads) required for:**
- Safe deletion
- Architecture cleanup
- Duplicate authority
- Dead-code claims
- Cross-boundary decisions (TS↔Python)
- Model/provider selection paths

## The Mandatory CBM Gate

For any edit, deletion, refactor, or architecture claim:

1. Identify indexed project (`list_projects`)
2. Check freshness (`index_status`)
3. Map structural slice (search_graph → trace_path → get_code_snippet)
4. Read exact source
5. Targeted `rg` for text evidence
6. Make edit
7. Run tests
8. CBM impact verification (`detect_changes` + trace affected paths)
9. `rg` to confirm old names/paths gone

Exceptions: pure prose edits, spelling fixes, emergency repair when CBM itself is broken. State why CBM was skipped.

## Proof Tiers

| Tier | Meaning | Tool |
|------|---------|------|
| CBM-path-proven | trace_path returned the edge | trace_path |
| CBM-symbol-verified | search_graph + get_code_snippet found exact symbol | search_graph, get_code_snippet |
| Source-verified | Graph-resolved source read confirms relationship | read_file after CBM resolution |
| Contract-test-proven | Focused test proves mechanism | vitest runner |
| Persistence-readback-proven | DB/file readback confirms state | deck read, file check |
| Runtime-proven | Process ran, verified independently | server start + API call |

Never claim CBM-path-proven unless trace_path returned the edge. Never claim a function is dead without inbound trace + rg + coverage reasoning.

## Installed Tools (v0.6.1)

### Indexing & Project State

**list_projects** — Canonical project names, node/edge counts.
Use: first call when project identity uncertain. Returns `{"projects":[{"name":"C-Projects-main","root_path":"C:/Projects/main","nodes":5413,"edges":12121}]}`

**index_status** — Current index state.
Parameter: `{"project":"C-Projects-main"}`
Use: before making claims about freshness. Returns status + counts.
Do not poll endlessly.

**index_repository** — Full reindex.
Parameter: `{"repo_path":"C:/Projects/main"}`
Use ONLY when: no index exists, index format changed, or coverage/freshness evidence proves unusable. Do NOT use before every query, once per subagent, or as a reflex. Check project and status first. Current cold reindex: ~971ms for 473 files.

**detect_changes** — Maps working-tree changes to affected symbols.
Parameter: `{"project":"C-Projects-main"}`
Use: before and after meaningful edits. Reports tracked files with uncommitted modifications. Does NOT report untracked files. Clean result = working tree clean for tracked files. Combine with `git status --short` for untracked files.

**delete_project** — Destructive. Never use without explicit owner authorization.

### Structural & Architectural

**get_graph_schema** — Node labels, edge types, properties.
Parameter: `{"project":"C-Projects-main"}`
Use: early in a serious session, before writing custom Cypher. Returns 13 node labels (Function 1508, Variable 1225, File 473, Module 472, Type 468, Method 416, Section 338, Class 212, Route 193, Folder 91, Interface 10, Channel 6, Project 1) and 20 edge types.

Key edges: CALLS (3840, with confidence/strategy), IMPORTS (444), HANDLES (53, route→handler), TESTS (533), SEMANTICALLY_RELATED (144, LSH-based), SIMILAR_TO (47, Jaccard), HTTP_CALLS (36), GRPC_CALLS (1), CONFIGURES (38).

**get_architecture** — Structure overview.
Parameter: `{"project":"C-Projects-main"}`
Limitation in 0.6.1: returns only node/edge counts. Does not return packages, clusters, hotspots, or routes despite accepting aspects parameter. Use search_graph + query_graph for architectural discovery instead.

**search_graph** — Locate symbols by name, label, file pattern.
Parameters: `{"project":"C-Projects-main","query":"<name>","label":"Function"}`
Uses BM25 ranking. Returns name, qualified_name, file_path, start_line, end_line, rank. Supports pagination with has_more. Prefer this over rg when the question concerns a symbol or structural entity. Use the `name` field (not qualified_name) for subsequent trace_path calls.

**trace_path** — Inbound callers / outbound callees.
Parameters: `{"project":"C-Projects-main","function_name":"<simple-name>","direction":"inbound|outbound","depth":2}`
Uses simple function names (the `name` field from search_graph), NOT qualified names. Returns caller/callee lists with hop distance. Depth 2 is usually sufficient. Depth 1 = direct, depth 2 = transitive. Known limitation: does not resolve Python functions or TypeScript dotted methods.

**query_graph** — Custom Cypher queries.
Parameters: `{"project":"C-Projects-main","query":"MATCH ..."}`
Use for structural questions not covered by simpler tools. Cypher support is limited — no subqueries, no OPTIONAL MATCH with complex patterns. Use simple MATCH + RETURN patterns. Run get_graph_schema first to verify labels and edge types.

### Source & Text

**get_code_snippet** — Full source for a qualified symbol.
Parameters: `{"project":"C-Projects-main","qualified_name":"<exact-qualified-name>"}`
Use after locating symbol via search_graph. Returns source, signature, return type, complexity, lines, fingerprint. Discover qualified names through search_graph — do not guess them. Known bug: line-offset can return wrong function for ambiguous names; verify against expected line range.

**search_code** — Graph-augmented code search. FIXED in v0.9.0 (tested 2026-07-18). Was broken in v0.6.1 on Windows ("The system cannot find the path specified"). Now returns graph-ranked results with in_degree/out_degree, directory breakdown, dedup ratio (3.3x typical), and ~500ms query time. Prefer search_code over rg for code text search within indexed files. Use rg for files outside CBM coverage and comment-only searches.

### Knowledge & Evidence

**manage_adr** — Architecture Decision Records.
Parameters: `{"project":"C-Projects-main","action":"list|update","content":"..."}`
Use for durable architecture decisions only. Not for temporary notes, cleanup findings, or unapproved decisions. Current repo: no ADRs exist.

**ingest_traces** — Runtime trace ingestion.
Status: STUB in 0.6.1 ("Runtime edge creation from traces not yet implemented"). Accepts traces but does not create edges. Documented for future use.

## Features NOT in 0.6.1

- **semantic_query** — Not installed. Semantic relationships exist as SEMANTICALLY_RELATED edges (144 total) queryable via query_graph Cypher.
- **check_index_coverage** — Not installed. No coverage check available.
- **Cross-repository CROSS_* edges** — Not present.
- **Team-shared graph artifacts (.codebase-memory/graph.db.zst)** — Not present. `artifact_present: false`.
- **Auto-index / auto-watch** — Not enabled. `auto_index: false`, `auto_index_limit: 50000`.
- **LSP-style type resolution** — Partial. Go/C/C++ have dedicated type resolution passes; TypeScript/Python use 6-strategy name-based cascade with confidence scores (0.30-0.95).

## v0.9.0 Upgrade Path

v0.9.0 is available but the update could not overwrite the running 0.6.1 binary (MCP server lock). To upgrade: stop Hermes, run `codebase-memory-mcp update -y`, restart Hermes. v0.9.0 may fix search_code on Windows and add semantic_query, check_index_coverage, and richer get_architecture output.

## Graph Schema Reference

Node labels (counts from fresh index): Function (1508), Variable (1225), File (473), Module (472), Type (468), Method (416), Section (338), Class (212), Route (193), Folder (91), Interface (10), Channel (6), Project (1).

Critical properties: `name`, `qualified_name`, `file_path`, `start_line`, `end_line`, `is_exported`, `is_test`, `signature`, `return_type`, `complexity`.

Key edge types: CALLS (confidence 0.30-0.95, strategy labels), IMPORTS (local_name), HANDLES (handler), TESTS, SEMANTICALLY_RELATED (score, same_file), SIMILAR_TO (jaccard), HTTP_CALLS (url_path), CONFIGURES (config_key, confidence), GRPC_CALLS (method, service).

Note: Route nodes have empty `file_path`. Route→handler mapping requires reading route files directly.

## Working-Tree Visibility

CBM indexes tracked files. Uncommitted changes to tracked files ARE visible after reindex. Untracked new files are NOT indexed — they must be staged (git add) first. `detect_changes` reports only tracked files with modifications. New untracked files require `git status --short` for discovery.

## Cold Start & Performance

Every CLI call starts with "mem.init budget_mb=16226" (~1-2s). Queries resolve in <1ms after init. Full reindex: ~971ms for 473 files using 12 parallel workers. The MCP server (running via Hermes) keeps the graph in memory — CLI calls restart the binary each time. For batch operations, batch independent calls together.

## Hybrid Workflow Pattern (The Core Loop)

```
1. CBM: list_projects → index_status → get_graph_schema
2. CBM: search_graph for target symbols
3. CBM: trace_path inbound (who calls this)
4. CBM: trace_path outbound (what does this call)
5. CBM: get_code_snippet for exact source
6. rg:   verify text patterns, search comments, check configs
7. Source read: verify critical paths
8. EDIT
9. Test
10. CBM: detect_changes → trace affected paths
11. rg:   confirm old identifiers gone
```

## Pre-Grep Targeting (the user's pattern)

Use CBM to narrow grep scope: search_graph → trace_path → identify affected files → rg only those files. This prevents blind rg across the entire repo.

## Post-Grep Adjacency Check

After rg finds a text match, use trace_path on the containing function to check inbound/outbound relationships. Text match alone doesn't reveal structural impact.

## Failure & Recovery

When CBM returns nothing:
1. Confirm project name (list_projects)
2. Check status (index_status)
3. Check schema (get_graph_schema)
4. Use rg to find exact symbol/path
5. Return to CBM with confirmed identifiers

When graph and source disagree: source truth wins. Determine if index is stale, path excluded, call resolution uncertain, or dynamic dispatch involved. Record the disagreement.

Do not repeatedly restart CBM. Do not repeatedly call index_repository.

## LiquidAIty-Specific Patterns

- **trace_path parameter**: Use simple function names (`runConfiguredCard`), never qualified. The `name` field from search_graph is correct.
- **index_status / detect_changes**: Accept project name string, never filesystem path.
- **Python functions**: trace_path does not resolve them. Verify via source reads + rg.
- **Route nodes**: file_path is empty. Read route files directly for handler mapping.
- **Protected dirs**: localcoder/, worldsignal/, autogen-main/, Kronos-main/, services/esn_rls/, EDGAR caches are off-limits for cleanup but ARE indexed by CBM.
- **search_code**: Broken on Windows. Use rg exclusively for text search.
- **Cypher**: Limited. Simple MATCH patterns only. No EXISTS subqueries, no OPTIONAL MATCH with complex patterns, no aggregations with WHERE on aggregates.

## Proven Hybrid Patterns (from live repo testing)

### Pattern 1: Dead console.log Triage
```
CBM: query_graph to list all functions in file → search_graph for suspect symbol
  → trace_path inbound (who calls this function?)
  → If callers = 0 AND not dynamically dispatched → candidate
rg: confirm no text references outside the file
source read: verify function context
→ remove console.log if safe
→ CBM: detect_changes + trace_path to verify no impact
```
Tested on: runtime.ts (runCardWithContract had console.log but is dynamically dispatched — NOT dead)

### Pattern 2: Dead Export Detection
```
CBM: search_graph for exported functions in target file
  → trace_path inbound on each export
  → If 0 callers → red flag
rg: search for function name across repo (catches dynamic dispatch, string refs, config references)
source read: check if exported via barrel file, config object, or string registry
→ ONLY delete if CBM shows 0 callers AND rg shows 0 text references AND no dynamic dispatch
```
Tested on: modelConfig.ts (logModelConfiguration has 1 caller: startServer — not dead)

### Pattern 3: Pre-Grep Scope Narrowing
```
CBM: search_graph for target symbols → note file_paths
  → trace_path outbound to find all files in the call chain
rg: search ONLY those files (not the whole repo)
→ cuts rg scope from 500+ files to 5-15 files
```
Example: trace_path on runConfiguredCard identified 30 callee files — rg only those, not all 473.

### Pattern 4: Post-Grep Adjacency Verification
```
rg: find text match (e.g., stale card ID, deprecated string)
CBM: search_graph for the containing function
  → trace_path inbound/outbound to reveal structural impact
→ Text match alone says "this string exists"
→ CBM says "and changing it affects these 8 callers"
```

### Critical Blind Spot: Dynamic Dispatch
CBM trace_path tracks STATIC call edges. It WILL miss:
- String-based card routing (runtimeType dispatch)
- Config-driven handler selection
- Dynamic imports
- Event emitter patterns
- Dependency injection containers
Always cross-verify 0-caller CBM results with rg text search before claiming dead code.

Tested on: runCardWithContract — CBM shows 1 caller (spec test), but function is live via card runtime dispatch.

## Cypher Limitations (tested v0.9.0, 2026-07-18)
- `STARTS WITH` / `CONTAINS` fail with parser error "expected token type 86, got 49" — use `=` for exact string matches
- Boolean property filters (`WHERE f.is_exported = true`) return 0 rows — track via get_code_snippet metadata instead
- No subqueries, no OPTIONAL MATCH with complex patterns, no NOT EXISTS
- Use search_graph over query_graph for symbol lookup; reserve query_graph for relationship traversals with simple WHERE clauses
- These are v0.9.0-specific; check get_graph_schema after CBM upgrades for Cypher capability changes

## Pre/Post-Edit Checklist

Before edit:
- [ ] list_projects confirms project
- [ ] index_status confirms ready
- [ ] search_graph locates symbol
- [ ] trace_path inbound (who depends)
- [ ] trace_path outbound (what it affects)
- [ ] get_code_snippet verifies source
- [ ] rg checks for text references (catches dynamic dispatch)

After edit:
- [ ] Tests pass
- [ ] detect_changes confirms impact
- [ ] trace_path re-verified on affected paths
- [ ] rg confirms old identifiers gone
