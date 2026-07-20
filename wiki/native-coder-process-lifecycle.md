---
id: feature.native-coder-process-lifecycle
title: Native Coder Process Lifecycle
kind: feature
status: partial
proof_level: cbm_anchor_verified_and_source_verified

cbm:
  project_identity: C-Projects-main
  index_root: C:/Projects/main
  full_index_nodes: 5472
  full_index_edges: 17093
  freshness: ready

roots:
  files:
    - apps/backend/src/coder/localcoder/adapter.ts
    - apps/backend/src/coder/localcoder/service.ts
    - apps/backend/src/routes/coder.routes.ts
    - apps/backend/src/coder/openclaude/session/grpcChatClient.ts
    - apps/backend/src/coder/openclaude/console/consoleSession.ts
    - apps/backend/src/cards/runtime.ts
    - apps/python-models/app/python_models/tool_registry.py
    - apps/python-models/app/python_models/magentic_agentchat.py
  symbols:
    - runChildProcess
    - runWithDiagnostics
    - LocalCoderService.run
    - startGrpcTurn
    - runConfiguredCard
    - defaultSpawn
    - discoverRuntime
    - parseLocalCoderOutput
    - applyProcessDiagnostics
  routes:
    - POST /api/coder/localcoder/run
    - POST /openclaude/console/sessions
  tests:
    - adapter.spec.ts
    - consoleSession.spec.ts
---

# Native Coder Process Lifecycle

## What this is

The two native Coder process lifecycles that currently coexist by design:

1. Persistent Main Chat and interactive OpenClaude console sessions.
2. A bounded one-shot Local Coder CLI run that returns a validated CoderReport.

They share OpenClaude/LocalCoder technology but are not one continuous request path and must not
be collapsed into a replacement abstraction.

## What the user/agent experiences

Main Chat streams through the persistent gRPC Harness. The interactive Code Console uses a
long-lived PTY session with input, output, resize, and stop. Separately, a Local Coder card/tool
request spawns a bounded CLI process, waits up to five minutes, validates the CoderReport from
stdout, cleans up its temporary MCP file, and returns the result. The one-shot run has no
intermediate CoderReport streaming.

## How it works

```
Lifecycle stages (LocalCoderRuntimeStage):           [adapter.ts:102]
  preflight → prompt_bounds → process_not_started →
  process_timeout → process_exit_failed →
  json_parse → coder_report_validation → completed

Persistent Main Chat (separate):
  Browser SSE → POST /openclaude/session/chat        [coder.routes.ts]
    → startGrpcTurn → gRPC AgentService.Chat stream

One-shot Local Coder request:
  run_local_coder tool or POST /api/coder/localcoder/run
    → localCoderService.run → adapter.runWithDiagnostics

One-shot adapter:
  → discoverRuntime → prepareMcpConfig (temp file)

One-shot spawn:
  runChildProcess(command, args, options)             [adapter.ts:241]
    → spawn(command, args, { cwd, env, shell, stdio: ['ignore','pipe','pipe'] })
    → timeout = 300s → on close → finish(exitCode, stdout, stderr)
    → timeout → child.kill() → 5s kill fallback → finish

One-shot parse:
  parseLocalCoderOutput(stdout, packetId)             [adapter.ts:488]
    → JSON.parse → try structured_output/result/output/envelope
    → coderReportSchema validation + coderPacketId match

One-shot cleanup:
  unlinkSync(mcp.tempPath) (best-effort)              [adapter.ts:1061]
  applyProcessDiagnostics(runtimeDiagnostics, result) [adapter.ts:575]
  → CoderReport returned up the chain

Console session (long-lived, separate):
  POST /openclaude/console/sessions                  [coder.routes.ts:323]
    → consoleSessionManager.start() → defaultSpawn
    → SSE: /console/sessions/:id/stream → Input: /:id/input → Stop: /:id/stop
```

## Must not break

1. runChildProcess always settles — timeout + 5s kill fallback guarantee a finish()
   call. No hanging promise from the spawn path.
2. parseLocalCoderOutput never fabricates a report — only a valid coderReportSchema
   object with matching coderPacketId is accepted.
3. MCP config temp file is deleted after the run (best-effort unlinkSync).
4. Console sessions track their child process and expose stop/input/resize.
5. Non-interactive (print/task) sessions ignore stdin — no accidental blocking on
   a process waiting for input.
6. runWithDiagnostics stages are linear — each stage sets runtimeDiagnostics.runtimeStage
   so the exact failure point is recorded.

## Start in CBM

```
search_graph(project="C-Projects-main", query="runChildProcess")
search_graph(project="C-Projects-main", query="runWithDiagnostics")
search_graph(project="C-Projects-main", query="parseLocalCoderOutput")
search_graph(project="C-Projects-main", query="defaultSpawn")
search_graph(project="C-Projects-main", query="LocalCoderRuntimeStage")

trace_path(project="C-Projects-main", function_name="startGrpcTurn",
           mode="calls", direction="inbound", depth=1)

index_status(project="C-Projects-main")
```

## Valid proof

```typescript
// Proves: runChildProcess settles within timeout
import { runChildProcess } from './adapter';
const result = await runChildProcess('node', ['-e', 'console.log("hello")'], {
  cwd: '.', env: process.env, timeoutMs: 5000,
});
assert(result.started === true);
assert(result.exitCode === 0);
assert(result.stdout.includes('hello'));
```

Proves: subprocess spawns, collects stdout, exits with success code (contract-test-proven).
Does not prove: full LocalCoderAdapter chain (runtime discovery, MCP config, schema
validation), real OpenClaude subprocess lifecycle or cancellation propagation or
no-orphan behavior (source-verified; runtime proof required).

## Limitations

- **No cancellation propagation.** `runChildProcess` has no abort signal or cancellation
  mechanism from the caller. If the gRPC turn is cancelled (Harness close event), the
  running subprocess is orphaned until its timeout fires.
- **No intermediate streaming.** The model waits for the full 300s timeout. No SSE
  events or partial results flow back during the run.
- **MCP config cleanup is best-effort.** `unlinkSync` in a try/catch — a failed delete
  is silently ignored.
- **trace_path does not resolve adapter.ts methods.** `runChildProcess`,
  `runWithDiagnostics`, `parseLocalCoderOutput` (simple names) return no callers via
  trace_path. The lifecycle chain is source-verified from the adapter.ts file.
- **Console session stop** is graceful (`.stop()` on the session object). No evidence
  of forced SIGKILL if the process ignores the stop signal.

## Future agent load set

| File (all in apps/backend/src/) | Why |
|------|-----|
| `coder/localcoder/adapter.ts` (241-314, 488-538, 949-1128) | Spawn, parse, full lifecycle |
| `coder/localcoder/service.ts` | runWithDiagnostics orchestration |
| `coder/openclaude/console/consoleSession.ts` (180-194) | defaultSpawn |
| `coder/openclaude/session/grpcChatClient.ts` (308-400) | startGrpcTurn |
