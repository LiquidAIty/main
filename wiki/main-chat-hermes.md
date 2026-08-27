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

Main, Coder, and Kanban are three saved Cards served by the repo-owned Hermes ACP adapter, with a
reused process owner per native profile. They have separate homes, Card identity, sessions, memory,
prompts, models, and grant ceilings. Do not collapse their memory into one shared home.

```text
Main Chat (liquidaity-main)
├─ flow → Coder (coder)
├─ flow → Kanban (liquidaity-hermes-steward)
└─ magentic_control → Magentic-One
```

The backend owns conversation/Run/correlation identity and transports one Python-materialized Card call.
Hermes-native delegation may choose only saved connected Cards supplied by the host. Missing Cards,
relationships, tools, profiles, models, or credentials fail without fallback.

The Coder terminal is a backend-owned Hermes terminal beneath Chat. `card_local_coder` is a stable
persistence ID only; no LocalCoder/OpenClaude runtime exists.

The Card Terminal tab holds Main's technical events without adding them to chat. Coder invocation
focuses the existing external Code Console's attributed Card Run view; its interactive native CLI
session remains distinct. Both views reuse existing owners and do not start a second Card Run.

## Proof

- backend Main adapter/session/profile/memory tests;
- Coder terminal lifecycle tests;
- saved topology and runtime-binding tests;
- exact retained-`in.idf` inspection/reload/transport tests;
- one separately approved live Main → Coder proof with child Run and AGE lineage.

## Limitations

The final item is not yet proven end to end. Do not infer it from source wiring or mocks.
