# AutoGen + ReactFlow Runtime Architecture

This is the canonical architecture document for the LiquidAIty AutoGen runtime. The Spec 007
host-source AutoGen v0.4.4 runtime and live smoke are proven. Future durable agent runtime
contracts are defined in `specs/0075-agent-runtime-primitives/`; that spec does not claim those
new primitives are implemented.

## Active Stack

- Backend: host Node source.
- Python AutoGen sidecar: host Python source.
- AutoGen dependency source: `apps/python-models/requirements.txt`.
- Repo-local Python environment: `apps/python-models/.venv`.
- ThinkGraph database: `sim-pg` / Apache AGE in Docker.
- KnowGraph database: `neo4j` in Docker.
- Redis is not part of AutoGen, Mag One, ThinkGraph, or KnowGraph.
- Docker `python-models` is not an accepted development runtime.

## Vendored/Subrepo Exclusion List

The following paths are not active architecture truth and must be ignored until the user explicitly promotes one into active scope:

- `localcoder/`
- `worldsignal/`
- `data-formulator-main/`
- `Understand-Anything-main/`
- `client/src/vendor/codebase-memory-ui/`
- `vendor/sim/`
- `vendor/vips/`
- `videocanvas/remotion-templates/`
- `videocanvas/react-video-editor/`
- `videocanvas/clip-js/`
- `gamecanvas/triplex/`
- `gamecanvas/react-three-game-engine/`
- `gamecanvas/cuberun/`
- `motioncanvas/theatre/`
- `spatialcanvas/needle-engine-support/`

## AutoGen Primitive Map

| LiquidAIty concept | Runtime role |
|---|---|
| ReactFlow graph payload | Product graph and source of truth for nodes, cards, settings, edges, and connections |
| Plain agent card | `CardWorkerAgent(BaseWorker)` with selected `FunctionTool` tools |
| Card with fan-out enabled | `FanOutWorkerAgent(BaseWorker)` running bounded real-model fan-out |
| Card with connected child-agent subgraph | `SocietyOfMindWorkerAgent(BaseWorker)` running the compiled child subgraph |
| Runnable ReactFlow card | Compiled graph node and worker registration |
| ReactFlow edge | Compiled graph edge and scheduler obligation |
| Runnable ReactFlow graph selection | `compile_card_graph` producing a `CompiledGraph` |
| ReactFlow-derived execution paths | `GraphScheduler` obligations constraining worker dispatch |
| Mag One | Real v0.4.4 `LedgerOrchestrator` with Task Ledger and Progress Ledger |
| Mission plan | `MissionSpec`, generated inside graph constraints |
| Future human/app bridge | Reserved `UserProxyAgent` |

## ReactFlow Graph Rules

ReactFlow owns the graph.

- Nodes/cards define agents, tools, runtime objects, instructions, roles, card settings, and explicit model configuration.
- Edges define allowed routing, dependencies, branches, joins, loops, sequential execution, parallel execution, and mixed execution.
- Connections determine execution structure. `MissionSpec` never invents or replaces graph connections.
- The backend must preserve graph nodes, graph edges, edge relationships, and card settings in the strict sidecar payload.
- Every participant must carry explicit provider and provider model ID. Missing or falsy model configuration is a hard error.

## AutoGen Graph Execution Primitives

The Python graph compiler translates the ReactFlow execution structure into the proven v0.4.4
Magentic-One runtime adapters:

```text
ReactFlow runnable graph selection
-> compile_card_graph
-> CompiledGraph plus compiled child subgraphs
-> GraphScheduler obligations
-> LedgerOrchestrator worker request/reply execution
```

`GraphScheduler` constrains worker dispatch from ReactFlow-derived edge paths. It does not replace
ReactFlow or Mag One's real `LedgerOrchestrator`.

- Sequence: ReactFlow `A -> B -> C` becomes ordered scheduler obligations.
- Parallel branch: ReactFlow `A -> B` and `A -> C` becomes parallel-ready obligations.
- Join: ReactFlow `B -> D` and `C -> D` holds `D` until its upstream obligations complete.
- Loop: ReactFlow `A -> B -> A` with an explicit exit rule repeats through the scheduler and holds
  downstream work until loop exit.
- Child-agent subgraph: the compiled child graph executes internally through `GraphScheduler`
  inside a `SocietyOfMindWorkerAgent`.
- Per-card fan-out: a fan-out-enabled card uses `FanOutWorkerAgent` for bounded same-kind jobs.

## Card Settings

A card must preserve and compile these settings:

- instructions and role
- tools from ReactFlow card/tool wiring
- explicit provider and model configuration
- fan-out / `Swarm` setting
- `isSocietyOfMind`
- connected child-agent subgraph

A normal custom agent card compiles into a `CardWorkerAgent` with selected `FunctionTool` tools.
Fan-out is configured per card for many same-kind jobs such as files, chunks, URLs, records, or
graph extraction tasks. Fan-out is not the main orchestrator.

When a parent card has connected child agents beneath it, the parent setting becomes
`isSocietyOfMind = true`. The parent compiles into a `SocietyOfMindWorkerAgent`; its child subgraph
runs internally while the parent behaves as one outside-facing worker on the Mag One bus.

A future user/app prompt, approval, clarification, and human-in-loop bridge remains reserved. It
is not required for the current runtime and is not the main router.

## MissionSpec Planning Rules

`MissionSpec` is Mag One's planning object inside ReactFlow graph constraints. It may choose work and produce a run plan, but it must respect ReactFlow nodes, edges, card settings, tools, and explicit model configuration. It is not the source of graph connections.

The future canonical planning result is `PlanGraphDraft`, a mission-specific ReactFlow-visible
overlay defined by Spec 007.5. It remains distinct from the durable `AgentGraph` and cannot
silently mutate or exceed AgentGraph constraints.

The real v0.4.4 `LedgerOrchestrator` is the main Mag One orchestration bus. Connected outside-facing
workers report and coordinate through its worker request/reply flow. `GraphScheduler`, fan-out,
and Society-of-Mind child execution have narrower roles and do not replace it.

## Proven Runtime And Next Contract Layer

The proven Spec 007 runtime:

1. Accepts the strict ReactFlow graph and mission payload from the host-source backend.
2. Builds real tool-enabled `CardWorkerAgent`, `FanOutWorkerAgent`, and
   `SocietyOfMindWorkerAgent` workers according to card settings.
3. Compiles ReactFlow nodes, edges, loops, joins, and child graphs with `compile_card_graph`.
4. Executes edge-defined obligations through `GraphScheduler`.
5. Connects outside-facing workers through the real v0.4.4 `LedgerOrchestrator`.
6. Return real non-empty output or fail loudly.
7. Passed the real host-source runtime smoke recorded in
   `specs/007-runtime-contract-hardening/tasks.md`.

Before beginning Spec 012, implement the durable contracts in
`specs/0075-agent-runtime-primitives/` one atomic task at a time, beginning with ToolSpec and the
Python runtime ToolRegistry.

## What Not To Use

- Docker `python-models`
- Redis for AutoGen
- Microsoft Agent Framework
- Semantic Kernel
- AutoGen Studio
- `RoundRobinGroupChat`, `SelectorGroupChat`, or Ledger tutorial patterns as product runtime
- mocks, mocked transcripts, mocked sidecar success, or fake final output
- default provider/model, fallback provider/model, OpenAI fallback, OpenRouter fallback, or `providerModelId="default"`
- vendored/subrepo paths as active architecture truth
