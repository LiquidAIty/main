# MVP

This file is the current source of truth for the LiquidAIty MVP.

Older broad framing is no longer current. The MVP is now intentionally narrowed to a code-first, self-dogfooding system that must prove itself on this repository first.

## Final MVP Statement

> A graph-based code intelligence and code execution system with visual agent orchestration, PlanWiki-driven tasking, codebase graph memory, KnowGraph for objective code structure, ThinkGraph for subjective working reasoning, Claude-Code-style execution as a tool layer, and OpenClaw-style swarm behavior as an optional node capability, used first on the product’s own repo.

## Why This Is The MVP

This is the smallest cut that makes the product real immediately.

The repo already has:

- a visual builder
- a visible deck runtime
- PlanWiki-like planning surfaces
- Blackboard
- ThinkGraph and KnowGraph concepts
- RAG and graph-adjacent infrastructure

What it lacks is the force that turns those surfaces into a working code system:

- repo intelligence
- real scoped code execution
- explicit task packets
- explicit merge and review after branching or swarm work

## Product Intent

LiquidAIty is not trying to become another terminal-only coding agent.

It is trying to become the visual control plane above agent runtimes:

- Claude Code or a clean-room equivalent is the execution hand
- OpenClaw is the swarm and exploration hand
- MCP is the tool protocol
- LiquidAIty owns planning, graph intelligence, memory, orchestration, and governance

## Hard Architecture Rules

1. Visible graph routing is execution truth.
2. PlanWiki is the bridge between human intent and machine task packets.
3. The Claude-style runtime is a tool, not the planner.
4. OpenClaw-style swarm is a capability on a node, not a separate product brain.
5. KnowGraph stores objective repo structure.
6. ThinkGraph stores subjective and provisional working reasoning.
7. Blackboard stores current mission state.
8. The system must dogfood on itself first.

## Primary Execution Spine

```text
Human Intent / Chat
-> PlanWiki
-> Agent Graph
-> Runtime
-> Repo Graph Query and/or Tool Invocation
-> Blackboard + ThinkGraph + KnowGraph updates
-> Review / Merge
-> Next Plan Step
```

There should be no hidden orchestration path that bypasses the visible graph and then claims to represent it later.

## Exact MVP Scope

1. Graph the codebase.
2. Use PlanWiki to create next-step prompts and task packets.
3. Query KnowGraph and ThinkGraph during planning.
4. Run a real Claude-style code execution tool through agent cards.
5. Allow selected cards to enable OpenClaw-style swarm mode.
6. Merge swarm or branch outputs through an explicit Society-of-Mind review step.
7. Write results back into Blackboard and the graphs.
8. Use the system on its own repo first.

## Success Criteria

The MVP is successful when:

- the repo graph works on this repository
- PlanWiki reliably generates downstream task packets
- at least one card can call the Claude tool adapter
- at least one card can enable swarm mode through the OpenClaw adapter
- a merge or review step can reconcile branch outputs
- Blackboard and the graphs reflect current mission state
- the system can complete at least one real cleanup or implementation task on itself

## Not In MVP

- broad business-owner workflows
- generalized non-code productization
- a full automation marketplace story
- polished editor extensions
- broad MCP ecosystem coverage
- hidden orchestration that overrides visible edges

## Repo Layout Direction

```text
third_party/
  openclaude/
  openclaw/
  UPSTREAMS.md
  PATCHES.md

apps/
  backend/
    src/
      repo-graph/
      planwiki/
      tools/
        claude/
        openclaw/
      v3/
      runtime/
      graphs/
  client/
```

`third_party/` is the quarantine zone for vendored runtimes. Product code should import only adapters, never scattered internals from those runtimes.

## Git Subtree Strategy

Use `git subtree`, not submodules, for the current MVP.

Reason:

- the code stays in the repo and is visible to coding agents
- self-dogfooding is simpler
- upstream sync remains possible later
- adapter boundaries stay stable

Reference docs:

- GitHub subtree guide: https://docs.github.com/enterprise-cloud/latest/get-started/using-git/about-git-subtree-merges
- Git subtree contrib source: https://github.com/git/git/tree/master/contrib/subtree

Planned commands:

```powershell
git remote add openclaude https://github.com/ruvnet/open-claude-code.git
git subtree add --prefix=third_party/openclaude openclaude main --squash

git remote add openclaw https://github.com/openclaw/openclaw.git
git subtree add --prefix=third_party/openclaw openclaw main --squash
```

If the Claude-style engine candidate changes, keep the `third_party/openclaude` prefix and adapter boundary stable.

## Consolidated Implementation Notes

The detailed notes for this MVP are intentionally kept here instead of spread across a large doc tree.

### PlanWiki Packet

PlanWiki needs both:

- a human section with intent, why, steps, risks, and notes
- a machine section with objective, repo scope, selected files, constraints, allowed tools, graph queries, and merge rules

The internal packet target is `planwiki.task.v1`.

### Repo Graph

The repo graph MVP should ingest:

- folders
- files
- imports and exports
- symbols where feasible
- route handlers
- service boundaries

Output split:

- objective structure goes to KnowGraph
- provisional drift or cleanup signals go to ThinkGraph
- current mission summary goes to Blackboard

Must-answer queries:

- what imports this file?
- what depends on this module?
- what routes touch this service?
- what files are likely relevant to this task?
- what drift cluster is near this feature?

### Claude-Style Tool Layer

The Claude-style runtime is a tool layer, not the planner.

Minimum input:

- objective
- repoPath
- selectedFiles
- constraints
- allowedActions
- planExcerpt
- blackboardContext
- outputFormat

Minimum normalized output:

- status
- action or tool name
- command summary
- files touched
- diff summary
- final result
- error

### OpenClaw Capability

OpenClaw-style swarm is a node capability, not a separate product brain.

Rules:

- the parent node owns identity, goal, permissions, and graph position
- swarm fan-out must return to explicit merge or review
- no branch output becomes truth without that merge step

### Third-Party Runtime Policy

When vendoring third-party runtimes:

- keep them under `third_party/`
- keep product code behind adapters only
- do not scatter direct imports from vendored internals across the app
- keep local patches minimal and trackable

## Current Repo Mapping

These are the most important current surfaces to preserve and evolve:

- `client/src/pages/agentbuilder.tsx`: main visual control plane
- `client/src/components/builder/*`: graph editing and execution UX
- `apps/backend/src/v3/*`: visible graph runtime and blackboard path
- `apps/backend/src/v3/messages/store.ts`: current persisted PlanWiki surface
- `services/knowgraph/*`: KnowGraph service boundary
- `apps/python-models/*`: optional runtime experiments or candidate engine work, not the primary product story
- `apps/backend/src/repo-graph/*`: repo graph scaffold for code intelligence
- `apps/backend/src/planwiki/*`: task-packet compilation boundary
- `apps/backend/src/tools/claude/*`: Claude-style tool adapter boundary
- `apps/backend/src/tools/openclaw/*`: OpenClaw swarm adapter boundary

## Phased Implementation Order

1. rewrite the MVP and architecture docs around the code-first dogfooding story
2. document the `third_party/` subtree policy
3. add the repo-graph module scaffold
4. add the PlanWiki task-packet contract
5. subtree in the Claude-style runtime
6. build the Claude adapter
7. prove one card to Claude-tool path
8. subtree in OpenClaw
9. build the swarm capability adapter
10. formalize merge and review behavior
11. run the full self-dogfood loop on this repo

## Working Rule

Every major architecture decision should be judged against one question:

Does this make the system better at understanding, planning, executing, reviewing, and improving its own codebase through the visible graph?

If the answer is no, it is outside the MVP.
