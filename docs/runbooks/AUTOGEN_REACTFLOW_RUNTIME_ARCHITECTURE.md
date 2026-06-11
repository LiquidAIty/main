# AutoGen + ReactFlow Runtime Architecture

This is the canonical architecture document for the LiquidAIty AutoGen runtime. It describes the target runtime Fable will implement. It does not claim that the runtime or live smoke currently works.

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
| Plain agent card | Tool-enabled `AssistantAgent` |
| Card with fan-out enabled | `Swarm`-backed card-level fan-out |
| Card with connected child-agent subgraph | `SocietyOfMindAgent` wrapping the internal child graph |
| Runnable ReactFlow card | `DiGraphNode` |
| ReactFlow edge | `DiGraphEdge` |
| Runnable ReactFlow graph selection | `DiGraphBuilder` producing a `DiGraph` |
| ReactFlow-derived execution paths | `GraphFlow` |
| Mag One | `MagenticOneGroupChat`, the main orchestration/chat bus |
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

The Python graph compiler translates the ReactFlow execution structure into AutoGen graph primitives:

```text
ReactFlow runnable graph selection
-> DiGraphBuilder
-> DiGraphNode plus DiGraphEdge structure
-> DiGraph
-> GraphFlow execution
```

`GraphFlow` executes ReactFlow-derived edge paths. It does not replace ReactFlow and does not replace `MagenticOneGroupChat`.

- Sequence: ReactFlow `A -> B -> C` becomes a `DiGraph`/`GraphFlow` chain.
- Parallel branch: ReactFlow `A -> B` and `A -> C` becomes a `DiGraph`/`GraphFlow` branch.
- Join: ReactFlow `B -> D` and `C -> D` becomes a `DiGraph`/`GraphFlow` join.
- Loop: ReactFlow `A -> B -> A` with an explicit exit rule becomes a `DiGraph`/`GraphFlow` loop with that exit condition.
- Child-agent subgraph: the child graph becomes internal `DiGraph`/`GraphFlow` execution wrapped by a `SocietyOfMindAgent`.
- Per-card fan-out: a fan-out-enabled card uses `Swarm` inside that card's runtime mode.

## Card Settings

A card must preserve and compile these settings:

- instructions and role
- tools from ReactFlow card/tool wiring
- explicit provider and model configuration
- fan-out / `Swarm` setting
- `isSocietyOfMind`
- connected child-agent subgraph

A normal custom agent card compiles into an `AssistantAgent` with tools. `Swarm` is configured per card for many same-kind jobs such as files, chunks, URLs, records, or graph extraction tasks. `Swarm` is not the main orchestrator.

When a parent card has connected child agents beneath it, the parent setting becomes `isSocietyOfMind = true`. The parent compiles into a `SocietyOfMindAgent`; its child subgraph runs internally while the parent behaves as one outside-facing participant on the Mag One bus.

`UserProxyAgent` is reserved for a later user/app prompt, approval, clarification, and human-in-loop bridge. It is not required for the first runtime and is not the main router.

## MissionSpec Planning Rules

`MissionSpec` is Mag One's planning object inside ReactFlow graph constraints. It may choose work and produce a run plan, but it must respect ReactFlow nodes, edges, card settings, tools, and explicit model configuration. It is not the source of graph connections.

`MagenticOneGroupChat` is the main Mag One orchestration/chat bus. Connected agents and outside-facing agent cards report and coordinate through it. `GraphFlow`, `Swarm`, and `SocietyOfMindAgent` have narrower execution roles and do not replace it.

## What Fable Implements

Fable implements the Python runtime wiring later:

1. Accept the strict ReactFlow graph and mission payload from the host-source backend.
2. Build real tool-enabled `AssistantAgent`, card-level `Swarm`, and `SocietyOfMindAgent` participants according to card settings.
3. Compile ReactFlow nodes and edges with `DiGraphBuilder`, `DiGraphNode`, `DiGraphEdge`, and `DiGraph`.
4. Execute edge-defined paths with `GraphFlow`.
5. Connect outside-facing participants through real `MagenticOneGroupChat`.
6. Return real non-empty output or fail loudly.
7. Prove the result through a real host-source runtime smoke before beginning Spec 012.

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
