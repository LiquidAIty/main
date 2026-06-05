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

### P1 — PlanDraft Schema And Types

- [ ] `P1-T001` Define the primitive draft-plan contract and map it against existing mission and plan structures.
  - Goal: introduce a durable `PlanDraft` concept without rewriting the existing runtime yet.
  - Likely files: `client/src/types/agentgraph`, `client/src/components/builder/assistPlanSurface.ts`, `client/src/components/assist/planMissionModel.ts`, `specs/004-agent-workspace-primitive/spec.md`.
  - Acceptance test: one documented type contract covers plan id, source user request, ordered steps, approval state, revision marker, execution status, and summary.
  - Do not touch: deck autosave, layout, route family.
  - Risk: medium.

- [ ] `P1-T002` Map existing `MissionSpec`, `StructuredAssistPlanSurface`, and `PlanMissionGraph` responsibilities to the new primitive contract.
  - Goal: document and encode which type is source-of-truth versus derived presentation.
  - Likely files: `client/src/components/builder/chatPlanCompanion.ts`, `client/src/components/builder/assistPlanSurface.ts`, `client/src/components/assist/planMissionModel.ts`.
  - Acceptance test: it is clear which structure is the canonical draft and which structures are derived UI views.
  - Do not touch: mission run path, graph writes.
  - Risk: medium.

### P2 — Magentic-One Two-Output Turn Contract

- [ ] `P2-T001` Formalize the two-output Magentic-One turn contract in the AgentBuilder chat conductor.
  - Goal: every turn returns both `chatReply` and `planDraft`.
  - Likely files: `client/src/pages/agentbuilder.tsx`, `client/src/components/builder/chatPlanCompanion.ts`.
  - Acceptance test: one user turn returns a conversational `chatReply` in chat and a valid `planDraft` for the Plan Canvas.
  - Do not touch: layout, routes, persistence rules.
  - Risk: medium.

- [ ] `P2-T002` Ensure the `planDraft` is valid even when the work is lightweight.
  - Goal: the draft may be minimal, but it must still be renderable and structurally valid.
  - Likely files: `client/src/pages/agentbuilder.tsx`, `client/src/components/builder/chatPlanCompanion.ts`.
  - Acceptance test: simple requests still produce a valid minimal draft instead of empty, fake, or error-shaped plan content.
  - Do not touch: mission execution behavior.
  - Risk: medium.

### P3 — Chat Turn Updates Plan Canvas Draft

- [ ] `P3-T001` Bind the primitive draft-plan contract to the existing structured plan surface.
  - Goal: Plan Canvas must render real draft steps from the current plan contract, not ad hoc inferred filler.
  - Likely files: `client/src/components/builder/assistPlanSurface.ts`, `client/src/components/assist/planMissionModel.ts`, `client/src/pages/agentbuilder.tsx`.
  - Acceptance test: plan nodes/steps correspond to the actual current draft and no fake fallback goal/note nodes appear.
  - Do not touch: viewport behavior, bus/chat layout.
  - Risk: medium.

- [ ] `P3-T002` Ensure Plan Canvas reflects the current draft from the latest turn.
  - Goal: later turns update the visible draft instead of leaving stale plan content on screen.
  - Likely files: `client/src/components/builder/assistPlanSurface.ts`, `client/src/components/assist/planMissionModel.ts`.
  - Acceptance test: after a new turn, the Plan Canvas reflects the current draft rather than prior obsolete steps or raw runtime text.
  - Do not touch: runtime execution path.
  - Risk: medium.

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

- [ ] `D-T001` Trading implementation is deferred until the primitive above is proven.
- [ ] `D-T002` OpenClaude terminal execution behavior is deferred.
- [ ] `D-T003` Add Agent / Template Picker is deferred.
- [ ] `D-T004` Broad AgentBuilder refactor is deferred.
- [ ] `D-T005` Route changes or new project route versions are deferred.
- [ ] `D-T006` Chat/bus/canvas layout or viewport redesign is deferred.

## First Recommended Implementation Task

- [ ] `NEXT-T001` Implement `P2-T001`: formalize and prove the two-output Magentic-One turn contract, where every turn emits `chatReply` plus `planDraft`, without changing the protected chat/bus/canvas UI contract.
