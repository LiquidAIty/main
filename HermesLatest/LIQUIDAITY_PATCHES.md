# HermesLatest LiquidAIty divergence register

This is the controlled-fork record for the exact local changes carried on top of the current Hermes
Agent import. It describes source only. It grants no permission for broad vendor cleanup, another
runtime, or restoration of historical overlay files.

## Upstream baseline

- Project: `NousResearch/hermes-agent`
- Remote: `https://github.com/NousResearch/hermes-agent.git`
- Release tag: `v0.22.7`
- Package version: `0.22.7`
- Release date: `2026.11.3`
- Annotated tag object: `592aa804d6ed135a18d6a01fb0824bfdbb0279d7`
- Source commit: `b200f5bc60e31588ba2cb60e288029c4a54ba5fa`
- Imported into this working tree on `2026.11.4`

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

Hermes 0.22.7 exposes public plugin tool dispatch, but upstream `kanban_create` has no structural
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

Standard `tools/bot_mode_dm.py` is byte-identical to the imported baseline in this change.
LiquidAIty does not patch Bot delivery, target sessions, reply waiting, or sender identity.

## Focused proof

New focused tests:

```text
tests/hermes_cli/test_kanban_team.py
tests/hermes_cli/test_kanban_magnetic.py
```

The focused `kanban_tools` plus Team/Magnetic set passed **76 tests** in the current source turn; the
external plugin's focused suite passed separately. This proves the tested source contracts only. It does
not prove a loaded plugin, real provider execution, persistence readback, or UI acceptance.

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
