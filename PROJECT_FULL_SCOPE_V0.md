# PROJECT_FULL_SCOPE_V0

This file is the current v0 source of truth for the project.
It intentionally favors the smallest practical product shape over broader future architecture.

## What The Product Is

LiquidAIty v0 is a project-based AI workspace.

It is not primarily a transcript chatbot.
It is not primarily a collection of disconnected agent experiments.

For v0, the product is:
- one project workspace
- one main working page
- one assist/reasoning path
- one visual deck builder for agent-card workflows
- one right-panel editor for selected card configuration
- one project state surface that holds the plan/wiki/knowledge context already present in the repo

## The v0 Loop

The v0 loop should be kept simple:

1. A user opens a project.
2. The user works inside the main workspace.
3. The user can use Assist through the current backend runtime.
4. The user can create or edit agent-card decks visually in the builder.
5. The selected card is edited in the existing right panel.
6. A simple deck can be validated and run locally for inspection.
7. The project state, plan/wiki, and graph context remain the durable working context.

That is enough for v0.

## Main System Parts For v0

Frontend:
- `client/src/pages/agentbuilder.tsx` as the main workspace
- `client/src/components/AgentManager.tsx` as the right-panel editor
- `client/src/components/builder/*` as the visual deck builder and simple deck runtime

Backend:
- `apps/backend/src/routes/agent.routes.ts` as the active Assist runtime path
- `apps/backend/src/routes/projects.routes.ts` and `projectAgents.routes.ts` for existing project and agent config storage
- `apps/backend/src/routes/knowgraph.routes.ts` and `apps/backend/src/routes/v2/*` for graph-related work
- `apps/backend/src/routes/sol.routes.ts` for separate Sol chat paths that still exist

Supporting services:
- `services/knowgraph` for Neo4j ingest
- database-backed project state and agent config stores

## What Is In Scope Now

In scope for v0:
- keep one main working UI surface
- keep the visual builder as the primary card/deck authoring path inside Agents mode
- keep the existing right panel as the only real card editor
- keep simple deck validation and execution planning
- keep simple contract-based local deck execution
- keep the current Assist runtime path alive
- keep project state and graph-backed context paths that already work
- reduce repo confusion and markdown sprawl

## What Is Explicitly Out Of Scope For v0

Out of scope for now:
- full branch or loop deck runtime
- a second builder or second inspector system
- large repo-wide refactors
- replacing the current right-panel editor
- new orchestration frameworks
- full graph synthesis and graph-everything expansion
- full research-deck-to-plan automation if it requires a parallel hidden runtime
- advanced swarm orchestration
- speculative abstractions added only for future flexibility

## What v0 Should Preserve

v0 should preserve working behavior first:
- the current main page
- project selection
- Assist runtime through the current backend
- graph visibility and graph ingest paths
- builder canvas rendering
- card and edge selection
- right-panel card editing
- simple deck runtime debug path

If a cleanup does not directly reduce confusion or stabilize the active path, it is probably not a v0 task.

## Immediate Build Order

The immediate build order should stay narrow:

1. Untangle the repo structure and archive stale docs.
2. Keep one current source of truth for what v0 is.
3. Stabilize the active workspace path in `agentbuilder.tsx`.
4. Keep the React Flow builder path as the only active deck authoring direction.
5. Keep `AgentManager` as the only active card editor.
6. Keep `/api/agents/boss` as the active Assist path.
7. Only after that, decide how deck persistence and deck-to-Assist integration should be tightened.

## Practical v0 Rules

- Prefer one working path over multiple partial paths.
- Prefer existing storage and routes over new systems.
- Prefer archiving stale ideas over deleting history.
- Prefer local, explicit cleanup over deep refactors.
- Prefer stabilizing the current workspace over inventing a cleaner future one.

## v0 Bottom Line

For v0, LiquidAIty should behave like a single project workspace with:
- a live Assist/runtime path
- a live graph-backed project context
- a live visual deck builder
- a single right-panel editing flow

That is the minimum product shape worth stabilizing now.
