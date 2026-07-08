---
id: feature.native-coder-process-lifecycle
title: Native Coder Process Lifecycle
kind: feature
status: partial
proof_level: cbm_anchor_verified_and_source_verified

cbm:
  project_identity: C-Projects-main
  index_root: C:/Projects/main
  full_index_nodes: 5273
  full_index_edges: 10327
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

The end-to-end lifecycle of a native Coder subprocess, from the browser SSE request
through the Harness, Python control plane, adapter spawn, process execution, MCP child
management, cancellation, cleanup, and return artifact finalization.

## What the user/agent experiences

A coding task is requested (via chat doorway, card run, or console session). The backend
spawns a native Coder (OpenClaude CLI) process, pipes stdout/stderr, waits up to 5
minutes for it to complete, parses the CoderReport from stdout, cleans up temporary
files, and returns the result. Intermediate streaming does not exist — the model waits
for the final CoderReport.

## How it works

```
Lifecycle stages (LocalCoderRuntimeStage):           [adapter.ts:102]
  preflight → prompt_bounds → process_not_started →
  process_timeout → process_exit_failed →
  json_parse → coder_report_validation → completed

Stage 1 — Request:
  Browser SSE → POST /openclaude/session/chat        [coder.routes.ts:185]
    → startGrpcTurn → model calls runConfiguredCard
    → Python AutoGen → model calls run_local_coder tool

Stage 2 — Adapter:
  POST /api/coder/localcoder/run                     [coder.routes.ts:422]
    → localCoderService.run → adapter.runWithDiagnostics [adapter.ts:949]
      → discoverRuntime → prepareMcpConfig (temp file)

Stage 3 — Spawn:
  runChildProcess(command, args, options)             [adapter.ts:241]
    → spawn(command, args, { cwd, env, shell, stdio: ['ignore','pipe','pipe'] })
    → timeout = 300s → on close → finish(exitCode, stdout, stderr)
    → timeout → child.kill() → 5s kill fallback → finish

Stage 4 — Parse:
  parseLocalCoderOutput(stdout, packetId)             [adapter.ts:488]
    → JSON.parse → try structured_output/result/output/envelope
    → coderReportSchema validation + coderPacketId match

Stage 5 — Cleanup:
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