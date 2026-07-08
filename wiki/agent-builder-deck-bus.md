---
id: feature.agent-builder-deck-bus
title: Agent Builder Deck and Bus Connectivity
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
    - apps/backend/src/decks/store.ts
    - apps/backend/src/decks/mainChatControllerCard.ts
    - apps/backend/src/cards/runtime.ts
    - apps/backend/src/routes/decks.routes.ts
    - apps/backend/src/routes/coder.routes.ts
    - apps/backend/src/services/mcp/pythonAgentMcpClient.ts
    - apps/python-models/app/control_plane.py
    - client/src/features/agentbuilder/canvas/AgentCanvasPane.tsx
    - client/src/runtime/agentCardRegistryResolver.ts
  symbols:
    - getDeckDocument / getV3ProjectBlob / saveDeckDocument / writeV3ProjectBlobCas
    - normalizeDeckNode / normalizeDeckEdge / normalizeDeckDocument
    - ensureMainChatControllerCard / buildMainChatControllerCard / buildMainChatBusEdge
    - resolvedMagenticOptions / resolveBusConnections / canvas_inspect
    - AgentCanvasPane
  tests:
    - agentCardRegistryResolver.spec.ts
    - runtime.spec.ts
---

# Agent Builder Deck and Bus Connectivity

## What this is

The Agent Canvas's persisted deck is the single source of truth for all card
configurations, tool assignments, model selections, positions, and bus edges.
The "bus" is a `magentic_option` edge that connects orchestrator (Mag One) and
Main Chat to worker cards. Frontend and backend read the same deck edges to
determine which cards participate in multi-agent work.

## What the user/agent experiences

**Canvas editing**: user adds cards (nodes with positions), draws bus edges, sets
tools/models. Changes persist via `saveDeckDocument` → `writeV3ProjectBlobCas` (CAS).

**Reload/readback**: `getV3ProjectBlob` → `normalizeProjectBlob` →
`ensureMainChatControllerCard` auto-creates the Main Chat card + its bus edge
(`card_main_chat` ↔ `card_magentic`, `edgeType='magentic_option'`) if missing.
Card positions, edges, and prompt templates survive reload.

**Selected-card inspector**: clicking a card in `AgentCanvasPane` (React) triggers
`onSelectCard`. Backend `POST /cards/runtime-assignments` reads the card's runtime
skills/bindings via `callPythonAgentMcpTool('canvas.inspect')`.

**Bus**: a card with a `magentic_option` edge from the orchestrator is on the bus.
No edge → disconnected → invisible to Mag One.

**No-auto-broadcast**: cards never auto-join. Only explicit `magentic_option` edges
connect cards to the bus. The Main Chat prompt states: "You are not a worker."

## How it works

```
DB: agent_io_schema (JSONB, CAS via writeV3ProjectBlobCas)
  → getV3ProjectBlob → normalizeProjectBlob → ensureMainChatControllerCard
    → buildMainChatControllerCard / buildMainChatBusEdge (if missing)
  → getDeckDocument(projectId, deckId)
  → saveDeckDocument(projectId, deck) → writeV3ProjectBlobCas

Deck routes: GET /:projectId/decks, GET/PUT /:projectId/decks/:deckId [decks.routes.ts]

Bus (backend): resolvedMagenticOptions(orchestratorId, nodes, edges) [runtime.ts:86]
  → filters edges where source=orchestratorId AND edgeType='magentic_option'
  → CBM-path-proven (callers: describeConnectedAgents, runCardWithContract)

Bus (client): resolveBusConnections(cards, edges) [agentCardRegistryResolver.ts:54]
  → finds Sol (magentic_one) → 'orchestrator'; magentic_option edges → 'connected'
  → CBM-path-proven (callers: isLocalCoderBusConnected, spec)

Inspector: AgentCanvasPane(onSelectCard) → POST /cards/runtime-assignments [coder.routes.ts:107]
  → callPythonAgentMcpTool('canvas.inspect') → Python canvas_inspect [control_plane.py:102]
  → POST /cards/assign-runtime-skill / assign-data-binding mutate card config

Main Chat bus edge: buildMainChatBusEdge() [mainChatControllerCard.ts:54]
  source='card_main_chat', target='card_magentic', edgeType='magentic_option'
```

## Must not break

1. Deck is sole authority — runtime reads from `getDeckDocument`/`canvas_inspect`,
   never from browser in-memory state.
2. Bus connectivity is edge-driven — only `magentic_option` edges. No role inference.
3. `ensureMainChatControllerCard` only creates the card + edge if missing — never
   overwrites a user-modified Main Chat card.
4. Deck persistence is CAS — concurrent saves retry rather than silent overwrite.
5. `canvas_inspect` is read-only — never mutates deck state.

## Start in CBM

```
search_graph(project="C-Projects-main", query="getDeckDocument")
search_graph(project="C-Projects-main", query="ensureMainChatControllerCard")
search_graph(project="C-Projects-main", query="resolvedMagenticOptions")
search_graph(project="C-Projects-main", query="canvas_inspect")

trace_path(project="C-Projects-main", function_name="resolvedMagenticOptions",
           mode="calls", direction="inbound", depth=1)

index_status(project="C-Projects-main")
```

## Valid proof

```typescript
// Proves: deck readable with expected structure
const doc = await getDeckDocument('proj-1', 'deck_builder');
assert(doc.deck.nodes.length > 0);
assert(doc.meta.deckRevision !== null);

// Proves: bus connectivity resolves
const connections = resolveBusConnections(deck.nodes, deck.edges);
const orch = [...connections].find(([,v]) => v === 'orchestrator');
assert(orch !== undefined);
```

Proves: deck readable, bus connections resolve. Does not prove: canvas UI correctly
persists edges (UI-proven), Python `canvas_inspect` matches deck store (integration).

## Limitations

- **Deck content is a persistence boundary**, not a CBM graph fact. CBM indexes store
  code but not actual card/edge data. Verify at task time via `getDeckDocument`.
- **Bus connectivity is a deck-edge runtime property.** CBM confirms resolution code,
  not which cards have edges. Read the deck edges at task time.
- **Canvas UI** (AgentCanvasPane) is CBM-verified as function nodes. Selection, edge
  drawing, drag behavior are UI-proven, not graph-traversable.
- **Python MCP boundary** is a network call. CBM verifies the TypeScript call site,
  not the Python response shape or sidecar availability.

## Future agent load set

| File | Why |
|------|-----|
| `apps/backend/src/decks/store.ts` | Deck read/write, normalization, CAS |
| `apps/backend/src/decks/mainChatControllerCard.ts` | Main Chat card + bus edge |
| `apps/backend/src/routes/decks.routes.ts` | Deck GET/PUT endpoints |
| `apps/backend/src/cards/runtime.ts` (lines 86-112) | resolvedMagenticOptions |
| `apps/backend/src/services/mcp/pythonAgentMcpClient.ts` | Python MCP transport |
| `apps/python-models/app/control_plane.py` | canvas_inspect, skill/data binding |
| `client/src/features/agentbuilder/canvas/AgentCanvasPane.tsx` | Canvas React component |
| `client/src/runtime/agentCardRegistryResolver.ts` | Bus connections |