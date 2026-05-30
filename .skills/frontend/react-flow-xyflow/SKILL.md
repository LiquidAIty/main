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
- Treat the Agent Builder deck as the user's persistent playing board: saved layout is source-of-truth.
- Preserve the actual saved React Flow edge array as source-of-truth; never infer edges from card placement or screenshots.
- Preserve existing node IDs and positions for persisted decks; only assign positions for genuinely new nodes.
- Keep edge updates non-destructive: preserve user-created edges, avoid duplicates, and never force all-to-all rewires.
- Distinguish capability wiring vs mission-flow wiring; do not collapse them into one noisy edge pattern.
- For mission wiring helpers (e.g. `MissionDeckPatch`), merge into existing state without resetting user layout.

## Do Not

- Do not rewrite the whole canvas for a small node/edge bug.
- Do not remove handles without checking existing edges.
- Do not hide handles with `display: none`.
- Do not mutate node/edge objects in place.
- Do not break object-aware selection or chat/canvas context.
- Do not add road-sign UI or heavy labels unless requested.
- Do not assume all graph canvases share the same node semantics.
- Do not reapply `INITIAL_DECK` over an existing saved project/deck state.
- Do not add fake/inferred connections to make the board "look right."
- Do not auto-connect agents unless explicitly requested by the user.
- Do not change default seed layout to "fix" existing project persistence.
- Do not run auto-layout on existing user decks unless explicitly requested.
- Do not add forced node position resets for specific cards in hydration paths.
- Do not silently ignore failed deck saves.

## Persistence Rules

- Persist node movement (`drag`/`position`) to project/deck-scoped storage.
- Persist edge connect/reconnect/delete to project/deck-scoped storage.
- Hydration must prefer saved deck state; seed defaults apply only when no saved deck exists (or explicit reset/new deck flow).
- Rebuild/restart/reopen must restore saved layout exactly for the same project/deck.
- If persistence guarantees cannot be met in current mode, surface that explicitly before changing layout logic.

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
