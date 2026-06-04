# AgentBuilder Board Persistence

## Scope

This document defines the real persistence contract for the AgentBuilder canvas in `client/src/pages/agentbuilder.tsx` and `client/src/components/builder/BuilderCanvas.tsx`.

Priority 0 rule: the saved board is the source of truth. The canvas must not invent connections, silently restore deleted optional cards, or replace a real saved board with a seeded display fallback.

## Storage Path

- Frontend load/save route: `GET` and `PUT /api/projects/:projectId/decks/:deckId`
- Frontend run route: `POST /api/projects/:projectId/decks/:deckId/run`
- AgentBuilder deck id: `deck_builder`
- Backend routes: `apps/backend/src/routes/projects.routes.ts`, `apps/backend/src/routes/decks.routes.ts`
- Backend persistence store: `apps/backend/src/v3/decks/store.ts`
- Database blob location: `ag_catalog.projects.agent_io_schema.v3_state`

The backend stores a normalized `DeckDocument` with:

- `nodes`
- `edges`
- `promptTemplates`
- `version`
- revision metadata in `v3_state.meta.decks[deckId]`

## Autosave Contract

Autosave is driven by the board fingerprint of `deck.nodes` plus `deck.edges`.

The canvas must autosave after:

- node move
- node add
- node delete
- edge create
- edge reconnect
- edge delete
- explicit node-field edits that mutate the deck

Current canvas mutation entry points:

- `onNodesChange` with persisted node change types
- `onEdgesChange` with persisted edge change types
- `onConnect`
- `onReconnect`
- canvas delete key handling
- card editor mutations in `agentbuilder.tsx`

Autosave debounce is `500ms`.

## Real Edge Contract

Only `document.edges` may render as graph connections.

- `BuilderCanvas.toFlowEdges()` maps persisted `DeckEdge` records into React Flow edges.
- No default seed edge should be injected into an existing saved board.
- The default AgentBuilder seed currently starts with `edges: []`.

This means:

- no fake connector overlay should appear without a real `DeckEdge`
- no saved edge should be inferred from card placement
- removing an edge from `document.edges` removes the rendered edge

## Seed Rules

Default seed is allowed only when a real project-backed deck payload does not exist yet for that project and deck.

Default seed is not allowed to overwrite or reinterpret a real saved board.

When no project is selected yet, AgentBuilder must stay project-backed:

- no local pretend board
- no seeded canvas banner
- no fake recovery deck
- project selection happens first, then the real deck loads

## Normalization Rules

Hydration may:

- normalize node/edge shape
- sanitize invalid edge references
- strip banned legacy cards/templates
- upgrade truly legacy system decks into the current seeded card set

Hydration must not:

- re-append deleted optional cards to a saved board
- treat a trimmed saved canonical board as a truncated fallback display mode
- force-add Magentic or other optional cards back into a saved board
- inject seed edges into a saved board that has none

## Deletion Contract

Deleting a node or edge on the board must persist through reload for the same project and deck.

This includes optional system cards. If the user deletes optional cards from a saved board, hydration must preserve that trimmed state on reload.

## Error Handling

Autosave failures must be surfaced through `deckStatusMessage` instead of only logging to the console.

Current behavior:

- failed autosave shows a board-save error message
- `deck_conflict` clears the cached revision so the next save can retry from fresh revision state

## Manual Smoke

1. Open AgentBuilder for a project with a real `deck_builder`.
2. Move a node and wait at least 500ms.
3. Reload and confirm the position persists.
4. Delete a non-critical node and wait at least 500ms.
5. Reload and confirm it stays deleted.
6. Create a connection and wait at least 500ms.
7. Reload and confirm the edge persists.
8. Remove that connection and wait at least 500ms.
9. Reload and confirm it stays removed.
10. Confirm no extra connector-looking seed lines appear unless backed by real edge state.

## Known Limits

- The deck document still lives inside the `v3_state` project blob even though the public API path is now `/api/projects/*`.
- Legacy deck upgrade still maps older system-only boards into the current seeded card set.
- The current automated page-level spec needs `jsdom` and emits unrelated canvas-library warnings from imported visualization dependencies, even when the AgentBuilder assertions pass.

## Refactor Note

`client/src/pages/agentbuilder.tsx` is still carrying too much responsibility.

Future split targets after this repair:

- project/deck API client
- board persistence hook
- deck normalization and seed rules
- active canvas composition
- rail/card registry
- companion surface rendering
- graph and knowledge workspace logic
- inactive legacy surface registry
