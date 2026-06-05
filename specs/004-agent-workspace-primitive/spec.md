# Feature Specification: Agent Workspace Primitive

**Feature Branch**: `004-agent-workspace-primitive`

**Created**: 2026-06-05

**Status**: Draft. Specification only. Do not implement from this file until explicitly approved.

**Input**: User description: "Create the Agent Workspace Primitive spec before any trading implementation."

## Purpose

Define the minimum real LiquidAIty primitive that must work before any major vertical, including trading, is implemented.

This primitive is the project-backed AgentBuilder workspace where a user chats with Magentic-One, receives either a direct answer or a structured multi-agent plan, approves or revises that plan, runs the approved work, and gets durable graph-backed results that can be reused in future chat.

## Hard Boundaries

- This spec does not add trading implementation.
- This spec does not refactor AgentBuilder.
- This spec does not redesign the protected chat/bus/canvas UI contract.
- This spec does not permit fallback boards, fake success, launch flags, or substitute runtime behavior.
- The active AgentBuilder route family remains `/api/projects/*`.

## User Scenarios & Testing

### User Story 1 — Direct Chat With Magentic-One (Priority: P1)

As a user, I want to chat in the Agent Workspace and receive a direct answer when no multi-agent work is needed, so simple tasks feel immediate and do not force plan approval.

**Independent Test**: Open AgentBuilder on a real project, send a simple question, and verify Magentic-One returns a direct answer in chat without opening a plan approval flow.

**Acceptance Scenarios**:

1. **Given** a real project-backed workspace, **When** the user sends a simple question, **Then** Magentic-One may answer directly in chat.
2. **Given** a direct-answer case, **When** the response completes, **Then** no approval-required mission is opened.
3. **Given** the response finishes, **When** the next user message is sent, **Then** prior chat/run context remains available in the same project workspace.

### User Story 2 — Structured Plan Proposal Before Agent Work (Priority: P1)

As a user, I want the workspace to propose a structured plan when a task requires multiple agents or risky actions, so I can inspect and control the work before it runs.

**Independent Test**: Send a complex request, verify a structured plan draft appears, and verify the user can approve, reject, or revise it before execution.

**Acceptance Scenarios**:

1. **Given** a request that needs multiple steps or agent delegation, **When** Magentic-One evaluates it, **Then** a structured plan proposal is created instead of auto-running.
2. **Given** a proposed plan, **When** the user reviews it, **Then** the user can approve, reject, or request revision.
3. **Given** a rejected or revised plan, **When** the workspace updates it, **Then** no prior rejected plan auto-runs.

### User Story 3 — Approved Plan Runs Real Agents (Priority: P1)

As a user, I want an approved plan to run through real project-backed agent execution, so the workspace performs actual work instead of simulated orchestration.

**Independent Test**: Approve a plan, verify real run events stream back, and verify the final result returns to chat and project state.

**Acceptance Scenarios**:

1. **Given** an approved plan, **When** execution begins, **Then** real run events stream through the project-backed deck runtime.
2. **Given** a run is in progress, **When** events arrive, **Then** the user can see meaningful progress in chat and/or plan context.
3. **Given** the run completes, **When** the final result is produced, **Then** the result returns to chat as project-backed state, not an ephemeral placeholder.

### User Story 4 — Results Become Reusable Workspace Memory (Priority: P2)

As a user, I want important run results to write into the appropriate graph memory systems, so future chat and planning can reuse prior work.

**Independent Test**: Complete a run that produces reusable output, then send a follow-up chat request and verify prior results are available through project-backed state and graph context.

**Acceptance Scenarios**:

1. **Given** a run produces provisional planning knowledge, **When** it is persisted, **Then** it targets ThinkGraph.
2. **Given** a run produces grounded external or evidence-backed knowledge, **When** it is persisted, **Then** it targets KnowGraph.
3. **Given** a run produces code structure or codebase knowledge, **When** it is persisted, **Then** it targets CodeGraph.
4. **Given** a later chat references prior work, **When** Magentic-One plans or answers, **Then** prior project-backed results can inform the next response.

### User Story 5 — Internal Self-Work Through Local Coder + CodeGraph (Priority: P2)

As a builder, I want the Agent Workspace to support internal code/agent/card/prompt work using Local Coder plus CodeGraph, so the workspace can improve its own agent system safely after the primitive is stable.

**Independent Test**: Run a code-oriented task inside the workspace and verify the planner can route to Local Coder and CodeGraph as helper capabilities rather than ad hoc frontend logic.

**Acceptance Scenarios**:

1. **Given** a code or agent-system task, **When** the planner needs internal implementation help, **Then** Local Coder and CodeGraph are available as explicit helper capabilities.
2. **Given** Local Coder runs, **When** it performs real work, **Then** the work remains backend-owned rather than frontend-executed.
3. **Given** CodeGraph participates, **When** it returns structure or proposals, **Then** that output can inform subsequent planning and code work.

## Functional Requirements

### Core Workspace Primitive

- **FR-001**: Agent Workspace MUST provide a project-backed chat surface where the primary conductor is Magentic-One.
- **FR-002**: The workspace MUST allow Magentic-One to answer directly when no multi-agent plan is needed.
- **FR-003**: The workspace MUST create a structured plan proposal when work requires multiple agents, explicit approval, or risky execution.
- **FR-004**: Users MUST be able to approve, reject, or revise a proposed plan before execution begins.
- **FR-005**: An approved plan MUST run through the real project-backed deck runtime.
- **FR-006**: Agent execution MUST emit runtime events that can be surfaced to the user.
- **FR-007**: Run completion MUST return a final result to chat and project-backed workspace state.

### Graph Responsibilities

- **FR-008**: Provisional, working, or planning knowledge MUST target ThinkGraph.
- **FR-009**: Grounded, evidence-backed, or citation-backed knowledge MUST target KnowGraph.
- **FR-010**: Code structure, symbols, routes, and dependency knowledge MUST target CodeGraph.
- **FR-011**: The primitive MUST define explicit graph write contracts instead of relying on implicit UI-only side effects.
- **FR-012**: Future chat/planning MUST be able to reuse prior graph-backed results from the same project.

### Local Coder and CodeGraph

- **FR-013**: Local Coder MUST remain a real helper capability for internal code, agent, card, and prompt work.
- **FR-014**: CodeGraph MUST remain a first-class helper capability for structural code understanding.
- **FR-015**: Internal code/agent/card/prompt work MUST not bypass the project-backed workspace flow.

### Route and Persistence Truth

- **FR-016**: AgentBuilder project/deck behavior MUST use the canonical `/api/projects/*` route family only.
- **FR-017**: AgentBuilder MUST NOT use `/api/v2/projects` or `/api/v3/projects` for active project/deck behavior.
- **FR-018**: Saved project-backed deck state remains authoritative for workspace persistence.
- **FR-019**: The primitive MUST preserve deck integrity guards and empty/partial save protection.

### UX and Runtime Guardrails

- **FR-020**: The chat/bus/canvas layout is a protected UX contract and MUST NOT be treated as a generic split-pane by default.
- **FR-021**: The initial load view SHOULD remain chat-first, with internal helper graph visibility partially tucked under or behind chat until the user manually pans.
- **FR-022**: The workspace MUST NOT introduce roadsign banners, fake fallback boards, `displayFallback`, or `launchMode.ts`.
- **FR-023**: Runtime errors MUST NOT be converted into fake canvas nodes or substitute success states.

### Future Extension Boundary

- **FR-024**: Trading is the first planned major vertical after this primitive is implemented and proven.
- **FR-025**: Add Agent / Template Picker is future work and MUST be specified as a later extension, not implemented in this feature.

## Plan Schema Contract

The primitive plan model must support:

- plan id
- originating user request
- ordered steps
- targeted agents/cards per step
- approval state
- revision history or revision marker
- execution status
- user-facing summary

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

### Stage 1 — Direct Chat Primitive

- prove direct Magentic-One replies
- define direct-reply vs plan-required decision boundary

### Stage 2 — Plan Proposal Primitive

- formalize plan schema
- show approve/reject/revise flow

### Stage 3 — Approved Run Primitive

- formalize mission/run event schema
- prove real run execution from approved plans

### Stage 4 — Graph Write Primitive

- formalize ThinkGraph / KnowGraph / CodeGraph write contracts
- prove follow-up chat can reuse prior results

### Stage 5 — Internal Self-Work Primitive

- define Local Coder + CodeGraph workflow for internal code/agent/card/prompt work

### Stage 6 — First Major Vertical

- begin trading implementation only after the primitive above is stable and accepted

## Success Criteria

- **SC-001**: A user can open AgentBuilder on a real project and receive a direct Magentic-One reply for a simple request without a plan approval flow.
- **SC-002**: A user can submit a complex request and receive a structured plan proposal with approve, reject, and revise options.
- **SC-003**: An approved plan produces real runtime events and a final result in the same project-backed workspace.
- **SC-004**: At least one follow-up chat can reuse prior result context from the same project.
- **SC-005**: ThinkGraph, KnowGraph, and CodeGraph responsibilities are explicitly separated and documented.
- **SC-006**: Local Coder and CodeGraph remain available as real helper capabilities for internal system work.
- **SC-007**: No new AgentBuilder route family is introduced; `/api/projects/*` remains the single active project/deck route family.
- **SC-008**: No fake fallback board, `displayFallback`, or `launchMode.ts` is introduced by primitive implementation.

## Assumptions

- The current ADMIN project-backed workspace remains the baseline reference surface.
- Current route/persistence/UI truth is documented separately and treated as the baseline for future implementation.
- Some primitive behaviors already exist in partial form today, but the contracts are not yet fully formalized or protected.
- Add Agent / Template Picker is deferred until after the primitive works end to end.
