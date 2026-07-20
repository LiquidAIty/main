---
name: codebasedmemory
description: Canonical operating guide for Code-Based Memory (CBM) inside LiquidAIty. Use it for repository analysis, cleanup, architecture, refactoring, deletion-impact, and code changes.
version: 3.0.0
cbm_version: 0.9.0
project: C-Projects-main
---

# Code Based Memory Skill

@skill id=codebasedmemory
@type Skill
@status active
@requires fresh_cbm_index

This is the canonical CBM skill. Do not create a second general CBM manual under another filename.
`skills/codegraph.md` remains separate because it defines the product's CodeGraph authority and
boundary rather than this development workflow.

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
- Exhaustive text matching when graph-ranked `search_code` is not the right tool

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

## Installed Tools (v0.9.0)

### Indexing & Project State

**list_projects** — Canonical project names, node/edge counts.
Use: first call when project identity is uncertain. Record the returned root, node count, and edge
count; do not copy an old example count into a current report.

**index_status** — Current index state.
Parameter: `{"project":"C-Projects-main"}`
Use: before making claims about freshness. Returns status + counts.
Do not poll endlessly.

**index_repository** — Full reindex.
Parameter: `{"repo_path":"C:/Projects/main"}`
Use ONLY when: no index exists, the index format changed, or coverage/freshness evidence proves
unusable. Do NOT use before every query or as a reflex. Check project and status first; file and
graph counts vary with the current working tree and exclusion rules.

**detect_changes** — Maps working-tree changes to affected symbols.
Parameter: `{"project":"C-Projects-main"}`
Use: before and after meaningful edits. Reports tracked files with uncommitted modifications. Does NOT report untracked files. Clean result = working tree clean for tracked files. Combine with `git status --short` for untracked files.

**delete_project** — Destructive. Never use without explicit owner authorization.

### Structural & Architectural

**get_graph_schema** — Node labels, edge types, properties.
Parameter: `{"project":"C-Projects-main"}`
Use: early in a serious session, before writing custom Cypher. Record the live node labels and
edge types instead of relying on counts copied from a previous index.

Key edges include CALLS, IMPORTS, HANDLES, TESTS, SEMANTICALLY_RELATED, SIMILAR_TO,
HTTP_CALLS, GRPC_CALLS, CROSS_HTTP_CALLS, CROSS_ASYNC_CALLS, DATA_FLOWS, and CONFIGURES. Counts
belong in the live `get_graph_schema` result, not in this skill.

**get_architecture** — Structure overview.
Parameter: `{"project":"C-Projects-main"}`
The installed 0.9.0 build can return structure, dependencies, routes, entry points, hotspots,
boundaries, layers, file tree, and graph-derived clusters. Use only the aspects needed for the
current task.

**search_graph** — Locate symbols by name, label, file pattern.
Parameters: `{"project":"C-Projects-main","query":"<name>","label":"Function"}`
Uses BM25 ranking. Returns name, qualified_name, file_path, start_line, end_line, rank. Supports pagination with has_more. Prefer this over rg when the question concerns a symbol or structural entity. Use the `name` field (not qualified_name) for subsequent trace_path calls.

**trace_path** — Inbound callers / outbound callees. This is the current MCP name.
Parameters: `{"project":"C-Projects-main","function_name":"<simple-name>","direction":"inbound|outbound","depth":2}`
Uses simple function names (the `name` field from search_graph), NOT qualified names. Returns caller/callee lists with hop distance. Depth 2 is usually sufficient. Depth 1 = direct, depth 2 = transitive. Known limitation: does not resolve Python functions or TypeScript dotted methods.

Some older documentation and older clients called this operation `trace_call_path`. Treat that as a
historical alias only. The installed v0.9.0 MCP surface exposed to this repository is `trace_path`;
do not invent or call an unavailable alias.

**query_graph** — Custom Cypher queries.
Parameters: `{"project":"C-Projects-main","query":"MATCH ..."}`
Use for structural questions not covered by simpler tools. Cypher support is limited — no subqueries, no OPTIONAL MATCH with complex patterns. Use simple MATCH + RETURN patterns. Run get_graph_schema first to verify labels and edge types.

### Source & Text

**get_code_snippet** — Full source for a qualified symbol.
Parameters: `{"project":"C-Projects-main","qualified_name":"<exact-qualified-name>"}`
Use after locating symbol via search_graph. Returns source, signature, return type, complexity, lines, fingerprint. Discover qualified names through search_graph — do not guess them. Known bug: line-offset can return wrong function for ambiguous names; verify against expected line range.

**search_code** — Graph-augmented code search. The installed 0.9.0 build returns graph-ranked
results with structural degree and directory context. Prefer it for code text inside indexed files.
Use `rg` for files outside CBM coverage, configs, docs, comments, and exhaustive exact matching.

### Knowledge & Evidence

**manage_adr** — Architecture Decision Records.
Parameters: `{"project":"C-Projects-main","action":"list|update","content":"..."}`
Use for durable architecture decisions only. Not for temporary notes, cleanup findings, or unapproved decisions. Current repo: no ADRs exist.

**ingest_traces** — Runtime trace ingestion.
Treat imported traces as an explicit operation; do not ingest runtime data during ordinary code
discovery.

## Current 0.9.0 Notes

- The installed executable reports `codebase-memory-mcp 0.9.0`.
- `search_code`, `semantic_query`, richer architecture output, complexity signals, and
  cross-service tracing are available through the current MCP schema.
- CBM is independent of the LiquidAIty Hermes runtime. Do not stop, restart, or describe Hermes as
  the owner of CBM.
- Index coverage still must be checked against source and Git state. A successful query is not
  freshness proof.

## Graph Schema Reference

Typical node labels include Function, Method, Variable, File, Module, Type, Section, Class, Route,
Folder, Interface, Channel, and Project. Use `get_graph_schema` for current counts.

Critical properties: `name`, `qualified_name`, `file_path`, `start_line`, `end_line`, `is_exported`, `is_test`, `signature`, `return_type`, `complexity`.

Key edge types: CALLS (confidence 0.30-0.95, strategy labels), IMPORTS (local_name), HANDLES (handler), TESTS, SEMANTICALLY_RELATED (score, same_file), SIMILAR_TO (jaccard), HTTP_CALLS (url_path), CONFIGURES (config_key, confidence), GRPC_CALLS (method, service).

Note: Route nodes have empty `file_path`. Route→handler mapping requires reading route files directly.

## Working-Tree Visibility

`index_repository` walks eligible source files under the repository root; an eligible untracked file
can therefore appear after a fresh index. `detect_changes` is Git-delta analysis and does not replace
`git status --short` for untracked files. Never stage a file merely to make CBM see it. Verify
coverage by searching for the specific file/symbol after indexing, and combine CBM with Git status.

## Cold Start & Performance

Every CLI call starts a process, while the connected MCP service can keep its own graph state warm.
Neither lifecycle depends on Hermes. Batch independent calls when useful, but do not reindex as a
reflex.

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
- **Protected dirs**: localcoder/, worldsignal/, autogen-main/, Kronos-main/,
  services/esn_rls/, and EDGAR caches are off-limits for cleanup. Verify index coverage rather
  than assuming these vendored/protected boundaries are indexed.
- **search_code**: Working in the installed 0.9.0 build. Use it for indexed code text; use `rg` for
  exhaustive exact matches, comments, configs, docs, and files outside CBM coverage.
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

## Guardrails

@guardrail id=codebasedmemory.fresh-before-edits
@guardrail id=codebasedmemory.direct-read-before-claim
@guardrail id=codebasedmemory.no-fake-code-understanding
@guardrail id=codebasedmemory.source-wins-on-disagreement
@guardrail id=codebasedmemory.no-reflexive-reindex
@guardrail id=codebasedmemory.no-destructive-index-delete

## Query Records

@query id=codebasedmemory.current-code "prove project and index freshness, search_graph for relevant symbols, trace_path when needed, then direct-read resolved source"
@query id=codebasedmemory.skill-match "retrieve skills using user intent, active CoderPacket, fresh CBM files and symbols, subsystem boundaries, and required proof"
