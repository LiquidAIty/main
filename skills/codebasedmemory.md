# Skill: Code-Based Memory

@skill id=codebasedmemory
@type Skill
@status active
@source_spec specs/codebasedmemory-skill.md
@source_task tasks/active/create-codebasedmemory-skill.md
@requires fresh_cbm_index
@stores graphable_markdown
@imports_to knowgraph_neo4j

## Vector Summary

Use fresh Code-Based Memory to navigate the current repo graph before work, direct-read files before
claims or edits, prove scoped changes, refresh CBM after, and record graph-backed task deltas.

## Use When

Use for implementation, architecture/runtime/dependency claims, task scoping, file selection,
impact analysis, skill/example queries, validation planning, and post-change graph/code reporting.

## Do Not Use When

Do not use CBM as a substitute for direct file reads, installed-package proof, tests, compile,
smoke, or command output. CBM is the structural map, not unquestioned truth.

## Core Rule

Fresh CBM index every time. No stale cache logic.

Every use begins with a fresh or proven-fresh ready index. Code examples are fetched fresh through
graph queries and direct reads; copied code snippets are not durable skill memory unless tiny and
strictly necessary.

## Action Steps

1. Read `AGENTS.md`.
2. Read `PLAN.md`.
3. Read the relevant spec and matching skills.
4. Refresh or prove fresh CBM.
5. Record status, nodes, and edges.
6. Query graph for relevant nodes, edges, files, and symbols.
7. Direct-read files before claims or edits.
8. Use focused grep only for exact checks after graph narrowing.
9. For real implementation work, append and execute a bounded skill attempt.
10. Run proof.
11. Refresh or prove fresh CBM after.
12. Record actual graph/code delta.
13. Update the skill with success or failure evidence.

## Skill Graph Compounding Rule

Before creating a real implementation attempt, search skills using the user prompt, referenced specs, fresh CBM
nodes/files/symbols, touched subsystem, known guardrails, and related skills.

* If matching skills exist, append the bounded attempt to the matching skill.
* If no matching skill exists, write:
  `No matching skill found; successful completion must create a new skill.`
  Then create the smallest useful one-file skill stub and append the bounded attempt.
* Every successful code attempt creates or updates graphable skill memory.
* Existing matching skills receive a new example, proof claim, guardrail, smoke test, query pattern,
  or related-skill edge.
* Every failed code attempt records failed proof, why it failed, a guardrail, and a bounded retry
  direction.
* Process-normalization and steering prompts do not become attempts.

The skill graph compounds by connecting skills to specs, source tasks, touched CodeGraph nodes,
changed files, changed symbols, proof claims, validation commands, and related skills.

## The 14 CBM Tools

### `index_repository`

* What it does: builds or refreshes the repository graph.
* Use when: beginning serious work or a skill query, and after changes.
* Do not use when: a fresh current-tree index is already proven in this run.
* Write back: method, status, nodes, edges.

### `index_status`

* What it does: confirms index readiness and counts.
* Use when: before trusting graph results and after refresh.
* Do not use when: treating readiness as behavior proof.
* Write back: project, status, nodes, edges.

### `list_projects`

* What it does: lists indexed projects.
* Use when: the active project is uncertain or multiple indexes may exist.
* Do not use when: project identity is already proven.
* Write back: selected project and reason.

### `delete_project`

* What it does: deletes a project index.
* Use when: explicitly authorized cleanup of a bad/stale index.
* Do not use when: casually refreshing or troubleshooting.
* Write back: authorization, deleted project, replacement status.

### `search_graph`

* What it does: finds symbols, files, functions, classes, modules, routes, and named entities.
* Use when: locating ownership and candidate files before reads.
* Do not use when: an exact literal or non-code config is the actual question.
* Write back: qualified names, labels, files, and scope relevance.

### Conceptual `trace_call_path`; live tool `trace_path`

* What it does: traces calls, data flow, and cross-service paths.
* Use when: evaluating callers, callees, blast radius, or value propagation.
* Do not use when: a simple symbol lookup is sufficient.
* Write back: mode, direction, depth, paths, and risks.

### `query_graph`

* What it does: runs structured Cypher questions over nodes and relationships.
* Use when: filters, aggregation, or multi-hop reasoning are needed.
* Do not use when: `search_graph` answers the question more clearly.
* Write back: query purpose, relevant rows/edges, and scope decision.

### `ingest_traces`

* What it does: links real runtime traces to static graph structure.
* Use when: real traces exist and runtime/static linkage matters.
* Do not use when: traces are missing, invented, or irrelevant.
* Write back: trace source and evidence-supported linked behavior.

### `detect_changes`

* What it does: detects known changes and estimates graph impact.
* Use when: targeted impact analysis has an explicit comparison basis.
* Do not use when: no meaningful comparison exists or routine git reporting is not requested.
* Write back: comparison basis, impacted nodes/files, and risks.

### `get_graph_schema`

* What it does: reports node labels, edge types, and properties.
* Use when: preparing schema-aware graph queries.
* Do not use when: the task does not need graph-schema knowledge.
* Write back: relevant labels, edges, and query constraints.

### `get_architecture`

* What it does: summarizes services, dependencies, entry points, and subsystem structure.
* Use when: orienting before unfamiliar or cross-cutting work.
* Do not use when: narrow ownership is already proven.
* Write back: relevant boundaries and dependencies.

### `get_code_snippet`

* What it does: retrieves a small graph-resolved source snippet.
* Use when: choosing the next resolved file/symbol to direct-read.
* Do not use when: editing or citing without a direct file read.
* Write back: resolved symbol and target file.

### `search_code`

* What it does: performs graph-augmented exact source search.
* Use when: exact code text is needed after structural narrowing.
* Do not use when: broad text search is replacing graph discovery.
* Write back: pattern, owning symbols/files, and direct-read confirmation.

### `manage_adr`

* What it does: reads or updates architecture decision records.
* Use when: intentionally recording a durable architecture decision.
* Do not use when: storing task progress or normal skill memory.
* Write back: decision purpose, changed sections, and evidence.

## Focused Grep/Rg Fallback

Use focused grep/rg only for exact banned imports/dependencies, routes, config/env keys, error codes,
provider/model IDs, fake-output markers, tests, narrowed symbols, or when `search_code` fails.
Direct-read every match before treating it as truth.

## Graphable Skill Data

@node skill:codebasedmemory type=Skill label="Code-Based Memory"
@node skill_example:codebasedmemory.create_skill type=SkillExample
@node claim:fresh_cbm_index_each_time type=Claim
@node claim:graph_first_direct_read_second type=Claim
@node validation:markdown_normalization type=Validation
@node file:skills/codebasedmemory.md type=File
@node spec:codebasedmemory-skill type=Spec path="specs/codebasedmemory-skill.md"
@node task:skill-graph-compounding-rule type=Task label="Skill graph compounding rule"
@node claim:successful_code_task_updates_skill type=Claim
@node validation:skill_graph_compounding_docs type=Validation
@edge skill:codebasedmemory HAS_EXAMPLE skill_example:codebasedmemory.create_skill
@edge skill:codebasedmemory USED_SPEC spec:codebasedmemory-skill
@edge skill:codebasedmemory CAME_FROM_TASK task:skill-graph-compounding-rule
@edge skill:codebasedmemory TOUCHED_NODE file:skills/codebasedmemory.md
@edge skill:codebasedmemory CHANGED_FILE file:skills/codebasedmemory.md
@edge skill:codebasedmemory PROVED claim:successful_code_task_updates_skill
@edge skill:codebasedmemory VALIDATED_BY validation:skill_graph_compounding_docs
@edge_pattern Skill RELATED_SKILL Skill
@edge skill_example:codebasedmemory.create_skill USED_SPEC specs/codebasedmemory-skill.md
@edge skill_example:codebasedmemory.create_skill CAME_FROM_TASK tasks/active/create-codebasedmemory-skill.md
@edge skill_example:codebasedmemory.create_skill TOUCHED_NODE file:skills/codebasedmemory.md
@edge skill_example:codebasedmemory.create_skill CHANGED_FILE file:skills/codebasedmemory.md
@edge skill_example:codebasedmemory.create_skill PROVED claim:fresh_cbm_index_each_time
@edge skill_example:codebasedmemory.create_skill PROVED claim:graph_first_direct_read_second
@edge skill_example:codebasedmemory.create_skill VALIDATED_BY validation:markdown_normalization
@query skill_example_current_code "refresh CBM, resolve touched nodes/files from this skill example, return current snippets from graph-resolved files"
@query skill_match_for_task "search skills using user prompt, specs, fresh CBM nodes/files/symbols, subsystem, guardrails, and related skills"

Markdown is the authoring format. Future importers may convert these lines into JSON, Postgres, or
ThinkGraph records.

## Query-Ready Example

Future command shape:

`liq skill example codebasedmemory --fresh --show code`

Expected behavior:

1. refresh or prove fresh CBM
2. read `skills/codebasedmemory.md`
3. parse graphable skill/example metadata
4. resolve current graph nodes, files, and symbols
5. return current relevant snippets from CBM plus direct reads
6. return proof claims and action steps
7. do not return raw diff by default

## Source Task Metadata

* source task: `tasks/active/create-codebasedmemory-skill.md` (completed scratchfile, folded here)
* source spec: `specs/codebasedmemory-skill.md`
* source prompt as understood: create and then normalize the reusable CBM procedure into one
  graphable Markdown skill
* CBM before: full refresh, ready, 5215 nodes, 9436 edges for initial creation; 5292 nodes, 9509
  edges before this one-file correction
* files read: repo law, PLAN, CBM skill spec, active T001, and the previous split skill package
* files changed: `AGENTS.md`, `PLAN.md`, `specs/codebasedmemory-skill.md`,
  `tasks/active/T001-bootstrap-codegraph-thinkgraph.md`, and `skills/codebasedmemory.md`
* proof summary: all fourteen tools present, fresh-index rule present, graphable lines present,
  query-ready behavior present, split files removed, no runtime code changed
* CBM after: full refresh, ready, 5240 nodes, 9460 edges
* actual doc/graph delta: one indexed graphable skill file replaces the split skill package
* reusable lesson: query fresh structure, direct-read local truth, prove changes, and record
  graph-backed deltas without durable raw-diff piles
* compounding update: added mandatory pre-task skill search and mandatory post-success skill update
* compounding proof: matching skill `skills/codebasedmemory.md`; CBM before 5240 nodes/9460 edges;
  CBM after 5243 nodes/9463 edges; repo law, PLAN, spec, skill, and active T001 updated

## Task Write-Back Shape

CBM before:

* method
* status
* nodes
* edges
* relevant graph nodes
* relevant graph edges
* relevant files/symbols

CBM after:

* method
* status
* nodes
* edges
* actual graph/code delta

## No Raw Diff Pile

Raw diff is not durable skill memory. Durable skill memory is task-inverted action steps, graphable
nodes/edges, proof claims, query-ready examples, compact source-task metadata, and current code
retrieved fresh by query.
