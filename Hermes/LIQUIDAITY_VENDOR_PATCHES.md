# LiquidAIty Hermes divergence register

This vendored tree is the official Hermes Agent source at the pinned base below,
plus exactly three LiquidAIty-owned runtime extensions: durable Team delegation,
profile-scoped native Bot rosters projected from saved Card topology, and a nullable
root-scoped assignee ceiling used by headless Mag One execution.
This register describes source scope; loaded product acceptance is reported separately.

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

Upstream Hermes owns Bot delivery, Gateway and session ownership, native queueing,
delivery and receipts, `prompt.submit`, CLI/TUI behavior, tools, plugins, memory,
profiles, and lifecycle. Upstream ACP source remains present but is not a
LiquidAIty Card runtime boundary. The roster extension below changes only native
target authority and prompt presentation; no LiquidAIty Bot delivery, Gateway,
ACP, credential, completion-correlation, queue, or lifecycle patch is retained.

Any production difference outside the entries below is unexplained residue
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

## 2. Profile-scoped native Bot roster

VENDORED PROJECT: `NousResearch/hermes-agent` 0.21.3 at
`73521a8e375a867fae14ec0579f2dfb47aa0017e`.

PURPOSE: make one profile's explicit `bot_mode.roster` the sole local
`message_agent` target authority. LiquidAIty projects saved, enabled, symmetric
orange Card relationships into this field while Hermes continues to own Bot Chat
sessions, live-owner/offline selection, delivery, receipts, replies, retries, and
notifications.

EXTERNAL ALTERNATIVE CHECK: pinned Hermes 0.21.3 derives local Bot teammates by
enumerating every live profile directory and exposes no public profile-scoped
roster provider. Keeping application middleware authorization would leave two
target authorities, so the smallest coherent change is one native config field,
one resolver, and the existing public profile configure/describe RPCs.

FILES AND SYMBOLS:

- `hermes_cli/config_defaults.py`: Bot relay defaults deliberately omit the optional
  `roster` key so absence remains distinguishable from explicit `[]`.
- `tools/bot_mode_probe.py`: presence-sensitive ordered `resolve_bot_roster`, exact
  live-profile resolution, and stock all-live-profile discovery only when the key is absent.
- `tools/bot_mode_dm.py`: prompt-independent stock `message_agent` validation and
  local target-home lookup use the native resolver without changing delivery.
- `tui_gateway/methods_profiles.py` and
  `tui_gateway/contracts/profiles_vault_complete_foreign_subagents.py`: typed
  profile configure/describe write and readback contract.
- `tui_gateway/methods_bot_relay.py`: inbound delivery resolves one exact live
  target profile without treating profile enumeration as sender authority.
- `hermes_cli/config_migrations.py`: legacy install-wide cleanup explicitly uses
  the lifecycle-only profile enumerator.

UPSTREAM BEHAVIOR PRESERVED: canonical Bot Chat identity/history, stock
`message_agent` acknowledgement, live-owner admission, quiet-CLI offline delivery,
queueing, ordering, retries, receipts, attributed replies, silence handling,
background notification, remote peer relay, Gateway, terminal, and TUI ownership
are unchanged after exact local target resolution.

CONTRACTS:

- absent configuration preserves stock standalone all-live-profile discovery;
- explicit empty configuration grants no local Bot targets;
- configured order is preserved and duplicates are removed without sorting;
- self, malformed, unknown, deleted, and tombstoned profiles do not broaden access;
- the default profile is available only when explicitly configured as `default`;
- prompt construction, target validation, and capability fingerprinting share the
  same resolver;
- an epoch mismatch invalidates the matching cached protocol section before the
  existing one-time prompt rebuild;
- configure rejects invalid/self/non-live entries and describe returns the exact
  stored ordered roster.

TESTS:

- `tests/tools/test_bot_mode_probe.py`
- `tests/tools/test_bot_mode_dm.py`
- `tests/tui_gateway/test_profiles_bot_roster.py`

FORK COST: one additive profile field, one bounded resolver conversion, and public
profile RPC plumbing. There is no application delivery adapter, credential bridge,
queue, waiter, callback, correlator, or alternate session/runtime owner.

ROLLBACK: remove the field and typed profile RPC members, restore the upstream
all-live-profile local roster in prompt and target validation, restore lifecycle
callers to the upstream helper, and remove the focused tests together. No saved
Card, session, message, or Hermes delivery data requires migration.

## 3. Root-scoped assignee ceiling for Mag One

VENDORED PROJECT: `NousResearch/hermes-agent` 0.21.3 at
`73521a8e375a867fae14ec0579f2dfb47aa0017e`.

PURPOSE: let the existing headless Mag One adapter restrict one native creator tree
to the saved Mag One profile and the exact enabled blue-connected Card profiles.
Hermes continues to own decomposition, dependencies, dispatch, retries, task runs,
and summaries. LiquidAIty does not add a scheduler, worker registry, or task store.

EXTERNAL ALTERNATIVE CHECK: upstream direct task submission accepts one root
assignee but exposes no per-root assignment ceiling. Its install-wide dispatcher
profile filter is not mission-scoped, and prompt text alone cannot enforce the
saved topology boundary. A nullable inherited field on the existing task rows is
the smallest native enforcement point.

FILES AND SYMBOLS:

- `hermes_cli/kanban_db.py`: nullable `Task.allowed_assignees`, canonical ordered
  normalization, creator-task inheritance, no-widening validation, assignment and
  review-handoff checks, schema storage, readback, and creation event payload.
- `hermes_cli/kanban_db_connect.py`: additive nullable column migration for existing
  Hermes task databases.
- `hermes_cli/kanban_db_graph.py`: atomic decomposition inherits the same ceiling
  and rejects an out-of-scope root or child assignment.
- `hermes_cli/kanban_db_dispatch.py`: the existing default-assignee write observes
  the ceiling if it encounters a bounded task.

UPSTREAM BEHAVIOR PRESERVED: `NULL` keeps ordinary task creation unrestricted.
Existing dispatcher, worker processes, task tools, retries, dependencies, events,
summaries, CLI/TUI, and profile discovery remain upstream-owned. The model-facing
task-creation schema cannot set, replace, or widen the ceiling.

CONTRACTS:

- omission means unrestricted upstream behavior;
- an explicit list is canonicalized, order-preserving, and duplicate-free;
- the root assignee must be present in an explicit ceiling;
- every task created with a bounded `creator_task_id` inherits the exact list;
- a child cannot replace, narrow, or widen the inherited list;
- an assignee outside the inherited list is rejected before task creation,
  reassignment, or a review handoff changes the row;
- the application supplies the field only on the structured Mag One root call.

TESTS:

- `tests/hermes_cli/test_kanban_creator_origin.py`
- application integration coverage in
  `apps/python-models/app/python_models/test_magentic_execution.py`

FORK COST: one nullable task column and bounded validation in the existing task
creator. There is no alternate dispatcher, process owner, queue, database, or UI.

ROLLBACK: remove the nullable column from new schema definitions and the later-column
migration, remove normalization/inheritance/enforcement and focused tests, and stop
passing the field from the Mag One adapter. Existing rows with `NULL` already behave
like upstream; SQLite column removal is unnecessary for functional rollback.

## Complete upstream-relative difference manifest

Production files:

- `tools/delegate_tool.py` — Team
- `hermes_cli/config_defaults.py` — Team and native Bot roster field
- `hermes_cli/kanban_team.py` — Team
- `hermes_cli/kanban_db.py` — Team and root-scoped assignee ceiling
- `hermes_cli/kanban_db_connect.py` — nullable assignee-ceiling migration
- `hermes_cli/kanban_db_graph.py` — Team and assignee-ceiling inheritance
- `hermes_cli/kanban_decompose.py` — Team
- `hermes_cli/kanban_db_dispatch.py` — Team and bounded default-assignee enforcement
- `hermes_cli/config_migrations.py` — Bot roster/lifecycle enumeration split
- `tools/bot_mode_probe.py` — profile-scoped native Bot roster resolver
- `tools/bot_mode_dm.py` — native local-target validation through the resolver
- `tui_gateway/contracts/profiles_vault_complete_foreign_subagents.py` — typed Bot roster RPC field
- `tui_gateway/methods_profiles.py` — Bot roster configure/describe implementation
- `tui_gateway/methods_bot_relay.py` — exact inbound live-profile resolution

Focused tests:

- `tests/tools/test_delegate.py` — adjusted public-schema assertions only
- `tests/tools/test_delegate_team.py` — Team
- `tests/hermes_cli/test_kanban_team.py` — Team
- `tests/hermes_cli/test_kanban_creator_origin.py` — assignee-ceiling inheritance and unrestricted behavior
- `tests/tools/test_bot_mode_probe.py` — native Bot roster resolution/prompt
- `tests/tools/test_bot_mode_dm.py` — native Bot target and unchanged delivery selection
- `tests/tui_gateway/test_profiles_bot_roster.py` — profile roster write/readback

Metadata:

- `LIQUIDAITY_VENDOR_PATCHES.md` — this register

Ignored runtime state beneath the vendor directory, including virtual
environments, profile homes, history/databases, caches, bytecode, egg metadata,
and test-duration caches, is neither upstream source nor a local source
divergence and must not be reset as part of a vendor update.
