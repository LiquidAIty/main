# HermesLatest application patch overlay

This register is the update contract for seven bounded extension families carried on top of Hermes
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

1. Experimental Dynamic Tools: project one accepted turn's exact authorized tool schemas into Hermes,
   dispatch each call through the authenticated MCP callback, and cancel the exact in-flight call on Stop.
2. Card Python: present one valid saved Script as `card_python`, execute it through Hermes's existing
   child-process Python path, and route only its declared nested tool calls through the same callback.
3. Bot roster scoping: constrain Hermes `message_agent` to the exact Project-session orange roster.
4. Card profile capability fencing: apply/read only Card-owned profile fields, scope learning reads to the
   addressed profile, preserve unknown/learned state, ship Builder's selected inspection skill through
   Hermes's bundled-skill mechanism, and rebuild a session only when its capability fingerprint is stale.
5. Exact turn evidence: correlate submission, Stop, completion, actual provider/model and turn-local usage
   without replacing Hermes queue/session ownership.
6. AutoTeam / Team TaskGraph: mark an ordinary saved Team profile, create one bounded Team root, use
   temporary workers, and synthesize on that same root through Hermes's task ledger.
7. TaskGraph / Magnetic: persist and enforce the exact blue-worker assignment ceiling and creator lineage
   while leaving ordinary Hermes tasks unrestricted.

## New production files

| File | Family | Current responsibility |
| --- | --- | --- |
| `agent/transports/dynamic_tools_mcp.py` | Dynamic Tools / Card Python | Validates the loopback endpoint, performs one signed MCP call, projects the real result, and closes the exact HTTP/MCP contexts when the turn interrupt fires. |
| `agent/dynamic_tools.py` | Dynamic Tools / Card Python | Installs and restores the current turn's exact definitions/executors for Codex and ordinary providers; it creates no global tool registry. |
| `agent/card_script_tool.py` | Card Python | Validates the immutable Script contract, hashes, schemas, aliases, tool states and budgets; exposes one `card_python` tool and one bounded output. |
| `hermes_cli/kanban_team.py` | AutoTeam | Owns the explicit Team task mode/policy, root construction/readback, activation and bounded decomposition-failure settlement. |
| `skills/autonomous-ai-agents/agent-builder-inspection/SKILL.md` | Profile fencing | Bundled Builder guidance selected by the saved Builder Card and seeded by Hermes's existing fresh-profile skill sync; it adds no permission, loader or execution path. |

## Compatibility hunks in upstream production files

Files may appear in more than one family because one accepted turn carries all of its authority together.

| File | Family | Symbols / reason |
| --- | --- | --- |
| `agent/codex_runtime.py` | Dynamic Tools / Card Python | `_dynamic_tools_configuration`, `_dynamic_tool_executor`, `_ensure_codex_session`: fingerprint exact turn tools and retire/reuse Codex sessions accordingly. |
| `agent/conversation_loop.py` | Profile fencing | `_profile_capability_prompt_stale`, `_persist_system_prompt`, `_restore_or_build_system_prompt`: refresh profile-following prompts when the real capability epoch changes. |
| `agent/inline_tool_executors.py` | Dynamic Tools / Card Python | `resolve_invoke_tool_executor`: prefer the current turn's exact executor before shipped memory/registry lookup. |
| `agent/system_prompt.py` | Bot roster / profile fencing | `_profile_capability_parts`, `_post_workspace_parts`: describe only the authorized Bot roster and bind the prompt to the profile capability epoch. |
| `agent/tool_executor.py` | Dynamic Tools / Card Python | `_resolve_sequential_dispatch`: route current-turn tools through agent-local authority, never a replacement global registry. |
| `agent/transports/codex_app_server_session.py` | Dynamic Tools | Validate the experimental handshake, definitions, thread/turn/call identity and exactly-once server-request response; propagate the existing interrupt event. |
| `gateway/kanban_watchers_dispatcher.py` | AutoTeam | `_record_team_decomposition_failure`, `_decompose_one`: apply the breaker only to marked Team roots. |
| `hermes_cli/config_defaults.py` | AutoTeam | `kanban.task_mode`: empty preserves shipped behavior; `team` is explicit profile configuration. |
| `hermes_cli/kanban_db.py` | AutoTeam / Magnetic | Store Team workflow fields and `allowed_assignees`; inherit/narrow/enforce the creator-tree ceiling, build same-root Team synthesis context, and expose `append_task_event` so the Magnetic adapter records its authority event without importing Hermes's private `_append_event`. No custom claim capability is retained. |
| `hermes_cli/kanban_db_connect.py` | Magnetic | Additive `allowed_assignees` column migration for existing Hermes task databases. |
| `hermes_cli/kanban_db_dispatch.py` | AutoTeam / Magnetic / turn evidence | Record Team step/provider/model facts, enforce default-assignee ceiling, and mark Team worker processes. |
| `hermes_cli/kanban_db_graph.py` | AutoTeam / Magnetic | Enforce/inherit the ceiling during decomposition and move a marked Team root to synthesis. |
| `hermes_cli/kanban_decompose.py` | AutoTeam | Use the saved Team profile for bounded depth-one worker fanout and mandatory worker tasks. |
| `tools/bot_mode_dm.py` | Bot roster | Keep `message_agent` internal to Hermes and reject a local target outside the explicit roster. |
| `tools/bot_mode_probe.py` | Bot roster / profile fencing | Resolve explicit absent/empty/nonempty rosters and compute the capability epoch from roster, tools, delegation, task mode and runtime. |
| `tools/code_execution_tool.py` | Card Python | Generate child-only `input/tools/output`, enforce aliases/states/budgets, and inject the signed nested dispatcher. |
| `tools/code_kernel.py` | Card Python | Carry per-cell authority into a disposable local kernel and dispose it after execution. |
| `tools/delegate_tool.py` | AutoTeam | Prevent a temporary Team worker from opening a second delegation tree. |
| `tools/kanban_tools.py` | AutoTeam / Magnetic | Create the structurally marked Team root and preserve creator identity/assignment ceiling. |
| `tui_gateway/agent_callbacks.py` | Profile fencing / turn evidence | Rebuild from exact stored profile/session overrides and reject capability drift during the build. |
| `tui_gateway/contracts/events.py` | Turn evidence | Declare submission identity and `MessageCompletePayload.turn_usage`. |
| `tui_gateway/contracts/profiles_vault_complete_foreign_subagents.py` | Bot roster / profile fencing / AutoTeam | Declare Card-owned runtime/delegation/task-mode fields, roster-aware describe, and `capability_fingerprint`. |
| `tui_gateway/contracts/prompt_voice.py` | Dynamic Tools / Card Python / Bot roster / turn evidence | Declare exact tool, Script, callback, roster, fingerprint and submission fields on `prompt.submit`. Voice behavior is otherwise unchanged. |
| `tui_gateway/contracts/sessions.py` | Bot roster / exact Stop | Declare session roster input and `expected_submission_id`. |
| `tui_gateway/contracts/tools_mcp_plugins.py` | Profile fencing | Add explicit profile identity to Hermes learning reads/edits. |
| `tui_gateway/methods_profiles.py` | Bot roster / profile fencing / AutoTeam | Configure/read only declared Card fields, preserve explicit empty toolset pins, canonicalize session rosters and return the capability fingerprint. |
| `tui_gateway/methods_prompt.py` | Dynamic Tools / Card Python / Bot roster / turn evidence | Validate one complete callback/Script/roster/fingerprint envelope and forward the exact accepted authority. |
| `tui_gateway/methods_session.py` | Bot roster / exact Stop | Apply the roster to create/resume/activate and refuse interruption of a different submission. |
| `tui_gateway/methods_tools.py` | Profile fencing | Forward learning operations to Hermes's existing implementation for the exact profile. |
| `tui_gateway/model_switch.py` | Profile fencing / model evidence | Rebuild only against the expected capability fingerprint and clear stale resume overrides without choosing a model for the application. |
| `tui_gateway/prompt_turn.py` | All turn-scoped families | Fence before provider work, install/restore exact tools and Script, emit submission events, and calculate the turn-local usage delta. |
| `tui_gateway/server.py` | Bot roster / profile fencing / turn evidence | Preserve explicit empty toolsets, carry roster/session authority, fence profile builds, and expose available Hermes usage evidence. |
| `tui_gateway/session_auto_continue.py` | Dynamic Tools / Card Python / Bot roster / turn evidence | Preserve the accepted envelope and submission identity when Hermes queues and later drains a busy-session turn. |

`tui_gateway/methods_config_set.py` is not part of the overlay. The rejected Builder Docker/configuration
patch is absent and this file is byte-equal to the imported upstream baseline.

## Generated contract artifacts

| File | Source | Rule |
| --- | --- | --- |
| `apps/shared/src/gateway-contract.openrpc.json` | Hermes Gateway contract generator | Must exactly contain the declared Dynamic Tool, Card Script, roster, capability-fingerprint, submission/Stop and turn-usage fields. |
| `apps/shared/src/gateway-contract.generated.ts` | Same generator | Must be byte-derived from the same Python declarations; never hand-edit. |

These artifacts are regenerated once after authored source freezes. A later source defect that requires a
second generation must stop for owner approval.

Current frozen generation (2026-10-09):

- `gateway-contract.generated.ts` SHA-256
  `D9E4CF7AF28B41759592ADE6EDCD0970F9D536A9B36F9EF5EACDB956705412C9`
- `gateway-contract.openrpc.json` SHA-256
  `9AD016F4695A7A4ECB1BBB5316061ED20DBF802B11827477E01F767C61446DDB`

## Focused proof files

```text
tests/agent/test_card_script_dynamic_tools.py
tests/agent/test_system_prompt.py
tests/agent/test_system_prompt_restore.py
tests/agent/transports/test_codex_app_server_session.py
tests/agent/transports/test_dynamic_tools_mcp.py
tests/hermes_cli/test_kanban_creator_origin.py
tests/hermes_cli/test_kanban_db.py
tests/hermes_cli/test_kanban_team.py
tests/hermes_state/test_named_profile_session_db.py
tests/skills/test_agent_builder_inspection_skill.py
tests/tools/test_bot_mode_probe.py
tests/tools/test_card_script_code_execution.py
tests/tools/test_kanban_tools.py
tests/tui_gateway/test_auto_continue.py
tests/tui_gateway/test_fallback_chain_hot_reload.py
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
- old Card-tools-host, environment preload, lifecycle hook or hidden fallback code;
- credentials, generated build output, profile data or cache databases.

## Focused Windows proof

From the repository root, use the application environment for pytest and add both the Hermes source
and Hermes runtime dependencies. `HermesLatest/.venv` is the production environment but intentionally
does not install pytest:

```powershell
$hermesRoot = (Resolve-Path "HermesLatest").Path
$hermesSite = (Resolve-Path "HermesLatest\.venv\Lib\site-packages").Path
$env:PYTHONPATH = "$hermesRoot;$hermesSite"
apps\python-models\.venv\Scripts\python.exe -m pytest `
  HermesLatest/tests/agent/test_card_script_dynamic_tools.py `
  HermesLatest/tests/agent/test_system_prompt.py `
  HermesLatest/tests/agent/test_system_prompt_restore.py `
  HermesLatest/tests/agent/transports/test_codex_app_server_session.py `
  HermesLatest/tests/agent/transports/test_dynamic_tools_mcp.py `
  HermesLatest/tests/hermes_cli/test_kanban_creator_origin.py `
  HermesLatest/tests/hermes_cli/test_kanban_db.py `
  HermesLatest/tests/hermes_cli/test_kanban_team.py `
  HermesLatest/tests/hermes_state/test_named_profile_session_db.py `
  HermesLatest/tests/skills/test_agent_builder_inspection_skill.py `
  HermesLatest/tests/tools/test_bot_mode_probe.py `
  HermesLatest/tests/tools/test_card_script_code_execution.py `
  HermesLatest/tests/tools/test_kanban_tools.py `
  HermesLatest/tests/tui_gateway/test_auto_continue.py `
  HermesLatest/tests/tui_gateway/test_fallback_chain_hot_reload.py `
  HermesLatest/tests/tui_gateway/test_profile_rebuild_commit.py `
  HermesLatest/tests/tui_gateway/test_profiles_bot_roster.py `
  HermesLatest/tests/tui_gateway/test_profiles_toolset_pin.py `
  HermesLatest/tests/tui_gateway/test_tui_gateway_server.py -q
```

On native Windows this complete file set currently has six source-unrelated upstream baseline failures:
three POSIX/systemd/worktree assertions in `test_kanban_db.py`, two fallback-chain hot-reload assertions,
and one same-size/pinned-mtime config-cache assertion. The 2026-10-09 run passed 965 tests, including every
overlay-added assertion, and failed only those six cases. Do not patch or weaken those upstream behaviors as
part of the LiquidAIty overlay; rerun them when updating the upstream baseline or its Windows test support.

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
