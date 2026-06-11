# Code-Based Memory MCP — Usage Runbook

## Fresh Index Required

Code-Based Memory MCP must refresh or rebuild its repository index before agents use it to make
architecture, runtime, dependency, or implementation claims. `index_status: ready` proves that an
index can answer queries; it does not prove that the index reflects the current repository
timestep.

If the index is stale, out of timestep, or was built before recent repository changes, CBM is not
authoritative. A stale index may produce false claims about deleted files, old routes, old
packages, old Docker paths, old Redis paths, old AgentChat references, or removed fake runtime
code.

Filesystem truth wins whenever it disagrees with CBM. Current Git status, current Git diff, direct
file reads, installed-package proof, and test results all outrank stale CBM results. Stale CBM must
never override:

- `docs/runbooks/AUTOGEN_REACTFLOW_RUNTIME_ARCHITECTURE.md`
- `docs/runbooks/VENDORED_ROOTS_AND_SUBREPOS.md`
- current Git status
- current Git diff
- direct file reads
- installed-package proof
- test results

Every agent must explicitly report whether the CBM index was refreshed in the current run. If it
was not refreshed, the report must say:

> Code-Based Memory index was not refreshed; treating CBM results as advisory only.

If CBM says something exists but direct filesystem reads disagree, the filesystem wins.

## Tool Status

| Tool | Status | Notes |
|------|--------|-------|
| `index_status` | ✅ Works | Returns node/edge counts and process readiness. It does not prove freshness. |
| `list_projects` | ✅ Works | Lists all indexed projects with path and counts. |
| `get_graph_schema` | ✅ Works | Returns all node labels, edge types, and properties. |
| `get_architecture` | ✅ Works | High-level node/edge summary. `aspects` param accepted but does not filter output. |
| `get_code_snippet` | ✅ Works | Reads source for a known function/class/symbol by name or qualified name. Line numbers may be stale after edits — verify with `Read` before patching. |
| `search_graph` | ✅ Works | BM25 query, `name_pattern` regex, and `semantic_query` array modes all work. |
| `query_graph` | ✅ Works | Cypher queries execute against the live graph. |
| `trace_path` | ✅ Works | Caller/callee chains with hop depth. Use before editing shared functions. |
| `detect_changes` | ✅ Works | Identifies changed files vs a git ref. Run before and after edits. |
| `manage_adr` | ✅ Works (read) | `get` and `sections` modes work. No ADR exists yet for this project. |
| `ingest_traces` | ⚠️ Accepted / no-op | Payload accepted; runtime edge creation is not implemented. |
| `search_code` | ❌ Broken | Fails with `cannot create temp file (No such file or directory)`. Broken on this machine. Do not rely on it. |
| `index_repository` | ✅ Required before trusted claims | Re-indexes the repository. Run before using CBM as architecture/runtime/dependency truth. |
| `delete_project` | ⛔ Destructive | Deletes the entire graph index. Do not run without explicit user approval. |

## Usage Rules

**Always:**
1. Refresh or rebuild the repository index before treating CBM results as truth.
2. Call `index_status` to confirm the refreshed index is alive.
3. Explicitly report whether the index was refreshed in the current run.
4. Use `get_code_snippet` for known functions, classes, or symbols.
5. Use `search_graph` (BM25/`name_pattern`/`semantic_query`) for indexed symbol discovery.
6. Use `query_graph` for structural/relationship questions via Cypher.
7. Use `trace_path` to understand caller/callee impact before touching shared functions.
8. Use `detect_changes` before and after edits to track impacted symbols.
9. Use the built-in `Grep` tool for raw text pattern search while `search_code` is broken.
10. Use `Read` to verify the actual current file contents and exact line numbers before any edit.

**Never:**
- Do not treat `index_status: ready` as proof that the index is fresh.
- Do not let stale CBM override current filesystem, Git, package, or test evidence.
- Do not trust MCP line numbers alone after a file has been edited — the index is a snapshot.
- Do not use `search_code` until the temp-file issue is fixed.
- Do not run `delete_project` without explicit user approval.

## search_graph Modes

```
BM25 query:       search_graph(query="model config resolver")
name_pattern:     search_graph(name_pattern=".*resolveModel.*")
semantic_query:   search_graph(semantic_query=["model", "provider", "fallback"])
```

`semantic_query` must be an array of strings, not a single string. Results appear in the `semantic_results` field, separate from `results`.

## Current Workaround for Broken search_code

`search_code` requires a writable temp directory for its grep pass. Until the server environment is fixed:

| Instead of | Use |
|------------|-----|
| `search_code` pattern search | `search_graph(name_pattern=...)` or `search_graph(query=...)` |
| `search_code` for symbol locations | `search_graph(name_pattern=...)` + `get_code_snippet` |
| `search_code` for raw file content | Built-in `Grep` tool |
| Exact current file content | `Read` |

## Fable / Sonnet Workflow

- Sonnet uses MCP for repo scouting, exact patch verification, and post-edit validation.
- Fable should receive curated context packets — it should not crawl the repo.
- Fable should not be asked to execute broad repo cleanup.
- Fable is appropriate for architecture decisions after specs and tasks are finalized and test-gated.
- All implementation must remain atomic: one change, one test gate, one validation pass.
