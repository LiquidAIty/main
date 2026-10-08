# LiquidAIty Hermes divergence register

Status: **audit checkpoint — current divergence is not accepted as the target**.

This file records what differs from the pinned upstream source. It does not grant
approval merely because code exists. The approved target is:

1. update the vendored tree to an explicitly selected current upstream Hermes revision;
2. retain only two LiquidAIty patch families, after re-porting and proof:
   - **AutoTeam** — a saved profile may turn an ordinary Hermes Kanban assignment
     into the bounded automatic decompose/work/synthesize workflow;
   - **TaskGraph/Magnetic** — one submitted Hermes task tree may enforce the exact
     saved blue-connected assignee ceiling;
3. use upstream profile, session, tool, Skill, MCP, Bot, transport, replay, TUI,
   provider and lifecycle behavior everywhere else.

No other Hermes modification is approved. A supporting hunk may remain only when
focused evidence proves it is strictly required by one of those two patch families;
it must then be documented inside that family, not as a third extension.

## Authoritative comparison

- Official project: `NousResearch/hermes-agent`
- Pinned comparison revision: `0.21.3`, commit
  `73521a8e375a867fae14ec0579f2dfb47aa0017e`
- Current LiquidAIty repository commit at audit:
  `8ea07bd447bef2efca3285806dc1f175ace05741`
- Current `Hermes/` working-tree diff before this documentation correction: clean
- Historical reset checkpoint used only as a secondary chronology reference:
  `1bc5cd12b3690a810a7a4e304f6b71997352f898`
- Comparison method: GitHub's official recursive Git tree for the pinned commit
  versus the blob identities in `git ls-tree -r HEAD -- Hermes`.
- Official upstream blobs: `13,698`
- LiquidAIty vendored blobs: `13,678`
- Same-path blobs with different content: `48`
- LiquidAIty-only blobs: `10`
- Upstream blobs missing from LiquidAIty: `30`

The previous register's statement that the tree was upstream plus “exactly nine”
extensions was false. The exact inventory below replaces it.

## Newer-upstream inspection

The latest tagged release visible during this audit is still `0.21.3`. Upstream
`main` is newer than the pinned source; the inspected head was
`05eecbcd972c8737ebc7722ea08aab47fb538043` (2026-10-06), and its package release
date is `2026.9.24`.

Newer upstream already provides behavior that can replace several local changes:

- `profiles.configure` writes the execution-facing `platform_toolsets.cli` pin;
- MCP enablement uses the runtime's current `enabled` representation;
- `model.openai_runtime: codex_app_server` is applied after provider resolution,
  and the app-server owns its own login rather than requiring copied profile OAuth;
- Bot delivery has durable delivery IDs, live-owner admission, retry handling,
  completion notification/poll fallback, and transcript persistence;
- the shipped WebSocket client has stronger per-session replay barriers and
  server-request replay;
- canonical Bot Chats rebuild their persisted prompt when the upstream capability
  fingerprint changes;
- `prompt.submit` has the ordinary client `queued` contract.

Newer upstream still does **not** provide:

- an exact per-source Bot roster derived from LiquidAIty orange topology;
- delivery to a LiquidAIty Project/conversation-specific stored target session;
- `prompt.submit.managed_tools`, `allowed_tools`, or `model_once`;
- LiquidAIty's completion fields (`nativeRootId`, `nativeRunId`, actual model/tool
  exposure, or captured tool-call evidence);
- AutoTeam's `auto-team-v1` workflow;
- TaskGraph/Magnetic's `allowed_assignees` ceiling.

Therefore an upstream update materially reduces the fork, but it does not by
itself satisfy the orange Bot boundary or dynamic per-Run tool narrowing.

## Approved patch family A — AutoTeam

Required outcome: an explicitly configured saved Team profile uses Hermes's one
Kanban database, dispatcher, task rows, dependencies, workers, retries and final
synthesis. LiquidAIty must not add a scheduler, worker registry, queue, task store
or transcript owner.

Current candidate production paths (mixed files must be split during re-port):

- `gateway/kanban_watchers_dispatcher.py` — bounded Team decomposition failure handling;
- `hermes_cli/config_defaults.py` — `kanban.task_mode` only;
- `hermes_cli/kanban_team.py` — Team policy/root/decomposition/synthesis helpers;
- `hermes_cli/kanban_db.py` — Team workflow and step fields;
- `hermes_cli/kanban_db_graph.py` — Team child and synthesis propagation;
- `hermes_cli/kanban_decompose.py` — Team worker route and required fan-out;
- `hermes_cli/kanban_db_dispatch.py` — Team worker process marker/receipt handling;
- `tools/kanban_tools.py` — ordinary saved-profile Team root entry;
- `tools/bot_mode_dm.py` — **candidate only**: the Team-target branch must be
  proven necessary after stock Bot delivery is restored; all Project-roster and
  target-session code is outside this family;
- `tools/delegate_tool.py` and `run_agent.py` — mixed historical cleanup around
  retired `role="team"` / profile delegation; rebase to upstream first, then keep
  only a proven AutoTeam delta.

Required proof before this family is accepted:

- ordinary Hermes Kanban remains unchanged when `kanban.task_mode` is empty;
- one marked saved profile creates one bounded Team root;
- decomposition produces real worker tasks and one final synthesis step;
- retry, Stop, failure and rejoin remain Hermes-owned;
- no Bot, profile, tool, session or provider patch is smuggled into this family.

## Approved patch family B — TaskGraph/Magnetic

Required outcome: the existing Hermes task tree for one Magnetic root may assign
work only to the exact saved blue-connected profiles. Omission remains ordinary
unrestricted Hermes behavior.

Current candidate production paths:

- `hermes_cli/kanban_db.py` — nullable `allowed_assignees`, canonical validation,
  creator/child/review/reassignment enforcement and readback;
- `hermes_cli/kanban_db_connect.py` — additive nullable column migration;
- `hermes_cli/kanban_db_graph.py` — inheritance and decomposition enforcement;
- `hermes_cli/kanban_db_dispatch.py` — bounded default-assignee enforcement.

Required proof before this family is accepted:

- `NULL` preserves upstream task behavior;
- the root assignee must belong to an explicit ceiling;
- automatic decomposition cannot assign outside the ceiling;
- manually created descendants cannot widen their creator scope;
- ordinary boards, review, retries and dispatcher behavior remain unchanged;
- no application scheduler, process owner or copied task ledger appears.

## Unapproved or mixed production differences

These differences must be replaced by newer upstream behavior or removed. If a
LiquidAIty requirement remains unsupported, implementation stops at that boundary
until the owner approves a concrete design. They are not silently folded into the
two Kanban families.

### Bot roster, Project target and exact-session modifications

- `hermes_cli/plugins.py`
- `hermes_cli/config_migrations.py`
- `tools/bot_mode_probe.py`
- `tools/bot_mode_dm.py` (mixed with the AutoTeam candidate branch)
- `tools/bot_live_delivery.py`
- `tui_gateway/methods_bot_relay.py`
- `tui_gateway/methods_profiles.py` (mixed with a toolset change now supplied upstream)
- `tui_gateway/contracts/profiles_vault_complete_foreign_subagents.py`
- `apps/shared/src/gateway-contract.generated.ts`
- `apps/shared/src/gateway-contract.openrpc.json`
- `agent/inline_tool_executors.py`

These add suffixed `Bot Chat:<digest>` recognition, per-profile `bot_mode.roster`,
the `resolve_message_agent_target` hook, a Project-owned target stored-session
argument, exact live-owner selection and Team delivery correlation. Stock and
newer Hermes use one canonical `Bot Chat` per profile and an install-wide live
profile roster. The application resolver has already been deleted, so the dormant
vendor hook is not an accepted fallback.

### Card/Codex dynamic tools, MCP projection, images and receipts

- `agent/codex_runtime.py`
- `agent/transports/codex_app_server.py`
- `agent/transports/codex_app_server_session.py`
- `tui_gateway/contracts/prompt_voice.py`
- `tui_gateway/contracts/events.py`
- `tui_gateway/methods_prompt.py`
- `tui_gateway/prompt_turn.py`
- `apps/shared/src/gateway-contract.generated.ts`
- `apps/shared/src/gateway-contract.openrpc.json`

These add Codex app-server Dynamic Tools, a Hermes tool callback executor,
Run-scoped MCP projection, image-item projection, turn-local model/tool selection,
and completion evidence/provider IDs. They may relate to Cards using the Codex
CLI and to IDF-selected context, but that relationship is not approval. Static
saved Card tool ON/OFF behavior already has a standard mechanism: each profile's
application plugin is materialized with only that Card's selected `tools.json`,
while Hermes profile configuration owns Skills, toolsets and MCP servers. Dynamic
AutoTools narrowing is a separate unsupported boundary.

### Profile prompt refresh

- `agent/system_prompt.py`
- `agent/conversation_loop.py`

These compare the current SOUL identity with a stored prompt for every persisted
session. Newer upstream has a capability-epoch rebuild for canonical Bot Chats,
but not for LiquidAIty's suffixed Project sessions. This remains tied to the
unapproved multi-conversation Bot design and must not survive as an independent
extension without approval.

### Provider and worker-environment changes

- `hermes_cli/runtime_provider.py` — Codex app-server routing without copied OAuth;
  newer upstream now owns the equivalent provider resolution.
- `agent/transports/codex_app_server.py` — mixed Magnetic shell disablement and
  removal/replacement of worker MCP environment projection.
- `hermes_cli/kanban_db_dispatch.py` — mixed Team/TaskGraph changes plus explicit
  dashboard-bearer removal. The latter may remain only if focused proof shows it
  is necessary inside one approved Kanban patchset after the upstream update.

### Other changed production paths requiring upstream rebase or removal

- `tools/delegate_tool.py` — large removal of historical Team/profile delegation;
- `run_agent.py` — companion removal of profile-delegation arguments;
- `tui_gateway/methods_voice.py` — speaking/idle event additions unrelated to either
  approved Kanban family;
- `contributors/emails/uperLu@users.noreply.github.com` — blob identity differs
  from upstream while the ordinary textual diff is empty; treat as line-ending or
  metadata drift until a clean upstream rebase resolves it.

## Exact changed-blob inventory versus pinned upstream

The following 48 same-path blobs differ from upstream:

```text
agent/codex_runtime.py
agent/conversation_loop.py
agent/inline_tool_executors.py
agent/system_prompt.py
agent/transports/codex_app_server.py
agent/transports/codex_app_server_session.py
apps/shared/src/gateway-contract.generated.ts
apps/shared/src/gateway-contract.openrpc.json
contributors/emails/uperLu@users.noreply.github.com
gateway/kanban_watchers_dispatcher.py
hermes_cli/config_defaults.py
hermes_cli/config_migrations.py
hermes_cli/kanban_db.py
hermes_cli/kanban_db_connect.py
hermes_cli/kanban_db_dispatch.py
hermes_cli/kanban_db_graph.py
hermes_cli/kanban_decompose.py
hermes_cli/plugins.py
hermes_cli/runtime_provider.py
run_agent.py
tests/agent/test_system_prompt.py
tests/agent/test_system_prompt_restore.py
tests/agent/transports/test_codex_app_server_runtime.py
tests/agent/transports/test_codex_app_server_session.py
tests/agent/transports/test_codex_worker_mcp_overrides.py
tests/hermes_cli/test_kanban_creator_origin.py
tests/hermes_cli/test_kanban_worker_spawn_toolsets.py
tests/tools/test_bot_live_owner_delivery.py
tests/tools/test_bot_mode_dm.py
tests/tools/test_bot_mode_probe.py
tests/tools/test_delegate.py
tests/tools/test_kanban_tools.py
tests/tui_gateway/test_bot_mode_silence_delivery.py
tests/tui_gateway/test_hud_surface_note.py
tests/tui_gateway/test_image_routing_stale_model.py
tools/bot_live_delivery.py
tools/bot_mode_dm.py
tools/bot_mode_probe.py
tools/delegate_tool.py
tools/kanban_tools.py
tui_gateway/contracts/events.py
tui_gateway/contracts/profiles_vault_complete_foreign_subagents.py
tui_gateway/contracts/prompt_voice.py
tui_gateway/methods_bot_relay.py
tui_gateway/methods_profiles.py
tui_gateway/methods_prompt.py
tui_gateway/methods_voice.py
tui_gateway/prompt_turn.py
```

## Exact LiquidAIty-only blob inventory

The following 10 blobs do not exist in pinned upstream:

```text
%SystemDrive%/ProgramData/Microsoft/Windows/Caches/{6AF0698E-D558-4F6E-9B3C-3716689AF493}.2.ver0x0000000000000001.db
%SystemDrive%/ProgramData/Microsoft/Windows/Caches/{DDF571F2-BE98-426D-8288-1A9A39C3FDA2}.2.ver0x0000000000000001.db
%SystemDrive%/ProgramData/Microsoft/Windows/Caches/cversions.2.db
LIQUIDAITY_VENDOR_PATCHES.md
hermes_cli/kanban_team.py
tests/agent/test_codex_native_mcp_projection.py
tests/hermes_cli/test_kanban_team.py
tests/tui_gateway/test_profiles_bot_roster.py
tests/tui_gateway/test_profiles_toolset_pin.py
tests/tui_gateway/test_turn_scoped_card_routing.py
```

The three `%SystemDrive%` database blobs are unexplained tracked residue and are
not part of either approved patch family.

## Exact missing-upstream blob inventory

The following 30 upstream blobs are absent from LiquidAIty:

```text
apps/desktop/src/plugins/hello-runtime/plugin.runtime.js
optional-skills/creative/concept-diagrams/examples/apartment-floor-plan-conversion.md
optional-skills/creative/concept-diagrams/examples/automated-password-reset-flow.md
optional-skills/creative/concept-diagrams/examples/autonomous-llm-research-agent-flow.md
optional-skills/creative/concept-diagrams/examples/banana-journey-tree-to-smoothie.md
optional-skills/creative/concept-diagrams/examples/commercial-aircraft-structure.md
optional-skills/creative/concept-diagrams/examples/cpu-ooo-microarchitecture.md
optional-skills/creative/concept-diagrams/examples/electricity-grid-flow.md
optional-skills/creative/concept-diagrams/examples/feature-film-production-pipeline.md
optional-skills/creative/concept-diagrams/examples/hospital-emergency-department-flow.md
optional-skills/creative/concept-diagrams/examples/ml-benchmark-grouped-bar-chart.md
optional-skills/creative/concept-diagrams/examples/place-order-uml-sequence.md
optional-skills/creative/concept-diagrams/examples/smart-city-infrastructure.md
optional-skills/creative/concept-diagrams/examples/smartphone-layer-anatomy.md
optional-skills/creative/concept-diagrams/examples/sn2-reaction-mechanism.md
optional-skills/creative/concept-diagrams/examples/wind-turbine-structure.md
plugins/hermes-achievements/dashboard/dist/index.js
plugins/hermes-achievements/dashboard/dist/style.css
plugins/kanban/dashboard/dist/index.js
plugins/kanban/dashboard/dist/style.css
skills/creative/p5js/references/export-pipeline.md
skills/creative/p5js/scripts/export-frames.js
web/public/fonts/Collapse-Bold.woff2
web/public/fonts/Collapse-Regular.woff2
web/public/fonts/Mondwest-Regular.woff2
web/public/fonts/RulesCompressed-Medium.woff2
web/public/fonts/RulesCompressed-Regular.woff2
web/public/fonts/RulesExpanded-Bold.woff2
web/public/fonts/RulesExpanded-Regular.woff2
website/src/data/userStories.json
```

No absence above is accepted merely because it is non-runtime or generated.
The controlled upstream update must restore the exact selected revision first;
only a separately justified build-output policy may remove a restored path later.

## Current tests outside the pinned upstream tree

LiquidAIty-only tests correspond to unapproved behavior as well as the approved
Kanban work. They do not prove approval:

- `tests/agent/test_codex_native_mcp_projection.py` — Card/Codex MCP projection;
- `tests/hermes_cli/test_kanban_team.py` — AutoTeam (approved family A);
- `tests/tui_gateway/test_profiles_bot_roster.py` — unapproved Bot roster;
- `tests/tui_gateway/test_profiles_toolset_pin.py` — now supplied by newer upstream;
- `tests/tui_gateway/test_turn_scoped_card_routing.py` — unapproved turn routing.

Changed upstream tests in the 48-blob list must be rebased with their production
owners. `tests/tools/test_delegate_team.py` is deleted relative to the historical
LiquidAIty reset checkpoint but is not an upstream-tree addition; its history must
not be used as permission to restore `delegate_task(role="team")`.

## Controlled update and reduction plan

No update, restore or source edit is authorized by this document. When explicitly
approved, the coherent operation is:

1. pin one exact upstream target (latest stable tag, or an explicitly approved
   upstream-head commit);
2. reproduce a clean upstream tree and verify every upstream blob before porting;
3. re-port AutoTeam as one bounded patch family;
4. re-port TaskGraph/Magnetic as one bounded patch family;
5. include a supporting hunk only when a focused failing test proves one of those
   two families cannot work without it;
6. delete every other current Hermes difference, including Bot target/session,
   Card turn-routing, prompt/receipt, provider, voice and tracked-cache residue;
7. regenerate contracts only if one of the two approved patch families changes a
   declared wire contract;
8. run upstream tests first, then the two patch-family tests, then LiquidAIty
   integration proof;
9. keep saved Cards, profiles, sessions, data, UI, queue and Run records untouched.

The unresolved product boundaries—orange-authorized `message_agent`,
Project/conversation-specific Bot delivery, dynamic AutoTools narrowing, and
provider receipt fields—must be presented for owner approval. They must not be
recreated as application controllers or retained as undeclared vendor residue.
