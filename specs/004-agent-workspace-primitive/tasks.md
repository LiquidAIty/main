# Tasks: Agent Workspace Primitive

**Spec**: `specs/004-agent-workspace-primitive/spec.md`
**Plan**: `specs/004-agent-workspace-primitive/plan.md`
**Last updated**: 2026-06-05

## Status

Planning and task refinement only.

This queue is the implementation order for the Agent Workspace Primitive.

Do not:

- start trading implementation from this queue
- refactor AgentBuilder broadly from this queue
- change the chat/bus/canvas layout from this queue
- change canonical `/api/projects` routing from this queue
- add OpenClaude terminal execution behavior from this queue

## Protected Baseline

Every task below must preserve:

- canonical `/api/projects/*` project/deck route family
- project-backed deck persistence
- deck integrity guards
- empty/partial save protection
- protected chat/bus/canvas viewport contract
- splitter resize and under-chat reveal behavior
- no `launchMode.ts`
- no `displayFallback`
- no fake fallback boards
- no if/else classifier gate between chat reply and plan draft
- no auto-run before approval
- no fake plan nodes
- no raw runtime errors as plan content

## Build Queue

### P0 — Baseline Smoke And Contract Freeze

- [ ] `P0-T001` Run a baseline smoke on the ADMIN workspace and record the current working primitive entry points.
  - Goal: confirm the workspace baseline before primitive implementation starts.
  - Likely files: no runtime changes required; reference only `docs/agentbuilder-current-architecture.md`, `docs/agentbuilder-route-contract.md`, `docs/agentbuilder-ui-contract.md`, `docs/agentbuilder-viewport-contract.md`.
  - Acceptance test: ADMIN loads, board renders, project-backed deck loads, chat and canvas are both visible, no route/version drift is introduced.
  - Do not touch: layout, persistence, routes, deck integrity.
  - Risk: low.

- [ ] `P0-T002` Freeze the primitive vocabulary shared by chat, plan, run events, and graph writes.
  - Goal: ensure implementation uses one stable set of terms for `chatReply`, `planDraft`, approved plan, run event, and graph write.
  - Likely files: `specs/004-agent-workspace-primitive/spec.md`, `plan.md`, `tasks.md`.
  - Acceptance test: spec, plan, and tasks use the same primitive terms without contradiction.
  - Do not touch: runtime code.
  - Risk: low.

### P0.5 — Cleanup Parity Audit

- [ ] `P0.5-T001` Audit the codebase for duplicate route families and mixed runtime paths.
  - Goal: identify other places that need the same treatment as project route demixing.
  - Likely files: route/docs audit only.
  - Acceptance test: checklist exists for duplicate route families and mixed runtime paths.
  - Do not touch: runtime behavior.
  - Risk: low.

- [ ] `P0.5-T002` Audit the codebase for stale compatibility fallbacks and fake placeholder UI.
  - Goal: identify stale fallback systems and fake UI that should later be removed or documented.
  - Likely files: docs/audit checklist only.
  - Acceptance test: checklist exists for compatibility fallbacks and fake placeholder UI.
  - Do not touch: runtime behavior.
  - Risk: low.

- [ ] `P0.5-T003` Audit active/inactive surface boundaries and overlapping plan/graph models.
  - Goal: identify old inactive surfaces still leaking active, plus overlapping plan and graph models.
  - Likely files: docs/audit checklist only.
  - Acceptance test: checklist exists for inactive-surface leaks and overlapping plan/graph models.
  - Do not touch: UI layout or surface behavior.
  - Risk: low.

- [ ] `P0.5-T004` Audit frontend-owned backend orchestration hotspots.
  - Goal: identify page-owned mission execution, KG orchestration, and other frontend-owned backend logic for later cleanup.
  - Likely files: docs/audit checklist only.
  - Acceptance test: checklist exists for frontend-owned backend orchestration hotspots.
  - Do not touch: runtime behavior.
  - Risk: low.

### P0.6 — Magentic-One / Plan Surface Capability Audit

- [ ] `P0.6-T001` Audit where chat currently creates and updates mission or plan draft state.
  - Goal: map the current planning path before defining `PlanDraft`.
  - Likely files: `client/src/pages/agentbuilder.tsx`, `client/src/components/builder/chatPlanCompanion.ts`.
  - Acceptance test: the current draft-entry path, approval read path, and run-start path are documented.
  - Do not touch: runtime behavior.
  - Risk: low.

- [ ] `P0.6-T002` Audit how Plan Canvas currently derives structured nodes, edges, order, and fallback content.
  - Goal: map what already exists in the plan surface instead of replacing it blindly.
  - Likely files: `client/src/components/builder/assistPlanSurface.ts`, `client/src/components/assist/planMissionModel.ts`, `client/src/components/assist/PlanMissionFlow.tsx`.
  - Acceptance test: current structured data, derived data, and fallback data paths are documented.
  - Do not touch: plan surface behavior.
  - Risk: low.

- [ ] `P0.6-T003` Audit Magentic-One connected-agent awareness and callable-participant routing.
  - Goal: verify how connected agents on the board are exposed to Magentic-One today.
  - Likely files: `apps/backend/src/v3/cards/runtime.ts`, `apps/backend/src/services/autogen/autogenOrchestratorClient.ts`, `apps/python-models/app/python_models/orchestration_contracts.py`, `apps/python-models/app/python_models/autogen_orchestrator.py`.
  - Acceptance test: callable-head routing, participant visibility, and current structured-output capability are documented.
  - Do not touch: runtime behavior.
  - Risk: low.

- [ ] `P0.6-T004` Audit the current research-to-KnowGraph default path.
  - Goal: verify what already exists for Research Agent, KnowGraph population, and evidence inspection.
  - Likely files: `client/src/pages/agentbuilder.tsx`, `apps/backend/src/services/research/researchService.ts`, knowledge surface files, related docs.
  - Acceptance test: existing research path, missing pieces, and future `PlanDraft` mapping inputs are documented.
  - Do not touch: runtime behavior.
  - Risk: low.

### P1 — PlanDraft Schema And Types

- [x] `P1-T001` Define the primitive draft-plan contract and map it against existing mission and plan structures.
  - Goal: define `PlanDraft` by mapping existing `MissionSpec`, plan surface, mission graph, and run continuity structures instead of replacing them blindly.
  - Implemented in: `client/src/features/agentbuilder/plan/planDraftTypes.ts`, `client/src/features/agentbuilder/plan/planDraftMapping.ts`, `client/src/features/agentbuilder/plan/planDraftMapping.spec.ts`.
  - Acceptance test: `npx tsc --noEmit -p client/tsconfig.json` and `npx vitest run client/src/features/agentbuilder/plan/planDraftMapping.spec.ts`.
  - Note: `PlanDraft` is a contract/model layer only in this stage. Runtime wiring remains for `P2` and `P3`.
  - Do not touch: deck autosave, layout, route family.
  - Risk: medium.

- [x] `P1-T002` Map existing `MissionSpec`, `StructuredAssistPlanSurface`, and `PlanMissionGraph` responsibilities to the new primitive contract.
  - Goal: document and encode which type is source-of-truth versus derived presentation.
  - Implemented in: `client/src/features/agentbuilder/plan/planDraftOwnership.ts`, `client/src/features/agentbuilder/plan/planDraftTypes.ts`, `specs/004-agent-workspace-primitive/spec.md`, `docs/agentbuilder-current-architecture.md`.
  - Acceptance test: ownership is explicit for `PlanDraft`, `MissionSpec`, `ChatPlanDraftResult`, `StructuredAssistPlanSurface`, `PlanMissionGraph`, `deckRunState` `structuredPlan`, and AutoGen `PlanContext`.
  - Note: runtime wiring should not begin until this ownership split is treated as the baseline for `P2`.
  - Do not touch: mission run path, graph writes.
  - Risk: medium.

### P2 — Magentic-One Two-Output Turn Contract

- [x] `P2-T001` Formalize the two-output Magentic-One turn contract in the AgentBuilder chat conductor.
  - Goal: every turn returns both `chatReply` and `planDraft`.
  - Implemented in: `client/src/pages/agentbuilder.tsx`, `client/src/components/builder/chatPlanCompanion.ts`, `client/src/features/agentbuilder/state/useAgentBuilderDeck.ts`, `client/src/features/agentbuilder/plan/planDraftMapping.ts`, `client/src/types/agentgraph.ts`.
  - Acceptance test: one user turn returns a conversational `chatReply` in chat and a valid `planDraft` bridge for the Plan Canvas, while follow-up chat refines the current draft without auto-running an approved mission.
  - Note: this stage keeps `MissionSpec` approval/run behavior intact and bridges draft authoring through canonical `PlanDraft` state plus existing Plan Canvas structures.
  - Do not touch: layout, routes, persistence rules.
  - Risk: medium.

- [x] `P2-T002` Ensure the `planDraft` is valid even when the work is lightweight.
  - Goal: the draft may be minimal, but it must still be renderable and structurally valid.
  - Implemented in: `client/src/components/builder/chatPlanCompanion.ts`, `client/src/features/agentbuilder/plan/planDraftGuards.ts`, `client/src/features/agentbuilder/plan/planDraftMapping.ts`, `client/src/pages/agentbuilder.tsx`.
  - Acceptance test: simple requests produce a minimal valid draft with no fake agent nodes, no raw runtime-noise plan text, and no approval-path regression; research requests still produce useful multi-step drafts.
  - Note: lightweight turns now stay `PlanDraft`-truthful and agent-free while real work requests still expand through the existing mission adapter path.
  - Do not touch: mission execution behavior.
  - Risk: medium.

### P3 — Chat Turn Updates Plan Canvas Draft

- [x] `P3-T001` Bind the primitive draft-plan contract to the existing structured plan surface.
  - Goal: Plan Canvas must render real draft steps from the current plan contract, not ad hoc inferred filler.
  - Implemented in: `client/src/features/agentbuilder/plan/planDraftMapping.ts`, `client/src/components/assist/PlanMissionFlow.tsx`, `client/src/pages/agentbuilder.tsx`, `client/src/components/builder/chatPlanCompanion.ts`.
  - Acceptance test: plan nodes/steps correspond to the actual current draft, lightweight drafts stay minimal, and no fake fallback goal/note nodes appear.
  - Note: Research planning role contract fixed: ThinkGraph intent/context -> Research swarm/source gathering -> KnowGraph evidence ingestion -> Context Builder prepares separate ThinkGraph and KnowGraph packets for next-turn context. Ordinary chat turns draft and reply without auto-running the deck before approval.
  - Do not touch: viewport behavior, bus/chat layout.
  - Risk: medium.

- [x] `P3-T002` Ensure Plan Canvas reflects the current draft from the latest turn.
  - Goal: later turns update the visible draft instead of leaving stale plan content on screen.
  - Implemented in: `client/src/components/builder/chatPlanCompanion.ts`, `client/src/pages/agentbuilder.tsx`, `client/src/features/agentbuilder/plan/planDraftMapping.spec.ts`.
  - Acceptance test: research/refine turns replace the visible current draft graph, a later lightweight explanatory turn clears stale research plan nodes from the current `PlanDraft` view, and old preserved run-history text does not become the current plan graph.
  - Note: page-owned draft adapter state and plan editor overrides now reset on draft identity change, while lightweight explanatory turns no longer inherit prior research mission structure. This only replaces the current draft view; it does not clear durable ThinkGraph, KnowGraph, CodeGraph, or approved/run-history memory.
  - Do not touch: runtime execution path.
  - Risk: medium.

- [x] `P3-T003` Audit graph ingestion, storage, and query readiness before GraphContextPacket runtime wiring.
  - Goal: verify what graph ingestion, metadata, storage, query routes, and Magentic-One graph payload context already exist before wiring next-turn graph context.
  - Implemented in: `specs/004-agent-workspace-primitive/spec.md`, `specs/004-agent-workspace-primitive/tasks.md`, `docs/graph-responsibilities.md` via readiness audit and queue refinement.
  - Acceptance test: repo reality is classified for KnowGraph, ThinkGraph, CodeGraph, Neo4j, AGE/Postgres, query endpoints, sidecar payload context, and recommended primary query path.
  - Note: audit result says graph ingestion/storage are real but mixed, query surfaces exist but are split across current and legacy paths, and Magentic-One currently receives separate graph envelopes that are usually empty/default rather than a built project `GraphContextPacket`.
  - Do not touch: runtime behavior, layout, persistence, graph memory.
  - Risk: low.

- [x] `P3-T004` Define the graph context packet contract for next-turn prompt shaping.
  - Goal: create an explicit stream-separated graph context contract without overloading `PlanDraft` or rewiring runtime execution yet.
  - Implemented in: `client/src/features/agentbuilder/context/graphContextPacket.ts`, `client/src/features/agentbuilder/context/graphContextPacket.spec.ts`, `specs/004-agent-workspace-primitive/spec.md`, `docs/graph-responsibilities.md`.
  - Acceptance test: a typed `GraphContextPacket` exists with separate `thinkGraphContext`, `knowGraphContext`, optional `codeGraphContext`, `selectedBoardContext`, `comparison`, and provenance/debug metadata; pure helpers preserve stream separation and do not imply graph-memory clearing.
  - Note: this is a contract/model layer only. No graph queries, prompt rewiring, UI changes, route changes, or execution changes are introduced here.
  - Do not touch: runtime execution path, graph persistence, layout.
  - Risk: medium.

- [x] `P3-T005` Build a read-only GraphContextBuilder service or tool boundary.
  - Goal: create one product-safe backend path that queries ThinkGraph, KnowGraph, and CodeGraph separately and returns a `GraphContextPacket`.
  - Implemented in: `apps/backend/src/services/graphContext/graphContextPacket.ts`, `apps/backend/src/services/graphContext/graphContextBuilder.ts`, `apps/backend/src/services/graphContext/graphContextBuilder.spec.ts`.
  - Acceptance test: `npx tsc --noEmit -p apps/backend/tsconfig.app.json`, `npx vitest run apps/backend/src/services/graphContext/graphContextBuilder.spec.ts`, `git diff --check`.
  - Note: the first safe slice is a backend read-only service boundary only. It preserves separate ThinkGraph, KnowGraph, and CodeGraph streams; returns honest partial/unavailable notes; does not mutate graph memory; and does not add a public endpoint yet. Raw terminal/Cypher access may remain a dev-admin fallback, but it is not the normal product path for Magentic-One chat.
  - Do not touch: plan execution, UI layout, graph write behavior.
  - Risk: high.

- [x] `P3-T005b` Expose GraphContextBuilder via canonical project route.
  - Goal: add a read-only canonical endpoint `POST /api/projects/:projectId/context/graph` that returns the `GraphContextPacket`.
  - Implemented in: `apps/backend/src/routes/projects.routes.ts`.
  - Acceptance test: frontend or CLI can fetch the assembled packet without raw Cypher.
  - Note: Canonical project-scoped GraphContext access path. Not yet wired into Magentic-One prompt (comes in P3-T006).
  - Do not touch: Magentic-One prompt wiring.
  - Risk: low.

- [ ] `P3-T006` Inject the read-only `GraphContextPacket` into the Magentic-One prompt path.
  - Goal: ensure future turns can consume separated project graph context before answering.
  - Likely files: Magentic-One prompt/runtime path files in frontend/backend sidecar payload builders.
  - Acceptance test: Magentic-One receives `thinkGraphContext`, `knowGraphContext`, and optional `codeGraphContext` from the builder path rather than only empty/default envelopes.
  - Do not touch: approval/run semantics, layout, routes outside the chosen safe boundary.
  - Risk: high.

- [ ] `P3-T007` Prove follow-up chat uses prior graph context from the same project.
  - Goal: verify that prior research/evidence/reasoning context shapes the next turn without the user restating everything.
  - Likely files: prompt/runtime tests, graph-context docs, maybe minimal diagnostics.
  - Acceptance test: a follow-up turn uses cached ThinkGraph and KnowGraph context as separate streams and can surface congruence, conflict, missing evidence, or confidence gaps.
  - Do not touch: trading code, broad refactors, fake context injection.
  - Risk: high.

### P4 — Follow-Up Chat Overwrites Or Refines Draft

- [ ] `P4-T001` Define revise, reject, and overwrite behavior for an existing plan draft.
  - Goal: the user can intentionally replace or refine the current plan without stale plan bleed.
  - Likely files: `client/src/pages/agentbuilder.tsx`, `client/src/components/builder/chatPlanCompanion.ts`, `client/src/components/builder/assistPlanSurface.ts`.
  - Acceptance test: revise updates the draft, reject prevents auto-run, and a new plan request does not accidentally preserve obsolete steps.
  - Do not touch: route family, autosave, layout.
  - Risk: medium-high.

### P5 — Approve Or Check Promotes Current Draft To Approved

- [ ] `P5-T001` Formalize the approval transition from draft to approved plan.
  - Goal: approved plans become the only execution-eligible plans.
  - Likely files: `client/src/pages/agentbuilder.tsx`, `client/src/types/agentgraph`, `client/src/components/builder/assistPlanSurface.ts`.
  - Acceptance test: approve/check transitions one current draft into approved state and rejected drafts do not auto-run.
  - Do not touch: deck integrity, viewport, route family.
  - Risk: medium-high.

- [ ] `P5-T002` Add focused tests for direct reply, draft creation, revise, reject, and approve transitions.
  - Goal: protect the two-output primitive behavior contract before run integration expands.
  - Likely files: `client/src/pages/*.spec.*`, `client/src/components/builder/*.spec.*`.
  - Acceptance test: tests cover the state transitions above without depending on layout rewrites.
  - Do not touch: unrelated UI snapshots.
  - Risk: medium.

### P6 — Approved Plan Uses Existing Agent-Run Path

- [ ] `P6-T001` Route approved plans through the existing canonical deck run path instead of a parallel execution path.
  - Goal: approved plan execution must reuse the current real run route and runtime event flow.
  - Likely files: `client/src/pages/agentbuilder.tsx`, `client/src/components/builder/deckRunState.ts`, `apps/backend/src/routes/decks.routes.ts` if schema alignment is required.
  - Acceptance test: approved plan execution uses `POST /api/projects/:projectId/decks/:deckId/run`.
  - Do not touch: route versioning, fake runtime substitutes, OpenClaude terminal execution.
  - Risk: high.

- [ ] `P6-T002` Align approved-plan payload shape with the existing run path.
  - Goal: remove ambiguity between draft plan structure and run submission structure.
  - Likely files: `client/src/types/agentgraph`, `client/src/pages/agentbuilder.tsx`, `client/src/components/builder/deckRunState.ts`.
  - Acceptance test: one approved plan can be submitted without ad hoc field translation scattered across the page.
  - Do not touch: layout or persistence conductor behavior.
  - Risk: high.

### P6.5 — Default Research-To-KnowGraph Path

- [ ] `P6.5-T001` Approved default research plan runs Research Agent.
  - Goal: make research the first useful default executable primitive path.
  - Likely files: `client/src/pages/agentbuilder.tsx`, plan/run contract files, backend run-path integration files as needed.
  - Acceptance test: user asks for research, approves the draft, and Research Agent runs through the real plan/run path.
  - Do not touch: trading code, route family, UI layout.
  - Risk: high.

- [ ] `P6.5-T002` Research output is normalized into source-backed evidence records.
  - Goal: turn raw research output into evidence objects suitable for KnowGraph insertion.
  - Likely files: graph contract docs/types plus backend graph normalization boundary.
  - Acceptance test: research output becomes normalized evidence records rather than raw text only.
  - Do not touch: trading code.
  - Risk: high.

- [ ] `P6.5-T003` Evidence records populate KnowGraph as nodes, edges, and properties with provenance.
  - Goal: make research output graph-shaped and source-backed.
  - Likely files: graph contract/types, backend graph write boundary, `docs/graph-responsibilities.md`.
  - Acceptance test: KnowGraph receives evidence with provenance, not just a chat summary.
  - Do not touch: route versioning, UI layout.
  - Risk: high.

- [ ] `P6.5-T004` KnowGraph evidence is visible in the graph surface.
  - Goal: the user can see resulting evidence in the graph surface after the research run.
  - Likely files: graph surface wiring and related data-loading boundaries.
  - Acceptance test: evidence appears in the graph surface after research completes.
  - Do not touch: fallback UI or fake placeholder graph states.
  - Risk: high.

- [ ] `P6.5-T005` User can inspect evidence details from graph nodes and edges.
  - Goal: support inspecting source link, snippet, screenshot or table preview if available, confidence, and provenance.
  - Likely files: KnowGraph surface/detail presentation contracts plus supporting docs.
  - Acceptance test: selected evidence reveals inspectable source/provenance detail.
  - Do not touch: Prezi-style camera zoom future work.
  - Risk: high.

- [ ] `P6.5-T006` Research result summary returns to chat.
  - Goal: the run returns a useful chat summary in addition to graph writes.
  - Likely files: `client/src/pages/agentbuilder.tsx`, `client/src/components/builder/deckRunState.ts`.
  - Acceptance test: after research completes, chat shows a summary and the graph shows evidence.
  - Do not touch: trading code.
  - Risk: high.

### P7 — Run Result Returns To Chat

- [ ] `P7-T001` Formalize the primitive run event schema used by chat and plan surfaces.
  - Goal: stream, display, and reload run events through one documented contract.
  - Likely files: `client/src/types/agentgraph`, `client/src/components/builder/deckRunState.ts`, `client/src/pages/agentbuilder.tsx`, `apps/backend/src/routes/decks.routes.ts`.
  - Acceptance test: run started, step started, progress, step completed, step failed, and run completed are represented consistently.
  - Do not touch: route family, fake UI nodes, layout.
  - Risk: high.

- [ ] `P7-T002` Ensure final run results return to chat as project-backed state.
  - Goal: users see final results in chat and reload continuity remains real.
  - Likely files: `client/src/pages/agentbuilder.tsx`, `client/src/components/builder/deckRunState.ts`.
  - Acceptance test: reload preserves meaningful run result continuity through the existing persisted run path.
  - Do not touch: autosave rules for the board itself.
  - Risk: high.

### P8 — Run Result Writes To ThinkGraph / KnowGraph / CodeGraph

- [ ] `P8-T001` Formalize graph write responsibility routing for primitive outputs.
  - Goal: make ThinkGraph, KnowGraph, and CodeGraph writes explicit and non-overlapping.
  - Likely files: `specs/004-agent-workspace-primitive/spec.md`, `docs/graph-responsibilities.md`, `client/src/types/agentgraph`, backend graph execution boundary files.
  - Acceptance test: the system can determine which graph receives which class of result without UI-only guessing.
  - Do not touch: trading logic, route versions.
  - Risk: high.

- [ ] `P8-T002` Ensure follow-up chat can reuse prior primitive outputs.
  - Goal: prove the workspace can reason over prior graph-backed results in the same project.
  - Likely files: `client/src/pages/agentbuilder.tsx`, KG/graph context helpers, backend graph query/write boundary files.
  - Acceptance test: a follow-up prompt can use prior project-backed graph results from the same primitive flow.
  - Do not touch: UI layout, fallback boards.
  - Risk: high.

### P8.5 — Expanded Graph Context Quality

- [ ] `P8.5-T001` Deepen GraphContextPacket source coverage after the initial runtime path is proven.
  - Goal: expand beyond the first working builder path once `P3-T005` through `P3-T007` are stable.
  - Likely files: graph-context builder files, prompt/context docs, minimal diagnostics.
  - Acceptance test: the packet can safely grow richer source coverage without collapsing stream separation or blurring provenance.
  - Do not touch: unrelated UI layout or fake context synthesis.
  - Risk: medium-high.

### P9 — Docs, Tests, And Acceptance Cleanup

- [ ] `P9-T001` Add focused implementation tests for the primitive path end to end.
  - Goal: cover `chatReply`, `planDraft`, approval, run event flow, and graph responsibility routing at the smallest useful level.
  - Likely files: page/component tests plus any backend route tests needed for run-event schema stability.
  - Acceptance test: the primitive queue above has matching regression coverage.
  - Do not touch: unrelated broad refactors.
  - Risk: medium.

- [ ] `P9-T002` Update the primitive spec/docs with final implementation truth once the queue is complete.
  - Goal: keep spec, plan, tasks, and route/UI docs aligned with the real primitive.
  - Likely files: `spec.md`, `plan.md`, `tasks.md`, AgentBuilder docs.
  - Acceptance test: docs no longer describe planned behavior as future once the primitive is complete.
  - Do not touch: route family or protected UX unless separately approved.
  - Risk: low.

## Explicitly Deferred

- [ ] `D-T001` Trading implementation is deferred until Stage 0 primitive work is proven complete.
- [ ] `D-T002` OpenClaude terminal execution behavior is deferred.
- [ ] `D-T003` Add Agent / Template Picker is deferred.
- [ ] `D-T004` Broad AgentBuilder refactor is deferred.
- [ ] `D-T005` Route changes or new project route versions are deferred.
- [ ] `D-T006` Chat/bus/canvas layout or viewport redesign is deferred.

## First Recommended Implementation Task

- [ ] `NEXT-T001` Implement `P3-T006`: inject the read-only `GraphContextPacket` into the Magentic-One prompt path.
