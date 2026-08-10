---
name: codebasedmemory
description: Canonical operating guide for Code-Based Memory (CBM) inside LiquidAIty. Use it for repository analysis, cleanup, architecture, refactoring, deletion-impact, and code changes.
version: 4.0.0
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

For code structure, ownership, calls, dependencies, symbols, or architecture, make one narrow
`search_graph` call first. Then use `trace_path` only when relationships or impact matter and
`get_code_snippet` only when a bounded snippet helps. Direct-read current source next. Most coding
tasks should use one to three CBM calls total; more than four before meaningful source reading is a
warning that the agent is wandering.

At task start, inspect the maintenance marker once and establish one cached freshness/identity state
for the task. Call `list_projects`, `index_status`, or `detect_changes` at most once when that state is
actually needed. Do not repeat freshness calls unless a commit occurs, `.cbmignore` changes, a large
structural edit changes topology, the graph produces stale evidence, or the active project changes.

Normal route:

1. `search_graph`
2. `trace_path` only if relationships matter
3. `get_code_snippet` only if useful
4. direct current-source read
5. focused `rg` only for literals, configs, docs, errors, missing coverage, or exhaustive residue
6. edit, test, and proportional post-edit proof

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
Use once when task freshness cannot be established from cached task state or the maintenance marker.
Returns status + counts. Do not poll or ask repeatedly whether the graph is clean.

**index_repository** — Native synchronization or full reindex.
Parameter: `{"repo_path":"C:/Projects/main","name":"C-Projects-main","mode":"full"}`
Use only for one bounded maintenance decision: no index exists, the index format changed, a pending
checkpoint marker requires evaluation, or coverage/freshness evidence proves maintenance is needed.
Never reindex per query, per prompt, or as a health check.

**detect_changes** — Maps working-tree changes to affected symbols.
Parameter: `{"project":"C-Projects-main"}`
Use once when ordinary synchronization/change impact must be evaluated. Reports tracked files with
uncommitted modifications and does not report untracked files. Do not call it ritualistically before
and after every edit; combine it with `git status --short` when untracked state matters.

**delete_project** — Destructive. The owner has granted standing authorization only for
`C-Projects-main` when live evidence proves that its index is stale/polluted and one clean rebuild is
necessary. Verify the exact project/root, record status and counts, verify current `.cbmignore`, ensure
no maintenance operation is running, then perform one delete → one rebuild → one verification. Never
apply this authorization to another project, ordinary latency/timeouts, missing symbols, connector
recovery, source files, or direct CBM storage. If the native tool is not exposed, restart the MCP
connection or start a fresh thread; never substitute CLI, plugin federation, database access, or a
second process.

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
current task. It is an optional cold-start/broad-orientation tool, not a normal first call.

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
Use only for a specific bounded structural question not covered by simpler tools, with an explicit row
bound. Cypher support is limited — no subqueries and no OPTIONAL MATCH with complex patterns. Run
`get_graph_schema` first only when custom Cypher actually requires it.

### Source & Text

**get_code_snippet** — Full source for a qualified symbol.
Parameters: `{"project":"C-Projects-main","qualified_name":"<exact-qualified-name>"}`
Use after locating symbol via search_graph. Returns source, signature, return type, complexity, lines, fingerprint. Discover qualified names through search_graph — do not guess them. Known bug: line-offset can return wrong function for ambiguous names; verify against expected line range.

**search_code** — Graph-augmented code search. The installed 0.9.0 build returns graph-ranked
results with structural degree and directory context. Use it when structural graph lookup cannot
resolve the target; it is not part of the default first-call chain.
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

The canonical `C-Projects-main` index represents committed source. The local `post-commit` hook does
not launch, delete, synchronize, or index CBM. It only writes or refreshes one marker containing the
project, root, Git HEAD, timestamp, and reason. Multiple commits before the next prompt coalesce into
one pending maintenance action.

On the next `UserPromptSubmit`, the active native MCP owner evaluates maintenance once. If native
detect/sync can prove the graph matches current source, synchronize and verify one representative
query. If proof is uncertain or stale residue exists, perform one exact `C-Projects-main` clean
delete → full rebuild → verification. Clear the marker only after proof; leave it on failure.

Dirty tracked edits and intentional untracked files are expected to be absent or outdated in CBM.
Do not report that expected divergence as a coverage defect, ask to reindex it, or stage a file to
make CBM see it. Use the committed graph for structural anchors, then use `git status --short`, the
active diff, direct reads, and focused proof for uncommitted work. Refresh a dirty working tree only
when the user explicitly requests it.

## Cold Start & Performance

Every CLI call starts a process, while the connected MCP service can keep its own graph state warm.
Neither lifecycle depends on Hermes.

Use one doorway per run. Prefer the already-connected native MCP service. Main/GPT may use the
transparent `cbm.*` federation because it preserves native schemas and owns one persistent native
child; do not mix that doorway with a separate direct connection after either is proven healthy.

Keep dependent discovery chains and all state-changing operations sequential. After project/task
state is established, at most two independent narrow reads may run in parallel through the same
already-connected native MCP owner and canonical cache. This exception is for genuinely independent
bounded reads, not several speculative searches "to see what sticks." Never parallelize
`query_graph`, `get_architecture`, initialization, status polling, indexing, deletion, or recovery.
Never launch CBM through CLI or shell as a concurrency or recovery strategy.

Process lifecycle and index lifecycle are separate. A transport error does not authorize an index
delete or reindex.

## Hybrid Workflow Pattern (The Core Loop)

```
1. Marker/freshness state: reuse cached task state; 0-1 maintenance calls if needed
2. CBM: one narrow search_graph
3. CBM: 0-1 trace_path when relationships matter
4. CBM: 0-1 get_code_snippet when useful
5. Direct-read current source
6. Focused rg only for its specific text/residue role
7. Edit and test
8. Proportional source/CBM/residue verification
```

## Pre-Grep Targeting (the user's pattern)

Use CBM to narrow grep scope: search_graph → trace_path → identify affected files → rg only those files. This prevents blind rg across the entire repo.

## Post-Grep Adjacency Check

After rg finds a text match, use trace_path on the containing function to check inbound/outbound relationships. Text match alone doesn't reveal structural impact.

## Failure & Recovery

When CBM returns nothing:
1. Refine `search_graph` once only when a clearly better query exists.
2. If still unresolved, use direct source and focused `rg` as an explicit coverage fallback.
3. Record the CBM limitation; do not start a speculative search/freshness chain.

When graph and source disagree: source truth wins. Determine if index is stale, path excluded, call resolution uncertain, or dynamic dispatch involved. Record the disagreement.

When CBM returns `Transport closed`, times out, or exits:
1. Stop equivalent retries.
2. Identify which doorway was selected and inspect its owner once.
3. Distinguish connector/process failure from query or index failure.
4. Preserve the live owner's native child and stop only a proven orphan.
5. Retry once only after a specific lifecycle repair.
6. Use verified direct-source fallback when the index is ready but the connector remains unavailable.

Do not repeatedly restart CBM. Do not repeatedly call `index_repository`. Do not compensate by
starting both the direct connector and LiquidAIty federation.

Expose state without interaction tax: report the selected doorway, project/root, readiness,
operation, and exact failure. Do not dump process tables or raw graph payloads unless needed for
diagnosis.

## Skill Learning Loop

Turn repeated real incidents into compact skill updates:

1. Classify the problem as query/schema, coverage, transport, process lifecycle, or misuse.
2. Preserve the smallest raw evidence and the recovery that actually worked.
3. Add one rule to this canonical skill; never create a second general CBM manual.
4. Validate the updated skill and use it on the next real task.
5. Remove rules that later evidence disproves.

This is the calm-technology standard for CBM: continuous legible state, predictable controls,
visible failure, direct recovery, and no need for the user to supervise the machinery.

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
- [ ] maintenance marker and cached task freshness state inspected once when relevant
- [ ] search_graph locates symbol
- [ ] trace_path used only when relationships/impact matter
- [ ] get_code_snippet used only when its bounded source helps
- [ ] current source directly read
- [ ] focused rg used only for literals/config/docs/errors/coverage/residue

After edit:
- [ ] Tests pass
- [ ] proportional affected-path/source verification passes
- [ ] rg confirms old identifiers gone when exhaustive absence matters
- [ ] large structural changes received one cleanliness decision

## Guardrails

@guardrail id=codebasedmemory.fresh-before-edits
@guardrail id=codebasedmemory.direct-read-before-claim
@guardrail id=codebasedmemory.no-fake-code-understanding
@guardrail id=codebasedmemory.source-wins-on-disagreement
@guardrail id=codebasedmemory.no-reflexive-reindex
@guardrail id=codebasedmemory.no-destructive-index-delete

## Query Records

@query id=codebasedmemory.current-code "reuse one cached freshness state, search_graph once, trace_path and get_code_snippet only when needed, then direct-read current source"
@query id=codebasedmemory.skill-match "retrieve skills using user intent, active CoderPacket, fresh CBM files and symbols, subsystem boundaries, and required proof"
