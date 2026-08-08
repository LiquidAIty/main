---
id: feature.native-coder-process-lifecycle
title: Native Coder Process Lifecycle
kind: feature
status: working

roots:
  files:
    - apps/backend/src/coder/openclaude/console/consoleSession.ts
    - apps/backend/src/coder/localcoder/adapter.ts
    - apps/backend/src/coder/localcoder/service.ts
    - apps/backend/src/routes/coder.routes.ts
  symbols:
    - OpenClaudeConsoleSession
    - LocalCoderAdapter
    - LocalCoderService
---

# Native Coder Process Lifecycle

There are two useful surfaces over the canonical OpenClaude coding harness:

- the persistent interactive console owns PTY input/output, resize, interrupt, stop, and session
  lifecycle;
- the saved Local Coder card owns bounded non-interactive CoderPacket execution and validated
  CoderReport output.

They share OpenClaude runtime discovery but are not alternate execution authorities for the same
request. The retired direct-terminal task engine is absent. Main reaches the saved Local Coder card
through the generic connected-card subagent doorway in the OpenClaude Harness; there is no separate
Coder-specific Main execution tool.

Must remain true:

- one visible child process per interactive console session;
- explicit Stop targets only that interactive session;
- Local Coder runs in the server-owned repository root and returns only a validated CoderReport;
- both use OpenClaude's supported `openai` CLI dialect; endpoint and credential binding select
  OpenRouter/API-key or OpenAI Account/Codex OAuth, with no invented `codex` CLI provider;
- failures remain scoped and never terminate Main or Python MCP.

Focused proof:

```powershell
vitest run src/coder/openclaude/console/consoleSession.spec.ts src/coder/localcoder/adapter.spec.ts src/routes/coder.routes.spec.ts
```
