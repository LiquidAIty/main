# Skill: Codebase Memory Indexing

@skill id=codebase-memory-indexing
@type Skill
@status active
@related_to context-packet
@requires fresh_cbm_index

## Vector Summary

Use fresh Codebase Memory / CodeGraph evidence to anchor planning and coding; stale or missing code
context is a blocker.

## Procedure

1. Prove fresh CBM before edits and record status, nodes, and edges.
2. Use graph search and call/path tracing before focused text search.
3. Direct-read graph-resolved files before claims or edits.
4. Let tests, compile, real smoke, and direct reads win when CBM disagrees.
5. Refresh or prove fresh CBM after code changes.

## Working-Tree Visibility Rule

In the current Codebase Memory 0.6.1 workspace integration, an untracked-only addition may fail to
invalidate a cached moderate index. A later moderate refresh triggered by tracked file changes did
perform a real re-index and picked up the untracked file. Therefore:

* Do not claim the graph indexes committed HEAD only.
* Treat unchanged node/edge counts plus missing new symbols as a possible no-op/cache invalidation
  miss; confirm with a later real refresh and symbol search.
* `detect_changes` reports worktree differences from HEAD, not whether the current graph includes
  those changes. When changes exist and `index_status` exposes no indexed revision/time, record
  freshness as unverified and keep a visible blocker.
* Prefer a direct filesystem source inventory compared with CBM `File` nodes for non-git
  new-file-risk detection. Any on-disk source file absent from the indexed inventory makes
  freshness stale. Matching inventories are still only unknown unless CBM exposes a real indexed
  revision or timestamp tied to the verified project root.
* Never substitute the diagnostic check time for CBM's indexed time, and never invent a revision
  or chunk count. Preserve missing metadata as null and keep the exact unknown/stale reason visible.
* Root-anchor vendored-repository exclusions such as `/localcoder/`. An unanchored `localcoder/`
  rule can also hide a repo-owned nested boundary such as `apps/backend/src/coder/localcoder/`.
* A bounded adapter gate may prove same-run freshness by requiring a real successful index action,
  a matching project root, ready status, all required control-plane files, and no excluded vendored
  files before allowing the adapter to start. Missing scope evidence blocks; search is not a
  fallback.

## Guardrails

@guardrail id=codebase-memory-indexing.no-fake-code-understanding
@guardrail id=codebase-memory-indexing.stale-context-blocks
@guardrail id=codebase-memory-indexing.direct-read-before-claim

## Query Patterns

@query id=codebase-memory-indexing.current-code "refresh CBM, search_graph for relevant symbols, trace paths when needed, then direct-read resolved files"
