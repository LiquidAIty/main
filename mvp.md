# MVP

This document captures the intended MVP and audits what this repo would need to change to deliver it.

## Design Intent

### What this system is

A real AI agent system with a visual orchestration layer.

It is built to:

- respond fast
- ingest the user + assistant pair after the response
- update a working plan
- run agents only when needed
- structure findings into graphs
- keep runtime behavior visible instead of hidden in code

### What this system is not

It is not:

- a prompt-writing app
- a dashboard full of fake metrics
- a chatbot wrapper
- a form-heavy config tool
- a fake diagram editor

### Core runtime law

The system must stay fast.

Canonical loop:

1. user sends message
2. assistant replies first
3. user + assistant pair becomes the minimum ingestion unit
4. plan is updated from that pair
5. if needed, the plan creates agent calls
6. agent prompts are only as long as needed, no longer
7. deeper search, graph work, and synthesis run after the fast reply path

### Core objects

#### Chat

Front door interaction.

#### Blackboard

Shared working state for the current mission.

Use it for:

- objective
- current plan
- subagent assignments
- returned results
- review and integration
- next actions

#### ThinkGraph

Subjective and provisional layer.

Use it for:

- hypotheses
- assumptions
- alternative framings
- unresolved questions

#### KnowGraph

Objective and source-backed layer.

Use it for:

- entities
- relationships
- evidence
- traversals
- grounded facts

#### Agent

A worker with a type, context, and prompt.

The user should not need to hand-write full prompts every time.

#### Edge

A real visible connection, not decoration.

In the current builder/runtime model it means:

- this node runs after that node
- blackboard participation is only real when the blackboard link is visible

Future edge semantics, if they are ever added, must stay explicit and visible. They are not part of the current truthful runtime model.

### Agent prompt rule

Prompt writing should not become the product.

The system should prefer:

- short prompt seeds from plan
- expansion from known agent types
- manual override only when needed

Prompt should be as long as needed, no longer.

### Graph-first truth rule

Deep work should structure reality before over-summarizing it.

Research path:

1. extract terms, entities, relationships, and open questions
2. send them to search agents
3. return sources, facts, and candidate relationships
4. send structured results into the Python Neo4j route
5. write objective outputs to KnowGraph
6. write provisional branches to ThinkGraph
7. update Blackboard with a merged working summary

### MVP success definition

The MVP is good enough when:

- chat responds fast
- user + assistant pair ingests cleanly
- plan updates from the pair
- agent calls can be created from the plan
- research can flow into Neo4j and KnowGraph
- blackboard shows current work clearly
- visual layer shows real runtime objects and real connections

## Visual Programming Layer

### Design law

Do not let position secretly define logic.

- edges define execution truth
- layout helps humans read it

### Recommended visual grammar

Use all three:

- columns = stages
- rows or lanes = parallel families
- edges = actual execution truth

### Minimal mental model

- left to right = mission progress
- same column, multiple nodes = parallel options or jobs
- edge lines = real order and routing

### Rules

1. Cards are real runtime objects only.
2. Edges are the program.
3. Left to right is the primary reading direction.
4. Parallel work is shown by fan-out plus same-stage grouping.
5. Merge points should be explicit.
6. Writes to Blackboard, ThinkGraph, or KnowGraph must be visible.

### Suggested first canvas object types

Current live node kinds:

- Agent
- Blackboard

Current semantic roles expressed through agent presets and runtime bindings:

- Main Chat
- ThinkGraph
- Research Worker
- Summary Step
- KnowGraph
- Graph Write

### First useful layout

- Column 1: Main Chat
- Column 2: ThinkGraph / Plan shaping
- Column 3: Worker agents
- Column 4: Summary and review
- Column 5: Blackboard, KnowGraph, and graph write
- Column 6: Final answer and next step

## Repo Audit

### How the existing docs fit now

The repo already contains three useful but different vision layers:

- [`old/MVP-FINAL.md`](C:/Projects/LiquidAIty/main/old/MVP-FINAL.md) captured an Assist-first launch contract where Agent Builder stayed internal.
- [`old/CURRENT.md`](C:/Projects/LiquidAIty/main/old/CURRENT.md) captured the dual-graph direction: ThinkGraph for subjective reasoning and KnowGraph for evidence.
- [`legacy/docs/PROJECT_FULL_SCOPE_V0.md`](C:/Projects/LiquidAIty/main/legacy/docs/PROJECT_FULL_SCOPE_V0.md) captured the broader project/deck/contract/graph vision.

Those docs are not contradictory. They describe different levels of scope:

- old Assist-first MVP = the narrow launch cut
- dual-graph note = the memory and graph split
- full-scope doc = the long-term operating environment

What this document does now is reconcile those with the current repo truth.

### What the repo already has now

- A real front-door Assist route at `/api/agents/boss`.
- A real ThinkGraph-style ingestion and research path through KG v2.
- A real KnowGraph / Neo4j path for evidence-backed graph work.
- A real AutoGen Python sidecar route at `/autogen/research/plan`.
- A real React Flow builder where nodes are real objects and edges are plain visible `source -> target` links.
- A real v3 deck runtime where visible links determine execution order.
- A real v3 blackboard that only reads and writes through visible links in the deck runtime.
- A real right-panel agent editing flow through the existing `AgentManager`.

### What is true now in the active builder/runtime path

The active builder truth is:

- nodes are real runtime objects
- edges are plain visible `source -> target` links
- runtime follows visible links only
- blackboard reads happen only through visible links
- blackboard writes happen only through visible links
- loops are warned honestly instead of being faked into an order
- selected nodes are edited in the right panel

This is a meaningful step forward. The builder is no longer just a fake diagram surface.

### What is still split or unfinished

#### 1. The repo still has two active state worlds

- Assist/project continuity still lives in `builder_state`
- deck runtime and blackboard still live in `v3_state`

That is the main structural split in the repo today.

#### 2. `/api/agents/boss` and the v3 deck runtime are not unified yet

The current Assist route is real, and the current deck runtime is real, but they are not yet one coherent orchestration spine.

#### 3. The planning surface is useful but still rescue-heavy

The plan/wiki surface works, but it still relies on fallback shaping and normalization logic because the stored plan shape is not yet cleanly stabilized.

#### 4. Runtime bindings are still thinner than their names imply

Cards can be labeled as `main_chat`, `kg_ingest`, `research_agent`, `knowgraph`, and `neo4j`, but the v3 card runner still resolves to a generic LLM call for most card execution.

#### 5. LangGraph is not the active backbone

LangGraph paths still exist in the repo, but they are not the real critical path for the current builder, Assist runtime, ThinkGraph path, or KnowGraph path.

## What This System Is Becoming

This project is not best understood as a single chat app or a single workflow editor.

It is becoming:

**a project-based AI operating environment with visible orchestration, durable project state, graph-backed reasoning, and a controllable execution engine**

In practice, that means:

- the builder is the visible route map
- the plan/wiki is the directional continuity surface
- the blackboard is the shared work surface
- ThinkGraph is the provisional reasoning layer
- KnowGraph is the grounded evidence layer
- AutoGen should become the execution and orchestration engine moving through those layers

The system should not collapse into AutoGen.
AutoGen should run inside this system.

## What Stays Ours

These parts remain first-class and should not be replaced:

- React Flow builder and visible routing truth
- project continuity and project state
- plan/wiki
- blackboard
- ThinkGraph
- KnowGraph
- the right-panel node editing surface

## What AutoGen Should Own

AutoGen is the best fit for:

- the permanent orchestration runtime
- the orchestrator entrypoint
- agent execution
- AutoGen-backed worker agents
- team orchestration
- handoffs
- Magentic-One orchestration
- manager-worker behavior
- explicit model/provider resolution
- fail-fast model gating
- bounded temporary run context
- save/load orchestration state
- tool and MCP usage
- structured report-backs into our truth systems
- tracing and observability for orchestration runs

AutoGen should be the car, not the penthouse.

## Where The Old LangGraph Vision Fits Now

LangGraph should not drive the current plan.

It can stay in the repo for now, but it is not the current backbone and should not define the next architecture decisions.

The more current direction is:

- keep the current builder truth
- keep the current graph split
- keep the current project continuity surfaces
- keep AutoGen in the Python sidecar as the orchestration engine
- make Magentic the real orchestrator instead of treating it as an optional experiment

## What Is Working Enough To Build On

### 1. Builder truth

The builder is now strong enough to preserve:

- visible routing
- visible blackboard participation
- right-panel agent editing
- starter and quick-add setup

### 2. Dual-graph direction

The ThinkGraph / KnowGraph split is still the right conceptual model.

That older vision remains valid:

- ThinkGraph = subjective, provisional, exploratory
- KnowGraph = objective, evidence-backed, grounded

### 3. Plan/wiki as continuity

The plan/wiki should stay as the readable brain of the project.
It should not be replaced by raw framework chat history.

### 4. AutoGen foundation direction

AutoGen is now installed and connected through the Python sidecar.

The current real foothold is:

- `/autogen/research/plan` in the Python sidecar
- the backend research service calling that route

But that foothold is not the target architecture.

The target architecture is:

- Python sidecar becomes the real orchestration runtime
- Magentic-One becomes the real orchestrator
- `/api/agents/boss` becomes, at most, a thin API ingress into that runtime
- worker agents become AutoGen-backed
- orchestration writes back through typed contracts, not ad hoc chat glue

This repo should not spend time on throwaway planner-only bridge code whose main purpose is to preserve broken orchestration patterns.

## What Is Not Working As One Coherent System Yet

### 1. Main Chat is not yet the real orchestration engine

The Assist route is real, but it is still custom route/service glue rather than a true long-horizon orchestration engine.

### 2. The blackboard is real in v3, but not yet the shared Assist blackboard

The v3 blackboard works inside deck execution, but `/api/agents/boss` does not yet use it as a common shared state surface.

### 3. The planning surface still needs cleaner structure

The plan surface is readable, but it still accepts too many input shapes and needs rescue logic to stay coherent.

### 4. The real orchestration foundation is not installed yet

- `/api/agents/boss` still contains orchestration intelligence instead of being a trivial ingress or disappearing entirely
- worker agents are not yet AutoGen-backed as the default execution model
- `ContextPack`, `AgentReportBack`, `BlackboardEntry`, and `SidecarSession` are not yet the frozen basis of integration
- blackboard, plan/wiki, and graph writes are not yet driven by one structured orchestration contract

### 5. Magentic model compatibility is a real engineering concern

Magentic is the intended orchestrator, but not every model is a safe fit for its ledger/orchestration behavior.

The repo should treat Magentic-safe model choice as explicit runtime policy, not as something hidden in local `.env`.

### 6. The repo should not optimize for keeping both orchestration patterns alive

Old routes may remain callable temporarily as adapters.

They should not remain the design center.

This pass should not preserve broken glue just to claim compatibility.

## Old Methods Still In Use

The current old research spine still matters and stays in place:

- ThinkGraph extraction still runs through KG v2.
- Tavily/web retrieval still runs through the current research service.
- KnowGraph and Neo4j ingest still run through the current pipeline.
- plan/wiki rewrite still runs through the Assist route.
- blackboard, ThinkGraph, KnowGraph, and plan/wiki remain ours.

AutoGen is not replacing those surfaces.
AutoGen is replacing orchestration work first.

That does not mean preserving old orchestration glue as the primary system shape.

Old routes should survive only as temporary adapters where continuity requires them.

The design center is the new orchestration foundation, not the legacy glue.

## AutoGen Feature Map

| AutoGen feature | Current code surface | Current role now | Planned role |
| --- | --- | --- | --- |
| `AssistantAgent` | existing agent prompt/config surfaces and the Python sidecar runtime | worker/prompt unit | default worker agent unit under the orchestrator |
| `MagenticOneGroupChat` | Python sidecar orchestration path | intended primary orchestrator | research first, main chat/front-door runtime next |
| `SelectorGroupChat` | temporary legacy AutoGen research planner path | transitional only | not part of the target architecture |
| `ContextPack` | shaped context from plan/wiki, ThinkGraph, KnowGraph, and blackboard | not frozen yet | required contract into the orchestrator |
| `AgentReportBack` | structured agent output returned from the sidecar | not frozen yet | required contract back into backend truth systems |
| `BlackboardEntry` | blackboard write contract | not frozen yet | required structured blackboard update path |
| `SidecarSession` / `ProjectSession` | orchestration run/session boundary | not frozen yet | required persistence and trace boundary |
| AutoGen memory / model context | shaped external context, not truth | external context sources | bounded execution context only |
| save/load state | project continuity + sidecar session wrapper | not unified yet | orchestration persistence bridge later |
| GraphFlow | not active in the current runtime | none | later option under the builder, not a replacement for builder truth |

## Foundation Contracts

The permanent integration basis should be these typed contracts:

- `ContextPack`
- `AgentReportBack`
- `BlackboardEntry`
- `SidecarSession` / `ProjectSession`

These are not optional cleanup work for later.

They are the basis of the real orchestration architecture and should be frozen before deeper wiring spreads ad hoc shapes through the codebase.

## Current AutoGen/Magentic Path

The current live AutoGen path is:

1. KG/Research packet is prepared in the backend.
2. Backend calls the Python sidecar route.
3. AutoGen/Magentic plans research work.
4. Backend continues with the existing Tavily, KnowGraph, and plan/wiki work.

That is proof that the sidecar is real.

It is not the intended end state.

The intended end state is:

1. backend builds a real `ContextPack`
2. the front-door runtime calls the sidecar orchestrator, or AutoGen owns the call path directly
3. AutoGen/Magentic runs the orchestration
4. sidecar returns `AgentReportBack` plus `BlackboardEntry` updates
5. backend persists those structured writes into plan/wiki, blackboard, ThinkGraph, and KnowGraph

Old planner-style routes are acceptable only as temporary adapters while the permanent path is installed.

## Current Default Model Direction

The intended repo default for orchestration is:

- OpenRouter OpenAI GPT-5.1 chat

It should be treated as the code-level default for:

- Main Chat
- Research orchestration
- other orchestration-first surfaces

Moonshot/Kimi can still exist in the registry, but it is not the intended default orchestrator model.

## Next Plan

### Phase 1 — Freeze the real contracts now

- define and use `ContextPack`
- define and use `AgentReportBack`
- define and use `BlackboardEntry`
- define and use `SidecarSession` / `ProjectSession`

Do not postpone these behind throwaway planner glue.

### Phase 2 — Make the Python sidecar the real orchestration runtime

- define the real orchestrator entrypoint
- wire AutoGen + Magentic-One as the real orchestration layer
- make model/provider resolution explicit
- fail fast on blocked or unsafe models
- do not silently remap models
- do not silently fall back inside the orchestrator

### Phase 3 — Reduce `/api/agents/boss` to an optional ingress shim

- `/api/agents/boss` may still receive API traffic
- it may remain as a thin shim, be called by AutoGen, call AutoGen, or disappear later
- it should stop being the place where orchestration intelligence lives
- orchestration authority belongs in the sidecar runtime, not in the route name

### Phase 4 — Make worker agents AutoGen-backed

- worker agents should execute through the orchestrator runtime
- orchestration should stop depending on legacy route-local glue as the primary pattern
- old paths may remain temporarily only as adapters

### Phase 5 — Connect structured writes into the truth systems

- write blackboard updates through `BlackboardEntry`
- write plan/wiki updates through structured report-backs
- keep ThinkGraph and KnowGraph as real system memory surfaces
- do not collapse those surfaces into chat memory

### Phase 6 — Keep only minimal adapters for continuity

- if an old route is still needed, keep it as an adapter only
- do not let adapter-only code define the architecture
- do not invest in fake compatibility work whose only value is preserving bad glue

## Practical MVP Recommendation

The shortest truthful path now is:

- keep the current builder truth
- keep the current dual-graph split
- keep the plan/wiki and blackboard surfaces
- install AutoGen/Magentic as the real orchestration foundation
- freeze the real contracts now
- reduce `/api/agents/boss` to an optional shim if it still exists
- keep old routes only as temporary adapters where continuity requires them
- stop designing around preserving broken orchestration glue

## One-line Summary

Keep the visible builder, plan/wiki, blackboard, ThinkGraph, and KnowGraph as the penthouse -> install AutoGen with Magentic-One as the real orchestration foundation now -> treat `/api/agents/boss` as an optional shim at most, not a real architecture object -> keep old routes only as temporary adapters, not as the design center

## Future Possibilities

These are reasonable future additions once the current runtime path is stable:

- visible participant-membership links if nested runtime truth needs to be shown on canvas
- wrapped nested runtimes for supported internal team patterns
- executable `swarm` support only after handoff behavior is wired truthfully
- executable `graph_flow` support only after workflow semantics are mapped honestly to the deck runtime
- richer test-panel traces for team events, participant turns, and structured report-backs

### Deferred Runtime Controls

These runtime settings were cut from the active editor because the current app does not wire them truthfully yet:

- real `TerminationCondition` builders for team runtimes
- selector `candidate_func` / `selector_func` style hooks
- executable `emitTeamEvents` streaming into the builder test panel
- executable `swarm` handoff controls
- executable `graph_flow` workflow controls
- executable adapter target controls
- full AutoGen `AssistantAgent` memory / tool / streaming parity for the single-card runtime path

### Participant Membership Later

Participant selection currently stays inside the agent card config because the current deck edges still mean top-level execution order only.

Future work can move participant membership into the visual canvas only after that relationship has its own explicit visible semantics and does not overload normal deck edges.
