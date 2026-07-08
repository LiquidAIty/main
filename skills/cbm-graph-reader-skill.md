# Skill: CBM Graph Reader

@skill id=cbm-graph-reader
@type Skill
@status active
@related_to codegraph-context-reader
@related_to codebasedmemory
@related_to feature-manifest-registry

## Vector Summary

Low-level CBM freshness check, symbol resolution, and reindex procedure. Produces a
CBMReadPacket that higher-level skills (Feature Context Resolver, CodeGraph Context Reader)
use. CBM is a graph reader capability — it does not block coding.

## Core Rule

CBM is a graph reader and source-context capability, not a coding gate.

Do not block coding just because CBM is stale. If CBM is stale, agents may still inspect
disk/source directly, but must not make current CBM graph claims until CBM is refreshed.

## Procedure

### 1. Check freshness

Project identity:

```
list_projects
  → returns: [{"name": "C-Projects-main", "root_path": "C:/Projects/main", ...}]
```

Use exactly `C-Projects-main` as the project argument for all CBM tools — never
`C:/Projects/main` or `C:\Projects\main`.

Run:

```
index_status(project="C-Projects-main")
detect_changes(project="C-Projects-main")
```

`index_status` returns `{"project":"C-Projects-main","nodes":N,"edges":N,"status":"ready"}`.
`detect_changes` returns `{"changed_files":[],"changed_count":0,...}` when clean.

**Proof labels at this stage:**

- CBM-freshness-proven: index_status=ready AND changed_count=0.
- CBM-stale: changed_count>0 OR index_status is not ready.

### 2. Reindex only when needed

**If changed_count=0 and status=ready:**
- Do not reindex.
- Use current CBM.

**If changed_count>0:**
- For documentation/graph claims: mark CBM stale. Do not make current graph claims.
- If the task explicitly allows refresh: run `index_repository(repo_path="C:/Projects/main")`.
- After reindex: run `index_status` and `detect_changes` again.
- Report before/after node and edge counts.

**If reindex fails:**
- Mark CBM unavailable/stale.
- Do not invent graph results.
- Fall back to direct source reads for non-graph claims.

**Proof labels at this stage:**

- CBM-reindexed: index_repository ran and index_status returned ready afterward.
- unavailable: CBM tool failed; no graph claim may be made.

### 3. Resolve symbols

Use `search_graph` with simple symbol names:

```
search_graph(project="C-Projects-main", query="runConfiguredCard")
  → returns results with: name, qualified_name, label, file_path, start_line
```

Store the `name` field (simple name) for future `trace_path` calls.
Store the `qualified_name` field for future `get_code_snippet` calls.

**Trace_path** uses simple function names only:

```
trace_path(project="C-Projects-main", function_name="runConfiguredCard",
           mode="calls", direction="inbound", depth=1)
```

- Accepts: the `name` field from search_graph results.
- Does NOT accept: qualified_name, file-scoped paths, or dotted names.

**Get_code_snippet** uses qualified names:

```
get_code_snippet(project="C-Projects-main",
                 qualified_name="C-Projects-main.apps.backend.src.cards.runtime.runConfiguredCard")
```

- Accepts: the `qualified_name` field from search_graph results.
- Does NOT accept simple names when multiple same-name symbols exist.

**Durable root storage:**
- Store as exact relative file path + simple symbol name.
- Simple symbol name alone is not durable identity.
- If multiple same-name symbols are returned, filter by declared file path.
- If the declared path cannot be uniquely matched, mark ambiguous.

### 4. Proof labels

Every relationship in a CBMReadPacket carries one of these labels:

| Label | When to use |
|-------|-------------|
| CBM-freshness-proven | index_status ready AND detect_changes clean |
| CBM-stale | changed_count>0 or index_status not ready |
| CBM-reindexed | index_repository ran, status ready after |
| CBM-resolved-anchor | search_graph found the symbol/file/route |
| CBM-path-proven | trace_path or query_graph returned the edge/relationship |
| source-verified | graph-resolved source confirms relation; CBM did not return the edge |
| unavailable | CBM tool failed; no graph claim may be made |

### 5. Python / TypeScript limitation

Current CBM trace_path may not resolve:

- Python functions (e.g. `run_local_coder`)
- Dotted TypeScript methods (e.g. `LocalCoderAdapter.run`)
- Route→handler links (route nodes have empty file_path in CBM)
- Type/interface nodes

For these, resolve the file through CBM, read the source directly, and label the
relationship as `source-verified` — never `CBM-path-proven`.

### 6. Produce CBMReadPacket

After checks and resolution, produce this output shape:

```
CBMReadPacket:
  project: "C-Projects-main"
  root: "C:/Projects/main"
  status: "fresh" | "stale" | "unavailable"
  index_status: { status, nodes, edges }
  detect_changes: { changed_files, changed_count, impacted_symbols }
  reindex_performed: bool
  node_count: N
  edge_count: N
  resolved_anchors:
    - file: <relative path>
      symbol: <simple name>
      label: "CBM-resolved-anchor"
  ambiguous_anchors:
    - file: <relative path>
      symbol: <simple name>
      reason: "multiple same-name symbols, could not filter by declared path"
  unresolved_anchors:
    - file: <relative path>
      symbol: <simple name>
      reason: "trace_path: Python function not resolvable"
  graph_paths_proven:
    - from: <symbol>
      to: <symbol>
      label: "CBM-path-proven"
  source_verified_relationships:
    - from: <symbol>
      to: <symbol>
      label: "source-verified"
  recommended_source_load_set:
    - <file path>
  affected_feature_pages:
    - wiki/<feature>.md
  warnings:
    - "CBM stale for changed files: foo.ts, bar.ts"
```

## Relationship to Feature Context Resolver

CBM Graph Reader is lower-level than the Feature Context Resolver.

The Feature Context Resolver will use CBM Graph Reader to:
1. Check freshness and reindex if needed.
2. Resolve declared feature manifest anchors.
3. Trace bounded callers/callees.
4. Return a CBMReadPacket that feeds into the CoderPacket.

CBM Graph Reader does NOT:
- Select features from chat wording.
- Create regex routing.
- Create intent classification.
- Read wiki/*.md files or parse frontmatter.

Feature selection comes from the current SPEC, Task Ledger, Planner decision, or explicit
user/project instruction.

## Relationship to Local Coder

Local Coder should not be blocked by CBM freshness.

After a successful edit, the CoderReport should either:
- Include that CBM was refreshed and report clean status; or
- Report "CBM stale for changed files."

Do not reintroduce CBM editAllowed gates. CBM is a reader capability, not an access
control gate.

## Guardrails

@guardrail id=cbm-graph-reader.no-coding-gate
@guardrail id=cbm-graph-reader.reindex-only-when-needed
@guardrail id=cbm-graph-reader.project-name-not-filesystem-path
@guardrail id=cbm-graph-reader.trace-path-simple-names-only
@guardrail id=cbm-graph-reader.python-dotted-type-limitation
@guardrail id=cbm-graph-reader.no-regex-feature-routing
@guardrail id=cbm-graph-reader.direct-read-when-unavailable

## Query Patterns

@query id=cbm-graph-reader.freshness "index_status(project=\"C-Projects-main\") + detect_changes(project=\"C-Projects-main\") + report fresh/stale/unavailable"

@query id=cbm-graph-reader.read-symbol "search_graph(project=\"C-Projects-main\", query=\"<simple_name>\") + confirm file_path + store name + store qualified_name"

@query id=cbm-graph-reader.trace-route "trace_path(project=\"C-Projects-main\", function_name=\"<name>\", direction=\"inbound\", mode=\"calls\", depth=1)"

@query id=cbm-graph-reader.full-cycle "check freshness + resolve anchors + trace paths + produce CBMReadPacket"
