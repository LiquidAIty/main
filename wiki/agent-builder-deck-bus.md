---
id: feature.agent-builder-deck-bus
title: Agent Builder Deck and Bus Connectivity
kind: feature
status: partial
proof_level: cbm_anchor_verified_and_source_verified

cbm:
  project_identity: C-Projects-LiquidAIty-main
  index_root: C:/Projects/LiquidAIty/main
  full_index_nodes: 3395
  full_index_edges: 9902
  freshness: ready

roots:
  files:
    - apps/backend/src/decks/store.ts
    - apps/backend/src/cards/runtime.ts
    - apps/backend/src/routes/decks.routes.ts
    - apps/backend/src/routes/coder.routes.ts
    - apps/backend/src/services/mcp/pythonAgentMcpClient.ts
    - apps/python-models/app/control_plane.py
    - client/src/features/agentbuilder/canvas/AgentCanvasPane.tsx
    - client/src/features/agentbuilder/rail/railVisibility.ts
  symbols:
    - getDeckDocument / getV3ProjectBlob / saveDeckDocument / writeV3ProjectBlobCas
    - parseDeckDocument / parseProjectBlob
    - resolvedMagenticOptions / buildBusConnectedCardIds / canvas_inspect
    - AgentCanvasPane
  tests:
    - agentbuilder.topology.spec.ts
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

**Reload/readback**: `getV3ProjectBlob` reads the PostgreSQL JSONB record and
validates only the deck envelope and required node/edge identities. It does not
rebuild cards, choose models, normalize tools, synthesize edges, or repair saved
state. Card positions, edges, prompt templates, and unknown future fields survive
reload exactly; malformed state fails clearly.

**Selected-card inspector**: clicking a card in `AgentCanvasPane` selects the
saved card already loaded from the deck. It does not maintain a second runtime identity.

**Bus**: an enabled card with a `magentic_option` edge from the orchestrator is
discoverable on the bus, including a card nested in a visual/workbench parent.
Discovery does not claim the card can execute. The backend separately validates
its saved model/runtime configuration and selected tools against the live Python
AutoGen tool manifest before including it in a run. No edge → disconnected →
invisible to Mag One.

**No-auto-broadcast**: cards never auto-join. Only explicit `magentic_option` edges
connect cards to the bus. The Main Chat prompt states: "You are not a worker."

## How it works

```
DB: agent_io_schema (JSONB, CAS via writeV3ProjectBlobCas)
  → getV3ProjectBlob → parseProjectBlob (structural validation, no rewriting)
  → getDeckDocument(projectId, deckId)
  → saveDeckDocument(projectId, exact deck) → writeV3ProjectBlobCas

Deck routes: GET /:projectId/decks, GET/PUT /:projectId/decks/:deckId [decks.routes.ts]

Bus (backend): resolvedMagenticOptions(orchestratorId, nodes, edges) [runtime.ts]
  → resolves the card at the opposite endpoint of each 'magentic_option' edge
  → CBM-path-proven (callers: describeConnectedAgents, runCardWithContract)

Bus (client): buildBusConnectedCardIds(nodes, edges) [railVisibility.ts]
  → derives presentation visibility from persisted magentic_option connectivity

Main Chat control edge: the persisted deck uses source='card_main_chat',
  target='card_magentic', edgeType='magentic_control', targetHandle='task-bus-top'.
```

## Must not break

1. Deck is sole authority — runtime reads from `getDeckDocument`/`canvas_inspect`,
   never from browser in-memory state.
2. Bus discovery is edge-driven — only `magentic_option` edges. Execution readiness
   is a separate structural/runtime validation; neither is inferred from prompt text.
3. Persistence validates structure but never repairs, normalizes, or invents saved
   cards, edges, models, tools, positions, or presentation fields.
4. Deck persistence is CAS — concurrent saves retry rather than silent overwrite.
5. `canvas_inspect` is read-only — never mutates deck state.

## Start in CBM

```
search_graph(project="C-Projects-LiquidAIty-main", query="getDeckDocument")
search_graph(project="C-Projects-LiquidAIty-main", query="parseDeckDocument")
search_graph(project="C-Projects-LiquidAIty-main", query="resolvedMagenticOptions")
search_graph(project="C-Projects-LiquidAIty-main", query="canvas_inspect")

trace_path(project="C-Projects-LiquidAIty-main", function_name="resolvedMagenticOptions",
           mode="calls", direction="inbound", depth=1)

index_status(project="C-Projects-LiquidAIty-main")
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
- **Execution readiness is not connectivity.** Read the live saved-card readiness
  fields (`executionReady`, `readinessState`, `readinessReason`) before launching.
- **Canvas UI** (AgentCanvasPane) is CBM-verified as function nodes. Selection, edge
  drawing, drag behavior are UI-proven, not graph-traversable.
- **Python MCP boundary** is a network call. CBM verifies the TypeScript call site,
  not the Python response shape or Python rails availability.

## Future agent load set

| File | Why |
|------|-----|
| `apps/backend/src/decks/store.ts` | Exact deck read/write, structural validation, CAS |
| `apps/backend/src/routes/decks.routes.ts` | Deck GET/PUT endpoints |
| `apps/backend/src/cards/runtime.ts` (lines 86-112) | resolvedMagenticOptions |
| `apps/backend/src/services/mcp/pythonAgentMcpClient.ts` | Python MCP transport |
| `apps/python-models/app/control_plane.py` | canvas inspection and saved-card execution |
| `client/src/features/agentbuilder/canvas/AgentCanvasPane.tsx` | Canvas React component |
| `client/src/features/agentbuilder/rail/railVisibility.ts` | Canvas connectivity presentation |
