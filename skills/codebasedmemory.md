---
name: codebasedmemory
description: Canonical operating guide for Code-Based Memory (CBM) inside LiquidAIty. Use it for repository analysis, cleanup, architecture, refactoring, deletion-impact, and code changes.
version: 5.1.0
cbm_version: 0.10.8
project: C-Projects-LiquidAIty-main
---

# Code Based Memory Skill

@skill id=codebasedmemory
@type Skill
@status active
@requires codegraph_first_navigation

This is the canonical CBM skill. Do not create a second general CBM manual under another filename.
`ARCHITECTURE.md` owns the product's CodeGraph authority; this file owns the development workflow.

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

The canonical ordered recipe is:

```text
search_graph
→ trace_path when relationships matter
→ get_code_snippet using a qualified name returned by search_graph
→ query_graph only for a bounded unresolved multi-hop question
→ focused search_code or rg for configuration, non-code files, graph gaps, and residue
→ complete current-source read
```

Begin coding discovery with `search_graph`. Real graph data supplied by Main or an IDF actual-graph-data section may seed the
search, but its native IDs, paths, qualified symbols, authority, and provenance must remain intact. When no
upstream graph selection exists, derive a bounded query from the actual task and validate the symbols CBM
returns. Never invent graph records, qualified names, or placeholder search seeds from prompt prose.

Use `trace_path` only when relationships or impact matter. Use `get_code_snippet` only with an actual qualified
name returned by CBM. Optional graph and text-search stages are not a checklist: select the smallest useful
subset and say why an omission matters when it limits proof. Use `get_architecture` only when broad orientation
is genuinely necessary. Always read the complete relevant current source before changing behavior. Any bounded
native result supplied by Main is a discovery seed, never proof or freshness evidence. Do not invoke lifecycle
mutation during the response.

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

## Installed Tools (v0.10.8)

### Indexing & Project State

**list_projects** — Canonical project names, node/edge counts.
Use: first call when project identity is uncertain. Record the returned root, node count, and edge
count; do not copy an old example count into a current report.

**index_status** — Current index state.
Parameter: `{"project":"C-Projects-LiquidAIty-main"}`
The active agent may call application-published status once only when current graph state is itself material to
the task; do not poll it.

**check_index_coverage** — Exact path/scope coverage and filesystem-freshness evidence.
Parameters: `{"project":"C-Projects-LiquidAIty-main","paths":["<repo-relative-path>"]}` or bounded
`scopes`. Use it for every source file relied upon in a strong report and for the scope behind an exhaustive
or negative claim. Distinguish `no_recorded_issue`, parse-partial, skipped, and deliberately excluded status
from filesystem freshness such as `metadata_changed`. Every result is best-effort; read current source and do
not treat absence of a recorded issue as completeness proof.

**index_repository** — Lifecycle maintenance, never discovery. Initial projection creation is an explicit
application-MCP administrative operation. Normal freshness belongs to the upstream Docker watcher. The active
agent does not call this tool during an ordinary coding response.

**detect_changes** — Maps working-tree changes to affected symbols.
Parameter: `{"project":"C-Projects-LiquidAIty-main"}`
Use once when ordinary synchronization/change impact must be evaluated. Reports tracked files with
uncommitted modifications and does not report untracked files. Do not call it ritualistically before
and after every edit; combine it with `git status --short` when untracked state matters.

**delete_project** — Destructive derived-state maintenance, never part of a normal prompt or completion path.
Use only for an explicitly authorized exact-project repair. Never apply that authorization to another project,
repository source, vendor state, or direct CBM storage.

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
The installed 0.10.8 build can return structure, dependencies, routes, entry points, hotspots,
boundaries, layers, file tree, and graph-derived clusters. Use only the aspects needed for the
current task. It is an optional cold-start/broad-orientation tool, not a normal first call.

**search_graph** — Locate symbols by name, label, file pattern.
Parameters: `{"project":"C-Projects-LiquidAIty-main","query":"<name>","label":"Function"}`
Uses BM25 ranking. Returns name, qualified_name, file_path, start_line, end_line, rank. Supports pagination with has_more. Prefer this over rg when the question concerns a symbol or structural entity. Use the `name` field (not qualified_name) for subsequent trace_path calls.

**trace_path** — Inbound callers / outbound callees. This is the current MCP name.
Parameters: `{"project":"C-Projects-LiquidAIty-main","function_name":"<simple-name>","direction":"inbound|outbound","depth":2}`
Uses simple function names (the `name` field from search_graph), NOT qualified names. Returns caller/callee lists with hop distance. Depth 2 is usually sufficient. Depth 1 = direct, depth 2 = transitive. Known limitation: does not resolve Python functions or TypeScript dotted methods.

Some older documentation and older clients called this operation `trace_call_path`. Treat that as a
historical alias only. The installed v0.10.8 MCP surface exposed to this repository is `trace_path`;
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

**search_code** — Graph-augmented code search. The installed 0.10.8 build returns graph-ranked
results with structural degree and directory context. Use it when structural graph lookup cannot
resolve the target; it is not part of the default first-call chain.
Use `rg` for files outside CBM coverage, configs, docs, comments, and exhaustive exact matching.

### Knowledge & Evidence

**manage_adr** — Architecture Decision Records.
Parameters: `{"project":"C-Projects-LiquidAIty-main","mode":"get|sections|update","content":"..."}`
Use for durable architecture decisions only. Not for temporary notes, cleanup findings, or unapproved decisions. Current repo: no ADRs exist.

**ingest_traces** — Runtime trace ingestion.
Treat imported traces as an explicit operation; do not ingest runtime data during ordinary code
discovery.

## Current 0.10.8 Notes

- The installed executable reports `codebase-memory-mcp 0.10.8`.
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
tests are authoritative. It indexes the canonical host checkout `C:/Projects/LiquidAIty/main`; no second root
or alias exists. The checksum-pinned official binary lives under LiquidAIty AppData, and the official Python
MCP host owns its one long-lived native frontend. Codex, Hermes, Cards, plugins, and connectors use only the
application-published `cbm.*` catalog. They never register a direct server, launch a frontend or daemon, or own
an index lifecycle.

The upstream watcher owns ordinary incremental freshness. Empty and failed searches remain visible and fail
open to bounded source inspection. There is no Codex lifecycle hook, host CLI doorway, second daemon, mutex,
turn claim, lease, generation file, worktree fingerprint, state file, database wrapper, receipt, journal,
retry loop, static graph handoff, or prompt-time lifecycle recovery. The active agent uses the application MCP
for result-informed graph navigation and never repairs or mutates the index during its response.

The current projection intentionally excludes `autogen-main` through `.cbmignore` for the measured lifecycle
boundary. AutoGen remains first-party source and runtime infrastructure; exclusion from this derived projection
does not transfer or remove ownership.

## Mandatory Inverse Deletion Audit

Removing or renaming a production file, class, function, route, schema, configuration key, exported type, Card
operation, registration ID, or other code identity triggers this workflow. A rename is deletion of the old
identity plus introduction of the new identity.

### Before deletion

1. Resolve every actual target path and qualified symbol with `search_graph`, returned qualified names,
   `get_code_snippet` when useful, and the complete current source. Never infer a deletion identity from prompt
   prose.
2. Traverse inbound callers/importers and outbound callees/dependencies with `trace_path` where supported.
3. Inspect exports, re-exports, routes, handlers, schemas, configuration, tests, documentation links, and runtime
   registrations. Use bounded `query_graph` only for an unresolved multi-hop relationship.
4. Use `search_code` and focused `rg` for literals, dynamic dispatch, unindexed files, paths, route strings,
   configuration keys, and registration IDs.
5. Record only the actual deletion targets and real former neighbors returned by graph/source evidence.

### During the change

Remove or update every surviving caller, registration, import, test, configuration reference, and documentation
contract that would otherwise become residue. Preserve a compatibility identity only when current product
authority proves it remains required, and document that contract. Never leave an unexplained alias or adapter.

### Before completion

1. Reread each surviving former caller, importer, consumer, registration, and test from the neighbor side back
   toward the deleted identity.
2. Search exact deleted qualified names, simple names, paths, route strings, configuration keys, and registration
   IDs. Prove every remaining hit intentional or remove it.
3. For renames, prove the old identity is absent and the new identity exists.
4. Run focused proof for the surviving boundary and report deleted symbols plus every repaired relationship.
5. After watcher synchronization, use application-published graph queries to prove deleted paths/qualified
   symbols and former edges are absent when the client contract makes that result observable. Do not infer graph absence from
   text search alone.

## Cold Start & Performance

The connected application MCP keeps one native frontend warm; the upstream Docker coordination daemon owns its
watcher and embedded UI. Neither lifecycle depends on Hermes.

Use one doorway per run: LiquidAIty's application-published `cbm.*` federation. It mechanically preserves
native schemas and uses one persistent native child. A Coder never substitutes a direct native connection,
host CLI, or alternate facade. If the application doorway is unavailable, record the boundary as unproven and
use verified direct-source fallback.

Independent bounded read operations may run concurrently through that same application-owned frontend,
canonical Docker cache, and project; do not impose an arbitrary concurrency count. Dependent calls wait for
their prerequisites, and every mutation, initialization, indexing, deletion, and recovery operation remains
sequential. Never launch a native process for discovery or concurrency.

Process lifecycle and index lifecycle are separate. A transport error does not authorize an index
delete or reindex.

## Hybrid Workflow Pattern (The Core Loop)

```
1. CBM: search_graph until structural owners are found
2. CBM: trace_path when relationships matter
3. CBM: get_code_snippet only with a returned qualified name
4. CBM: bounded query_graph/get_architecture/search_code only when their evidence is needed
5. Direct-read complete current source
6. Focused rg only for configs, non-code, graph gaps, literals, and exhaustive residue
7. Edit and test
8. Proportional source/CBM/residue verification, including inverse deletion audit when triggered
```

## Role-Scoped CodeGraph Tool Profiles

**Design status:** proposed repository recipe and tool-exposure profile. It does not change saved Card grants,
claim current runtime exposure, or create an authorization layer. Saved Card grants remain the permanent
capability ceiling; a named recipe introduces only the smaller useful corridor for the current graph context.
The model still chooses semantically within that corridor.

| Role or owner | Exposed by default | Introduced only by a named recipe | Application or administrative boundary |
|---|---|---|---|
| Main / GPT planner | `search_graph`, `get_architecture`, `trace_path` | An explicit architecture/Cypher recipe may add `get_graph_schema` and bounded `query_graph`; source-level reading remains a Coder responsibility | Ordinary lifecycle and project-state tools stay absent |
| Coder | `search_graph`, `trace_path`, `get_code_snippet`, `check_index_coverage`, `detect_changes` | `search_code` for literals/config/JSX/coverage gaps; `query_graph` for a bounded multi-hop question; `get_architecture` for orientation; `get_graph_schema` before custom Cypher | The upstream watcher owns normal refresh; the active Coder does not index |
| Explicit diagnostics / administration | None | `list_projects`, `index_status`, and read-safe `manage_adr(get|sections)` only in a named diagnostic or architecture recipe | `manage_adr(update)` requires an explicit durable architecture decision; these tools do not occupy normal Main/Coder context |
| Runtime observation / maintenance | None | None | `ingest_traces` requires real approved runtime trace evidence; initial `index_repository` is an explicit application-MCP administrative action; both are unavailable to ordinary discovery models |
| Destructive recovery | None | None | `delete_project` is destructive and unavailable without explicit owner authorization for an exact verified maintenance target |

Classification rules:

- `index_repository`, `ingest_traces`, and `delete_project` are mutation-capable. Their schemas may be audited
  read-only, but ordinary models must not receive or call them merely to prove catalog coverage.
- `list_projects`, `index_status`, and read-safe ADR inspection are non-destructive but administrative. Keep
  them out of the default choice set unless project identity, freshness, coverage state, or a durable decision
  is the actual question.
- This profile is directional context, not a hidden allowlist, classifier, regex router, prompt rewriter, or
  second permission system.

## Graph-Authority Recipe Catalog

Every recipe below keeps native authority, IDs, bounds, and provenance attached. A selection tells the next
model where to begin and what relationship to inspect; it never predetermines the coding or research conclusion.
Use only tool names present in the current native catalog and current saved grant. Do not invent a convenient
wrapper name when an authority's live schema differs.

### CodeGraph — Main / GPT planner

- **Graph authority:** native Codebase Memory MCP; the CBM indexer is the sole writer.
- **Role:** establish repository direction and send Coder exact qualified names, paths, relationships, project
  identity, revision/freshness context, and provenance.
- **Trigger:** the request concerns code ownership, architecture, dependencies, impact, or a bounded coding
  handoff.
- **Leading graph context:** the real prompt or PromptSpec, supplied `CODEGRAPH_SEARCH` criteria, native
  qualified names/paths/IDs, first-page metadata, and `has_more`.
- **Default tool corridor:** `search_graph → get_architecture` when boundary orientation is needed
  `→ trace_path` when ownership or consumers matter.
- **Optional specialist tools:** only a named architecture/Cypher recipe may add `get_graph_schema` and one
  bounded `query_graph` question.
- **Proof required:** exact project, returned qualified names and paths, result totals/truncation, and any
  relationship claimed from `trace_path`.
- **Stop condition:** a real implementation owner and bounded handoff criteria are identified, or the graph
  returns an explicit gap/failure that must be handed off for source fallback.
- **Forbidden mutation:** no lifecycle tools, trace ingestion, project deletion, fabricated symbol, copied
  subgraph, source-level wandering, or claim that graph orientation is runtime proof.

### CodeGraph — Coder

- **Graph authority:** native Codebase Memory MCP; current source and tests remain authoritative when they
  disagree with the derived projection.
- **Role:** land on exact code, understand callers/callees, read returned symbols, qualify coverage, and prove
  the working-tree blast radius.
- **Trigger:** a bounded implementation, diagnosis, review, deletion/rename, or proof task has real CodeGraph
  anchors or a task-derived structural query.
- **Leading graph context:** Main/GPT pointers when supplied; otherwise the real task query plus canonical
  project/root. Preserve upstream IDs, paths, revision/freshness, selection reason, and provenance.
- **Default tool corridor:** `search_graph → trace_path` when relationships matter
  `→ get_code_snippet → check_index_coverage → complete source → detect_changes` when a meaningful diff exists.
- **Optional specialist tools:** recipe-loaded `search_code`, bounded `query_graph`, `get_architecture`, and
  `get_graph_schema` only for the evidence needs listed in the role matrix.
- **Proof required:** exact symbols/files, source confirmation, coverage/freshness limits, focused tests or
  build for changed behavior, current diff inspection, and inverse-neighbor proof for deletion/rename.
- **Stop condition:** requested behavior and preservation checks are proven, or a named gap is reported without
  speculative lifecycle recovery.
- **Forbidden mutation:** no manual index refresh during the response, no delete/recovery/trace ingestion, no
  CLI/second daemon, no fabricated graph pointer, and no graph-only completeness claim.

### ThinkGraph — Main / Kanban project reasoning

- **Graph authority:** Constellation Engine project reasoning and operational knowledge; its native owner remains
  the sole graph writer.
- **Role:** select bounded project reasoning records and relationships for the next model without converting
  them into CodeGraph or KnowGraph records.
- **Trigger:** the task needs existing project decisions, operational state, hypotheses, or a deliberate
  ThinkGraph traversal.
- **Leading graph context:** native ThinkGraph IDs, project identity, selection reason, bounded returned records,
  relationship direction, pagination/bounds, and provenance.
- **Default tool corridor:** use the live granted native catalog for bounded search/read, then inspect the exact
  selected record, then traverse only the relationship needed by the task.
- **Optional specialist tools:** recipe-loaded read-only native query/traversal operations whose current schemas
  and grants are visible; a write operation requires an explicit approved graph change.
- **Proof required:** returned native IDs, project, query/traversal bounds, provenance, and an honest empty,
  partial, or failed result when applicable.
- **Stop condition:** enough native reasoning evidence is selected for the handoff, or the authority reports a
  specific unresolved gap.
- **Forbidden mutation:** no TypeScript ranking/semantic merge, copied subgraph, invented record, silent fallback
  to another graph, or unapproved graph write/lifecycle action.

### KnowGraph — Main / Kanban sourced knowledge

- **Graph authority:** Neo4j/Graphiti sourced knowledge and provenance; its native owner and research pipeline
  remain the only writers.
- **Role:** select bounded entities, claims, evidence, sources, temporal context, and relationships while keeping
  source and provenance attached.
- **Trigger:** the task needs factual evidence, source context, freshness, contradiction inspection, or a
  deliberate KnowGraph traversal.
- **Leading graph context:** native KnowGraph IDs, canonical entity identity, claim/evidence/source references,
  dates/freshness, confidence/status, selection reason, bounds, and provenance.
- **Default tool corridor:** use the live granted native catalog for bounded search/read, inspect the selected
  evidence and source context, then traverse only the required neighborhood or temporal relationship.
- **Optional specialist tools:** recipe-loaded read-only contradiction, freshness, source, or bounded traversal
  operations that exist in the current native catalog; research ingestion/write stays outside ordinary reads.
- **Proof required:** native entity/claim/source IDs, source and time provenance, result bounds/truncation, and
  explicit contradictions, gaps, or failures.
- **Stop condition:** sufficient source-backed evidence is selected for the handoff, or the authority exposes a
  specific missing/contradictory evidence gap.
- **Forbidden mutation:** no copied evidence graph, hidden fusion with ThinkGraph/CodeGraph, prose-derived access
  claim, TypeScript semantic merge, fabricated provenance, or ordinary-model write/ingestion.

### Run-scoped combined graph evidence

Deliberately selected CodeGraph, ThinkGraph, and KnowGraph records may travel together through the canonical
Run-scoped `in.idf` actual-graph-data section. Each record keeps its authority, native ID, bounds, and provenance.
Python rails bounds that selection before it materializes and reloads the one canonical input. The embedded
evidence is temporary transport, not a fourth graph, writer, cache, merged authority, or permission source.

## Task Recipes

Recipes are useful graph-navigation corridors, not tool allowlists. Select the smallest recipe that matches the
task, follow real results, and use any additional CBM tool whose evidence is actually needed.

### Feature owner discovery

```text
search_graph(user outcome, supplied graph anchors, and likely subsystem)
→ trace_path both directions only when ownership crosses symbols
→ get_code_snippet for returned qualified owners
→ complete current source and focused tests
Proof: current implementation owner, callers/consumers when material, and affected tests are identified.
```

### Main or IDF actual graph data to Coder validation

```text
retain supplied native IDs, qualified symbols, paths, project/revision, and provenance
→ search_graph using the supplied structural neighborhood
→ check exact path coverage when that tool is exposed
→ get_code_snippet for current returned identities
→ complete current source
Proof: transported context answers what to search next; current CodeGraph/source confirms or rejects it.
```

### Working-tree blast radius

```text
detect_changes once after a meaningful diff exists
→ inspect changed-symbol impact rows
→ trace_path only for the highest-risk or ambiguous relationships
→ reread affected source and run focused tests
Proof: changed files, impacted symbols/modules, truncation, and tested preservation boundary are reported.
```

### Deletion or rename

```text
search_graph exact old identity
→ trace_path inbound and outbound
→ get_code_snippet plus complete current source
→ search_code/focused rg for dynamic and unindexed residue
→ repair every surviving neighbor and run the Mandatory Inverse Deletion Audit
Proof: old identity/residue is absent, new identity exists when applicable, and former neighbors remain valid.
```

### Route to runtime

```text
search_graph route, handler, transport method, or runtime entry
→ trace_path calls or data_flow across the relevant direction
→ get_code_snippet for returned handlers/adapters
→ read both transport and runtime source
→ focused rg for route/config literals
Proof: route-to-handler-to-runtime ownership is source-confirmed; graph gaps and dynamic dispatch are explicit.
```

### Cross-service flow

```text
search_graph client, Route, Channel, or service operation
→ trace_path mode=cross_service when exposed
→ inspect evidence/confidence only when the edge must support a strong claim
→ read both service endpoints and run a focused contract test
Proof: protocol, source endpoint, destination endpoint, and unresolved dynamic boundaries are identified.
```

### Index coverage fallback

```text
search_graph expected identity
→ check_index_coverage for exact paths/scopes when exposed, or index_status once when state is material
→ direct-read skipped or parse-partial files and ranges
→ focused rg for missing definitions/imports/callers
Proof: indexed evidence and direct-source fallback are distinguished; absence claims state their coverage limit.
```

### Architecture boundary

```text
get_architecture with only needed aspects/path
→ search_graph representative boundary symbols
→ trace_path across the suspected seam
→ get_code_snippet and complete source for the real owners
Proof: graph clusters/folders remain orientation evidence; source confirms the actual authority boundary.
```

### Implementation and tests

```text
search_graph implementation identity
→ trace_path inbound with tests included when supported, or bounded query_graph over TESTS
→ get_code_snippet for implementation and exact tests
→ run the smallest focused test command
Proof: the exercised contract and missing coverage are reported separately from test success.
```

### Complexity or hot path

```text
get_architecture hotspots or bounded query_graph over complexity properties
→ search_graph the returned candidates
→ trace_path inbound to establish whether the path is live
→ get_code_snippet and complete source
→ benchmark/profile when a performance claim matters
Proof: graph complexity is a candidate signal; live-path source and measurement decide the claim.
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

- **trace_path parameter**: Use simple function names (`materialize_invocation`), never qualified. The `name` field from search_graph is correct.
- **index_status / detect_changes**: Accept project name string, never filesystem path.
- **Python functions**: trace_path does not resolve them. Verify via source reads + rg.
- **Route nodes**: file_path is empty. Read route files directly for handler mapping.
- **Protected/excluded dirs**: autogen-main/, worldsignal/, Kronos-main/,
  services/esn_rls/, and EDGAR caches are off-limits for cleanup. Verify index coverage rather
  than assuming these vendored/protected boundaries are indexed.
- **search_code**: Working in the installed 0.10.8 build. Use it for indexed code text; use `rg` for
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
Example: trace_path on `materialize_invocation` identifies its bounded caller/callee slice — search
only that slice before using focused residue search.

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

## Historical Cypher Limitations (tested v0.9.0, 2026-07-18)
- `STARTS WITH` / `CONTAINS` fail with parser error "expected token type 86, got 49" — use `=` for exact string matches
- Boolean property filters (`WHERE f.is_exported = true`) return 0 rows — track via get_code_snippet metadata instead
- No subqueries, no OPTIONAL MATCH with complex patterns, no NOT EXISTS
- Use search_graph over query_graph for symbol lookup; reserve query_graph for relationship traversals with simple WHERE clauses
- These are v0.9.0-specific; check get_graph_schema after CBM upgrades for Cypher capability changes

## Pre/Post-Edit Checklist

Before edit:
- [ ] search_graph resolves the required structural owners
- [ ] trace_path used only when relationships/impact matter
- [ ] get_code_snippet uses only a qualified name returned by CBM
- [ ] optional graph tools used only for a bounded evidence need
- [ ] complete current source directly read
- [ ] focused rg used only for literals/config/docs/errors/coverage/residue
- [ ] actual deletion/rename targets and former neighbors recorded when the inverse audit is triggered

After edit:
- [ ] Tests pass
- [ ] proportional affected-path/source verification passes
- [ ] rg confirms old identifiers gone when exhaustive absence matters
- [ ] surviving former neighbors no longer reference deleted identities
- [ ] rebuilt graph absence/new-identity proof recorded when observable
- [ ] large structural changes received one cleanliness decision

## Guardrails

@guardrail id=codebasedmemory.fresh-before-edits
@guardrail id=codebasedmemory.direct-read-before-claim
@guardrail id=codebasedmemory.no-fake-code-understanding
@guardrail id=codebasedmemory.source-wins-on-disagreement
@guardrail id=codebasedmemory.no-reflexive-reindex
@guardrail id=codebasedmemory.exact-main-projection-maintenance

## Query Records

@query id=codebasedmemory.current-code "search_graph, useful trace_path, returned-name get_code_snippet, bounded optional graph tools, complete source, and focused residue proof"
@query id=codebasedmemory.skill-match "retrieve skills using user intent, active CoderPacket, fresh CBM files and symbols, subsystem boundaries, and required proof"
