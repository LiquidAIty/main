---
id: feature.harness-to-local-coder
title: Main to Local Coder
kind: feature
status: working

roots:
  files:
    - apps/backend/src/cards/runtime.ts
    - apps/backend/src/routes/coder.routes.ts
    - apps/backend/src/coder/localcoder/service.ts
    - apps/backend/src/coder/localcoder/adapter.ts
    - apps/python-models/app/python_models/magentic_agentchat.py
    - apps/python-models/app/python_models/tool_registry.py
  symbols:
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

The saved Local Coder card is a normal single-card AutoGen participant and a Mag One-eligible worker.
Coder-card Run, Main/external GPT through `card.run_assistant_agent`, and Mag One all use the same
saved-card participant builder. For a `local_coder` participant, Python replaces the registered
controller tool with one `run_local_coder` FunctionTool bound to that card's saved provider/model.

`run_local_coder` transports only the bounded logical CoderPacket. The backend mints the run identity
and injects the trusted repository root, then `LocalCoderService` calls `LocalCoderAdapter`. Success
requires the OpenClaude process to return a schema-valid, packet-matched CoderReport.

Must remain true:

- the saved card identity, prompt, provider/model, tools, and AutoGen compatibility remain intact;
- the model cannot choose the repository root, run identity, provider, or model;
- OpenRouter/DeepSeek and OpenAI Account/Codex OAuth configure the same adapter;
- `run_coder_subagent` remains absent until a future Coder-launched dynamic-subagent design exists;
- no terminal transcript is converted into a fabricated CoderReport.

Focused proof:

```powershell
python -m pytest apps/python-models/app/python_models/test_run_local_coder.py apps/python-models/app/python_models/test_run_configured_card.py
vitest run src/cards/runConfiguredCard.spec.ts src/coder/localcoder/adapter.spec.ts
```

Unproven only when live credentials are unavailable: a paid provider call. Structural provider,
session, model, and CoderReport evidence must still be reported honestly.
