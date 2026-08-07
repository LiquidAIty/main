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
request. The retired direct-terminal task engine is absent. Main's external MCP tool named
`run_coder_subagent` is valid only because it is a thin saved-card delegation doorway into
`runConfiguredCard`; it does not own or launch an alternate terminal/session path.

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
