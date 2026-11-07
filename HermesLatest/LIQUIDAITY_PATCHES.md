# HermesLatest LiquidAIty divergence register

This is the controlled-fork record for the exact local changes carried on top of the current Hermes
Agent import. It describes source only. It grants no permission for broad vendor cleanup, another
runtime, or restoration of historical overlay files.

## Upstream baseline

- Project: `NousResearch/hermes-agent`
- Remote: `https://github.com/NousResearch/hermes-agent.git`
- Release tag: `v0.23.0`
- Package version: `0.23.0`
- Release date: `2026.11.5`
- Official source: `https://github.com/NousResearch/hermes-agent/releases/tag/v0.23.0`
- Imported into this working tree on `2026.11.7`, retaining the existing local overlays.

Production uses only `HermesLatest/`. There is no comparison runtime, fallback checkout, parallel
Gateway, or application-owned task service.

## Current extension family: wire-reduced Team and Magnetic TaskGraphs

### Purpose

LiquidAIty has two deliberately reduced taskgraph use cases over Hermes's existing SQLite
task/dependency runtime:

- **Team / AutoTeam:** one saved Team Bot receives a bounded assignment, creates one marked root,
  decomposes to temporary same-profile depth-one workers, dependency-blocks that root, and performs
  final synthesis on the same root.
- **Magnetic:** one saved Magnetic Bot receives an exact Builder-authored PromptSpec, creates one root
  whose `allowed_assignees` are the exact blue-wire Hermes profiles, delegates only inside that
  ceiling, dependency-blocks the same root, and performs final synthesis there.
- A Magnetic child may be assigned to the protected Team profile. Team then creates its own
  same-profile AutoTeam root. AutoTeam workers cannot open another delegation tree.
- Ordinary Hermes tasks remain unrestricted when `allowed_assignees` is null and no task mode is
  configured.

LiquidAIty's native plugin tool `taskgraph_start` is the narrow admission seam. It uses the documented
`PluginContext.dispatch_tool("kanban_create", ...)` public doorway and imports no private Kanban module.
Bot delivery into Team/Magnetic remains ordinary Hermes `message_agent`. Hermes retains task rows,
dependencies, attempts, dispatch, worker processes, retries, notifications, and completion.

### External alternative check

Hermes 0.23.0 exposes public plugin tool dispatch, but upstream `kanban_create` has no structural
Team/Magnetic root, exact mission-scoped assignee ceiling, or same-root synthesis contract. Putting that
behavior in LiquidAIty application code would require a second task store, dispatcher, worker registry,
or private database writer. The smallest owner-local change is therefore inside Hermes's existing
`kanban_create` and task/dependency owners while the external plugin remains on the public API.

Remove this divergence when upstream publishes an equivalent supported taskgraph admission/policy API.
Do not replace it with a board, application scheduler, Gateway requester, subprocess adapter, or copied
SQLite ledger.

## New production files

| File | Responsibility |
| --- | --- |
| `hermes_cli/kanban_team.py` | Read explicit profile task mode; construct and activate one marked Team root; preserve same-profile AutoTeam policy. |
| `hermes_cli/kanban_magnetic.py` | Construct and activate one Magnetic root with an exact validated worker-profile ceiling. |

## Compatibility hunks

| File | Local delta and preserved behavior |
| --- | --- |
| `hermes_cli/config_defaults.py` | Adds empty `kanban.task_mode`; empty preserves ordinary upstream behavior. |
| `hermes_cli/kanban_db_connect.py` | Adds the nullable `allowed_assignees` migration to the existing task database. |
| `hermes_cli/kanban_db.py` | Persists Team workflow fields and the nullable ceiling; inherits/narrows the creator tree; enforces assignment/review/specify fences; and builds same-root Team synthesis context. Ordinary null-ceiling tasks retain upstream semantics. |
| `hermes_cli/kanban_db_graph.py` | Preserves workflow/ceiling fields through decomposition and marks Team worker structure for same-root synthesis. |
| `hermes_cli/kanban_decompose.py` | Requires Team fanout and routes temporary workers through the saved Team profile without creating recursive teams. |
| `hermes_cli/kanban_db_dispatch.py` | Enforces default-assignee ceilings while preserving ordinary unrestricted dispatch. |
| `gateway/session_kanban.py` | Propagates taskgraph markers into an adopted worker's current Hermes context. |
| `gateway/kanban_watchers_dispatcher.py` | Applies the decomposition-failure breaker only to marked Team roots. |
| `tools/delegate_tool.py` | Prevents a temporary AutoTeam worker from opening another delegation tree. |
| `tools/kanban_tools.py` | Lets structurally configured Team and Magnetic profiles enter their exact root paths through public `kanban_create`, including native completion subscription, while retaining ordinary task creation. |

## Wire-controlled Bot Mode and retained integration repairs

The ordinary 0.23.0 single-final-reply Bot protocol, delivery process, outcome reporting, sender
identity, and completion notification remain upstream-owned. LiquidAIty supplies the saved wire
roster, not a second delivery or task system.

| File | Local delta and preserved behavior |
| --- | --- |
| `tools/bot_mode_probe.py` | An explicit profile roster is the ordered local-target authority; an empty roster stays empty. Absent configuration retains upstream discovery. Live-profile resolution, Bot activation, prompt roster, and capability fingerprint use that same authority. Protocol epoch 4 advances the earlier local epoch 3 so retained Bot Chats adopt upstream's new single-reply instructions once. |
| `tools/bot_mode_dm.py` | Resolves local targets through that roster and filters upstream friendly-name matching to authorized entries. Preserves upstream self-target handling and the 0.23.0 delivery/combined-reply implementation. |
| `tui_gateway/methods_profiles.py`, `tui_gateway/contracts/profiles_vault_complete_foreign_subagents.py` | Configure and read back `bot_mode_roster`; the shared TypeScript/OpenRPC contracts are regenerated from these schemas. |
| `gateway/run.py` | Retains concurrent per-profile MCP discovery during startup. |
| `hermes_cli/middleware.py` | Preserves the original value of a rewritten tool argument in its existing `original_*` field. |

The corresponding existing Bot/profile contract tests are retained. No additional name aliases,
fallback roster, delivery transport, reply formatter, or security-policy change is part of this update.

## Windows installation prerequisite

- **Purpose / files:** `pm/workspace.py::_copy_core_inputs` passes its package-directory copy through
  the existing `pm.filesystem.long_root` helper. The official update failed while copying three
  bundled configuration conformance files into the managed environment on Windows with long paths
  disabled; the destination filenames exceeded MAX_PATH.
- **External alternative check:** Hermes already provides this filesystem helper specifically for
  that Windows setting. No registry change, relocated profile, omitted file, disabled plugin, or
  replacement installer is needed.
- **Contracts / upstream behavior preserved:** the same source files, ignore rules, dependency
  manager, plugin selection, workspace identity, and transactional environment publication remain.
  Non-Windows path behavior is unchanged.
- **Proof:** the previously failing real managed sync completed source copy, dependency installation,
  and publication. The managed interpreter reports Hermes 0.23.0 and a current dependency environment.
  Generated contracts pass their regeneration check; the application and spec typechecks pass.
  These checks do not substitute for a real Bot delivery or Team/Magnetic model run.
- **Fork cost / rollback:** one import and one copy-call change; remove it when upstream applies the
  same long-path handling. No saved data migration is involved.

## Focused proof

New focused tests:

```text
tests/hermes_cli/test_kanban_team.py
tests/hermes_cli/test_kanban_magnetic.py
```

Before the 0.23.0 refresh, the focused `kanban_tools` plus Team/Magnetic set passed **76 tests**; the
external plugin's focused suite passed separately. Those are historical source-contract results,
not proof of the refreshed runtime or a real Team/Magnetic model run. The update retains these tests
and their policy owners; loaded and visual update results must be reported separately.

The 0.23.0 managed update, generated-contract check, application/spec typechecks, client build and
Plugin Doctor passed. The running Main session reports 0.23.0. One real read-only Main-to-KnowGraph
request returned a 1,343-character reply; one persisted `process_complete` notification retained that
exact reply, Main continued, and the notice/answer survived reopening Trading Preview. This proves the
short-reply path only. The upstream 2,000-character notification formatter remains unchanged and its
known long-output truncation defect is not fixed. Team/Magnetic model execution was not rerun.

## Upstream behavior preserved

The divergence does not replace or copy:

- Gateway/session ownership;
- `message_agent` delivery, queues, receipts, retries, late replies, or reply identity;
- the SQLite task ledger;
- attempt records or worker-process ownership;
- ordinary unrestricted task creation/dispatch;
- PTY/TUI ownership;
- profile, provider, tool, skill, memory, or MCP lifecycle; or
- dashboard rendering.

No vendor code reads LiquidAIty Project databases, Cards, wires, or graph stores. Profile publication
stores the exact Hermes Bot roster; public `kanban_create` reads that configured roster only for a
structurally Magnetic profile, then Hermes owns execution.

## Explicit exclusions

The current overlay does not contain:

- historical `agent/card_turn_tools.py`, `agent/card_script_tool.py`,
  `tui_gateway/saved_card_turn.py`, or `hermes_cli/taskgraph_adapter.py`;
- application Card Run, IDF, Data Anchor, callback-tool, or per-turn schema envelopes;
- a custom Bot delivery path or `requestForBot`;
- a task board, duplicate task status store, scheduler, worker registry, or generic process adapter;
- private Desktop hooks;
- Gateway, PTY, voice, image, profile, learning, or credential management; or
- saved data, generated build output, profile homes, caches, or databases.

Card Python now belongs to the first-party LiquidAIty native plugin and calls only saved MCP grants.
It is not a Hermes vendor patch.

## Fork cost and rollback

The fork cost is two small owner modules, one nullable task field, bounded workflow/ceiling propagation,
and focused tests across ten existing owner files.

Rollback must be family-complete:

1. disable/remove `taskgraph_start` and the Team/Magnetic profile task-mode projection;
2. remove the two new modules and every compatibility hunk listed above;
3. retain existing SQLite data unless an explicit migration is separately authorized—the nullable
   column is harmless to ordinary Hermes;
4. rerun ordinary task and Bot Mode tests; and
5. report Team/Magnetic unavailable rather than installing an application fallback.

Never leave half-applied ceiling enforcement or silently widen a saved Magnetic roster.

## Upstream refresh procedure

1. Record the new official tag object and source commit.
2. Compare these exact symbols against a clean temporary upstream checkout.
3. Prefer an upstream public taskgraph policy/admission API when it satisfies the same contracts.
4. Port only the still-required semantic delta; do not restore files from an older overlay.
5. Run ordinary task, Team, Magnetic, Bot Mode, plugin, and dashboard contract tests.
6. Replace the production vendor tree only after every retained hunk and exclusion is accounted for.
7. Update this register and ARCHITECTURE.md together.

No refresh step authorizes a runtime restart, data migration, Git mutation, or live prompt.
