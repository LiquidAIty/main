# LiquidAIty Hermes divergence register

This vendored tree is the official Hermes Agent source at the pinned base below,
plus exactly two LiquidAIty-owned runtime extensions: durable Team delegation and
named-profile delegation. This register describes source scope; loaded product
acceptance is reported separately.

## Verified upstream base

- Project: `NousResearch/hermes-agent`
- Official repository: `https://github.com/NousResearch/hermes-agent.git`
- Version: `0.21.3`
- Commit: `73521a8e375a867fae14ec0579f2dfb47aa0017e`
- Commit subject: `fix(update): one bad workspaces glob no longer aborts the lockfile-churn cleanup`
- Task-start resolution: one `git ls-remote origin refs/heads/main` resolved the
  exact commit above. The detached verification snapshot's `FETCH_HEAD` was
  written at `2026-09-16T20:44:57.3367113-04:00`.
- Import proof: every one of the 13,698 upstream-tracked paths was compared by
  SHA-256 after the mirror and before the feature port: zero missing, zero
  mismatched, and zero old tracked-only paths remained.

Upstream Hermes owns Bot Mode, Gateway and session ownership, native queueing,
delivery and receipts, `prompt.submit`, CLI/TUI behavior, tools, plugins, memory,
profiles, and lifecycle. Upstream ACP source remains present but is not a
LiquidAIty Card runtime boundary. No LiquidAIty Bot, Gateway, ACP, credential,
completion-correlation, queue, or lifecycle patch is retained in this tree.

Any production difference outside the two entries below is unexplained residue
and blocks publication.

## 1. Durable Team through `delegate_task(role="team")`

VENDORED PROJECT: `NousResearch/hermes-agent` 0.21.3 at
`73521a8e375a867fae14ec0579f2dfb47aa0017e`.

PURPOSE: add one explicit top-level `team` role to Hermes' existing
`delegate_task` tool. It creates and activates one durable native Auto-Kanban
root, then native Kanban owners retain decomposition, dispatch, worker execution,
retry, final synthesis, notification, Stop, and rejoin.

EXTERNAL ALTERNATIVE CHECK: upstream temporary subagents do not create a durable
task graph. A LiquidAIty scheduler, queue, worker process owner, task database, or
TypeScript planner would duplicate native owners and is rejected.

FILES AND SYMBOLS:

- `tools/delegate_tool.py`: top-level Team schema/validation, depth-one worker
  guard, and dispatch to `hermes_cli.kanban_team.submit_team` before temporary
  child credential/runtime construction.
- `hermes_cli/kanban_team.py`: validates decomposer/worker policy and native
  dispatcher readiness, creates one parked root, activates Triage, and subscribes
  the durable originating session.
- `hermes_cli/config_defaults.py`: optional Team worker provider/model/reasoning
  selections; empty provider/model leaves Team fail-closed.
- `hermes_cli/kanban_db.py`: atomic workflow/step fields on task creation,
  `activate_team_triage_task`, nested task-creation guard, and final-synthesis
  worker context.
- `hermes_cli/kanban_db_graph.py`: propagates the Team workflow, depth-one worker
  route, retry limit, and root synthesis step through native decomposition.
- `hermes_cli/kanban_decompose.py`: applies the configured Team worker policy to
  native decomposed children and requires actual fan-out for Team missions.
- `hermes_cli/kanban_db_dispatch.py`: marks Team worker processes and adds Team
  workflow/provider/model facts to the existing native spawned event.

UPSTREAM BEHAVIOR PRESERVED: temporary subagent `tasks[]`, ordinary Kanban tasks,
manual decomposition, dispatch, worker processes, task/run persistence, retries,
and notifications remain upstream-owned. Team adds no Card identity, IDF, graph,
LiquidAIty Run, scheduler, or queue to Hermes.

CONTRACTS:

- one non-empty goal and optional string context;
- no Team `tasks[]`, `output_schema`, images, or nested delegation;
- explicit decomposer and Team worker provider/model before any root write;
- live native dispatcher and durable source session before any root write;
- one parked root before activation into native Triage;
- native depth-one workers and a separate final synthesis pass;
- no artificial Team task-count cap beyond native policy.

TESTS:

- `tests/tools/test_delegate_team.py`
- `tests/hermes_cli/test_kanban_team.py`
- affected upstream coverage in `tests/tools/test_delegate.py`

FORK COST: one small adapter module and bounded branches in seven existing
delegation/Kanban owners. There is no second scheduler, process owner, queue,
Gateway, or callback runtime.

ROLLBACK: remove the Team schema/branch, `kanban_team.py`, Team-only defaults,
workflow propagation/activation/worker marker/synthesis hunks, and corresponding
tests together. Leave upstream temporary delegation and ordinary Kanban intact.

## 2. Named profile through `delegate_task(role="profile")`

VENDORED PROJECT: `NousResearch/hermes-agent` 0.21.3 at
`73521a8e375a867fae14ec0579f2dfb47aa0017e`.

PURPOSE: add one explicit top-level `profile` role that requests exactly one
trusted-host-authorized existing profile with a parent-authored goal, context,
and optional bounded native data references. Hermes does not learn Card or
topology semantics.

EXTERNAL ALTERNATIVE CHECK: temporary children inherit their current runtime;
Team is durable same-board fan-out. Neither selects a named persistent profile.
A second Card tool, deterministic router, ACP adapter, callback service, or
direct profile launcher is rejected.

FILES AND SYMBOLS:

- `tools/delegate_tool.py`: Profile schema/validation, exact trusted roster
  membership, bounded `dataAnchors`, background choice, and fail-closed host
  request through `session/delegate_profile`.
- `run_agent.py`: mechanically forwards Profile arguments through the ordinary
  native `delegate_task` dispatch point.

UPSTREAM BEHAVIOR PRESERVED: without an authenticated host roster/request
context the Profile branch fails closed. It does not create a Hermes Card,
session owner, model fallback, direct process, queue, Run, or IDF.

CONTRACTS:

- one exact host-authorized profile and one non-empty goal;
- optional string context and at most sixteen object-shaped `dataAnchors`;
- no batch, output schema, or image payload;
- the host remains responsible for saved-Card authorization and for validating
  native references; the receiving profile keeps its native runtime authority;
- missing or invalid host context returns an explicit error with no fallback.

TESTS:

- `tests/tools/test_delegate_team.py`
- affected upstream coverage in `tests/tools/test_delegate.py`

FORK COST: one contained branch/schema extension in the existing delegate tool
and mechanical field transport at its one agent-loop call site.

ROLLBACK: remove the Profile schema/branch and matching `run_agent.py` forwarding
and tests together. Leave Team and upstream temporary delegation intact.

## Complete upstream-relative difference manifest

Production files:

- `tools/delegate_tool.py` — Team and Profile
- `run_agent.py` — Profile
- `hermes_cli/config_defaults.py` — Team
- `hermes_cli/kanban_team.py` — Team
- `hermes_cli/kanban_db.py` — Team
- `hermes_cli/kanban_db_graph.py` — Team
- `hermes_cli/kanban_decompose.py` — Team
- `hermes_cli/kanban_db_dispatch.py` — Team

Focused tests:

- `tests/tools/test_delegate.py` — adjusted public-schema assertions only
- `tests/tools/test_delegate_team.py` — Team and Profile
- `tests/hermes_cli/test_kanban_team.py` — Team

Metadata:

- `LIQUIDAITY_VENDOR_PATCHES.md` — this register

Ignored runtime state beneath the vendor directory, including virtual
environments, profile homes, history/databases, caches, bytecode, egg metadata,
and test-duration caches, is neither upstream source nor a local source
divergence and must not be reset as part of a vendor update.
