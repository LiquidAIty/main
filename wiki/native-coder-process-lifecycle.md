---
id: feature.native-coder-process-lifecycle
title: Native Coder Process Lifecycle
kind: feature
status: partial

roots:
  files:
    - apps/backend/src/coder/openclaude/console/consoleSession.ts
    - apps/backend/src/coder/execution/coderConsoleRuntime.ts
    - apps/backend/src/routes/coder.routes.ts
  symbols:
    - OpenClaudeConsoleSession
    - runOpenClaudeCodeTask
    - awaitSessionExit
---

# Native Coder Process Lifecycle

The interactive Coder console and Main-assigned Coder task use the same native OpenClaude session
manager. The console owns input, output, resize, native lifecycle events, and explicit Stop. A task
waits for native completion and validates its final CoderReport; no application execution timeout
terminates an active coding job.

Must remain true:

- one visible child process per session;
- explicit Stop targets only that session;
- a short post-Stop grace timer may settle the receipt, but never initiates Stop;
- no structured result is fabricated from terminal text;
- failures remain scoped to the child and do not terminate Main or Python MCP.

Focused proof:

```powershell
npx vitest run apps/backend/src/coder/execution/coderConsoleRuntime.spec.ts apps/backend/src/coder/openclaude/console/consoleSession.spec.ts apps/backend/src/routes/coder.routes.spec.ts
```
