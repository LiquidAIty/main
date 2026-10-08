# LiquidAIty HermesLatest patch overlay

This file is the update contract for the two LiquidAIty task extensions and
four narrow application-integration patches carried on top of Hermes Agent.
It is an inventory, not runtime authority.

## Upstream baseline

- Project: `NousResearch/hermes-agent`
- Remote: `https://github.com/NousResearch/hermes-agent.git`
- Release tag: `v2026.9.24`
- Package version: `0.21.5`
- Release date: `2026.9.24`
- Annotated tag object: `e3dd27ee2d8b011737a4eea8e3eb3d711ab78690`
- Source commit: `f97608f178d1ffeca59860195ab7da295f7c8e5f`
- Imported into LiquidAIty by repository commit:
  `68b2014e7dbdf502d176e36fc4817a857ae1ce2c`

Git history is the comparison authority for the deleted former Hermes tree.
Production must not recreate, import, launch, or use that superseded tree as a
profile source or fallback.

## Integration patch 1: Codex App Server experimental Dynamic Tools

Purpose: present one saved Card's exact effective tool schemas to Hermes's
existing Codex App Server thread and return each `item/tool/call` through the
authenticated LiquidAIty MCP dispatcher. No alternate App Server, provider,
login, thread owner, or tool executor is introduced. The existing turn interrupt
also cancels and awaits an in-flight Dynamic Tool MCP request so its HTTP and MCP
contexts close before the Codex turn unwinds.

### Vendored change record

- **VENDORED PROJECT:** `HermesLatest`, at the upstream baseline recorded above.
- **PURPOSE:** make the already-approved Codex Dynamic Tool transport honor the existing exact turn interrupt while an MCP request is in flight.
- **EXTERNAL ALTERNATIVE CHECK:** application-only cancellation cannot unblock the synchronous Codex server-request handler; the transport must receive the session's existing interrupt event.
- **FILES AND SYMBOLS:** `agent/transports/codex_app_server_session.py::_handle_dynamic_tool_call`; `agent/transports/dynamic_tools_mcp.py::_call` and `build_dynamic_tool_executor`; their two focused test modules.
- **UPSTREAM BEHAVIOR PRESERVED:** normal Dynamic Tool validation, exactly-once response caching, MCP result projection, turn interruption, and every non-Dynamic-Tool request path remain unchanged.
- **CONTRACTS:** executor callables receive one additional internal `threading.Event`; no Gateway RPC or generated contract changes.
- **TESTS:** focused session propagation plus in-flight MCP cancellation/context-closure tests.
- **FORK COST:** two small transport hunks and one focused test module must be reconciled on an upstream refresh.
- **ROLLBACK:** revert these cancellation hunks and their tests, then keep saved-specialist Dynamic Tools disabled because Stop would no longer cancel their in-flight work.

### New files

| File | Symbols | Purpose |
| --- | --- | --- |
| `agent/transports/dynamic_tools_mcp.py` | `build_dynamic_tool_executor`, `_call`, and its bounded HTTP callback helpers | Sends one authenticated Dynamic Tool call to the existing LiquidAIty MCP endpoint, races the exact session interrupt, closes the active HTTP/MCP contexts on cancellation, and mechanically returns the real MCP result or `dynamic_tool_cancelled`. |

### Compatibility hunks in upstream files

| File | Symbols / hunk | Why required |
| --- | --- | --- |
| `agent/codex_runtime.py` | `_dynamic_tools_configuration`, `_dynamic_tool_executor`, `_ensure_codex_session` | Reads the already-authorized Card definitions, fingerprints them for thread reuse, and supplies the callback to the existing Codex runtime. |
| `agent/transports/codex_app_server_session.py` | constructor Dynamic Tool validation, `dynamic_tools_fingerprint`, `ensure_started`, `_handle_server_request`, `_handle_dynamic_tool_call`, event projection | Advertises only `experimentalApi` when tools are present, sends exact `dynamicTools`, validates thread/turn/schema/call IDs, executes once, passes the existing session interrupt event into that exact call, and answers the original JSON-RPC request. No other App Server behavior is changed. |
| `tui_gateway/contracts/prompt_voice.py` | `DynamicToolDefinition`; `PromptSubmitParams.dynamic_tools`, `tool_endpoint`, `tool_authorization` | Declares the exact turn transport fields. |
| `tui_gateway/methods_prompt.py` | Dynamic Tool triple validation and forwarding | Rejects partial configuration and passes the exact definitions/authorization into the accepted turn. |
| `tui_gateway/prompt_turn.py` | Dynamic Tool turn binding | Binds the accepted definitions to the existing agent turn without changing saved profile authority. |
| `tui_gateway/session_auto_continue.py` | queued-envelope Dynamic Tool fields | Preserves the same accepted definition set when Hermes itself queues a busy-session turn. |
| `tests/agent/transports/test_codex_app_server_session.py` | Dynamic Tool binding and interrupt tests | Proves experimental handshake, exact schema projection, request scoping, argument validation, conflict rejection, exactly-once callback behavior, and propagation of the existing interrupt event into a blocked executor. |
| `tests/agent/transports/test_dynamic_tools_mcp.py` | in-flight cancellation test | Proves an interrupted MCP call is cancelled and its ClientSession, stream, and HTTP contexts all close before the result returns. |

## Integration patch 2: saved orange-roster scoping for Bot Mode

Purpose: constrain each orchestrator session's Hermes `message_agent` targets
to the exact saved outbound orange roster supplied by that Project deck. The
application remains the authorization owner; Hermes validates and enforces the
supplied profile names during its normal Bot Mode delivery. Project topology is
never persisted in the reusable profile.

### Compatibility hunks in upstream files

| File | Symbols / hunk | Why required |
| --- | --- | --- |
| `tools/bot_mode_probe.py` | `configured_bot_roster`, `resolve_bot_roster`, `bot_mode_session_authorized`; prompt/probe roster use | Makes an explicit roster, including `[]`, authoritative without broadening to every installed profile. |
| `tools/bot_mode_dm.py` | schema injection gate and local target resolution | Keeps `message_agent` internal to Hermes while rejecting targets outside the supplied roster. |
| `agent/system_prompt.py` | Bot protocol injection | Describes only the session's allowed targets and injects the internal tool only for an authorized roster. |
| `tui_gateway/methods_profiles.py` | `_canonical_bot_roster` | Canonicalizes live profile identities for a supplied session roster and rejects self/unknown/malformed entries without writing profile configuration. |
| `tui_gateway/contracts/sessions.py` | create/resume/activate roster fields | Declares the session-scoped roster input. |
| `tui_gateway/methods_session.py` | `_session_bot_roster`, `_apply_session_bot_roster`; create/resume/activate integration | Validates and attaches the exact roster to the intended session. |
| `tui_gateway/server.py` | agent/session roster attachment | Carries the validated roster into the existing agent build and reattachment paths. |
| `tests/tui_gateway/test_profiles_bot_roster.py` | session roster and profile preservation tests | Proves absent versus empty, stable order/deduplication, no profile write, rejection of self/unknown/malformed entries, and reusable profile preservation. |

This patch does not include the old Project target opener, suffixed Bot Chats,
relay replacement, or `resolve_message_agent_target` application hook.

## Integration patch 3: submitted-turn correlation

Purpose: correlate one accepted or Hermes-queued user submission with the
events and terminal result for that same turn. LiquidAIty uses the opaque Run
ID to avoid settling a different active/queued turn; Hermes still owns its
existing queue and execution behavior.

### Compatibility hunks in upstream files

| File | Symbols / hunk | Why required |
| --- | --- | --- |
| `tui_gateway/contracts/events.py` | `SubmissionStartedPayload`; `ErrorPayload.submission_id`; `MessageCompletePayload.submission_id` | Declares the correlation evidence on start, failure, and completion. |
| `tui_gateway/contracts/prompt_voice.py` | `PromptSubmitParams.submission_id`, `PromptSubmitResult.submission_id` | Accepts and acknowledges one opaque caller identity. |
| `tui_gateway/methods_prompt.py` | submit validation/acknowledgement and `_active_submission_id` | Carries the accepted identity into the existing turn without interpreting it. |
| `tui_gateway/prompt_turn.py` | `prompt.submission.started` and completion propagation | Emits start/completion evidence for the exact accepted turn. |
| `tui_gateway/session_auto_continue.py` | queue envelope and terminal-error propagation | Preserves the identity when Hermes queues and later drains a busy-session input. |
| `tui_gateway/contracts/sessions.py` | `SessionInterruptParams.expected_submission_id` | Declares the exact accepted submission that a caller intends to interrupt. |
| `tui_gateway/methods_session.py` | exact-submission interrupt guard | Refuses to stop a different active or queued turn while retaining Hermes's existing interrupt behavior for the matching submission. |
| `tests/tui_gateway/test_auto_continue.py` | exact-submission interruption proof | Proves a stale caller cannot interrupt a later turn and the matching caller still can. |

The application consumer is
`apps/backend/src/routes/mainSession.routes.ts::submitTurn`, which waits for the
matching `prompt.submission.started` event and ignores unrelated completions.

## Integration patch 4: Card profile fields and profile-scoped learning selection

Purpose: let the existing LiquidAIty Card/profile adapter configure only the
Card-owned Hermes profile fields, including an explicit empty toolset selection,
and read them back, while leaving Hermes-owned
learning, memory, unknown profile keys, execution, and session state intact.
One Card remains one reusable profile; Projects create sessions against that
profile rather than cloning it.

### Compatibility hunks in upstream files

| File | Symbols / hunk | Why required |
| --- | --- | --- |
| `tui_gateway/contracts/profiles_vault_complete_foreign_subagents.py` | `ProfileModelPin.openai_runtime`, `ProfileDelegationSettings`, profile describe/configure delegation and task-mode fields | Declares the existing profile configuration values that saved Cards actually own and need to read back. |
| `tui_gateway/methods_profiles.py` | `_profile_delegation_settings`, `_configure_model`, `_configure_card_execution`, `_save_toolset_pin`, describe/configure integration | Writes only declared Card-owned fields into the selected profile, preserves an explicit empty `platform_toolsets.cli` pin, and preserves every unrelated config key and profile file. |
| `tui_gateway/server.py` | `_load_enabled_toolsets` explicit-empty profile pin | Keeps `platform_toolsets.cli: []` distinct from a missing key so a Card can select no ordinary Hermes toolsets; missing, nonempty, environment-pin, session-fold-in, and Kanban-worker paths retain their existing behavior. |
| `tui_gateway/contracts/tools_mcp_plugins.py` | profile on learning frame/node requests | Makes learning reads and edits address the exact saved Card profile instead of an ambient profile. |
| `tui_gateway/methods_tools.py` | profile-scoped learning RPC forwarding | Delegates the request to Hermes's existing learning implementation for that profile; it does not add another learning store. |
| `tests/tui_gateway/test_profiles_bot_roster.py` | Card execution/profile preservation proof | Proves model runtime, delegation and Team mode read back while unknown and Hermes-owned state survives configuration. |
| `tests/tui_gateway/test_profiles_toolset_pin.py`, `tests/tui_gateway/test_tui_gateway_server.py` | empty/missing/nonempty toolset-selection proof | Proves an explicit empty profile pin survives save/readback and reaches the runtime as `[]`, while missing and nonempty selections retain Hermes behavior. |

## Generated contract artifacts

| File | Source | Purpose |
| --- | --- | --- |
| `apps/shared/src/gateway-contract.openrpc.json` | Hermes contract generator | Generated schemas for Dynamic Tools, Bot roster, submission correlation, exact interruption, profile configuration, and profile-scoped learning. |
| `apps/shared/src/gateway-contract.generated.ts` | Hermes contract generator | Generated TypeScript types for the same declared RPC/event fields. |

## Extension family 1: AutoTeam / Team TaskGraph

Purpose: an explicitly configured saved Team profile runs one bounded Hermes
Kanban workflow with a decomposition pass, temporary worker tasks, and a
separate final synthesis pass. Hermes remains the task, dependency, attempt,
dispatcher, worker, retry, and result owner.

### New files

| File | Symbols | Purpose |
| --- | --- | --- |
| `hermes_cli/kanban_team.py` | `TEAM_WORKFLOW_ID`, `TEAM_DECOMPOSITION_STEP`, `TEAM_WORKER_STEP`, `TEAM_SYNTHESIS_STEP`, `profile_task_mode`, `is_team_profile`, `team_profile_policy`, `create_team_root`, `activate_staged_team_root`, `record_decomposition_failure` | The existing LiquidAIty AutoTeam workflow migrated from the former Hermes comparison tree without redesign. |
| `tests/hermes_cli/test_kanban_team.py` | complete test module | The migrated AutoTeam behavior contract. |

### Compatibility hunks in upstream files

| File | Symbols / hunk | Why required |
| --- | --- | --- |
| `hermes_cli/config_defaults.py` | `DEFAULT_CONFIG["kanban"]["task_mode"]` | Stores the explicit per-profile `team` marker; empty preserves ordinary Hermes behavior. |
| `hermes_cli/kanban_db.py` | `create_task` Team-worker nesting guard; workflow fields in creation; `build_worker_context` synthesis contract | Carries the existing Team workflow marker and prevents recursive Team trees. |
| `hermes_cli/kanban_db_graph.py` | `decompose_triage_task`, `_insert_decomposed_child` Team branches | Moves a marked Team root from decomposition to synthesis and marks its worker rows. |
| `hermes_cli/kanban_decompose.py` | `_apply_fanout`, `decompose_task` Team branches | Uses the saved Team profile/model for bounded temporary workers while preserving ordinary decomposition. |
| `hermes_cli/kanban_db_dispatch.py` | `_set_worker_pid`, `_default_spawn` Team branches | Records the Team step/model receipt and marks dispatched Team worker processes. |
| `gateway/kanban_watchers_dispatcher.py` | `_record_team_decomposition_failure`, `_decompose_one` | Applies the existing bounded decomposition breaker only to Team roots. |
| `tools/kanban_tools.py` | `_handle_create` Team-root branch | An ordinary saved profile marked `team` creates the existing Team root without exposing a workflow selector to the model. |
| `tools/delegate_tool.py` | `delegate_task` Team-worker guard | Prevents a temporary Team worker from creating another delegation tree. |

### Mechanical compatibility choices

- HermesLatest's newer ordinary decomposition fallback to the root assignee is
  preserved. The old Team branch was added beside it rather than replacing it.
- HermesLatest's newer persisted author/session resolution is preserved in
  `kanban_create`; only the old Team-root choice was added.
- HermesLatest's current worker environment and secret-scope handling is
  preserved. Old Card-tools-host and dashboard-bearer plumbing was not copied.

## Extension family 2: TaskGraph / Magnetic

Purpose: one explicitly bounded Magnetic creator tree may assign work only to
the exact saved blue-connected profile ceiling. `NULL` remains ordinary,
unrestricted upstream Kanban behavior.

### New files

None. This family is an additive schema and enforcement overlay on the shipped
Kanban ledger.

### Compatibility hunks in upstream files

| File | Symbols / hunk | Why required |
| --- | --- | --- |
| `hermes_cli/kanban_db_connect.py` | `_LATER_TASK_COLUMNS.allowed_assignees` | Additive migration for existing Kanban databases. |
| `hermes_cli/kanban_db.py` | `Task.allowed_assignees`, `_normalize_allowed_assignees`, `_stored_allowed_assignees`, `_require_allowed_assignee`, `_creator_allowed_assignees`, `_creator_task_id`, `create_task`, `assign_task`, `request_review`, `specify_triage_task` | Stores, inherits, narrows, and enforces the exact creator-tree assignment ceiling. |
| `hermes_cli/kanban_db.py` | `_new_claim_capability`, `claim_task`, `claim_review_task` | Gives each claimed run a distinct capability used by the existing authenticated Magnetic worker-tool envelope. |
| `hermes_cli/kanban_db_graph.py` | `decompose_triage_task`, `_insert_decomposed_child` ceiling checks and inheritance | Prevents automatic decomposition from escaping the blue-worker ceiling. |
| `hermes_cli/kanban_db_dispatch.py` | `_apply_default_assignee` ceiling check | Prevents default assignment from bypassing the explicit ceiling. |
| `tests/hermes_cli/test_kanban_creator_origin.py` | three `allowed_assignees` tests | Existing TaskGraph lineage, null-preservation, and bounded-decomposition proof. |
| `tests/tools/test_kanban_tools.py` | `test_bounded_worker_can_recurse_to_self_but_cannot_recruit_another_profile` | Existing model-tool boundary proof for a Magnetic worker. |

### Mechanical compatibility choices

- HermesLatest refuses adding a dependency to a running child without the
  child's current run identity. The LiquidAIty adapter test now supplies that
  existing `expected_child_run_id`; production already reaches this API through
  Hermes's run-bound `kanban_link` tool.
- HermesLatest rejects an empty completion before a task can become `done`.
  The LiquidAIty adapter proof now expects that earlier failure instead of
  manufacturing a completed root with no result.

## Explicit exclusions

This overlay does not contain:

- any Codex App Server change beyond the experimental Dynamic Tool fields and request handler listed above;
- an alternate Codex App Server, Codex runtime, provider, or login path;
- application-owned Gateway, process, session, queue, or retry ownership;
- Bot roster, target-session resolver, suffixed Bot Chat, or message fallback;
- IDD tool ownership, tool aliases, or runtime validation through IDD;
- Project orange/blue topology persisted into a reusable profile;
- old Card-tools-host, environment preload, lifecycle-hook, or cache code;
- generated Gateway contracts, build artifacts, credentials, or `%SystemDrive%`
  cache databases;
- voice/HUD/WorldView bridge experiments; upstream Hermes voice mode is retained unchanged;
- a PTY implementation patch; upstream `win_pty_bridge.py` remains the Windows terminal owner;
- the removed `delegate_task(role="team")` design.

## Focused proof

Run from the LiquidAIty repository root:

```powershell
$env:PYTHONPATH = "C:\Projects\LiquidAIty\main\HermesLatest"
apps\python-models\.venv\Scripts\python.exe -m pytest `
  HermesLatest/tests/agent/transports/test_codex_app_server_session.py `
  HermesLatest/tests/agent/transports/test_dynamic_tools_mcp.py `
  HermesLatest/tests/tui_gateway/test_profiles_bot_roster.py `
  HermesLatest/tests/tui_gateway/test_auto_continue.py `
  HermesLatest/tests/tui_gateway/contracts/test_generated.py `
  HermesLatest/tests/hermes_cli/test_kanban_team.py `
  HermesLatest/tests/hermes_cli/test_kanban_creator_origin.py `
  HermesLatest/tests/tools/test_kanban_tools.py -q

apps\python-models\.venv\Scripts\python.exe -m pytest `
  apps/python-models/app/python_models/test_magentic_execution.py -q
```

Hermes's preferred `scripts/run_tests.sh` is unavailable on the current native
Windows host because `/bin/bash` is absent. The Windows virtual-environment
results must therefore be reported separately from upstream-script parity.

## Upstream refresh procedure

1. Resolve and record the new official tag object and source commit.
2. Produce a clean checkout/worktree of that exact commit.
3. Generate a path-bounded overlay containing only the six seams listed
   above, their generated contracts and this register.
4. Apply-check the overlay against the clean checkout before changing the
   production tree.
5. Resolve only unavoidable upstream API conflicts. Record every such
   compatibility choice in this file; never replace newer upstream files
   wholesale with historical snapshots from Git.
6. Run upstream Kanban tests first, then the two extension-family tests, then
   LiquidAIty adapter and real-product proof.
7. Update the pinned revision only after the clean apply-check and focused
   proof pass.
8. Use Git history as the long-term comparison source. Do not recreate a second
   Hermes source tree beside `HermesLatest`.
