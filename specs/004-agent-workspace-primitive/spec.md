# Feature Specification: Agent Workspace Primitive

**Feature Branch**: `004-agent-workspace-primitive`

**Created**: 2026-06-05

**Status**: Draft. Specification only. Do not implement from this file until explicitly approved.

**Input**: User description: "Create the Agent Workspace Primitive spec before any trading implementation."

## Purpose

Define the minimum real LiquidAIty primitive that must work before any major vertical, including trading, is implemented.

This primitive is the project-backed AgentBuilder workspace where the real Magentic-One deck run is the source of truth. PlanDraft is not the ordinary chat brain. PlanDraft is not required for chat-submitted tasks. PlanDraft is optional future/adapter state. Real Magentic-One run trace is the source of truth for executed work.

### Research Planning Role Contract

For new research or intelligence requests, the approved workflow order is:

1. **Magentic-One**: Chats with the user, handles general questions, and routes to ThinkGraph when extracting subjective intent or reasoning is useful.
2. **ThinkGraph Agent**: Extracts subjective steelman, entities, relationships, claims, hypotheses, assumptions, risks, counterarguments, and open questions from the chat. It decides whether the graph is rich enough to offer research.
3. **Plan Agent (Canvas)**: Exposes the ThinkGraph "reveal" and the research offer readiness state to the user.
4. **User Approval**: The user revises the ideas through chat if needed, and explicitly approves the research plan when ready.
5. **Research Agent**: Runs only after approval. It gathers objective source-backed evidence (confirming and disconfirming) and returns evidence objects.
6. **KnowGraph Agent**: Consumes research outputs and ingests objective evidence into KnowGraph as entities, relationships, provenance, citations, and evidence gaps.

Research must never be executed prematurely before approval, and KnowGraph must not be written without real source-backed evidence.
There are no fake frontend PlanDrafts or deterministic tiny-message gates; Magentic-One itself exposes its real plan, and the user approves it.
KnowGraph is not the external search worker. `knowgraph_query` must not be advertised or called for new research.

ThinkGraph and KnowGraph remain separate streams. ThinkGraph stores subjective reasoning, assumptions, hypotheses, decisions, and uncertainty. KnowGraph stores objective source-backed evidence, provenance, citations, confidence, and source metadata.

### Role Boundaries

- **Magentic-One**: Chat/orchestrator/router. Does not make ThinkGraph itself. Does not make KnowGraph itself. Routes downstream agents and explains current state to user.
- **ThinkGraph Agent**: Downstream subjective/provisional graph extractor. Extracts useful reasoning from chat/AI answer pairs. Creates visible ThinkGraph nodes/edges/properties. Marks items provisional. Determines whether the graph is rich enough to offer research.
- **Plan Agent**: Exposes ThinkGraph Reveal. Creates research plan only after ThinkGraph is ready. Exposes PlanFlow/PlanCanvas. Asks approval before research.
- **Research Agent**: Runs only after approval. Gathers source-backed evidence for and against the thesis.
- **KnowGraph Agent**: Stores sourced evidence/gaps/provenance in OWL/RDF-compatible shape. Does not store unsourced ThinkGraph reasoning as fact.

### Wire Semantics

- **magentic_option**: Magentic-One membership / option wire. Direction does not matter.
- **flow**: Directed Assist-agent / graph-node execution wire. Direction matters.
- Canvas wires are real.

### Research Readiness State Machine & UI

Research is not automatic. It is offered only when the ThinkGraph is rich enough to justify objective research. ThinkGraph earns the research offer, and KnowGraph earns the factual memory.

**State Machine States:**
- `chatting`
- `thinkgraph_ready`
- `research_plan_ready`
- `approved_for_research`
- `research_running`
- `knowgraph_ready`
- `dual_graph_answer_ready`

**Readiness Logic (Graph Richness, not score soup):**
```json
{
  "status": "shaping | ready_to_plan_research | plan_ready | approved_for_research | research_running | knowgraph_ready | dual_graph_answer_ready",
  "token_count": 0,
  "entity_count": 0,
  "relationship_count": 0,
  "claim_count": 0,
  "assumption_count": 0,
  "risk_or_counterargument_count": 0,
  "evidence_needed_count": 0,
  "researchable_question_count": 0,
  "required_slots": {
    "central_thesis": false,
    "key_entities": false,
    "relationships": false,
    "assumptions": false,
    "risks_or_counterarguments": false,
    "evidence_needed": false,
    "disconfirming_questions": false
  },
  "missing": [],
  "researchable_questions": [],
  "research_offer": {
    "question": "",
    "why_now": "",
    "evidence_to_find": [],
    "disconfirming_evidence_to_find": []
  },
  "offer_research": false
}
```

**Baseline Readiness Heuristic:**
Set status = ready_to_plan_research only when ThinkGraph has enough graph substance to create a useful research plan:
- meaningful entities
- meaningful relationships
- at least one claim/thesis/intent
- at least one assumption
- at least one risk or counterargument
- at least one evidence-needed question
- at least one disconfirming question
- at least two researchable questions

Token count is a weak signal only and must not trigger research on its own.
ThinkGraph should act as a research-question former (e.g. "Which catalysts, dilution events, customer concentration risks, partnership milestones, and deployment evidence would materially change the ASTS/RKLB/PL 6-18 month thesis?").

*User-facing language must reflect state smoothly (e.g., "ThinkGraph needs more shape.", "ThinkGraph is ready to plan research.", "Research plan ready for approval.", "Research approved.").*

**UI / PlanCanvas / ThinkGraph panel:**
1. On first chat pair, begin populating visible ThinkGraph next to chat.
2. If graph is sparse, show `missing_for_research` and ask clarifying questions.
3. If graph is ready, show temporary button: "Plan Research".
4. When clicked, Plan Agent creates research plan in PlanFlow/PlanCanvas.
5. PlanFlow shows: research question, scope, evidence needed, disconfirming evidence, source targets, expected output, and approval required.
6. User approves.
7. Research Agent runs.
8. KnowGraph populates.
9. Magentic-One receives dual graph context and answers.

### Dual Graph Context & Traversal

Before answering after research, the system must retrieve:
- Relevant ThinkGraph reasoning
- Relevant KnowGraph evidence
- Contradictions / support / evidence gaps
- Prior-turn relationships if present

**Traversal Baseline:**
- Entity match
- Depth 1-2 neighborhood traversal
- Recent run context
- Top evidence gaps

**Visual Baseline:**
- ThinkGraph lights up when populated
- Active agent cards light up when called
- KnowGraph lights up when evidence is written
- (Full traversal animation can come later)

### Graph Context Packet Contract

Before future Magentic-One answers are shaped by prior project memory, the workspace should use a stream-separated `GraphContextPacket` contract rather than overloading `PlanDraft`.

The packet keeps these streams separate:

- `selectedBoardContext`
- `thinkGraphContext`
- `knowGraphContext`
- `codeGraphContext`
- `comparison`
- `provenance`

The packet must not merge ThinkGraph and KnowGraph into one undifferentiated blob. It must also not copy grounded KnowGraph evidence into ThinkGraph or treat `PlanDraft` as durable graph memory.

Current readiness reality:

- the backend/sidecar stack already has separate `plan`, `thinkGraph`, `knowGraph`, and `workspaceObjectContext` envelopes
- research ingestion and KnowGraph write paths are real but mixed across current and legacy surfaces
- query/read surfaces exist, but they are split across current routes, legacy KG routes, and service helpers
- Magentic-One does not yet receive a project-built `GraphContextPacket`; today it mostly receives empty/default graph envelopes unless another path pre-populates them

Preferred product-safe query path:

- a backend `GraphContextBuilder` or `GraphContextService`
- reads ThinkGraph separately
- reads KnowGraph separately
- reads CodeGraph separately when relevant
- returns one stream-separated `GraphContextPacket`
- preserves provenance/confidence/source labels
- exposes a safe read-only endpoint or tool boundary for Magentic-One

Raw terminal or ad hoc Cypher access may exist for development or admin fallback, but it is not the normal product path for Agent Workspace chat.

Current Stage 0 implementation truth:

- a read-only backend builder boundary now exists at `apps/backend/src/services/graphContext/graphContextBuilder.ts`
- it returns a stream-separated `GraphContextPacket`
- it uses real project-scoped KnowGraph reads where available
- it uses real AGE/ThinkGraph reads where available
- it returns an honest partial CodeGraph stream with debug notes until a canonical backend CodeGraph reader exists
- it does not write, delete, or merge graph memory
- it is not wired into Magentic-One prompt shaping yet

## Hard Boundaries

- This spec does not add trading implementation.
- This spec does not refactor AgentBuilder.
- This spec does not redesign the protected chat/bus/canvas UI contract.
- This spec does not permit fallback boards, fake success, launch flags, or substitute runtime behavior.
- The active AgentBuilder route family remains `/api/projects/*`.

## User Scenarios & Testing

### User Story 1 — Real Magentic-One Source of Truth (Priority: P1)

As a user, I want chat-submitted tasks to trigger the real Magentic-One runtime, so my work is backed by actual orchestration and not simulated front-end planning.

**Independent Test**: Open AgentBuilder on a real project, send a message, and verify Magentic-One executes the deck and returns a real run trace.

**Acceptance Scenarios**:

1. **Given** a real project-backed workspace, **When** the user sends any task, **Then** Magentic-One runs the deck natively and returns a real execution trace.
2. **Given** an ordinary chat request, **When** the response completes, **Then** the actual trace is displayed in the Plan/status surface.
3. **Given** the response finishes, **When** the next user message is sent, **Then** prior chat/run context remains available in the same project workspace.

### User Story 2 — ThinkGraph Earns the Research Offer (Priority: P1)

As a user, I want my chat to progressively build a ThinkGraph of reasoning, and only when it is rich enough, I am offered the ability to plan research.

**Independent Test**: Chat with Magentic-One. Verify ThinkGraph builds visibly. Verify a Plan Research offer appears only when the graph is rich enough.

**Acceptance Scenarios**:

1. **Given** an initial user turn, **When** the turn completes, **Then** the ThinkGraph begins to populate visibly beside the chat.
2. **Given** a sparse ThinkGraph, **When** the user sends a message, **Then** Magentic-One asks clarifying questions instead of offering research.
3. **Given** a sufficiently rich ThinkGraph, **When** the status updates, **Then** a "Plan Research" option is offered to the user.

### User Story 3 — Approved Plan Runs Real Agents (Priority: P1)

As a user, I want an approved plan to run through real project-backed agent execution, so the workspace performs actual work instead of simulated orchestration.

**Independent Test**: Approve a plan, verify real run events stream back, and verify the final result returns to chat and project state.

**Acceptance Scenarios**:

1. **Given** an approved plan, **When** execution begins, **Then** real run events stream through the project-backed deck runtime.
2. **Given** a run is in progress, **When** events arrive, **Then** the user can see meaningful progress in chat and/or plan context.
3. **Given** the run completes, **When** the final result is produced, **Then** the result returns to chat as project-backed state, not an ephemeral placeholder.

### User Story 4 — Approved Research Runs Agents and Populates KnowGraph (Priority: P1)

As a user, I want an approved research plan to gather evidence, populate KnowGraph, and show the result as navigable evidence instead of a vague placeholder workflow.

**Independent Test**: Approve the default research plan, verify Research Agent gathers evidence and populates KnowGraph, then inspect the resulting graph and source-backed result in chat.

**Acceptance Scenarios**:

1. **Given** an approved research offer, **When** execution begins, **Then** Research Agent gathers sources and evidence.
2. **Given** evidence is gathered, **When** extraction completes, **Then** entities, relations, and properties are written into KnowGraph.
3. **Given** KnowGraph is populated, **When** the user inspects the result, **Then** the graph is navigable and evidence-backed rather than a static summary only.
4. **Given** the research run completes, **When** the final result is produced, **Then** chat receives a summarized result and the user can see divergence between subjective ThinkGraph and objective KnowGraph.

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

### User Story 7 — Acceptance Tests for Research Readiness Flow (Priority: P1)

**Test 1: Weak prompt**
- **Input**: "knowledge graphs are cool"
- **Expected**: Normal chat response. ThinkGraph begins sparse population. Status remains `chatting` or `thinkgraph_ready=false`. Asks user to clarify intent. No "Plan Research" offer. No Research Agent execution. No KnowGraph write.

**Test 2: Richer prompt**
- **Input**: "I want to evaluate whether AST SpaceMobile, Rocket Lab, and Planet Labs are credible asymmetric space/telecom candidates over 6-18 months, focusing on catalysts, dilution risk, partnerships, customer concentration, and evidence against the thesis."
- **Expected**: ThinkGraph populated with entities/relationships/claims/assumptions/risks/evidence-needed. `research_offer_ready = true`. "Plan Research" button appears. Research Agent does not run yet.

**Test 3: Plan Research**
- **Input**: User clicks "Plan Research" or says "Plan Research".
- **Expected**: Plan Agent creates PlanFlow research plan. Approval required is visible. Research Agent does not run yet.

**Test 4: Approval**
- **Input**: User says "Approve objective research."
- **Expected**: `status = approved_for_research`. Research Agent runs. KnowGraph Agent stores only source-backed evidence/gaps. Magentic-One answers using separated ThinkGraph and KnowGraph context.

## Lightweight Skills System

A minimal skills layer is used where the Agent prompt = role and boundaries, the Skill pack = reusable reasoning behavior, and Tools = actual capabilities.

**Magentic-One**: `clarify_intent`, `route_by_graph_state`, `preserve_human_approval`, `explain_current_state`, `avoid_worker_job_leakage`
**ThinkGraph Agent**: `extract_subjective_graph`, `steelman_user_idea`, `form_researchable_questions`, `detect_missing_slots`, `compute_graph_richness`, `mark_provisional`
**Plan Agent**: `expose_thinkgraph_reveal`, `create_planflow`, `request_approval`, `show_missing_slots`, `show_subjective_vs_objective`
**Research Agent**: `search_confirming_evidence`, `search_disconfirming_evidence`, `extract_source_claims`, `preserve_provenance`, `avoid_unsourced_claims`
**KnowGraph Agent**: `normalize_evidence_graph`, `preserve_citations`, `store_contradictions`, `store_evidence_gaps`, `reject_unsourced_reasoning_as_fact`

## Functional Requirements

### Core Workspace Primitive

- **FR-001**: Agent Workspace MUST provide a project-backed chat surface where the primary conductor is Magentic-One.
- **FR-002**: Every chat turn MUST trigger the real Magentic-One deck run.
- **FR-003**: Magentic-One MUST route downstream rather than planning research itself.
- **FR-004**: The ThinkGraph Agent MUST determine research readiness based on graph richness, not a generic frontend PlanDraft.
- **FR-005**: Users MUST be able to see real Magentic-One progress traces in the UI.
- **FR-006**: The workspace MUST NOT run automated research without user approval of the research plan.
- **FR-007**: The Plan Canvas MUST reflect the ThinkGraph Reveal and the active research plan state rather than fake placeholder nodes.
- **FR-008**: An approved or typed task MUST run through the real project-backed deck runtime.
- **FR-009**: Agent execution MUST emit runtime events (`magentic_trace`) that can be surfaced to the user.
- **FR-010**: Run completion MUST return a final result to chat and project-backed workspace state.
- **FR-013**: Research planning MUST only be offered when ThinkGraph has sufficient graph substance (entities, relationships, claims, risks, evidence gaps).
- **FR-014**: The approved research plan MUST support running Research Agent, gathering objective evidence, populating KnowGraph, and returning a result comparing subjective ThinkGraph with objective KnowGraph.

### Graph Responsibilities

- **FR-015**: Provisional, working, or planning knowledge MUST target ThinkGraph.
- **FR-016**: Grounded, evidence-backed, or citation-backed knowledge MUST target KnowGraph.
- **FR-017**: Code structure, symbols, routes, and dependency knowledge MUST target CodeGraph.
- **FR-018**: The primitive MUST define explicit graph write contracts instead of relying on implicit UI-only side effects.
- **FR-019**: Future chat/planning MUST be able to reuse prior graph-backed results from the same project.
- **FR-020**: Model input MUST eventually be shapeable by cached project graph context including current project, selected board nodes, selected graph evidence, recent run outputs, relevant ThinkGraph decisions, relevant KnowGraph evidence, and relevant CodeGraph implementation context.
- **FR-020a**: Replacing the current `PlanDraft` MUST only replace the current draft view; it MUST NOT clear durable ThinkGraph context, KnowGraph evidence, CodeGraph memory, or preserved approved/run-history continuity.
- **FR-020b**: Cached project context for future turns MUST remain stream-separated as `thinkGraphContext`, `knowGraphContext`, and optional `codeGraphContext`, with explicit comparison of congruence, conflict, missing evidence, and confidence gaps rather than one merged blob.
- **FR-020c**: The stream-separated graph context contract MUST support `selectedBoardContext`, `thinkGraphContext`, `knowGraphContext`, `codeGraphContext`, `comparison`, and provenance/debug metadata for future prompt shaping.
- **FR-020d**: `PlanDraft` MUST remain the current draft-plan contract and MUST NOT become the durable owner of graph memory or next-turn graph context.
- **FR-020e**: The first runtime path for next-turn graph context MUST be a safe read-only builder/service boundary that queries ThinkGraph, KnowGraph, and CodeGraph separately rather than relying on raw terminal access as the primary product behavior.

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

The primitive plan model is driven by the ThinkGraph readiness object, not a monolithic fake frontend draft.

It must support:

- `status` (shaping, ready_to_plan_research, plan_ready, approved_for_research, research_running, knowgraph_ready, dual_graph_answer_ready)
- `token_count`
- `entity_count`, `relationship_count`, `claim_count`, `assumption_count`, `risk_or_counterargument_count`, `evidence_needed_count`, `researchable_question_count`
- `required_slots`
- `missing` (clarification asks)
- `researchable_questions`
- `research_offer` details (question, why_now, evidence_to_find, disconfirming_evidence_to_find)
- `offer_research` boolean

The plan contract must support at least three user actions in the PlanCanvas:

- approve research
- reject research
- ask to revise intent via chat

## Plan Structure Ownership

The Stage 0 primitive uses a strict ownership model aligned with the graph richness logic instead of legacy frontend drafting.

| Structure | Current location | Role | Ownership | Risk if used incorrectly |
| --- | --- | --- | --- | --- |
| `ReadinessObject` | TBD | ThinkGraph's output defining readiness state | canonical | Relying on score soup instead of graph richness |
| `PlanDraft` | `client/src/features/agentbuilder/plan/planDraftTypes.ts` | Legacy frontend draft wrapper (deprecated) | deprecated | Retaining fake frontend gates and logic |
| `MissionSpec` / `MissionRun` | `client/src/types/agentgraph.ts` | Execution adapter for the current approved-run path | adapter | Execution details leak back into authoring state |
| `PlanMissionGraph` | `client/src/components/assist/planMissionModel.ts` | Visual Plan Canvas graph representation | visual-only | Visual geometry or fallback nodes leak into business truth |
| `deckRunState` `structuredPlan` payload | `client/src/components/builder/deckRunState.ts` | Runtime continuity snapshot from persisted runs | runtime-only | Stale run artifacts overwrite the current draft |
| AutoGen `PlanContext` | `apps/python-models/app/python_models/orchestration_contracts.py` | Orchestrator context/result envelope | envelope | Sidecar-specific shape drift destabilizes frontend plan state |

Ownership rules:

- ThinkGraph Readiness Object is the canonical research trigger.
- `PlanDraft` is deprecated as a monolithic upfront gate.
- `MissionSpec` is an execution adapter, not the long-term draft owner.
- `PlanMissionGraph` is visual, not business truth.

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
- 0.5 Post-turn ThinkGraph extraction from chat pairs
- 0.6 Plan Canvas renders ThinkGraph Reveal and readiness
- 0.7 follow-up chat updates provisional graph
- 0.8 approve/check promotes plan state to approved
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

- **SC-001**: A user can open AgentBuilder on a real project and chat naturally, with ThinkGraph building from the completed user/assistant chat pairs.
- **SC-002**: Research planning is only offered when the ThinkGraph is sufficiently rich and contains researchable questions.
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
