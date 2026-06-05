# Feature Specification: Agent Workspace Primitive

**Feature Branch**: `004-agent-workspace-primitive`

**Created**: 2026-06-05

**Status**: Draft. Specification only. Do not implement from this file until explicitly approved.

**Input**: User description: "Create the Agent Workspace Primitive spec before any trading implementation."

## Purpose

Define the minimum real LiquidAIty primitive that must work before any major vertical, including trading, is implemented.

This primitive is the project-backed AgentBuilder workspace where every Magentic-One turn produces two outputs: a natural-language `chatReply` for chat and a structured `planDraft` for the Plan Canvas. The user may refine that draft across turns, approve the current draft for execution when ready, run the approved work, return the result to chat, write durable graph-backed results into ThinkGraph, KnowGraph, and CodeGraph, and let future chat use cached project graph context.

## Hard Boundaries

- This spec does not add trading implementation.
- This spec does not refactor AgentBuilder.
- This spec does not redesign the protected chat/bus/canvas UI contract.
- This spec does not permit fallback boards, fake success, launch flags, or substitute runtime behavior.
- The active AgentBuilder route family remains `/api/projects/*`.

## User Scenarios & Testing

### User Story 1 — Two-Output Magentic-One Turn (Priority: P1)

As a user, I want every Agent Workspace turn to produce both a conversational reply and a valid structured plan draft, so chat stays natural while the Plan Canvas always reflects the current draft.

**Independent Test**: Open AgentBuilder on a real project, send a message, and verify Magentic-One returns both a `chatReply` in chat and a valid `planDraft` in the Plan Canvas.

**Acceptance Scenarios**:

1. **Given** a real project-backed workspace, **When** the user sends any message, **Then** Magentic-One returns both `chatReply` and `planDraft`.
2. **Given** a lightweight request, **When** the response completes, **Then** the `planDraft` may be minimal but is still valid and renderable.
3. **Given** the response finishes, **When** the next user message is sent, **Then** prior chat/run context remains available in the same project workspace and the current draft can be replaced or refined.

### User Story 2 — Plan Draft Lives In Plan Canvas Before Agent Work (Priority: P1)

As a user, I want the Plan Canvas to always show the current structured draft, so I can inspect, refine, and control work before anything runs.

**Independent Test**: Send a request, verify the Plan Canvas shows the current draft, then send a follow-up and verify the same draft is refined or replaced before execution.

**Acceptance Scenarios**:

1. **Given** any user turn, **When** Magentic-One responds, **Then** the current `planDraft` is shown in the Plan Canvas.
2. **Given** a follow-up user turn, **When** Magentic-One responds again, **Then** the current draft is overwritten or refined rather than silently preserved as stale plan state.
3. **Given** a current draft, **When** the user reviews it, **Then** the user can approve, reject, or request revision before execution.

### User Story 3 — Approved Plan Runs Real Agents (Priority: P1)

As a user, I want an approved plan to run through real project-backed agent execution, so the workspace performs actual work instead of simulated orchestration.

**Independent Test**: Approve a plan, verify real run events stream back, and verify the final result returns to chat and project state.

**Acceptance Scenarios**:

1. **Given** an approved plan, **When** execution begins, **Then** real run events stream through the project-backed deck runtime.
2. **Given** a run is in progress, **When** events arrive, **Then** the user can see meaningful progress in chat and/or plan context.
3. **Given** the run completes, **When** the final result is produced, **Then** the result returns to chat as project-backed state, not an ephemeral placeholder.

### User Story 4 — Default Research Plan Populates KnowGraph (Priority: P1)

As a user, I want the first useful approved plan to be research, so the system can gather evidence, populate KnowGraph, and show the result as navigable evidence instead of a vague placeholder workflow.

**Independent Test**: Approve the default research plan, verify Research Agent gathers evidence and populates KnowGraph, then inspect the resulting graph and source-backed result in chat.

**Acceptance Scenarios**:

1. **Given** an approved default research draft, **When** execution begins, **Then** Research Agent gathers sources and evidence.
2. **Given** evidence is gathered, **When** extraction completes, **Then** entities, relations, and properties are written into KnowGraph.
3. **Given** KnowGraph is populated, **When** the user inspects the result, **Then** the graph is navigable and evidence-backed rather than a static summary only.
4. **Given** the research run completes, **When** the final result is produced, **Then** chat receives a summarized result and ThinkGraph records reasoning/outcome memory.

### User Story 5 — Results Become Reusable Workspace Memory (Priority: P2)

As a user, I want important run results to write into the appropriate graph memory systems, so future chat and planning can reuse prior work.

**Independent Test**: Complete a run that produces reusable output, then send a follow-up chat request and verify prior results are available through project-backed state and graph context.

**Acceptance Scenarios**:

1. **Given** a run produces provisional planning knowledge, **When** it is persisted, **Then** it targets ThinkGraph.
2. **Given** a run produces grounded external or evidence-backed knowledge, **When** it is persisted, **Then** it targets KnowGraph.
3. **Given** a run produces code structure or codebase knowledge, **When** it is persisted, **Then** it targets CodeGraph.
4. **Given** a later chat references prior work, **When** Magentic-One plans or answers, **Then** prior project-backed results can inform the next response.

### User Story 6 — Internal Self-Work Through Local Coder + CodeGraph (Priority: P2)

As a builder, I want the Agent Workspace to support internal code/agent/card/prompt work using Local Coder plus CodeGraph, so the workspace can improve its own agent system safely after the primitive is stable.

**Independent Test**: Run a code-oriented task inside the workspace and verify the planner can route to Local Coder and CodeGraph as helper capabilities rather than ad hoc frontend logic.

**Acceptance Scenarios**:

1. **Given** a code or agent-system task, **When** the planner needs internal implementation help, **Then** Local Coder and CodeGraph are available as explicit helper capabilities.
2. **Given** Local Coder runs, **When** it performs real work, **Then** the work remains backend-owned rather than frontend-executed.
3. **Given** CodeGraph participates, **When** it returns structure or proposals, **Then** that output can inform subsequent planning and code work.

## Functional Requirements

### Core Workspace Primitive

- **FR-001**: Agent Workspace MUST provide a project-backed chat surface where the primary conductor is Magentic-One.
- **FR-002**: Every Magentic-One turn MUST produce a `chatReply` shown in chat.
- **FR-003**: Every Magentic-One turn MUST produce a valid `planDraft` shown in the Plan Canvas.
- **FR-004**: The `planDraft` MAY be minimal when no substantial multi-agent work is needed, but it MUST remain valid and renderable.
- **FR-005**: Users MUST be able to approve, reject, or revise the current `planDraft` before execution begins.
- **FR-006**: Approval MUST gate execution only; approval is NOT required to draft or update the plan.
- **FR-007**: The workspace MUST NOT use an if/else classifier that chooses between chat reply and draft plan output; both outputs are required every turn.
- **FR-008**: The workspace MUST NOT auto-run work before approval.
- **FR-009**: The Plan Canvas MUST reflect the current draft rather than fake placeholder nodes or raw runtime error text.
- **FR-010**: An approved plan MUST run through the real project-backed deck runtime.
- **FR-011**: Agent execution MUST emit runtime events that can be surfaced to the user.
- **FR-012**: Run completion MUST return a final result to chat and project-backed workspace state.
- **FR-013**: The first default approved plan behavior MUST support research work as the first useful primitive path.
- **FR-014**: The default research plan MUST support running Research Agent, gathering sources/evidence, extracting entities/relations/properties, populating KnowGraph, returning a summarized result to chat, and recording reasoning/outcome memory in ThinkGraph.

### Graph Responsibilities

- **FR-015**: Provisional, working, or planning knowledge MUST target ThinkGraph.
- **FR-016**: Grounded, evidence-backed, or citation-backed knowledge MUST target KnowGraph.
- **FR-017**: Code structure, symbols, routes, and dependency knowledge MUST target CodeGraph.
- **FR-018**: The primitive MUST define explicit graph write contracts instead of relying on implicit UI-only side effects.
- **FR-019**: Future chat/planning MUST be able to reuse prior graph-backed results from the same project.
- **FR-020**: Model input MUST eventually be shapeable by cached project graph context including current project, selected board nodes, selected graph evidence, recent run outputs, relevant ThinkGraph decisions, relevant KnowGraph evidence, and relevant CodeGraph implementation context.

### KnowGraph UI Requirements

- **FR-021**: KnowGraph MUST evolve toward a navigable evidence graph rather than a static summary surface.
- **FR-022**: The user MUST be able to click nodes and edges to inspect evidence-backed detail.
- **FR-023**: The user MUST be able to open source links and inspect provenance from the graph context.
- **FR-024**: The user MUST be able to access screenshots, tables, snippets, or equivalent evidence previews in context.
- **FR-025**: The user MUST be able to inspect confidence, provenance, and status details for selected evidence.
- **FR-026**: Selected KnowGraph context MUST be usable to shape the next chat input.

### Local Coder and CodeGraph

- **FR-027**: Local Coder MUST remain a real helper capability for internal code, agent, card, and prompt work.
- **FR-028**: CodeGraph MUST remain a first-class helper capability for structural code understanding.
- **FR-029**: Internal code/agent/card/prompt work MUST not bypass the project-backed workspace flow.

### Route and Persistence Truth

- **FR-030**: AgentBuilder project/deck behavior MUST use the canonical `/api/projects/*` route family only.
- **FR-031**: AgentBuilder MUST NOT use `/api/v2/projects` or `/api/v3/projects` for active project/deck behavior.
- **FR-032**: Saved project-backed deck state remains authoritative for workspace persistence.
- **FR-033**: The primitive MUST preserve deck integrity guards and empty/partial save protection.

### UX and Runtime Guardrails

- **FR-034**: The chat/bus/canvas layout is a protected UX contract and MUST NOT be treated as a generic split-pane by default.
- **FR-035**: The initial load view SHOULD remain chat-first, with internal helper graph visibility partially tucked under or behind chat until the user manually pans.
- **FR-036**: The workspace MUST NOT introduce roadsign banners, fake fallback boards, `displayFallback`, or `launchMode.ts`.
- **FR-037**: Runtime errors MUST NOT be converted into fake canvas nodes, raw runtime error plan content, or substitute success states.

### Future Extension Boundary

- **FR-038**: Trading is the first planned major vertical after this primitive Stage 0 is implemented and proven.
- **FR-039**: Add Agent / Template Picker is future work and MUST be specified as a later extension, not implemented in this feature.
- **FR-040**: Prezi-style camera zoom detail panels are future work and MUST NOT be implemented in Stage 0.

## Plan Schema Contract

The primitive plan model must support:

- plan id
- originating user request
- latest chat reply paired with the draft turn
- ordered steps
- targeted agents/cards per step
- approval state
- revision history or revision marker
- execution status
- user-facing summary
- valid minimal draft state when substantial work is not needed
- default research-plan compatibility

The plan contract must support at least three user actions:

- approve
- reject
- revise

## Run Event Schema Contract

The primitive run-event model must support:

- event id
- timestamp
- run id
- optional mission/agent-run ids
- event kind
- status
- associated card/agent id when relevant
- human-readable text summary
- optional structured payload for graph write proposals or execution detail

Minimum event kinds:

- run started
- step started
- progress/message
- step completed
- step failed
- run completed

## Frontend vs Backend Responsibilities

### Frontend

- project-backed chat workspace
- plan presentation and approval UI
- canvas and companion surface presentation
- deck selection and persistence UI
- runtime event display
- object/panel editing surfaces

### Backend

- project and deck persistence
- real deck runtime execution
- mission orchestration contracts
- graph write execution
- Local Coder execution boundary
- CodeGraph / ThinkGraph / KnowGraph service integration
- auth and session ownership

## MVP Stages

### Stage 0 — Contract Freeze

- document current route, UI, and persistence truth
- freeze protected UX/runtime boundaries
- no trading work yet

### Stage 0 Queue

Stage 0 is the strict waterfall-style primitive implementation spine:

- 0.0 baseline smoke and savepoint
- 0.1 route contract freeze
- 0.2 UI/viewport contract freeze
- 0.3 project/deck persistence contract
- 0.4 PlanDraft schema and type mapping
- 0.5 Magentic-One two-output turn contract: `chatReply` + `planDraft`
- 0.6 Plan Canvas renders real PlanDraft nodes/edges
- 0.7 follow-up chat overwrites/refines PlanDraft
- 0.8 approve/check promotes current PlanDraft to approved
- 0.9 approved default research plan runs Research Agent
- 0.10 Research Agent populates KnowGraph
- 0.11 KnowGraph navigable evidence graph
- 0.12 run result returns to chat
- 0.13 run result writes to ThinkGraph / KnowGraph / CodeGraph
- 0.14 cached graph context shapes next chat input
- 0.15 Local Coder / CodeGraph draft-helper role documented
- 0.16 tests/docs/acceptance freeze

### Stage 1 — First Major Vertical

- begin trading implementation only after Stage 0 is stable and accepted

## Execution Method

Use a waterfall spine with agile execution.

- strict numbered stages
- work in order at first
- each task has acceptance checks
- when done, mark done
- when blocked, document blocker and next smallest unblocker
- when deferred, move it to `future.md`
- do not reopen finished decisions unless evidence forces it
- progress over perfection once implementation starts
- strictness during specification, momentum during execution

## Success Criteria

- **SC-001**: A user can open AgentBuilder on a real project and receive both `chatReply` and a valid `planDraft` on every Magentic-One turn.
- **SC-002**: The `planDraft` may be minimal for simple requests, but it remains valid, visible in the Plan Canvas, and replaceable/refinable on later turns.
- **SC-003**: The default first useful approved plan is research-to-KnowGraph.
- **SC-004**: An approved plan produces real runtime events and a final result in the same project-backed workspace.
- **SC-005**: The resulting KnowGraph is navigable as an evidence graph with inspectable provenance.
- **SC-006**: At least one follow-up chat can reuse prior result context from the same project.
- **SC-007**: ThinkGraph, KnowGraph, and CodeGraph responsibilities are explicitly separated and documented.
- **SC-008**: Local Coder and CodeGraph remain available as real helper capabilities for internal system work.
- **SC-009**: No new AgentBuilder route family is introduced; `/api/projects/*` remains the single active project/deck route family.
- **SC-010**: No fake fallback board, `displayFallback`, or `launchMode.ts` is introduced by primitive implementation.

## Assumptions

- The current ADMIN project-backed workspace remains the baseline reference surface.
- Current route/persistence/UI truth is documented separately and treated as the baseline for future implementation.
- Some primitive behaviors already exist in partial form today, but the contracts are not yet fully formalized or protected.
- Add Agent / Template Picker is deferred until after the primitive works end to end.
