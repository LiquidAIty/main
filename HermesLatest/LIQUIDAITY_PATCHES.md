# HermesLatest application patch overlay

This register is the update contract for eight bounded extension families carried on top of Hermes
Agent. It describes current source; it is not runtime authority and it does not permit unrelated vendor
cleanup.

## Upstream baseline

- Project: `NousResearch/hermes-agent`
- Remote: `https://github.com/NousResearch/hermes-agent.git`
- Release tag: `v2026.9.24`
- Package version: `0.21.5`
- Release date: `2026.9.24`
- Annotated tag object: `e3dd27ee2d8b011737a4eea8e3eb3d711ab78690`
- Source commit: `f97608f178d1ffeca59860195ab7da295f7c8e5f`
- Imported into the application repository by commit:
  `68b2014e7dbdf502d176e36fc4817a857ae1ce2c`

Git history is the comparison source. Production uses only `HermesLatest/`; no second Hermes source tree
or fallback checkout is retained.

## Extension families

1. Project-scoped saved Cards: bind one stable Hermes profile to one exact session per Project, constrain
   `message_agent` to directed orange authority plus exact target session IDs, and refuse a Project delivery
   when that exact live owner is unavailable instead of starting another CLI turn.
2. Receiving-Card lifecycle: carry one process-authenticated Project/Card context on create/resume/activate;
   before inference, obtain the receiving Card's already-materialized IDF projection and start/finish its
   existing outer Run. Continue an application-owned Main consultation Run from its exact completion event;
   otherwise create a new child Run for a later notification turn.
3. Card Python: present one valid saved Script as `card_python`, execute it through Hermes's existing
   child-process Python path, and route only declared nested calls through tools already loaded by that profile.
   Blank/invalid source is inert; execution failure removes the compact Script capability for the next iteration.
4. Card profile capability fencing: apply/read only Card-owned profile fields, scope learning reads to the
   addressed profile, preserve unknown/learned state, ship Builder's selected inspection skill through
   Hermes's bundled-skill mechanism, and use Hermes's existing `follow_profile_config` capability epoch
   to rebuild a live agent only when that profile-owned surface changes.
5. Profile MCP and exact turn evidence: preserve enabled profile MCP servers when the saved ordinary-Hermes
   toolset pin is empty, narrow one turn only within profile-loaded MCP tools, bind exact
   Project/deck/conversation/profile/Run headers and a short-lived signed internal bearer onto the dedicated MCP loop task,
   correlate submission, Stop, completion,
   provider/model, usage, tool calls, process IDs, and parent/child Run lineage without replacing Hermes
   queue/session/process ownership. LiquidAIty supplies no per-turn tool-definition callback protocol.
6. AutoTeam / Team TaskGraph: mark an ordinary saved profile, create one bounded Team root, use
   temporary same-profile workers, and synthesize on that same root through Hermes's task ledger.
   KnowGraph reuses this exact mechanism with one staged saved-Card Run: decomposition/candidate workers
   omit configured MCP servers, while only the synthesis root receives the exact Card Run context and
   signed profile-MCP boundary.
7. TaskGraph / Magnetic: persist and enforce the exact blue-worker assignment ceiling and creator lineage
   while leaving ordinary Hermes tasks unrestricted.
8. Package-safe taskgraph adapter: expose existing Hermes profile validation plus blocked-root stage,
   authority binding, activation and whole-root readback through one generic Hermes-interpreter process
   boundary. It owns no scheduler, retry loop, task copy or LiquidAIty runtime semantics.

Codex app-server's internal Dynamic Tools support remains its vendored session protocol for the two
session-bound Hermes capabilities recorded below; it is not an application tool-authority path.
LiquidAIty's web UI materializes exact saved application tools into each Card's profile-owned loopback MCP
connection; public GPT/plugin OAuth remains an external-client boundary. The UI cannot submit per-turn schemas,
callback URLs, or callback authorization. The Card Hooks
IDE/editor/compiler/executor is preserved; its broader hook-point design remains separate from this repair.

## New production files

| File | Family | Current responsibility |
| --- | --- | --- |
| `agent/card_turn_tools.py` | Profile MCP / Card Python | Narrows only already-loaded profile MCP tools, installs/restores the compact Script capability, and never registers a global or callback-provided application tool. |
| `agent/card_script_tool.py` | Card Python | Validates the immutable Script contract, hashes, schemas, exact tool names/states and budgets; runs one child Python recipe and dispatches nested calls through the profile's registered tools. |
| `tui_gateway/saved_card_turn.py` | Receiving-Card lifecycle | Validates Project/Card/conversation context, transports prepare/start/finish through the existing process-authenticated endpoint, binds current Project/deck/profile/Run headers, signs the short-lived internal profile-MCP bearer, serializes the same identity for one dispatcher-spawned synthesis root, and counts actual model plus Script tool calls. |
| `hermes_cli/kanban_team.py` | AutoTeam / exact Stop | Owns the explicit Team task mode/policy, root construction/readback, staged saved-Card Run binding, activation, the current-host active-root ceiling, bounded decomposition-failure settlement, and fail-closed root-first archival of one exact source session's AutoTeam root and real decomposed workers through Hermes's existing archive owner. |
| `hermes_cli/taskgraph_adapter.py` | Package-safe taskgraph adapter | Validates profiles and performs exact stage, authority-event binding, activation, and root/descendant readback through the existing Kanban database APIs; its CLI accepts one bounded JSON request and returns one bounded JSON result. |
| `skills/autonomous-ai-agents/agent-builder-inspection/SKILL.md` | Profile fencing | Bundled Builder guidance selected by the saved Builder Card and seeded by Hermes's existing fresh-profile skill sync; it adds no permission, loader or execution path. |

## Compatibility hunks in upstream production files

Files may appear in more than one family because one accepted turn carries all of its authority together.

| File | Family | Symbols / reason |
| --- | --- | --- |
| `agent/codex_runtime.py` | Card Python / Bot roster | `_dynamic_tools_configuration`, `_dynamic_tool_executor`, `_ensure_codex_session`: expose only session-bound `message_agent`/`card_python` through Codex app-server's own protocol, dispatch through their existing Hermes owners, bind the thread ID to that exact fingerprint, and resume only an exact match. No application callback tools enter this projection. |
| `agent/conversation_loop.py` | Profile fencing | `_profile_capability_prompt_stale`, `_persist_system_prompt`, `_restore_or_build_system_prompt`: refresh profile-following prompts when the real capability epoch changes. |
| `agent/inline_tool_executors.py` | Card Python / AutoTeam | `resolve_invoke_tool_executor`: resolve the current Card Script executor before shipped memory/registry lookup; the sequential `message_agent` executor preserves the exact tool-call ID used for idempotent AutoTeam admission. |
| `agent/system_prompt.py` | Bot roster / profile fencing | `_profile_capability_parts`, `_post_workspace_parts`: describe only the authorized Bot roster and bind the prompt to the profile capability epoch. |
| `agent/tool_executor.py` | Card Python | `_resolve_sequential_dispatch`: route `card_python` through agent-local authority before the ordinary registry. |
| `agent/transports/codex_app_server_session.py` | Card Python / Bot roster | Preserve Codex app-server's vendored Dynamic Tools handshake and exact thread/turn/call identity for session-bound `message_agent`/`card_python`; no LiquidAIty callback executor is retained. |
| `gateway/kanban_watchers_dispatcher.py` | AutoTeam | Apply the breaker only to marked Team roots and accept the headless host's exact activated-root ceiling for decomposition, dispatch and readiness without changing the normal GatewayRunner's unrestricted upstream behavior. |
| `gateway/kanban_watchers.py` | AutoTeam | Let only the headless `serve` adapter opt into activated-Team-root scoping while the ordinary messaging GatewayRunner retains its shipped unrestricted dispatcher contract. |
| `hermes_cli/config_defaults.py` | AutoTeam | `kanban.task_mode`: empty preserves shipped behavior; `team` is explicit profile configuration. |
| `hermes_cli/kanban_db.py` | AutoTeam / Magnetic | Store Team workflow fields and `allowed_assignees`; inherit/narrow/enforce the creator-tree ceiling, build same-root Team synthesis context, and expose `append_task_event` so the Magnetic adapter records its authority event without importing Hermes's private `_append_event`. No custom claim capability is retained. |
| `hermes_cli/kanban_db_connect.py` | Magnetic | Additive `allowed_assignees` column migration for existing Hermes task databases. |
| `hermes_cli/kanban_db_dispatch.py` | AutoTeam / Magnetic / turn evidence | Record Team step/provider/model facts, enforce default-assignee ceiling, optionally restrict spawn/readiness lanes to exact eligible task IDs, mark Team worker processes, remove every configured MCP server from decomposition/candidate workers, and bind one exact saved-Card context/internal secret only onto an authorized synthesis root. |
| `hermes_cli/kanban_db_graph.py` | AutoTeam / Magnetic | Enforce/inherit the ceiling during decomposition and move a marked Team root to synthesis. |
| `hermes_cli/web_server.py` | AutoTeam | After the socket binds, run Hermes's existing singleton-locked Kanban dispatcher watcher inside the canonical headless `serve` host, scoped to roots activated by that live host because no separate messaging GatewayRunner exists; stop and join it with the host lifecycle. |
| `hermes_cli/kanban_decompose.py` | AutoTeam | Use the saved Team profile for bounded depth-one worker fanout and mandatory worker tasks. |
| `gateway/run_notifications.py` | Turn evidence | Preserve originating Product Run identity on a background-process completion so the owning session can continue the exact still-open Run when required. |
| `tools/bot_live_delivery.py` | Bot roster / Run lineage | Carry an optional parent Run ID on the existing durable at-most-once delivery ticket without changing its queue/claim/receipt owner. |
| `tools/bot_mode_dm.py` | Bot roster / Run lineage / AutoTeam | Keep `message_agent` internal to Hermes, require the exact Project-session target, preserve the exact target Card context and tool-call identity, stage/activate a structurally marked AutoTeam root for a saved team-mode target, suppress redundant sender synthesis for directly observed ordinary `@Card` turns, and retain the originating Run ID for child lineage. |
| `tools/bot_mode_probe.py` | Bot roster / profile fencing | Resolve explicit absent/empty/nonempty rosters and compute the capability epoch from roster, tools, delegation, task mode and runtime. |
| `tools/code_execution_tool.py` | Card Python | Generate child-only `input/tools/output`, enforce exact names/states/budgets, and use the caller-supplied in-process dispatcher. |
| `tools/code_kernel.py` | Card Python | Carry per-cell authority into a disposable local kernel and dispose it after execution. |
| `tools/delegate_tool.py` | AutoTeam | Prevent a temporary Team worker from opening a second delegation tree. |
| `tools/kanban_tools.py` | AutoTeam / Magnetic | Create the structurally marked Team root and preserve creator identity/assignment ceiling. |
| `tools/mcp_tool_loop.py` | Profile MCP / turn evidence | Rebind the current Card Project/profile/Run context on the dedicated MCP event-loop task instead of losing caller ContextVars at `run_coroutine_threadsafe`. |
| `tools/mcp_tool_transport.py` | Profile MCP / turn evidence | Add exact current Project/deck/conversation/profile/Run headers plus the short-lived signed bearer only to the Card profile's loopback `liquidaity` Streamable HTTP connection and retain strict cross-origin header stripping. |
| `tools/process_registry.py` | Run lineage | Persist originating Run identity and same-Run continuation intent on the existing background process record and completion event. |
| `tui_gateway/agent_callbacks.py` | Profile fencing / turn evidence | Rebuild from exact stored profile/session overrides and reject capability drift during the build. |
| `tools/process_registry_notifications.py` | Turn evidence | Return the exact process IDs contained in one consumed notification batch so a caller can correlate the resulting assistant turn without parsing prose. |
| `tools/terminal_tool.py`, `tools/terminal_tool_background.py` | Run lineage | Carry internal Run correlation into the existing tracked background-process owner; model-facing terminal arguments and execution semantics are unchanged. |
| `tui_gateway/contracts/events.py` | Turn evidence | Declare submission identity, `MessageCompletePayload.turn_usage`, exact process/task notification correlation IDs, and the exact terminal task result correlated to each completed task ID. |
| `tui_gateway/contracts/profiles_vault_complete_foreign_subagents.py` | Bot roster / profile fencing / AutoTeam | Declare Card-owned runtime/delegation/task-mode fields, Bot-title readback, and exact MCP include/context fields. |
| `tui_gateway/contracts/prompt_voice.py` | Card Python / Bot roster / turn evidence | Declare exact profile-tool selection, Script, roster/session/target-Card-context, direct-vs-notification reply, submission and Run fields on `prompt.submit`. Retired application tool-definition/callback fields are absent. |
| `tui_gateway/contracts/sessions.py` | Bot roster / receiving-Card lifecycle / exact Stop | Declare session roster/target map, Card-turn context, `expected_submission_id`, and the bounded exact AutoTeam roots included in one session interrupt. |
| `tui_gateway/contracts/tools_mcp_plugins.py` | Profile fencing | Add explicit profile identity to Hermes learning reads/edits. |
| `tui_gateway/methods_profiles.py` | Bot roster / profile fencing / AutoTeam | Configure/read only declared Card fields, atomically preserve exact UTF-8 Card PromptBlock bytes in `SOUL.md` across platform newline modes, preserve explicit empty toolset pins and MCP `tools.include` whitelists (including an explicit empty block-all list), and read the existing Bot Mode title metadata. Ordinary Card tools remain profile MCP tools; this extension does not create a callback executor. |
| `tui_gateway/methods_prompt.py` | Card Python / profile MCP / Bot roster / turn evidence | Validate one Script/profile-tool/roster/target-Card-context/Run envelope and forward the exact accepted authority; no application callback envelope remains. |
| `tui_gateway/methods_session.py` | Bot roster / receiving-Card lifecycle / exact Stop / turn evidence | Apply roster, target sessions, and Card-turn context to create/resume/activate; let an older Project session opt into `follow_profile_config`; report its profile model/provider; refuse interruption of a different submission; and stop validated AutoTeam roots/workers through the durable source-session identity while retaining the live handle for the model-turn interrupt. |
| `tui_gateway/methods_tools.py` | Profile fencing | Forward learning operations to Hermes's existing implementation for the exact profile. |
| `tui_gateway/model_switch.py` | Profile fencing / model evidence | Resolve a lazy session's model and provider from that session's own profile and retain Hermes's capability-epoch rebuild without an application-supplied fingerprint. |
| `tui_gateway/prompt_turn.py` | All turn-scoped families | Prepare/start/finish receiving Card Runs, bind externally managed continuations, install/restore profile-tool selection, Script and Bot target contexts, settle a delivery receipt only after Run settlement, emit process- or task-correlated completion events with exact completed-task results, and calculate turn-local usage. |
| `tui_gateway/server.py` | Bot roster / receiving-Card lifecycle / profile fencing / turn evidence | Preserve an explicit empty ordinary-Hermes-tool pin while still loading enabled profile MCP servers; invalidate raw profile configuration by content even when file metadata is unchanged; carry roster, target sessions, and Card context; return the same model/provider identity for built and lazy sessions; fence profile builds; and expose available usage evidence. |
| `tui_gateway/session_auto_continue.py` | Card Python / profile MCP / Bot roster / turn evidence | Preserve the accepted Script/profile-tool/roster/Run envelope when Hermes queues and later drains a busy-session turn. |
| `tui_gateway/session_notifications.py` | Turn evidence / Run lineage | Keep the visible Kanban status compact while carrying the exact completed task result into the existing owner-session turn, alongside exact process IDs, completed task IDs, and originating Run intent; continue one still-open externally managed Run or prepare a new child notification Run without parsing prose. |

`tui_gateway/methods_config_set.py` is not part of the overlay. The rejected Builder Docker/configuration
patch is absent and this file is byte-equal to the imported upstream baseline.

## Generated contract artifacts

| File | Source | Rule |
| --- | --- | --- |
| `apps/shared/src/gateway-contract.openrpc.json` | Hermes Gateway contract generator | Must exactly contain Card Script, profile MCP selection, roster/session, Card context, direct-reply, notification process/task correlation, exact completed-task results, submission/Run/Stop and usage fields, with no application tool-definition/callback fields. |
| `apps/shared/src/gateway-contract.generated.ts` | Same generator | Must be byte-derived from the same Python declarations; never hand-edit. |

These artifacts are regenerated once after authored source freezes. A later source defect that requires a
second generation must stop for owner approval.

Current frozen generation (2026-10-21):

- `gateway-contract.generated.ts` SHA-256
  `532BC47730CE461D3EF82B575DC02E1479497E5E02B0A1A4ECA7CE3215F94FD4`
- `gateway-contract.openrpc.json` SHA-256
  `E57769E84D8A162B4BBB6098E2DE95E4A358267CA5CC03481D67F084F022CDB5`

## Focused proof files

```text
tests/agent/test_card_turn_tools.py
tests/agent/test_codex_runtime_prompt_handoff.py
tests/agent/test_system_prompt.py
tests/agent/test_system_prompt_restore.py
tests/agent/transports/test_codex_app_server_session.py
tests/hermes_cli/test_kanban_creator_origin.py
tests/hermes_cli/test_kanban_db.py
tests/hermes_cli/test_kanban_team.py
tests/hermes_state/test_named_profile_session_db.py
tests/skills/test_agent_builder_inspection_skill.py
tests/tools/test_bot_mode_probe.py
tests/tools/test_bot_live_owner_delivery.py
tests/tools/test_card_script_code_execution.py
tests/tools/test_process_registry.py
tests/tools/test_kanban_tools.py
tests/tui_gateway/test_auto_continue.py
tests/tui_gateway/test_bot_live_owner_delivery.py
tests/tui_gateway/test_diagnostic_turn_end_to_end.py
tests/tui_gateway/test_fallback_chain_hot_reload.py
tests/tui_gateway/test_kanban_notify_poller.py
tests/tui_gateway/test_profile_rebuild_commit.py
tests/tui_gateway/test_profiles_bot_roster.py
tests/tui_gateway/test_profiles_toolset_pin.py
tests/tui_gateway/test_tui_gateway_server.py
```

`evals/desktop_bug_campaign/rebuild_observer.py` follows the renamed profile-capability synchronization
symbol used by the focused rebuild observer; it is proof support, not product behavior.

## Explicit exclusions

The overlay does not contain:

- a Builder Docker policy, terminal backend setter, custom PTY or voice/HUD patch;
- another Codex App Server, provider, login, thread/session owner or compatibility server;
- an application-owned Gateway/process/session/queue/retry manager;
- a Bot target opener, suffixed Bot Chat, delivery replacement or catalog-visible Bot tool;
- an IDD tool registry, alias map, source-hash protocol identity or plugin-specific catalog;
- Project orange/blue topology persisted into a reusable profile;
- a custom Magnetic claim capability, duplicate task store, scheduler or worker registry;
- old Card-tools-host, environment preload, or hidden fallback code;
- credentials, generated build output, profile data or cache databases.

## Focused Windows proof

From the repository root, run the changed Card-turn/Bot/Gateway proof through the Hermes environment:

```powershell
HermesLatest\.venv\Scripts\python.exe -m pytest `
  HermesLatest/tests/agent/test_card_turn_tools.py `
  HermesLatest/tests/agent/test_codex_runtime_prompt_handoff.py `
  HermesLatest/tests/tools/test_bot_live_owner_delivery.py `
  HermesLatest/tests/tools/test_bot_mode_dm.py `
  HermesLatest/tests/tui_gateway/test_auto_continue.py `
  HermesLatest/tests/tui_gateway/test_bot_live_owner_delivery.py `
  HermesLatest/tests/tui_gateway/test_profiles_bot_roster.py -q
```

The 2026-10-14 Windows run passed 113 tests, skipped three, and failed only three upstream platform
assertions in `test_bot_mode_dm.py`: one compares slash spelling for an executable path, and two require
POSIX `0700` mode bits on Windows. Running the same set while deselecting those exact three assertions
passed 113, skipped three, and deselected three. Do not patch or weaken upstream path/permission behavior
as part of the LiquidAIty overlay.

Run the repository's current Magnetic/Team adapter proof separately from these vendor tests. Loaded
Hermes, saved-Card execution and visible product acceptance remain higher proof tiers.

## Upstream refresh procedure

1. Resolve and record the new official tag object and source commit.
2. Create a temporary clean checkout of that exact upstream revision outside production.
3. Apply-check `LIQUIDAITY_OVERLAY.patch` against that clean source before changing `HermesLatest/`.
4. Rebase only the seven families above; preserve newer upstream implementation and record every
   unavoidable compatibility hunk here.
5. Regenerate Gateway contracts once from the rebased authored declarations and inspect the entire diff.
6. Run upstream focused tests, the application adapter proof, one loaded saved-Card turn and one exact
   Stop/terminal/profile readback.
7. Replace `HermesLatest/` only after every retained family and exclusion is accounted for.
8. Update this baseline and regenerate the bounded overlay. Do not create a permanent comparison tree.

Rollback is family-scoped: remove a family's listed hunks and tests together, then disable the dependent
application capability honestly. Never retain a half-applied contract or add an application substitute.
