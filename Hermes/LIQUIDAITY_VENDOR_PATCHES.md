# LiquidAIty Hermes divergence register

This vendored tree is the official Hermes Agent source at the pinned base below,
plus exactly five LiquidAIty-owned runtime extensions: durable Team delegation,
profile-scoped native Bot rosters projected from saved Card topology, a nullable
root-scoped assignee ceiling used by headless Mag One execution, Codex-owned
authentication for detached workers whose saved profile selects the native app-server
runtime, and exact saved-profile toolset pins for native CLI execution.
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

## 1. Saved Team profile on the existing task ledger

VENDORED PROJECT: `NousResearch/hermes-agent` 0.21.3 at
`73521a8e375a867fae14ec0579f2dfb47aa0017e`.

PURPOSE: let one explicitly saved profile marked `kanban.task_mode: team` create
one durable root in Hermes' existing task ledger. The existing Kanban owners retain
decomposition, dispatch, worker execution, retry, final synthesis, notification,
Stop, and rejoin. `delegate_task` keeps its ordinary upstream `tasks[]` contract
and exposes no Team role.

EXTERNAL ALTERNATIVE CHECK: upstream temporary subagents do not create a durable
task graph. A LiquidAIty scheduler, queue, worker process owner, task database, or
TypeScript planner would duplicate native owners and is rejected.

FILES AND SYMBOLS:

- `tools/kanban_tools.py`: routes an ordinary task assigned to the exact marked
  profile into the shared Team-root creator after normal task authorization.
- `tools/bot_mode_dm.py`: routes an authorized direct orange `message_agent`
  target with the exact marker into the same Team-root creator.
- `hermes_cli/kanban_team.py`: validates the exact profile marker and saved
  parent/worker model policy, creates or rejoins one Triage root, and subscribes
  the durable originating session.
- `hermes_cli/config_defaults.py`: declares only the structural per-profile task
  mode; worker provider/model/reasoning remains the profile's saved delegation config.
- `hermes_cli/kanban_db.py`: persists workflow/step fields, the depth-one task
  guard, and final-synthesis worker context.
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

- exact `kanban.task_mode: team` on the assigned saved profile;
- one non-empty task body and one `auto-team-v1` Triage root;
- saved profile parent model plus saved delegation worker model/provider/reasoning;
- durable notification route before direct Bot submission;
- native depth-one workers and a separate final synthesis pass;
- bounded decomposition failure exits Triage once instead of retrying forever;
- no nested Team task or `delegate_task` from a Team worker.

TESTS:

- `tests/hermes_cli/test_kanban_team.py`
- `tests/tools/test_bot_mode_dm.py`
- affected upstream coverage in `tests/tools/test_delegate.py`

FORK COST: one small Team policy module and bounded branches in the existing
Kanban/Bot owners. There is no second scheduler, process owner, queue,
Gateway, or callback runtime.

ROLLBACK: remove the structural Team marker, `kanban_team.py`, workflow
propagation/worker marker/synthesis hunks, Bot/task entry branches, and
corresponding tests together. Leave upstream temporary delegation and ordinary
Kanban intact.

## 2. Profile-scoped native Bot roster

VENDORED PROJECT: `NousResearch/hermes-agent` 0.21.3 at
`73521a8e375a867fae14ec0579f2dfb47aa0017e`.

PURPOSE: make one profile's explicit `bot_mode.roster` the sole local
`message_agent` target authority. LiquidAIty projects each saved, enabled,
non-Magnetic orchestrator Card's ordered outbound orange targets into this field;
targets receive no reverse roster unless their own saved setting and outbound edges grant one. Hermes owns Bot Chat
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
saved topology boundary. A nullable field on the existing task rows is the
smallest native enforcement point.

FILES AND SYMBOLS:

- `hermes_cli/kanban_db.py`: nullable `Task.allowed_assignees`, canonical ordered
  normalization, creator-scope assignment validation, self-only scope for manually
  created descendants, operator reassignment and triage checks, schema storage,
  readback, and creation event payload.
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
- a manually created direct child must be assigned inside its creator's scope;
- that child receives a self-only local scope, so it can subdivide its own work but
  cannot recruit a sibling or another persistent profile;
- a child cannot replace or widen that derived local scope;
- an operator reassignment is checked against the creator's scope and moves the
  task's local self scope to the new assignee;
- review handoff remains inside the task's current local scope;
- native automatic triage/decomposition retains its existing bounded shared scope,
  preserving the separate automatic-Team behavior;
- the application supplies the field only on the structured Mag One root call.

TESTS:

- `tests/hermes_cli/test_kanban_creator_origin.py`
- application integration coverage in
  `apps/python-models/app/python_models/test_magentic_execution.py`

FORK COST: one nullable task column and bounded validation in the existing task
creator. There is no alternate dispatcher, process owner, queue, database, or UI.

ROLLBACK: remove the nullable column from new schema definitions and the later-column
migration, remove normalization/scope enforcement and focused tests, and stop passing
the field from the Mag One adapter. Existing rows with `NULL` already behave like
upstream; SQLite column removal is unnecessary for functional rollback.

## 4. Codex app-server route for detached native workers

VENDORED PROJECT: `NousResearch/hermes-agent` 0.21.3 at
`73521a8e375a867fae14ec0579f2dfb47aa0017e`.

PURPOSE: let a detached native task worker start when its exact saved profile selects
`model.openai_runtime: codex_app_server`. The Codex subprocess owns authentication;
the enclosing Hermes profile does not also require a copied `openai-codex` OAuth grant.
The worker process receives a complete process-local `hermes-tools` MCP transport entry,
including the JSON-encoded allowed writable root for its native task tree. Global Codex
configuration remains untouched.

EXTERNAL ALTERNATIVE CHECK: copying the already-signed-in Codex CLI refresh grant into
multiple named profiles forks one single-use OAuth grant and is explicitly prohibited by
Hermes credential hygiene. Requiring a separate interactive device login for every worker
duplicates authentication for a runtime that already delegates inference to Codex. A single
early runtime-provider branch is the smallest coherent repair.

FILES AND SYMBOLS:

- `hermes_cli/runtime_provider.py`: `_configured_codex_app_server_runtime` returns the
  configured app-server route before profile credential-pool/OAuth resolution. Its non-secret
  marker key satisfies the existing resolved-runtime constructor contract and is never sent to
  an inference endpoint because the app-server owns the turn.
- `agent/transports/codex_app_server.py`: the existing worker-specific MCP override builder
  supplies the complete native `hermes-tools` command, arguments, base environment, startup
  and call timeouts before adding the exact task/profile environment.

UPSTREAM BEHAVIOR PRESERVED: profiles using `openai_runtime: auto`, every non-OpenAI
provider, profile-local credential pools, refresh behavior, fallbacks, and the Codex
app-server transport itself are unchanged.

CONTRACTS:

- only `openai` and `openai-codex` profiles explicitly configured for
  `codex_app_server` use the branch;
- no OAuth credential is copied, linked, persisted, or inherited;
- the Codex subprocess remains the authentication and inference owner;
- no global Codex configuration is created or modified;
- missing Codex installation/sign-in still fails through the existing native transport;
- an initialize failure or timeout remains a visible native worker failure;
- ordinary Hermes provider resolution is unchanged when the runtime is `auto`.

TESTS:

- `tests/agent/transports/test_codex_app_server_runtime.py`
- `tests/agent/transports/test_codex_worker_mcp_overrides.py`
- loaded Mag One proof through the native dispatcher.

FORK COST: one bounded pre-credential resolution branch, one complete worker-local MCP
entry, and focused tests. No new provider, credential store, task runner, scheduler, or
process owner is added.

ROLLBACK: remove `_configured_codex_app_server_runtime`, its first ladder rung, the
worker-local `hermes-tools` MCP entry, and their focused tests together. Profiles then again
require profile-local OAuth before a detached app-server task process can start, and workers
again depend on a separately complete global Codex MCP entry.

## 5. Exact saved-profile toolset pin for native CLI execution

VENDORED PROJECT: `NousResearch/hermes-agent` 0.21.3 at
`73521a8e375a867fae14ec0579f2dfb47aa0017e`.

PURPOSE: make the existing native `profiles.configure` call persist one exact saved Card
toolset selection both for profile editing/readback and for the CLI execution surface. An
explicit empty selection remains deny-all instead of falling back to the global default.

EXTERNAL ALTERNATIVE CHECK: the application previously needed a second TypeScript-owned
config-file writer because the native profile RPC updated only the editor-facing field. That
duplicated profile-write authority. Extending the existing native RPC to its execution field
lets the application use one owner and removes the embedded writer.

FILES AND SYMBOLS:

- `tui_gateway/methods_profiles.py`: `_save_toolset_pin` writes both
  `tools.enabled_toolsets` and `platform_toolsets.cli` from the same ordered selection,
  including explicit `[]`.

UPSTREAM BEHAVIOR PRESERVED: omission leaves existing profile/global toolset behavior
unchanged. Profile creation, prompt/model configuration, Gateway ownership, CLI startup,
tool discovery, and execution remain native Hermes behavior.

CONTRACTS:

- only an explicitly supplied `enabledToolsets` value writes either field;
- ordering and explicit empty selection are preserved;
- one native profile RPC owns both saved representations;
- the application does not edit Hermes configuration files directly.

TESTS:

- `tests/tui_gateway/test_profiles_toolset_pin.py`
- application coverage in `apps/backend/src/hermes/agentTerminal.spec.ts`.

FORK COST: one bounded write in the existing profile configure owner and focused tests. No
new route, profile abstraction, runtime, tool registry, or file writer is added.

ROLLBACK: remove `_save_toolset_pin`, restore the former editor-only assignment, and restore
an external execution-pin writer if exact Card-owned toolset execution is still required.

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
- `hermes_cli/runtime_provider.py` — Codex app-server route without duplicate profile OAuth
- `agent/transports/codex_app_server.py` — complete process-local worker MCP transport
- `hermes_cli/config_migrations.py` — Bot roster/lifecycle enumeration split
- `tools/bot_mode_probe.py` — profile-scoped native Bot roster resolver
- `tools/bot_mode_dm.py` — native local-target validation through the resolver
- `tui_gateway/contracts/profiles_vault_complete_foreign_subagents.py` — typed Bot roster RPC field
- `tui_gateway/methods_profiles.py` — Bot roster configure/describe and exact CLI toolset pin
- `tui_gateway/methods_bot_relay.py` — exact inbound live-profile resolution

Focused tests:

- `tests/tools/test_delegate.py` — adjusted public-schema assertions only
- `tests/hermes_cli/test_kanban_team.py` — Team
- `tests/hermes_cli/test_kanban_creator_origin.py` — assignee-ceiling inheritance and unrestricted behavior
- `tests/tools/test_bot_mode_probe.py` — native Bot roster resolution/prompt
- `tests/tools/test_bot_mode_dm.py` — native Bot target and unchanged delivery selection
- `tests/tui_gateway/test_profiles_bot_roster.py` — profile roster write/readback
- `tests/agent/transports/test_codex_app_server_runtime.py` — detached app-server credential routing
- `tests/agent/transports/test_codex_worker_mcp_overrides.py` — complete worker MCP transport
- `tests/tui_gateway/test_profiles_toolset_pin.py` — saved profile and CLI execution toolset pin

Metadata:

- `LIQUIDAITY_VENDOR_PATCHES.md` — this register

Ignored runtime state beneath the vendor directory, including virtual
environments, profile homes, history/databases, caches, bytecode, egg metadata,
and test-duration caches, is neither upstream source nor a local source
divergence and must not be reset as part of a vendor update.
