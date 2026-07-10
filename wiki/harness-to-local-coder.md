---
id: feature.harness-to-local-coder
title: Harness to Local Coder Route
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
    - apps/backend/src/routes/coder.routes.ts
    - apps/backend/src/coder/localcoder/service.ts
    - apps/backend/src/coder/localcoder/adapter.ts
    - apps/backend/src/coder/localcoder/adapter.spec.ts
    - apps/backend/src/services/graphContext/cbmScopeGate.ts
    - apps/python-models/app/python_models/tool_registry.py
    - apps/python-models/app/python_models/test_run_local_coder.py
    - client/src/features/agentbuilder/console/consoleVisibility.ts
  symbols:
    - run_local_coder
    - LocalCoderService.run
    - LocalCoderAdapter.run
    - runChildProcess
    - runLocalCoderCbmScopeGate
    - isLocalCoderCard
    - selectDoorwayCards
    - buildHarnessAgentDefinition
  routes:
    - POST /api/coder/localcoder/run
    - GET /api/coder/localcoder/status
  tests:
    - test_run_local_coder.py
    - adapter.spec.ts
---

# Harness to Local Coder Route

## What this is

When the Main Chat model decides a coding task should be delegated, it opens the
`card_local_coder` specialist doorway. The backend runs the coding task through the
LocalCoderAdapter, which spawns a native Coder subprocess (OpenClaude CLI), collects
the structured CoderReport from stdout, and returns it to the model.

## What the user/agent experiences

The chat model sees a `when_to_use` doorway for Local Coder:
"Delegate here to run real coding work in the Coder workspace (create/edit files, run
commands, produce real artifacts)." Calling the doorway invokes `runConfiguredCard`
with `cardId='card_local_coder'`, which runs `run_local_coder` tool → posts to
`POST /api/coder/localcoder/run` → the backend spawns the native Coder → returns a
CoderReport (status, filesChanged, proofResults, blockers).

## How it works

```
Harness chat → specialist doorway for card_local_coder
  → selectDoorwayCards(nodes, 'chat')          [grpcChatClient.ts:142]
    → runtimeType='local_coder', binding='local_coder'
  → buildHarnessAgentDefinition(card)
  → runConfiguredCard({ cardId: 'card_local_coder' })  [runtime.ts:490]
    → runSingleAssistCardAsDeckRun
      → resolveCardTools → ['run_local_coder']
    → runCardWithContract → runSingleCardWithAutoGen
      → model calls run_local_coder tool

Python: run_local_coder(objective, ...)          [tool_registry.py:434]
  → builds coderPacket (model supplies objective, guardrails, ...)
  → POST /api/coder/localcoder/run (server injects repoPath + id)
  → returns CoderReport JSON verbatim

Backend: POST /api/coder/localcoder/run          [coder.routes.ts:422]
  → localCoderService.run(packet)               [service.ts:51]
    → parseCoderPacket → runLocalCoderCbmScopeGate [cbmScopeGate.ts:21]
    → adapter.runWithDiagnostics(packet)         [adapter.ts:949]
      → runChildProcess(command, args)           [adapter.ts:241]
        → spawn() from node:child_process
        → 300s timeout, 5s kill fallback
      → parseLocalCoderOutput(stdout, packetId) [adapter.ts:488]
        → JSON.parse → coderReportSchema validation
        → Returns CoderReport{status, filesChanged, proofResults, blockers}
```

## Must not break

1. `repoPath` and `id` are server-injected — never accepted from the model. The tool
   signature deliberately omits these fields.
2. Write mode defaults to `read-only` — a model must explicitly set `write_mode='edit'`
   to get `acceptEdits` permission. Read-only code audits are always safe.
3. CBM scope gate (`runLocalCoderCbmScopeGate`) can block the run if the repo path
   is outside the allowed scope — returns a blocked CoderReport, never a silent fallback.
4. `run_local_coder` is registered in `DEFAULT_TOOL_REGISTRY._specs` and appears in
   `tool_manifest()` — not a hidden/privileged tool.
5. `parseLocalCoderOutput` validates the CoderReport schema — only well-formed reports
   with matching `coderPacketId` are accepted. Malformed output → failed report, never
   fabricated success.

## Start in CBM

```
search_graph(project="C-Projects-main", query="run_local_coder")
search_graph(project="C-Projects-main", query="LocalCoderService.run")
search_graph(project="C-Projects-main", query="runChildProcess")
search_graph(project="C-Projects-main", query="runLocalCoderCbmScopeGate")
search_graph(project="C-Projects-main", query="isLocalCoderCard")

# trace_path works for TypeScript functions but NOT for Python functions
# or TypeScript methods with dots (e.g. LocalCoderAdapter.run):
trace_path(project="C-Projects-main", function_name="startGrpcTurn",
           mode="calls", direction="inbound", depth=1)

index_status(project="C-Projects-main")
```

## Valid proof

```python
# Proves: tool posts to correct endpoint, server-injects repoPath+id
from app.python_models import tool_registry as t
result = await t.run_local_coder(
    objective="Audit the /localcoder/run trusted-root injection.",
    write_mode="edit",
    guardrails=["No fake success."],
    allowed_files=["apps/backend/src/routes/coder.routes.ts"],
    proof_required=["backend tsc"],
)
assert "blocked" in result  # fake backend returns blocked
```

Proves: tool posts to `/api/coder/localcoder/run`, `repoPath` and `id` are
server-injected (not in the packet), logical task fields pass through verbatim.
Does not prove: real Coder subprocess runs correctly (source-verified; runtime proof
required), CoderReport contains valid file changes (requires real AutoGen + native
Coder runtime).

## Limitations

- **trace_path does not resolve Python functions or dotted method names.**
  `run_local_coder` and `LocalCoderAdapter.run` return no callers. The
  cross-language boundary (TypeScript → Python → native Coder) is source-verified.
- **Timeout risk:** `DEFAULT_LOCALCODER_RUN_TIMEOUT_MS = 300_000` (5 min). No SSE
  streaming during the run — model gets only the final CoderReport. A non-responsive
  subprocess can outlive the request (5-second kill fallback).
- **Placeholder artifact risk:** The model receives the CoderReport as JSON text.
  `write_return_file_tool` exists for job-folder handoff but is not used in the
  standard local coder path — real file artifacts are `filesChanged` report entries.

## Future agent load set

| File | Why |
|------|-----|
| `apps/backend/src/routes/coder.routes.ts` (lines 413-462) | status + run endpoints |
| `apps/backend/src/coder/localcoder/service.ts` | Service orchestration, CBM scope gate |
| `apps/backend/src/coder/localcoder/adapter.ts` | Adapter, runChildProcess, parseLocalCoderOutput |
| `apps/backend/src/services/graphContext/cbmScopeGate.ts` | Scope gate logic |
| `apps/python-models/app/python_models/tool_registry.py` (lines 434-475) | run_local_coder tool |
| `apps/python-models/app/python_models/test_run_local_coder.py` | Tool tests |
| `apps/backend/src/coder/localcoder/adapter.spec.ts` | Adapter tests |
