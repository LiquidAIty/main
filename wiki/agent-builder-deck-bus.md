---
id: feature.agent-builder-deck-bus
title: Agent Builder Deck and Bus Connectivity
kind: feature
status: partial
proof_level: cbm_anchor_verified_and_source_verified

cbm:
  project_identity: C-Projects-LiquidAIty-main
  index_root: C:/Projects/LiquidAIty/main
  freshness: task_entry_live_counts_recorded_elsewhere

roots:
  files:
    - apps/backend/src/decks/store.ts
    - apps/backend/src/routes/decks.routes.ts
    - apps/backend/src/routes/coder.routes.ts
    - apps/python-models/app/python_models/card_domain.py
    - apps/python-models/app/control_plane.py
    - client/src/features/agentbuilder/canvas/AgentCanvasPane.tsx
    - client/src/features/agentbuilder/rail/railVisibility.ts
  symbols:
    - getDeckDocument / saveDeckDocument
    - load_deck / save_deck / describe_magentic_agents
    - buildBusConnectedCardIds / canvas_inspect
    - AgentCanvasPane
  tests:
    - agentbuilder.topology.spec.ts
    - runtime.spec.ts
---

# Agent Builder Deck and Bus Connectivity

## What this is

The Agent Canvas edits one Project-owned Deck. Relational PostgreSQL owns Deck,
Card revision, grant, facet, membership, and React Flow layout state. AgentGraph/AGE owns
the accepted user-authored Card relationships.
The "bus" is a `magentic_option` edge that connects orchestrator (Mag One) and
Main Chat to worker cards. Frontend and backend read the same deck edges to
determine which cards participate in multi-agent work.

## What the user/agent experiences

Main owns the Chat conversation. In the approved Agent Builder interaction it proposes agents,
obtains user agreement and directs the existing Coder beneath Chat to compose reusable IDD objects
from templates or create custom Cards. IDD is builder data, not another agent or runtime.
The guided conversation is not yet live-proven. No saved Card/profile/prompt is changed by loading
the palette; ordinary model Runs never receive the full dictionary.

**Canvas editing**: user adds Cards, draws edges, and sets tools/models. Changes
travel through thin TypeScript Deck transport to Python `save_deck`; relational
Card/layout writes and required AgentGraph/AGE topology writes succeed together or fail.

**Reload/readback**: Python reconstructs `nodes[]` from relational Card/layout
authority and `edges[]` from AgentGraph/AGE. It does not infer, seed, normalize, or recreate
relationships from Card profiles, Hermes, AutoGen, or startup templates.

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
DB: relational Project → agent_decks → agent_cards/revisions/grants/facets/layout
AgentGraph/AGE: FLOW / MAGENTIC_OPTION / MAGENTIC_CONTROL relationship instances
  → Python load_deck reconstructs the unchanged Deck transport document
  → getDeckDocument(projectId, deckId)
  → saveDeckDocument(projectId, exact deck) → Python save_deck

Deck routes: GET /:projectId/decks, GET/PUT /:projectId/decks/:deckId [decks.routes.ts]

Bus (Python): describe_magentic_agents(projectId, deckId) [card_domain.py]
  → resolves exact enabled assistant Cards at AgentGraph/AGE `magentic_option` edges

Bus (client): buildBusConnectedCardIds(nodes, edges) [railVisibility.ts]
  → derives presentation visibility from persisted magentic_option connectivity

Main Chat control edge: the persisted deck uses source='card_main_chat',
  target='card_magentic', edgeType='magentic_control', targetHandle='task-bus-top'.
```

## Must not break

1. PostgreSQL stable Card state plus AgentGraph/AGE topology are the authorities; runtime
   reads the reconstructed Deck through Python, never browser-only state.
2. Bus discovery is edge-driven — only `magentic_option` edges. Execution readiness
   is a separate structural/runtime validation; neither is inferred from prompt text.
3. Persistence validates structure but never repairs, normalizes, or invents saved
   cards, edges, models, tools, positions, or presentation fields.
4. Deck persistence uses expected revision and rejects stale concurrent saves.
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
