# LocalCoder Boundary

`localcoder/` is a vendored OpenClaude-derived runtime and is intentionally excluded from
LiquidAIty's Codebase Memory index. Full vendored LocalCoder source must not be indexed or edited
unless a future active CoderPacket explicitly targets vendored runtime work.

LiquidAIty has two active, distinct OpenClaude/LocalCoder boundaries:

1. The persistent gRPC Harness session used by Main Chat and the interactive OpenClaude console/PTY.
2. The bounded one-shot Local Coder card/tool path through the backend-owned CLI/process adapter.

The one-shot adapter boundary is:

* `apps/backend/src/coder/localcoder/adapter.ts`
* `apps/backend/src/coder/localcoder/service.ts`
* `apps/backend/src/contracts/coderContracts.ts`
* `apps/backend/src/routes/coder.routes.ts`

The CLI/process adapter accepts a validated CoderPacket, applies explicit permission mode, invokes
the configured OpenClaude command, and validates the returned CoderReport. It must not replace or
hide the persistent terminal/session path.

LocalCoder's gRPC `AgentService.Chat` is already the persistent Main Chat transport through
`apps/backend/src/coder/openclaude/session/grpcChatClient.ts`. It is not the one-shot adapter.
The user-facing layout intent is OpenClaude Code below Main Chat; Hermes has its own terminal/UI
after a real Hermes process boundary is integrated.
