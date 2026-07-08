---
id: feature.harness-to-thinkgraph
title: Harness to ThinkGraph
kind: feature
status: partial
proof_level: cbm_anchor_verified_and_source_verified

cbm:
  project_identity: C-Projects-main
  index_root: C:/Projects/main
  full_index_nodes: 5273
  full_index_edges: 10327
  freshness: ready

roots:
  files:
    - apps/backend/src/routes/coder.routes.ts
    - apps/backend/src/routes/thinkgraph.routes.ts
    - apps/backend/src/services/thinkgraph/thinkGraphStore.ts
    - apps/backend/src/cards/runtime.ts
    - apps/python-models/app/control_plane.py
    - apps/python-models/app/python_models/test_control_plane.py
  symbols:
    - readThinkGraphScope
    - applyThinkGraphPatch
    - runConfiguredCard
    - card_run_assistant_agent
  routes:
    - POST /api/coder/mcp-bridge/thinkgraph_read_scope
    - POST /api/coder/mcp-bridge/thinkgraph_apply_patch
    - GET /api/thinkgraph/graph-view
    - GET /api/thinkgraph/projection
  tests:
    - test_control_plane.py
    - thinkGraphStore.spec.ts
---

# Harness to ThinkGraph

## What this is

The write/read boundary from Harness control flow into ThinkGraph persistence, with
scoped write authority and readback projection. The Harness delegates to a ThinkGraph
agent card via the specialist doorway; the agent reads/writes ThinkGraph through
scoped MCP-bridge endpoints; results are readable through projection routes.

## What the user/agent experiences

A chat model opens a ThinkGraph specialist doorway → reads scope (nodes/relationships)
via a read tool → applies patches (creates/updates nodes) via a write tool → results
are visible through graph-view and projection GET routes. The agent never writes
ThinkGraph directly — only through the scoped `thinkgraph_apply_patch` endpoint with
server-minted authority.

## How it works

```
Harness chat → specialist doorway (card_thinkgraph_agent)
  → runConfiguredCard → runSingleCardWithAutoGen
    → model calls thinkgraph.get_graph_slice (read tool)
    → model calls card.run_assistant_agent (delegation tool)

ThinkGraph read:
  POST /api/coder/mcp-bridge/thinkgraph_read_scope    [coder.routes.ts:68]
    → readThinkGraphScope({ projectId, limit })         [thinkGraphStore.ts]
    → returns scope with nodes/edges

ThinkGraph write (scoped authority):
  POST /api/coder/mcp-bridge/thinkgraph_apply_patch    [coder.routes.ts:84]
    → applyThinkGraphPatch(authority, patch)            [thinkGraphStore.ts]
    → validates authority (projectId + correlationId)
    → validates patch shape (validateThinkGraphPatch)
    → executes via cypherOnClient / ensureVertexLabel
    → returns { ok, status, error }

Readback:
  GET /api/thinkgraph/graph-view                       [thinkgraph.routes.ts]
  GET /api/thinkgraph/projection                        [thinkgraph.routes.ts]
    → user-visible, not scoped to an agent's authority
```

## Must not break

1. ThinkGraph write authority is scoped — `applyThinkGraphPatch` requires a valid
   authority object with projectId + correlationId. No unrestricted graph writes.
2. The `thinkgraph_read_scope` and `thinkgraph_apply_patch` endpoints are on the coder
   MCP-bridge prefix — they are internal tools, not public APIs.
3. `/api/codegraph/graph-view` is a preview endpoint (LIMIT 400 Function→CALLS), not
   the full CBM index. Full index counts come from `list_projects`/`index_status`.
4. `card_run_assistant_agent` and `thinkgraph.get_graph_slice` are registered Python
   MCP tools — not generic write surfaces.
5. Magnetic One `prompt.md` packets may contain scoped ThinkGraph context pointers
   selected by Harness / the packet-builder, but those pointers are read handles only.
   They do not grant Mag One raw graph DB access, ThinkGraph write authority, arbitrary
   graph queries, or generic graph delta behavior.

## Start in CBM

```
search_graph(project="C-Projects-main", query="readThinkGraphScope")
search_graph(project="C-Projects-main", query="applyThinkGraphPatch")
search_graph(project="C-Projects-main", query="card_run_assistant_agent")
search_graph(project="C-Projects-main", query="runConfiguredCard")

trace_path(project="C-Projects-main", function_name="runConfiguredCard",
           mode="calls", direction="inbound", depth=1)

index_status(project="C-Projects-main")
```

## Valid proof

```typescript
// Proves: ThinkGraph read endpoint returns scope for a real project
const scope = await fetch('/api/coder/mcp-bridge/thinkgraph_read_scope', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ authority: { projectId: 'proj-1', correlationId: 'corr-1' } }),
}).then(r => r.json());
assert(scope.ok === true);
assert(Array.isArray(scope.scope?.nodes));
```

Proves: scoped read endpoint works with valid authority. Does not prove: ThinkGraph
write authority validates correctly (requires invalid-authority test), or that the
Harness→doorway→ThinkGraph chain completes end-to-end (requires live card run).

## Limitations

- **Route→handler edges are not in CBM graph.** The `thinkgraph_read_scope` and
  `thinkgraph_apply_patch` handlers at `coder.routes.ts:68` and `:84` are source-level
  links, not CBM edges.
- **ThinkGraph store functions** (`readThinkGraphScope`, `applyThinkGraphPatch`) are
  CBM-symbol-verified; their internal cypherOnClient/ensureVertexLabel calls are
  source-verified from thinkGraphStore.ts.
- **Python MCP tools** (`card_run_assistant_agent`) are source-verified from
  control_plane.py. The Python→TypeScript MCP bridge is a runtime boundary.
- **graph-view is a preview** — hard-coded LIMIT 400 Function→CALLS query. Not useful
  as a full index export.

## Future agent load set

| File | Why |
|------|-----|
| `apps/backend/src/routes/coder.routes.ts` (lines 68-99) | ThinkGraph read/apply MCP-bridge |
| `apps/backend/src/routes/thinkgraph.routes.ts` | graph-view + projection GET routes |
| `apps/backend/src/services/thinkgraph/thinkGraphStore.ts` | readThinkGraphScope, applyThinkGraphPatch |
| `apps/backend/src/cards/runtime.ts` | runConfiguredCard |
| `apps/python-models/app/control_plane.py` | card_run_assistant_agent |
| `apps/python-models/app/python_models/test_control_plane.py` | Structural reference tests |
