---
name: codebasedmemory
description: Canonical operating guide for Code-Based Memory (CBM) inside LiquidAIty. Use it for repository analysis, cleanup, architecture, refactoring, deletion-impact, and code changes.
version: 4.0.0
cbm_version: 0.9.0
project: C-Projects-LiquidAIty-main
---

# Code Based Memory Skill

@skill id=codebasedmemory
@type Skill
@status active
@requires codegraph_first_navigation

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

For code structure, ownership, calls, dependencies, symbols, or architecture, use `search_graph` as
the doorway. Continue useful, result-informed searches until the relevant owner, symbol, file, route,
component, service, runtime boundary, or structural path is actually identified. There is no arbitrary
call-count limit. Several independent structural questions may be searched concurrently through the
same canonical owner and project.

Use `trace_path` only when relationships or impact matter, `get_code_snippet` after exact qualified
symbols are known, and `search_code` when the concept is known but symbol vocabulary is not. Direct-read
current source after CBM establishes the boundary. At Main task entry, use project/status tools once to
verify the fixed clean rebuild; do not poll them or repeat them during the same task without new evidence.

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
Parameter: `{"project":"C-Projects-LiquidAIty-main"}`
Use once after the fixed Main entry rebuild to verify ready state and live counts. Do not poll or ask
repeatedly whether the graph is clean.

**index_repository** — Native synchronization or full reindex.
Parameter: `{"repo_path":"C:/Projects/LiquidAIty/main","name":"C-Projects-LiquidAIty-main","mode":"full"}`
At each new Codex Main task entry, run exactly one full rebuild immediately after exact-project deletion.
Outside that fixed entry checkpoint, use it only for one bounded, explicitly authorized maintenance
decision. Never repeat it for follow-ups in the same task, reindex per query, or poll it as a health check.

**detect_changes** — Maps working-tree changes to affected symbols.
Parameter: `{"project":"C-Projects-LiquidAIty-main"}`
Use once when ordinary synchronization/change impact must be evaluated. Reports tracked files with
uncommitted modifications and does not report untracked files. Do not call it ritualistically before
and after every edit; combine it with `git status --short` when untracked state matters.

**delete_project** — `C-Projects-LiquidAIty-main` is disposable derived projection state. The owner grants standing
authorization for exact `C-Projects-LiquidAIty-main` deletion followed immediately by one full canonical rebuild
once at the start of each new Codex Main task. Verify exact project/root, current `.cbmignore`, and that no
mutation is already running. Never apply this authorization to another project, source files, vendor
projects, or direct CBM storage. Reindex alone is not an equivalent cleanup because deleted or newly
excluded SQLite fragments may survive incremental refresh.

### Structural & Architectural

**get_graph_schema** — Node labels, edge types, properties.
Parameter: `{"project":"C-Projects-LiquidAIty-main"}`
Use: early in a serious session, before writing custom Cypher. Record the live node labels and
edge types instead of relying on counts copied from a previous index.

Key edges include CALLS, IMPORTS, HANDLES, TESTS, SEMANTICALLY_RELATED, SIMILAR_TO,
HTTP_CALLS, GRPC_CALLS, CROSS_HTTP_CALLS, CROSS_ASYNC_CALLS, DATA_FLOWS, and CONFIGURES. Counts
belong in the live `get_graph_schema` result, not in this skill.

**get_architecture** — Structure overview.
Parameter: `{"project":"C-Projects-LiquidAIty-main"}`
The installed 0.9.0 build can return structure, dependencies, routes, entry points, hotspots,
boundaries, layers, file tree, and graph-derived clusters. Use only the aspects needed for the
current task. It is an optional cold-start/broad-orientation tool, not a normal first call.

**search_graph** — Locate symbols by name, label, file pattern.
Parameters: `{"project":"C-Projects-LiquidAIty-main","query":"<name>","label":"Function"}`
Uses BM25 ranking. Returns name, qualified_name, file_path, start_line, end_line, rank. Supports pagination with has_more. Prefer this over rg when the question concerns a symbol or structural entity. Use the `name` field (not qualified_name) for subsequent trace_path calls.

**trace_path** — Inbound callers / outbound callees. This is the current MCP name.
Parameters: `{"project":"C-Projects-LiquidAIty-main","function_name":"<simple-name>","direction":"inbound|outbound","depth":2}`
Uses simple function names (the `name` field from search_graph), NOT qualified names. Returns caller/callee lists with hop distance. Depth 2 is usually sufficient. Depth 1 = direct, depth 2 = transitive. Known limitation: does not resolve Python functions or TypeScript dotted methods.

Some older documentation and older clients called this operation `trace_call_path`. Treat that as a
historical alias only. The installed v0.9.0 MCP surface exposed to this repository is `trace_path`;
do not invent or call an unavailable alias.

**query_graph** — Custom Cypher queries.
Parameters: `{"project":"C-Projects-LiquidAIty-main","query":"MATCH ..."}`
Use only for a specific bounded structural question not covered by simpler tools, with an explicit row
bound. Cypher support is limited — no subqueries and no OPTIONAL MATCH with complex patterns. Run
`get_graph_schema` first only when custom Cypher actually requires it.

### Source & Text

**get_code_snippet** — Full source for a qualified symbol.
Parameters: `{"project":"C-Projects-LiquidAIty-main","qualified_name":"<exact-qualified-name>"}`
Use after locating symbol via search_graph. Returns source, signature, return type, complexity, lines, fingerprint. Discover qualified names through search_graph — do not guess them. Known bug: line-offset can return wrong function for ambiguous names; verify against expected line range.

**search_code** — Graph-augmented code search. The installed 0.9.0 build returns graph-ranked
results with structural degree and directory context. Use it when structural graph lookup cannot
resolve the target; it is not part of the default first-call chain.
Use `rg` for files outside CBM coverage, configs, docs, comments, and exhaustive exact matching.

### Knowledge & Evidence

**manage_adr** — Architecture Decision Records.
Parameters: `{"project":"C-Projects-LiquidAIty-main","action":"list|update","content":"..."}`
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

The canonical `C-Projects-LiquidAIty-main` index is a rebuildable projection of repository source. Source and
tests are authoritative. No delayed marker system exists. For each new Main-repository task,
`UserPromptSubmit` injects the fixed entry SOP: if the task has not completed clean entry, the active
agent uses the one connected native MCP owner to delete only `C-Projects-LiquidAIty-main`, perform one full
`C:/Projects/LiquidAIty/main` rebuild, and verify exact root, readiness, live counts, exclusions, and absence of
vendor paths once. Record completion in task context and reuse it across follow-ups, interruptions,
clarifications, and compactions. The hook itself performs no CBM or database operation and launches no process.

After maintenance, use the four-step discovery SOP: `search_graph` until structural owners are found;
`trace_path` when relationships matter; `get_code_snippet` for exact qualified-symbol snapshots;
`search_code` for bounded concept/literal/residue discovery when useful; then direct-read current source.
The Git post-commit hook remains Git LFS only.

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

Independent bounded read operations may run concurrently through the same already-connected native
MCP owner, canonical cache, and project; do not impose an arbitrary concurrency count. Dependent calls
wait for their prerequisites, and every mutation, initialization, indexing, deletion, and recovery
operation remains sequential. Never launch several CLI processes for discovery or concurrency.

Process lifecycle and index lifecycle are separate. A transport error does not authorize an index
delete or reindex.

## Hybrid Workflow Pattern (The Core Loop)

```
1. CBM: useful search_graph calls until structural owners are found
2. CBM: trace_path when relationships matter
3. CBM: get_code_snippet after exact qualified symbols are known
4. CBM: search_code when concept discovery materially helps
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
1. Refine `search_graph` while each subsequent query is usefully informed by prior results.
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
- [ ] search_graph resolves the required structural owners
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
@guardrail id=codebasedmemory.exact-main-projection-maintenance

## Query Records

@query id=codebasedmemory.current-code "search_graph until structural owners are found, then useful trace_path, get_code_snippet, current source, and focused residue proof"
@query id=codebasedmemory.skill-match "retrieve skills using user intent, active CoderPacket, fresh CBM files and symbols, subsystem boundaries, and required proof"
