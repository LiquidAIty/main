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

A real transfer rule, not decoration.

It answers:

- what goes across
- when it goes across
- where it writes
- whether it gates or waits

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
- edges = actual execution

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

- Chat
- Plan
- Agent
- Blackboard
- ThinkGraph
- KnowGraph
- Merge

### First useful layout

- Column 1: Chat
- Column 2: Plan
- Column 3: Worker agents
- Column 4: Merge and review
- Column 5: Blackboard, ThinkGraph, and KnowGraph
- Column 6: Final answer and next step

## Repo Audit

### What the repo already has

- A live front-door chat runtime at `/api/agents/boss`.
- A project-scoped main chat agent config resolver.
- A ThinkGraph-style ingestion path that can ingest a `Q/A` pair via `runKgChatTurnNow`.
- A research path that turns graph gaps and attention edges into web research and KnowGraph ingest.
- Neo4j-backed KnowGraph querying and ingest helpers.
- A `v3` deck runtime with cards, edges, runs, and a blackboard object.
- A builder UI with a left-to-right seed deck that already visually resembles stage columns.
- A separate admin canvas that sketches plan, main chat, ThinkGraph, research, KnowGraph, and Neo4j as nodes.

### What is close to the target

- Fast reply is partially present: `/api/agents/boss` is already the active Assist front door.
- Pair ingestion is partially present: the KG v2 path accepts `user_text` plus `assistant_text`.
- Plan update is partially present: the boss route rewrites a PlanWiki after the turn.
- Blackboard is partially present: `v3` has a real blackboard shape and persisted state.
- Graph flow is partially present: ThinkGraph extraction, research, and Neo4j/KnowGraph integrations already exist.
- Visual orchestration is partially present: the builder canvas already treats edges as explicit objects.

### Biggest mismatches

#### 1. Reply-first law is violated in the active Assist runtime

The current boss route performs ThinkGraph extraction, gap detection, research dispatch, and evidence retrieval before the final assistant reply. That is the opposite of the intended law.

The current runtime is closer to:

`user -> deep pre-reply loop -> assistant reply -> plan rewrite`

The intended runtime is:

`user -> assistant reply -> pair ingest -> plan update -> optional agents -> deeper work`

#### 2. The ingestion unit is wrong in the boss route

The repo can ingest a pair, but `/api/agents/boss` currently sends the current user text plus the previous assistant text into ThinkGraph. The MVP requires ingesting the current user text plus the current assistant reply as the minimum unit.

#### 3. There are two different state systems

The active Assist runtime writes plan state into `builder_state.plan`, while `v3` maintains a separate deck and blackboard state under `v3_state`. That split will create drift unless one becomes canonical.

#### 4. The visual layer is not yet the live runtime surface

The builder canvas and the admin canvas are editor-style surfaces. The active chat runtime does not emit live runtime objects, live edge traversals, live agent calls, or live state writes into those canvases.

#### 5. Deck edges are not yet execution truth

The `v3` model stores `routeType`, `condition`, `passforwardMode`, and priorities, but execution does not yet honor conditional routing or success/error branching. Today the deck runtime effectively performs a simple topological walk.

That means the repo already stores edge metadata, but edges do not yet fully behave like the program.

#### 6. Parallel work is drawn better than it is executed

The `v3` runtime can represent fan-out and multiple nodes, but execution is still sequential. Parallel families are not actually run in parallel yet.

#### 7. Runtime bindings are mostly labels, not real behaviors

Cards can declare bindings like `main_chat`, `kg_ingest`, `research_agent`, `knowgraph`, and `neo4j`, but card execution currently resolves to a generic LLM call. The binding does not yet switch into the real service path for chat, graph ingest, research, or graph persistence.

#### 8. The node model is too narrow for the intended canvas grammar

`v3` only has `agent` and `blackboard` node kinds. The MVP needs at least explicit `chat`, `plan`, `thinkgraph`, `knowgraph`, and `merge` semantics if the visual layer is supposed to expose real execution objects rather than decorative cards.

#### 9. Prompt-seed expansion is not the current default

The repo has strong prompt templates and agent configs, but the main deck path still stores full prompts on cards. The MVP wants plan-derived prompt seeds plus agent-type expansion, with full manual prompts as an override rather than the normal path.

#### 10. The ThinkGraph and KnowGraph split is not yet cleanly unified

The current repo uses a ThinkGraph-style extraction path backed by the KG v2 pipeline and separate KnowGraph or Neo4j flows elsewhere. The architectural intent is present, but the boundary is not yet normalized into one runtime contract.

#### 11. Blackboard policy exists in types but is not enforced in runtime

`inputSources`, `blackboardReadFields`, `blackboardWriteFields`, and `nextMoveAuthority` exist in the model and UI, but the backend runtime does not yet enforce them. That means the repo has configuration surface without full execution semantics behind it.

#### 12. Test coverage is far short of the MVP risk surface

There are a few tests, but there is no end-to-end proof of:

- reply first
- post-reply pair ingest
- plan update from pair
- agent fan-out and merge
- explicit graph writes
- runtime visibility in the visual layer

## What It Would Take

### 1. Pick one canonical runtime spine

Recommendation, based on the current repo: keep `/api/agents/boss` as the front door and make `v3` the canonical runtime state and orchestration model behind it. Do not build a third orchestration path.

That means:

- boss route = front door and fast reply
- `v3` state = blackboard, runs, runtime events, visual objects
- KG v2 plus research services = async graph workers behind runtime bindings

### 2. Reorder the boss route into a true fast path plus background path

Required change:

1. generate the assistant reply first
2. persist the turn
3. enqueue the fresh `user_text + assistant_text` pair
4. update the plan and blackboard from that pair
5. fan out deeper research only if the plan says it is needed

This is the single most important architectural change for the MVP.

### 3. Make the pair the canonical turn object

Add a first-class turn record that stores at least:

- `turn_id`
- `project_id`
- `user_text`
- `assistant_text`
- `reply_started_at`
- `reply_finished_at`
- `ingest_status`
- `plan_status`
- `runtime_events`

Then make every downstream stage consume that turn object rather than ad hoc text strings.

### 4. Unify PlanWiki and Blackboard into one mission state model

The current PlanWiki is useful, but it is still mostly markdown. The MVP needs structured state.

The canonical mission state should include:

- objective
- current plan
- subagent assignments
- returned results
- integration notes
- next actions
- open questions

The markdown PlanWiki can still exist, but it should be a readable projection of structured state, not the only state.

### 5. Make runtime bindings real

Each binding should map to a concrete runtime adapter:

- `main_chat` -> reply node
- `kg_ingest` -> ThinkGraph extraction on a pair object
- `research_agent` -> search and source retrieval worker
- `knowgraph` -> grounded fact normalization and objective write
- `neo4j` -> graph persistence step

Without this, the visual layer will stay a generic LLM card runner rather than a real orchestration system.

### 6. Make edges executable, not just descriptive

The `v3` runtime needs real support for:

- success and error routing
- conditional routing
- fan-out
- fan-in
- gates
- waits
- explicit write edges

This is also where explicit merge nodes should become first-class.

### 7. Add true parallel execution groups

The runtime should be able to run sibling nodes concurrently when their dependencies are satisfied and their edge rules allow it. The current sequential walk is fine for a scaffold, but it does not satisfy the visual programming intent.

### 8. Normalize the graph boundary

For MVP, decide this explicitly:

- ThinkGraph = provisional output only
- KnowGraph = grounded source-backed output only

Then decide whether the MVP keeps:

- ThinkGraph in the current KG v2 path and KnowGraph in Neo4j

or simplifies into:

- one Neo4j-backed graph with separate labels and write policies

Either can work, but the repo should stop leaving this implicit.

### 9. Drive the canvas from runtime events

The canvas should subscribe to real run data, not inferred summaries.

At minimum, emit events for:

- reply started
- reply completed
- pair queued for ingest
- plan updated
- agent started
- agent finished
- write to blackboard
- write to ThinkGraph
- write to KnowGraph
- merge completed

The user should be able to see which runtime object ran, what edge fired, and what state changed.

### 10. Tighten the prompt contract

The MVP should default to:

- plan creates a compact step brief
- agent type expands it
- manual full prompt remains an override

That will keep prompt writing from becoming the product.

### 11. Add end-to-end verification

Before calling this an MVP, add tests for:

- reply-first latency path
- current user + current assistant pair ingestion
- plan update after pair ingest
- agent creation from plan
- graph writes into provisional and objective targets
- live runtime event visibility in the visual layer

## Suggested Build Sequence

### Phase 1

Make `/api/agents/boss` reply first, then enqueue the fresh pair into the existing KG v2 ingest route.

### Phase 2

Create a canonical turn record and unify it with `v3` run state and blackboard state.

### Phase 3

Bind `v3` runtime bindings to the actual boss, ThinkGraph, research, KnowGraph, and Neo4j service paths.

### Phase 4

Implement real edge semantics, merge nodes, and parallel execution.

### Phase 5

Push live runtime events into the visual layer so the canvas shows real execution rather than just a saved deck.

### Phase 6

Add end-to-end tests and basic latency budgets for the reply path.

## Practical MVP Recommendation

For this repo, the shortest path is not to replace everything. It is to unify what already exists.

Recommended MVP cut:

- keep `/api/agents/boss` as the chat front door
- keep KG v2 and research services as graph workers
- make `v3` the canonical visual runtime and blackboard state
- reorder the loop so reply happens first
- use the current pair-ingest path after reply
- make the canvas reflect real run events before adding more editor complexity

## One-line Summary

Reply fast -> ingest the fresh user and assistant pair -> update the mission state -> run only the needed agents -> write provisional and grounded graph outputs -> show the real runtime on the canvas
