---
id: feature.main-chat-harness-controller
title: Main Chat / Harness Controller
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
    - apps/backend/src/coder/openclaude/session/grpcChatClient.ts
    - apps/backend/src/coder/openclaude/mcp/liquidAItyAgentFlow.ts
    - apps/backend/src/cards/runtime.ts
    - client/src/features/agentbuilder/console/HarnessChatPanel.tsx
    - client/src/features/agentbuilder/console/consoleVisibility.ts
    - client/src/runtime/agentCardRegistryResolver.ts
  symbols:
    - selectDoorwayCards
    - buildHarnessAgentDefinition
    - resolveMainChatCardFromDeck
    - resolveMainChatRuntimeConfig
    - startGrpcTurn
    - describeConnectedAgents
    - runMagOne
    - resolvedMagenticOptions
    - isLocalCoderCard
    - resolveBusConnections
  routes:
    - POST /openclaude/session/chat
    - POST /mcp-bridge/describe_connected_agents
    - POST /mcp-bridge/run_mag_one
---

# Main Chat / Harness Controller

## What this is

The front door of LiquidAIty. When a user opens the chat panel in the Agent Canvas builder,
the Harness Controller resolves the persisted Main Chat card from the deck, establishes a
persistent gRPC session with the native QueryEngine, surfaces specialist doorways
  (Local Coder), and registers Hermes directly as an inherited-context native Agent. Main reads
and writes ThinkGraph directly; Hermes reads it itself and owns one evolving Inspector report.
Main also owns the user-approved Mag One submission entry point.

## What the user/agent experiences

**Chat**: user types → SSE stream to `POST /openclaude/session/chat` → gRPC Chat turn.
The chat model receives the saved Main Chat prompt plus specialist doorway definitions.

**Agents**: Local Coder retains the bound `CARD_RUN_CONTROL_TOOL` doorway. Hermes is different:
its saved prompt/model/tools become the native Agent definition, it inherits the full parent
conversation, and may receive a short scoped outcome. It reads ThinkGraph, conditionally uses its
Search child/KnowGraph/CodeGraph, and revises the active report without user approval.

**Mag One**: Hermes prepares `prompt.md` only when Main requests a Run Plan. Main presents it;
`run_mag_one` is allowed only after user acceptance and requires Main's live `magentic_control`
edge. Workers resolve solely from `magentic_option` side edges.

## How it works

```
Browser → SSE POST /openclaude/session/chat  [coder.routes.ts:185]
  → deriveSessionId → startGrpcTurn           [grpcChatClient.ts:308]
    → gRPC AgentService.Chat() stream
    → forwards text/tool_start/tool_result/progress events verbatim

MainChatRuntimeConfig resolved per turn:       [grpcChatClient.ts:235]
  → getDeckDocument → resolveMainChatCardFromDeck [grpcChatClient.ts:206]
    → exactly one card with runtimeBinding='main_chat'
  → reads modelKey, prompt from card → resolveModel() from models.config
  → selectDoorwayCards(nodes, mode)            [grpcChatClient.ts:142]
    → enabled, top-level, kind=agent, runtimeType in [assistant_agent,local_coder],
      binding !== 'main_chat'
    → chat: ≤1 Local Coder + ≤1 Hermes
  → buildHarnessAgentDefinition(card)
    → Hermes: saved prompt/model + native read tools + inherit_parent
    → other cards: doorway with when_to_use + CARD_RUN_CONTROL_TOOL
  → returns { cardId, prompt, modelKey, doorwayDefinitions, ... }

Mag One (separate MCP-bridge endpoints):
  describe_connected_agents                   [liquidAItyAgentFlow.ts:60]
    → find orchestrator (magentic_one)
    → resolvedMagenticOptions(orchestrator.id, nodes, edges)
    → returns only magentic_option-connected cards
  run_mag_one
    → require exactly one live Main magentic_control edge
    → read the existing handoff/<jobId>/prompt.md
    → resolve live worker options → runCardWithContract
    → orchestrateWithAutoGen
```

## Must not break

1. Exactly one `main_chat` card — zero or multiple yields honest degrade (no doorways).
2. Doorway selection is structural (binding, runtimeType, enabled) — never by display name.
3. Chat mode: at most one Local Coder + one Hermes. Main owns ThinkGraph reads/writes directly.
4. `when_to_use` text is keyed on saved binding, not card title.
5. Mag One only sees cards with `magentic_option` edges from the orchestrator.
6. Deck is sole authority for card config — no caller overrides.
7. Hermes always inherits parent context; an optional short prompt scopes an outcome but is never a mandatory node-anchor packet.
8. Hermes may research, ingest qualified evidence, inspect code, revise its report, and prepare a requested Run Plan without user approval.
9. Only Mag One/Coder execution is user-gated; `run_mag_one` additionally requires Main's `magentic_control` edge.
8. UTF-8 survives gRPC and SSE chunk boundaries exactly.

## Start in CBM

```
search_graph(project="C-Projects-main", query="selectDoorwayCards")
search_graph(project="C-Projects-main", query="resolveMainChatCardFromDeck")
search_graph(project="C-Projects-main", query="describeConnectedAgents")
search_graph(project="C-Projects-main", query="resolvedMagenticOptions")

# trace_path uses simple function names:
trace_path(project="C-Projects-main", function_name="startGrpcTurn",
           mode="calls", direction="inbound", depth=1)
trace_path(project="C-Projects-main", function_name="selectDoorwayCards",
           mode="calls", direction="inbound", depth=1)

# Freshness:
index_status(project="C-Projects-main")
```

## Valid proof

```typescript
const response = await fetch('/api/coder/openclaude/session/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ projectId: 'proj-1', message: 'hello' }),
});
assert(response.status === 200);
assert(response.headers.get('Content-Type') === 'text/event-stream');
```

Proves: Harness route accepts chat turns and streams SSE events. Does not prove:
gRPC QueryEngine is running (requires the live gRPC harness), doorway definitions correctly
surface (requires runtime observation).

## Limitations

- **Deck is a runtime boundary, not a CBM graph fact.** The `main_chat` card's binding,
  model key, and prompt are in the deck document at runtime. CBM indexes the code that
  reads the deck, not the deck content. Verify at task time via `getDeckDocument`.
- **Route→handler edges are not in CBM graph.** The chat handler at `coder.routes.ts:185`
  is a source-level link, not a CBM graph edge.
- **Mag One exclusion** is a deck-edge property (`magentic_option` edge presence), not
  a source-code filter. Verify by reading the deck edges at runtime.
- **Client-side React** (HarnessChatPanel, consoleVisibility) is CBM-verified as
  function nodes, but UI behavior (drag, SSE consumption) is not graph-traversable.

## Future agent load set

| File | Why |
|------|-----|
| `grpcChatClient.ts` | Harness session, native Hermes + doorway selection, runtime config |
| `coder.routes.ts` (lines 185-255) | Harness chat SSE route |
| `liquidAItyAgentFlow.ts` | Mag One describe + run |
| `runtime.ts` (lines 86-112) | resolvedMagenticOptions |
| `consoleVisibility.ts` | Terminal rail visibility rules |
| `agentCardRegistryResolver.ts` | Bus connection resolution |
