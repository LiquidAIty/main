# Plan: Agent Workspace Primitive

**Branch**: `004-agent-workspace-primitive` | **Date**: 2026-06-05 | **Spec**: `specs/004-agent-workspace-primitive/spec.md`

**Status**: Draft. Planning only.

## Summary

Freeze and formalize the Agent Workspace Primitive before any trading implementation begins.

The primitive is the project-backed AgentBuilder workspace where:

- the user chats with Magentic-One
- every turn emits `chatReply` plus `planDraft`
- the plan draft may be lightweight but must still be valid
- users approve, reject, or revise the current draft
- approved plans run real agents
- events stream back into the workspace
- results return to chat and write into ThinkGraph, KnowGraph, and CodeGraph according to explicit responsibility boundaries
- future internal workspace improvement work can use Local Coder plus CodeGraph

## Current Baseline

Verified current baseline:

- ADMIN project loads
- project/deck persistence is project-backed
- `/api/projects/*` is the canonical project/deck route family
- `launchMode.ts` is removed
- `displayFallback` is removed from the active AgentBuilder board path
- Agent canvas, workspace shell, state hooks, deck load hook, project reset hook, and viewport math helper exist
- chat/bus/canvas layout is a protected UX contract

## Technical Context

**Frontend**:

- `client/src/pages/agentbuilder.tsx` is still the page-level conductor
- extracted shell/canvas/state helpers exist under `client/src/features/agentbuilder/`
- `client/src/components/builder/BuilderCanvas.tsx` still owns ReactFlow graph internals

**Backend**:

- canonical project routes live in `apps/backend/src/routes/projects.routes.ts`
- canonical deck routes live in `apps/backend/src/routes/decks.routes.ts`
- runtime persistence and execution glue live in `apps/backend/src/routes/decks.routes.ts` and `apps/backend/src/v3/decks/store.ts`

**Persistence**:

- saved project-backed deck is authoritative
- deck integrity guards and empty/partial save protection already exist and must remain untouched while the primitive is specified

## Constitution Check

- Code-Based Memory MCP first: satisfied for this planning pass
- Spec Kit heavy-mode: justified because this is a user-facing runtime contract and architecture boundary
- No fake substitute behavior: required and explicitly preserved
- Documentation minimalism: this plan adds only the requested feature spec set and baseline architecture docs

## Current Primitive Capabilities Found

### Present today

- project-backed chat surface with Magentic-One as conductor
- canonical `/api/projects/*` project/deck load/save/run path
- project auto-open behavior for canvas workspace
- mission approval handler and sequential run path in `agentbuilder.tsx`
- deck run event streaming through `streamDeckRunRequest(...)`
- persisted run reload continuity through `buildReloadStateFromDeckRuns(...)`
- Local Coder and CodeGraph present as active helper capabilities on the baseline board
- graph-oriented companion surfaces for KnowGraph / CodeGraph / WorldSignals / Plan

### Partial or missing today

- formal primitive contract requiring both `chatReply` and `planDraft` on every turn
- explicit durable plan schema contract
- explicit durable run event schema contract
- explicit graph write contract across ThinkGraph / KnowGraph / CodeGraph
- fully backend-owned mission orchestration boundary
- clearly protected Local Coder + CodeGraph workflow contract for self-improvement work
- deliberate Add Agent / Template Picker extension spec

## Frontend vs Backend Responsibility Target

### Frontend should own

- workspace shell
- chat UI
- plan approval/revision UI
- runtime event presentation
- canvas and companion surface presentation
- project/deck selection UX

### Backend should own

- project/deck persistence
- deck run execution
- mission execution contracts
- graph write execution
- Local Coder execution
- graph system integration

## Graph Responsibility Target

- ThinkGraph: provisional, planning, working, uncertain, or iterative knowledge
- KnowGraph: grounded, evidence-backed, citation-backed knowledge
- CodeGraph: files, symbols, routes, dependencies, subsystem structure, code relationships

## MVP Stage Plan

1. Contract freeze and baseline docs
2. Two-output Magentic-One turn primitive
3. Plan draft refinement and approval primitive
4. Approved run primitive
5. Graph write primitive
6. Local Coder + CodeGraph internal-work primitive
7. First vertical implementation: trading

## Affected Files

### Spec/Docs in this planning slice

- `specs/004-agent-workspace-primitive/spec.md`
- `specs/004-agent-workspace-primitive/plan.md`
- `specs/004-agent-workspace-primitive/tasks.md`
- `docs/agentbuilder-current-architecture.md`
- `docs/agentbuilder-route-contract.md`
- `docs/agentbuilder-ui-contract.md`

### Current implementation reference files

- `client/src/pages/agentbuilder.tsx`
- `client/src/features/agentbuilder/core/*`
- `client/src/features/agentbuilder/canvas/*`
- `client/src/features/agentbuilder/state/*`
- `client/src/components/builder/*`
- `apps/backend/src/routes/index.ts`
- `apps/backend/src/routes/projects.routes.ts`
- `apps/backend/src/routes/decks.routes.ts`

## Risks

- `agentbuilder.tsx` still mixes UI conduction with mission/graph/runtime glue, so primitive implementation should not start by refactoring
- graph write behavior is currently more implied than formally contracted
- mission approval/run orchestration remains page-owned and risky to change before the primitive spec is accepted
- old inactive surfaces still exist in source and can confuse future agents if baseline docs are missing

## Validation

Planning/documentation validation for this slice:

- confirm current route family from backend route mounts
- confirm current frontend file map from extracted modules and `agentbuilder.tsx`
- confirm no active `launchMode.ts`
- confirm no active `displayFallback` board path in the documented baseline

## Implementation Recommendation

The first implementation task after approval should be:

**Formalize and prove the two-output Magentic-One turn contract: every turn emits `chatReply` plus `planDraft`, without changing the protected chat/bus/canvas UI contract.**

Reason:

- it is the smallest primitive behavior users experience first
- it avoids premature trading work
- it does not require immediate shell refactor
- it preserves the user decision to avoid a classifier gate
- it creates the durable draft contract that later approved execution can use
