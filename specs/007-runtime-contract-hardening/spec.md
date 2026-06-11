# Spec 007: Runtime Contract Hardening

**Status**: T001-T004 complete. Real source-run AutoGen ReactFlow graph runtime smoke pending.

**Blocks**: Specs 008-012 implementation until the final runtime smoke passes.

## Goal

Prove the real source-run AutoGen graph runtime:

```text
host-source backend
-> host-source Python sidecar
-> strict ReactFlow graph and MissionSpec payload
-> AssistantAgent-with-tools cards / SocietyOfMindAgent wrappers / Swarm fan-out cards
-> DiGraphBuilder
-> DiGraphNode plus DiGraphEdge structure
-> DiGraph
-> GraphFlow edge-defined execution
-> MagenticOneGroupChat bus
-> real non-empty final output
```

## Runtime Contract

- ReactFlow is the product graph and source of truth.
- Nodes/cards define runnable primitives, tools, instructions, roles, settings, and explicit model configuration.
- Edges define sequence, branch, join, loop-with-exit-rule, parallel, and mixed execution relationships.
- `MissionSpec` is Mag One's plan inside ReactFlow graph constraints. It does not own graph connections.
- `MagenticOneGroupChat` is the main Mag One orchestration/chat bus.
- A plain agent card compiles into an `AssistantAgent` with tools.
- A fan-out-enabled card uses `Swarm` inside that card's runtime mode.
- A card with a connected child-agent subgraph compiles into a `SocietyOfMindAgent` wrapping the internal graph.
- `UserProxyAgent` is reserved and is not required for the first runtime.
- ReactFlow runnable structure compiles through `DiGraphBuilder`, `DiGraphNode`, `DiGraphEdge`, and `DiGraph`, then executes through `GraphFlow`.

## Hard Rules

- Preserve graph nodes, graph edges, edge relationships, and card settings in the backend-to-Python payload.
- Preserve fan-out / `Swarm` config, `isSocietyOfMind`, tools, explicit model config, instructions, and role.
- Every participant requires explicit `provider` and `providerModelId`.
- No default provider/model, provider/model fallback, OpenAI fallback, OpenRouter fallback, or `providerModelId="default"`.
- No fake final output, mocked transcript, mocked sidecar success, or swallowed runtime failure.
- Backend and Python run from repository source.
- Redis and Docker `python-models` are not part of AutoGen execution.
- Vendored/subrepo paths listed in `docs/runbooks/VENDORED_ROOTS_AND_SUBREPOS.md` are excluded from active implementation assumptions.

## Current Blocker

`apps/python-models/app/python_models/autogen_orchestrator.py` currently fails explicitly with `standard_autogen_graph_runtime_not_implemented`. The graph runtime has not been implemented or proven.

## Acceptance

The final smoke must call the real backend route and real host-source Python sidecar with a persisted ReactFlow deck/mission payload, preserve explicit model and graph contracts, execute real AutoGen primitives, and return real non-empty output. Health checks, mocks, provider errors, and historical smoke reports do not satisfy this gate.
