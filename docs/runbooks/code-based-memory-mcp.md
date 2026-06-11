# Code-Based Memory MCP — Usage Runbook

## Tool Status

| Tool | Status | Notes |
|------|--------|-------|
| `index_status` | ✅ Works | Returns node/edge counts and readiness. Always call first. |
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
| `index_repository` | ⛔ Gated | Long-running. Re-indexes the entire repo. Do not run mid-task. Requires explicit user approval. |
| `delete_project` | ⛔ Destructive | Deletes the entire graph index. Do not run without explicit user approval. |

## Usage Rules

**Always:**
1. Call `index_status` before using any other tool to confirm the index is alive.
2. Use `get_code_snippet` for known functions, classes, or symbols.
3. Use `search_graph` (BM25/`name_pattern`/`semantic_query`) for indexed symbol discovery.
4. Use `query_graph` for structural/relationship questions via Cypher.
5. Use `trace_path` to understand caller/callee impact before touching shared functions.
6. Use `detect_changes` before and after edits to track impacted symbols.
7. Use the built-in `Grep` tool for raw text pattern search while `search_code` is broken.
8. Use `Read` to verify the actual current file contents and exact line numbers before any edit.

**Never:**
- Do not trust MCP line numbers alone after a file has been edited — the index is a snapshot.
- Do not use `search_code` until the temp-file issue is fixed.
- Do not run `index_repository` mid-task without explicit user approval.
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
