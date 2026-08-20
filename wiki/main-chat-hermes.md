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

Main, Coder, and Kanban are three saved Cards served by the one repo-owned Hermes ACP runtime. They
have separate Card identity, profile, session, memory, prompt, model, and grant ceilings.

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

## Proof

- backend Main adapter/session/profile/memory tests;
- Coder terminal lifecycle tests;
- saved topology and runtime-binding tests;
- exact transient-input preview/transport tests;
- one separately approved live Main → Coder proof with child Run and AGE lineage.

## Limitations

The final item is not yet proven end to end. Do not infer it from source wiring or mocks.
