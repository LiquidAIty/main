# REPO_AUDIT_CURRENT_STATE

This file is the plain-language audit of what matters now after the MVP reset.

## Current Product Center

The active center of the repo is:

- `client/src/pages/agentbuilder.tsx`
- `client/src/components/builder/*`
- `apps/backend/src/v3/*`
- `apps/backend/src/v3/messages/store.ts`
- `services/knowgraph/*`

Those surfaces are the current foundation for the code-first self-dogfooding MVP.

## What The Repo Already Has

- a real visual builder
- a visible runtime that follows graph edges
- a real blackboard path in `v3`
- ThinkGraph and KnowGraph concepts already present in code and docs
- an existing planning surface that can be evolved into structured PlanWiki packets

## What Was Missing Before This Reset

The missing piece was not more UI.

The missing piece was one truthful code-first execution story that ties together:

- repo graph intelligence
- PlanWiki task compilation
- real code execution tooling
- optional swarm exploration
- explicit merge and review
- self-dogfooding on this repo

## What Is Now The Primary Path

The primary path is:

```text
PlanWiki -> Agent Graph -> Runtime -> Tool Layer -> Blackboard / ThinkGraph / KnowGraph
```

Anything outside that path should be treated as legacy, experimental, or secondary until it proves it belongs in the MVP.

## What Should Not Be Treated As Product Truth

- broad workflow automation narratives
- hidden orchestration that bypasses visible edges
- runtime candidates that try to become the planner of record
- scattered direct imports from vendored third-party internals

## Repo State That Still Needs Work

- PlanWiki persistence is still light and not yet compiled into a stable task packet by the active path
- repo graph ingest exists as a design direction and now has a scaffold, but not a full production importer
- card execution is real, but a Claude-style code runtime is not yet wired as the default code tool
- swarm behavior is not yet a formal node capability with mandatory merge or review
- state is still split across multiple stores and runtime layers

## What Is Preserved As Current Architecture

- visible graph routing as execution truth
- explicit blackboard reads and writes through the graph
- separate roles for Blackboard, ThinkGraph, and KnowGraph
- a backend runtime that can be evolved instead of replaced by slogans

## What Is Explicitly Deferred

- polished non-code product workflows
- marketplace-first framing
- broad external automation coverage
- editor-extension polish work

## Reading Order

1. `mvp.md`
2. `docs/architecture/CODE_FIRST_LAUNCH_STORY.md`
3. `docs/architecture/SYSTEM_OVERVIEW.md`
4. `docs/PLANWIKI_TASK_PACKET_SPEC.md`
5. this file

## Current Conclusion

The repo is still mixed-generation, but the MVP is now much clearer:

- the builder is the visible control plane
- PlanWiki is the human-to-machine bridge
- repo graphing is the objective code-memory path
- ThinkGraph remains the subjective reasoning layer
- Blackboard remains the current mission state layer
- a Claude-style runtime becomes the execution tool layer
- OpenClaw becomes an optional swarm capability inside selected nodes
- the system proves itself by working on its own repo first
