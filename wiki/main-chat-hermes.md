---
id: feature.main-chat-hermes
status: current-structural-live-model-proof-pending
owners:
  - apps/backend/src/hermes/mainAdapter.ts
  - apps/backend/src/routes/coder.routes.ts
  - client/src/components/builder/BuilderChat.tsx
  - client/src/features/agentbuilder/console/CoderTerminalPanel.tsx
cbm_anchors:
  - createMainSession
  - runHermesCardTurn
  - CoderTerminalSession
---

# Main Chat and native Hermes specialists

Main, Agent Builder, Local Coder, and Kanban are four saved Cards served by the repo-owned Hermes ACP
adapter, with a reused process owner per native profile. They have separate homes, Card identity,
sessions, memory, prompts, models, and grant ceilings. Do not collapse their memory into one shared home.

```text
Main Chat (liquidaity-main)
├─ flow → Agent Builder (liquidaity-agent-builder)
├─ flow → Kanban (liquidaity-hermes-steward)
└─ magentic_control → Magentic-One
   └─ magentic_option → Local Coder (coder)
```

The backend owns conversation/Run/correlation identity and transports one Python-materialized Card call.
Hermes-native delegation may choose only saved connected Cards supplied by the host. Missing Cards,
relationships, tools, profiles, models, or credentials fail without fallback.

Main Chat does not expose conversation IDs, New chat, a picker, or URL-driven conversation swapping.
Existing conversation links are resolved once on mount; project-scoped native history remains internal.
This presentation change does not repair Coder Run correlation, session locks, cancellation or recovery.

The existing Local Coder terminal is backend-owned. `card_local_coder` remains its saved identity;
no standalone LocalCoder/OpenClaude runtime exists. Agent Builder has a separate saved profile and
future native sessions/Runs; native Main ACP-to-existing-PTY attachment remains a separate blocker.

The Card Terminal tab holds Main's technical events without adding them to chat. Coder invocation
focuses the existing external Code Console's attributed Card Run view; its interactive native CLI
session remains distinct. Both views reuse existing owners and do not start a second Card Run.

## Proof

- backend Main adapter/session/profile/memory tests;
- Coder terminal lifecycle tests;
- saved topology and runtime-binding tests;
- exact retained-`in.idf` inspection/reload/transport tests;
- one separately approved live Main → Agent Builder proof with child Run and AGE lineage.

## Limitations

The final item is not yet proven end to end. Do not infer it from source wiring or mocks.
