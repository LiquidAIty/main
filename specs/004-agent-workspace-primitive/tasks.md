# Tasks: Agent Workspace Primitive

**Spec**: `specs/004-agent-workspace-primitive/spec.md`
**Plan**: `specs/004-agent-workspace-primitive/plan.md`
**Last updated**: 2026-06-05

## Status

This feature is in specification mode only.

Do not begin trading implementation from this task list.
Do not begin AgentBuilder refactor from this task list.
Protect the current route, persistence, and chat/bus/canvas UX baseline while implementing the primitive.

## Phase 1 — Contract Freeze

- [ ] T001 Finalize and approve `specs/004-agent-workspace-primitive/spec.md`
- [ ] T002 Finalize and approve `specs/004-agent-workspace-primitive/plan.md`
- [ ] T003 Finalize and approve `specs/004-agent-workspace-primitive/tasks.md`
- [ ] T004 Confirm `docs/agentbuilder-current-architecture.md` matches live baseline
- [ ] T005 Confirm `docs/agentbuilder-route-contract.md` matches mounted backend routes
- [ ] T006 Confirm `docs/agentbuilder-ui-contract.md` matches the protected chat/bus/canvas UX contract

## Phase 2 — Direct Reply Primitive [US1]

- [ ] T007 [US1] Define the direct-reply vs plan-required decision contract in `client/src/pages/agentbuilder.tsx`
- [ ] T008 [US1] Document Magentic-One direct reply expectations in the runtime/prompt contract owned by `client/src/pages/agentbuilder.tsx`
- [ ] T009 [US1] Verify direct replies return to chat without opening plan approval state in `client/src/pages/agentbuilder.tsx`
- [ ] T010 [US1] Add or update focused tests for direct-reply behavior in `client/src/components/builder` or `client/src/pages`

## Phase 3 — Plan Proposal Primitive [US2]

- [ ] T011 [US2] Formalize the primitive plan schema in `client/src/pages/agentbuilder.tsx` and `client/src/types/agentgraph`
- [ ] T012 [US2] Formalize approve, reject, and revise plan actions in `client/src/pages/agentbuilder.tsx`
- [ ] T013 [US2] Ensure plan proposals remain reviewable and do not auto-run before approval in `client/src/pages/agentbuilder.tsx`
- [ ] T014 [US2] Add or update focused tests for plan proposal and approval-state transitions

## Phase 4 — Approved Run Primitive [US3]

- [ ] T015 [US3] Formalize the primitive run event schema across `client/src/types/agentgraph`, `client/src/components/builder/deckRunState.ts`, and `apps/backend/src/routes/decks.routes.ts`
- [ ] T016 [US3] Verify approved plans execute through the canonical deck run route `POST /api/projects/:projectId/decks/:deckId/run`
- [ ] T017 [US3] Ensure final results return to chat and project-backed run state instead of ephemeral UI-only state
- [ ] T018 [US3] Add or update focused tests for runtime event flow and final result delivery

## Phase 5 — Graph Write Primitive [US4]

- [ ] T019 [US4] Formalize ThinkGraph, KnowGraph, and CodeGraph write responsibilities in `client/src/types/agentgraph` and the corresponding backend graph execution boundary
- [ ] T020 [US4] Define explicit graph write contracts instead of implicit UI-only behavior
- [ ] T021 [US4] Verify follow-up chat can reuse prior project-backed results through graph-aware workspace context
- [ ] T022 [US4] Add or update focused tests for graph responsibility routing and follow-up reuse

## Phase 6 — Local Coder + CodeGraph Internal Work Primitive [US5]

- [ ] T023 [US5] Formalize the Local Coder + CodeGraph helper workflow for internal code, agent, card, and prompt work
- [ ] T024 [US5] Confirm Local Coder execution remains backend-owned and not frontend-executed
- [ ] T025 [US5] Confirm CodeGraph outputs can inform later planning and internal code work
- [ ] T026 [US5] Add or update focused tests for Local Coder and CodeGraph helper-path behavior

## Phase 7 — Extension Boundary

- [ ] T027 Document Add Agent / Template Picker as a future extension in the approved primitive docs/specs without implementing it
- [ ] T028 Define the acceptance gate that must pass before trading becomes the first major vertical

## Protected Areas — Do Not Disturb During Primitive Work

- [ ] T029 Preserve the canonical `/api/projects/*` route family
- [ ] T030 Preserve deck integrity guards and empty/partial save protection
- [ ] T031 Preserve the chat/bus/canvas viewport and splitter UX contract
- [ ] T032 Preserve project-backed deck persistence and the no-fallback-board rule

## Recommended First Implementation Task

- [ ] T033 Implement the direct-reply vs plan-required decision boundary first, without refactoring AgentBuilder and without touching the protected chat/bus/canvas layout
