---
id: feature.harness-to-local-coder
title: Main to Local Coder
kind: feature
status: working

roots:
  files:
    - apps/backend/src/coder/openclaude/session/grpcChatClient.ts
    - apps/backend/src/cards/runtime.ts
    - apps/backend/src/routes/coder.routes.ts
    - apps/backend/src/coder/localcoder/service.ts
    - apps/backend/src/coder/localcoder/adapter.ts
    - apps/python-models/app/python_models/magentic_agentchat.py
    - apps/python-models/app/python_models/tool_registry.py
  symbols:
    - buildHarnessAgentDefinition
    - selectDoorwayCards
    - runConfiguredCard
    - runCardWithContract
    - _build_participants
    - build_local_coder_tool
    - run_local_coder
  routes:
    - POST /api/coder/mcp-bridge/run_configured_card
    - POST /api/coder/localcoder/run
---

# Main to Local Coder

The saved Local Coder card is an independently runnable card and remains compatible with native
AutoGen/Mag One for later testing. Mag One-to-Coder is not a current product requirement or MVP gate.

Coder-card Run enters `runConfiguredCard`. Main discovers the same saved Local Coder card through its
visible `flow` wire and presents it to the OpenClaude Harness through the generic saved-card subagent
doorway used for connected cards. That doorway runs the bound card through the normal configured-card
executor; it does not expose a separate Coder-specific Main tool or own another process, terminal,
provider, model, tool set, or repository root. For the `local_coder` runtime binding, Python uses an
AutoGen-compatible Local Coder runtime participant that invokes exactly one
`run_local_coder` FunctionTool bound to the saved card's provider/model. This avoids an extra Python
model call while preserving the participant contract needed by future Mag One runs.

`run_local_coder` transports only the bounded logical CoderPacket. The backend mints the run identity
and injects the trusted repository root, then `LocalCoderService` calls `LocalCoderAdapter`. Success
requires the OpenClaude process to return a schema-valid, packet-matched CoderReport.

Must remain true:

- the saved card identity, prompt, provider/model, tools, and AutoGen compatibility remain intact;
- Main reaches Coder only through the generic connected saved-card subagent doorway;
- the model cannot choose the repository root, run identity, provider, or model;
- OpenRouter/DeepSeek and OpenAI Account/Codex OAuth configure the same adapter;
- future temporary workers created by Coder are a separate nested subagent level;
- Mag One eligibility is preserved for later testing, not treated as current launch proof;
- no terminal transcript is converted into a fabricated CoderReport.

Focused proof:

```powershell
python -m pytest apps/python-models/app/python_models/test_run_local_coder.py apps/python-models/app/python_models/test_run_configured_card.py
vitest run src/cards/runConfiguredCard.spec.ts src/coder/localcoder/adapter.spec.ts
```

Unproven only when live credentials are unavailable: a paid provider call. Structural provider,
session, model, and CoderReport evidence must still be reported honestly.
