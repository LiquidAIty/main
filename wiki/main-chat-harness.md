---
id: feature.main-chat-hermes-controller
title: Main Chat / Hermes Controller
kind: feature
status: working
proof_level: source_tests_and_live_runtime

cbm:
  project_identity: C-Projects-main
  index_root: C:/Projects/main
  freshness: task_entry_live_counts_recorded_elsewhere

roots:
  files:
    - apps/backend/src/hermes/mainAdapter.ts
    - apps/backend/src/routes/coder.routes.ts
    - apps/backend/src/cards/runtime.ts
    - client/src/features/agentbuilder/console/mainSessionClient.ts
    - client/src/features/agentbuilder/console/useAgentBuilderMainChat.ts
    - client/src/features/agentbuilder/deck/newProjectDeck.ts
  symbols:
    - resolveMainHermesRuntimeConfig
    - resolveHermesCardRuntimeConfig
    - deriveHermesSessionKey
    - startHermesTurn
    - runConfiguredCard
    - resolvedMagenticOptions
  routes:
    - POST /api/coder/main/session/chat
    - POST /api/coder/main/session/answer
    - GET /api/coder/main/session/history
    - GET /api/coder/main/session/conversations
---

# Main Chat / Hermes Controller

## What this is

Main Chat executes through one persistent repo-owned Hermes ACP process. The saved `main_chat` card
owns its prompt, profile, provider/model, tool grants, and topology. A stable project/conversation/card
key selects the Hermes session; the backend preserves SSE, durable transcript/run persistence,
permissions, cancellation, and honest failures.

The familiar three-card functional topology remains:

```text
Main Chat (Hermes)
├─ flow → Coder (OpenClaude/LocalCoder)
├─ flow → Hermes Kanban (second Hermes ACP session)
└─ magentic_control → Mag One top control
```

Main receives Engraphis and explicit canvas/control grants. Coder receives only its coding surface and
native CBM. Hermes Kanban receives Graphiti/KnowGraph grants and keeps the existing native Kanban
workspace. Card IDs and positions remain stable; the obsolete Search card is absent from the new-project
deck.

## How it works

```text
browser → POST /api/coder/main/session/chat
→ resolveMainHermesRuntimeConfig(projectId)
→ exact saved Main card + direct saved flow children
→ startHermesTurn through Hermes/venv/Scripts/hermes-acp.exe
→ role-filtered Python MCP child with saved grants
→ text/reasoning/tool/permission events over existing SSE
→ durable completion/failure record
```

The saved `card_hermes_steward` binding enters the same ACP adapter through `runConfiguredCard`, but
uses its own saved policy and session key. It is not generic AutoGen and not another Main transcript.

## Must not break

1. Exactly one saved `main_chat` card resolves; missing/duplicate config fails honestly.
2. Saved card prompt/profile/provider/model/grants remain authoritative.
3. Direct subagents come only from explicit enabled top-level `flow` edges.
4. Main can invoke Coder and Hermes Kanban; it does not gain arbitrary cards.
5. Main retains the one existing top `magentic_control` edge and is not a Mag One worker.
6. OpenClaude remains the under-chat terminal and bounded CoderReport executor.
7. No OpenClaude Main gRPC fallback, second Hermes owner, PATH/AppData fallback, or direct CBM database access.
8. UTF-8, persistence, permission answers, cancellation, and SSE terminal events remain intact.

## Start in CBM

```text
search_graph(project="C-Projects-main", query="resolveMainHermesRuntimeConfig")
search_graph(project="C-Projects-main", query="startHermesTurn")
trace_path(project="C-Projects-main", function_name="startHermesTurn",
           mode="calls", direction="inbound", depth=2)
search_graph(project="C-Projects-main", query="runConfiguredCard")
```

## Valid proof

- focused backend route, Hermes adapter, configured-card, Coder adapter, console, and Kanban tests;
- focused client Main session/deck/topology tests;
- backend and client typecheck/build;
- live two-turn ACP with one PID/session and prior-turn recall;
- live cancellation returning `hermes_turn_cancelled`;
- inverse traversal proving the retired `grpcChatClient` and `/openclaude/session` route are absent.

## Limitations / next round

- Source deck changes do not rewrite existing persisted decks; verify or intentionally migrate a selected
  saved project separately.
- Main→real Mag One end-to-end execution and graph activity visualization remain separate proof work.
- Profile tuning, visual polish, and replacing the CLI-shaped Kanban bridge with its authenticated API
  are deferred until the functional path is used and measured.
