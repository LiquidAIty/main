# LiquidAIty Agent Runtime Guide

This is an operational pointer, not the architecture source of truth.

Read first:

1. `docs/runbooks/AUTOGEN_REACTFLOW_RUNTIME_ARCHITECTURE.md`
2. `docs/runbooks/VENDORED_ROOTS_AND_SUBREPOS.md`
3. `specs/007-runtime-contract-hardening/spec.md`
4. `specs/007-runtime-contract-hardening/tasks.md`

## Current Truth

- ReactFlow is the product graph and source of truth for cards, settings, edges, and connections.
- The backend runs from host Node source.
- The Python AutoGen sidecar runs from host Python source.
- The Python orchestrator currently fails explicitly with `standard_autogen_graph_runtime_not_implemented`.
- The real source-run AutoGen ReactFlow graph runtime smoke is pending.
- No default or fallback provider/model is permitted.
- No fake output, mocked transcript, or mocked sidecar success is permitted.
- Redis and Docker `python-models` are not part of the active AutoGen development runtime.

## Start and Check

From the repository root:

```powershell
npm run dev
Invoke-RestMethod http://127.0.0.1:4000/api/health
Invoke-RestMethod http://127.0.0.1:8003/health
```

A health check proves process liveness only. Do not report the runtime as working until the real Spec 007 source-run smoke returns real non-empty output.
