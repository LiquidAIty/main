# React Flow / XYFlow

## Trigger

Use only when:
- editing React Flow / XYFlow canvases
- changing nodes, edges, handles, viewport, pan/zoom, drag/drop, or selection
- fixing blank canvases, broken edges, missing handles, or sluggish graph UI
- changing Agent Canvas, Plan Canvas, ThinkGraph, KnowGraph, or CodeGraph canvas behavior

## Read

- SOUL.md
- AGENTS.md
- .specify/memory/constitution.md
- relevant specs/*
- relevant React Flow files found with Code-Based Memory MCP

## Do

- Import from `@xyflow/react`, not legacy `reactflow` or `react-flow-renderer`.
- Confirm `@xyflow/react/dist/style.css` is imported somewhere appropriate.
- Confirm the React Flow parent container has explicit width and height.
- Keep `nodeTypes` and `edgeTypes` stable outside render or memoized.
- Preserve node type strings, edge type strings, handle IDs, and connection semantics.
- Use unique handle IDs when multiple handles share a side/type.
- Use `nodrag` on buttons/inputs/selects inside nodes.
- Use `useUpdateNodeInternals` when handles are added/removed dynamically.

## Do Not

- Do not rewrite the whole canvas for a small node/edge bug.
- Do not remove handles without checking existing edges.
- Do not hide handles with `display: none`.
- Do not mutate node/edge objects in place.
- Do not break object-aware selection or chat/canvas context.
- Do not add road-sign UI or heavy labels unless requested.
- Do not assume all graph canvases share the same node semantics.

## Validate

Inspect package scripts first.

```powershell
npm --prefix client run build
npm --prefix client run typecheck
npm --prefix client run test
```

## Docs

Node/edge behavior change -> relevant specs/*  
Canvas architecture change -> docs/architecture.md  
Run/test command change -> docs/runbooks/full-stack-dev.md

## Source

Extracted from public React Flow skill patterns in framara/react-flow-skill and adapted for LiquidAIty.
