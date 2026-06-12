# T001 Bootstrap CodeGraph Planning Context

Status: ready-for-fable

## Source Prompt As Understood By Codex

Turn CodeGraph back on enough for planning by replacing the honest-but-empty backend CodeGraph
context fallback with a bounded real reader. Do not broaden into UI planning, ThinkGraph writes,
autonomous runtime, or unrelated runtime work.

## Linked Plan And Specs

* `PLAN.md` Build Order and Active Task
* `specs/bootstrap-self-build-loop.md`
* `specs/task-realm.md`
* `specs/code-task-packet.md`
* `specs/semantic-report.md`

## Relevant Skill Candidates

* `skills/codebasedmemory.md`

Skill search basis:

* user prompt: restore CodeGraph enough for planning
* referenced specs: bootstrap self-build loop, TaskRealm, CodeTaskPacket, SemanticReport
* fresh CBM structures: `buildGraphContextPacket`, `CodeGraphContextPacket`, CodeGraph surface
* touched subsystem: backend graph-context builder and CodeGraph planning context
* known guardrails: honest unavailable state, no invented context, no fake validation

## CBM Before

Fable must refresh or prove fresh CBM before implementation and fill:

* method:
* status:
* nodes:
* edges:
* relevant graph nodes:
* relevant graph edges:
* relevant files/symbols:

## Objective

Restore CodeGraph enough for planning by replacing the backend's empty CodeGraph context fallback
with a real, bounded reader of the existing local Code-Based Memory layout service. Preserve honest
unavailable/error reporting. Return structural context through the existing `CodeGraphContextPacket`
inside `buildGraphContextPacket`.

This is the first FableCoder task after the planning formats exist.

## TaskRealm

* Planner: ChatGPT
* Middle scout: Codex
* Executor: FableCoder
* Target memory: CodeGraph context for planning, with later SemanticReport memory sent to ThinkGraph
* Current CBM proof: fresh full index ready with graph structure available

### Evidence-Bound Current State

* `buildGraphContextPacket` already reads ThinkGraph and KnowGraph.
* `readCodeGraphContextFallback` returns empty arrays and explicitly reports
  `codegraph_partial: backend read path not wired yet`.
* `CodeGraphContextPacket` already defines relevant files, components, routes, schemas, tools, agent
  cards, prompt templates, and implementation notes.
* The client CodeGraph surface already reads the local CBM layout endpoint through `/api/layout`.
* Development proxy evidence maps `/api/layout` to the local CBM service.

## Allowed Files

* `apps/backend/src/services/graphContext/graphContextBuilder.ts`
* `apps/backend/src/services/graphContext/graphContextBuilder.spec.ts`
* `apps/backend/src/services/graphContext/graphContextPacket.ts` only if the existing packet cannot
  represent the proven reader result
* task result fields in this active scratchfile
* graph/semantic memory output after completion

## Forbidden Files And Systems

* UI implementation
* Prisma and env files
* Python runtime
* AutoGen runtime behavior
* ThinkGraph or KnowGraph write implementation
* CodeGraph visualization redesign
* vendored Codebase Memory UI
* unrelated routes, specs, and features
* AgentChat, Semantic Kernel, Microsoft Agent Framework, AutoGen Studio
* full autonomous runtime, marketplace, giant graph UI, LocalScout, local coding runner
* fake validation, silent fallback, invented CodeGraph records

## Required Reads

* `AGENTS.md`
* `PLAN.md`
* `skills/codebasedmemory.md`
* `specs/bootstrap-self-build-loop.md`
* `specs/task-realm.md`
* `specs/code-task-packet.md`
* `specs/semantic-report.md`
* `apps/backend/src/services/graphContext/graphContextPacket.ts`
* `apps/backend/src/services/graphContext/graphContextBuilder.ts`
* `apps/backend/src/services/graphContext/graphContextBuilder.spec.ts`
* `client/src/components/codegraph/types.ts`
* `client/src/components/codegraph/CodeGraphSurface.tsx`
* `client/vite.config.ts`

## Intended Delta

* Add a bounded backend CodeGraph reader using the already-running local CBM layout service.
* Map only proven structural node/edge data into the existing CodeGraphContextPacket categories.
* Keep CodeGraph separate from ThinkGraph and KnowGraph.
* Preserve explicit unavailable/error diagnostics; never return invented context or fake success.
* Keep the reader dependency-injectable so focused tests do not require a live CBM service.

If direct reads show the local layout response cannot support a safe bounded mapping, stop and
return a blocked SemanticReport instead of inventing a new architecture.

## Expected Artifacts

* bounded backend implementation and focused tests
* OutOfScopeObservations for useful discoveries outside the TaskRealm

## Validation

Required proof:

* focused tests prove real CodeGraph layout data maps into non-empty planning context
* focused tests prove unavailable service remains explicit and produces no invented context
* focused tests prove malformed data fails or is safely rejected
* existing ThinkGraph and KnowGraph stream separation remains intact
* backend TypeScript compile passes

Commands:

```powershell
npx vitest run apps/backend/src/services/graphContext/graphContextBuilder.spec.ts
npx tsc -p apps/backend/tsconfig.app.json --noEmit
```

Run one real host-source request against `POST /api/projects/:projectId/context/graph` with the local
CBM service available. Report blocked if the service or project index is unavailable. Do not fake
the smoke.

## Completion Report Format

Return a SemanticReport conforming to `specs/semantic-report.md` with:

* task state
* vectorSummary
* files and symbols changed
* claims bound to test/smoke evidence
* validation states
* patch path and hash
* refreshed CBM/CodeGraph findings
* OutOfScopeObservations
* remaining risks
* next task recommendation

Stop after T001. Do not implement SemanticReport ingestion, UI planning, or LocalScout.

## Result For Fable To Fill

* work done:
* proof:
* CBM after:
* actual graph/code delta:
* graph query example:
* code example query:
* reusable how-to text:
* out-of-scope observations:

## Skill Promotion

Fable must state what reusable continuity this result adds. Because `skills/codebasedmemory.md`
matches this task, successful completion must update it with a new graphable example, proof claim,
guardrail, smoke test, query pattern, or related-skill edge. Do not leave the completed task in
`tasks/active/`.
