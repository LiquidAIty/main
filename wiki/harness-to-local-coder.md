---
id: feature.harness-to-local-coder
title: Main to System Coder
kind: feature
status: partial

roots:
  files:
    - apps/backend/src/routes/coder.routes.ts
    - apps/backend/src/coder/execution/coderConsoleRuntime.ts
    - apps/backend/src/coder/execution/coderRuntimeContract.ts
    - apps/python-models/app/python_models/tool_registry.py
  symbols:
    - runOpenClaudeCodeTask
    - resolveEffectiveCoderToolSnapshot
    - run_local_coder
  routes:
    - POST /api/coder/run-coder-subagent
---

# Main to System Coder

Main may assign approved coding work to the saved System Coder card. The backend resolves the
card-selected model and tools, starts the existing visible OpenClaude task session, and returns only
native process evidence plus a validated CoderReport. The process runs until native completion or
explicit cancellation; LiquidAIty does not impose an execution deadline.

Must remain true:

- the saved card is model/tool authority;
- the repository root and run identity are server-owned;
- no second Coder or model fallback is used;
- explicit Stop cancels the same visible process;
- missing or malformed structured output is an honest failed run;
- CodeGraph access is the native CBM MCP selected for the System Coder.

Focused proof:

```powershell
npx vitest run apps/backend/src/coder/execution/coderConsoleRuntime.spec.ts apps/backend/src/coder/execution/coderRuntimeContract.spec.ts apps/backend/src/routes/coder.routes.spec.ts
```

Unproven: a paid end-to-end model run and the final below-chat presentation.
