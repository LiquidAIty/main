# LocalCoder Boundary

`localcoder/` is a vendored OpenClaude-derived runtime and is intentionally excluded from
LiquidAIty's Codebase Memory index. Full vendored LocalCoder source must not be indexed or edited
unless a future active CoderPacket explicitly targets vendored runtime work.

LiquidAIty currently invokes LocalCoder/OpenClaude Code through its backend-owned CLI/process
adapter. The active control-plane boundary is:

* `apps/backend/src/coder/localcoder/adapter.ts`
* `apps/backend/src/coder/localcoder/service.ts`
* `apps/backend/src/contracts/coderContracts.ts`
* `apps/backend/src/routes/coder.routes.ts`

The CLI/process adapter accepts a validated CoderPacket, applies explicit permission mode, invokes
the configured OpenClaude command, and validates the returned CoderReport.

LocalCoder's gRPC `AgentService.Chat` exists only as a possible future streaming interface. It is
not wired by the current LiquidAIty backend adapter, and this boundary does not authorize wiring
it.
