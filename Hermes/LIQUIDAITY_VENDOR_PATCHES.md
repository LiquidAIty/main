# LiquidAIty-maintained Hermes patches

This copied Hermes tree tracks upstream
[`NousResearch/hermes-agent`](https://github.com/NousResearch/hermes-agent). The refresh base for the
current LiquidAIty integration is upstream default branch `main` (package version `0.20.5`), commit
`6ce7ab8bfb3fce3ba116f52a11a438d6c7e4c03d`, verified 2026-08-25. That exact commit is not a release
tag; it advances 1,569 upstream commits (1,460 non-merge) beyond the prior recorded base
`e624e9fde561e1add9388384012b295fde669ade`.

Every local Hermes change must remain contained, carry a `LIQUIDAITY VENDOR PATCH` code comment, have
focused upstream-style tests, and include a concrete plan to contribute the capability upstream. A
local patch is not permission to fork Hermes architecture or copy LiquidAIty Card concepts into the
vendor.

The 2026-08-25 targeted refresh checked all eight registered seams against upstream `main`. Upstream
still has no equivalent public contract for any of them, so each remains a `GENERIC PR CANDIDATE`.
Unregistered provider-catalog and profile-display drift was not carried forward. The former bundled
`plugins/liquidaity-card-mcp` product plugin moved to LiquidAIty-owned source outside this vendor and
loads through Hermes' stock `hermes_agent.plugins` entry-point contract.

> Hermes is pinned. Updating, refreshing, downloading, replacing, rebasing, or reinstalling Hermes is prohibited unless Jeremiah explicitly requests a manual Hermes upgrade in the current message. Git save, Git checkpoint, commit, startup, testing, and general maintenance never imply that request.

## Patch: trusted ACP session surface

Purpose: let an ACP host constrain one Hermes session to a bounded system prompt, native toolsets,
explicit native tools, and the MCP toolsets registered for that session. The host configuration is
received only through ACP's namespaced `_meta.hermes.sessionConfig`; it never accepts credentials and
is never read from model tool arguments. An idle existing session can be refreshed through the generic
`_session/configure_host` method before the next standard `session/prompt`. The prompt uses Hermes'
native `ephemeral_system_prompt`, so Hermes remains the prompt assembler and no second prompt store is
created. One opaque `hostSessionKey` uses Hermes' existing `sessions.session_key` column solely to
recover the correct native session after process restart when several sessions share a working
directory. It contains no credential or product policy and does not compete with Hermes session
identity. Native `delegate_task` children remain ordinary Hermes subagents and inherit their owning
agent's bounded ceiling through Hermes' native rules. This patch does not create named child profiles
or persistent child identities.

Files and symbols:

- `acp_adapter/host_profiles.py`: bounded metadata parsing and exact session-surface publication.
- `acp_adapter/session.py`: retain ephemeral host configuration across agent reconstruction.
- `acp_adapter/server.py`: read ACP metadata, expose `_session/configure_host`, reapply configuration
  after MCP registration/model switches, replace only a changed host-provided MCP connection, and
  preserve concurrent session identity with Hermes' existing ContextVars rather than mutating
  process-global `HERMES_SESSION_ID`.
- `tools/mcp_tool.py`: `register_mcp_servers(..., replace_changed=True)` replaces one existing named
  connection only when its exact trusted transport configuration changes. This lets a persistent ACP
  session rotate per-Run bearer headers without retaining stale authority; ordinary MCP discovery
  remains name-idempotent by default.
- `tests/acp_adapter/test_host_profiles.py`, `tests/acp/test_server.py`, and
  `tests/tools/test_mcp_tool.py`: no-provider contract proof, including exact changed-connection
  replacement and unchanged default registration behavior.

Upstream behavior preserved: sessions without `_meta.hermes.sessionConfig` use the normal upstream ACP
and `delegate_task` paths unchanged. Model-supplied goals, context, roles, and control actions retain
their upstream behavior. A native child cannot gain a separately published host profile or a broader
tool surface than its parent.

Contribution plan:

1. Open an upstream design issue proposing a host-defined ACP session surface as an ACP
   extensibility feature, using generic Hermes vocabulary and the official `_meta` contract.
2. Submit the parser and session-scoped hooks as one focused PR with tests showing backward
   compatibility, bounded validation, exact session-key recovery, and no credential transport.
3. Replace this patch with the accepted upstream implementation only during a separately requested
   manual Hermes upgrade that contains it; keep only LiquidAIty's host-side mapping.

Rollback: remove this module and the marked hooks, then stop sending `hermes.sessionConfig` and
`_session/configure_host`. Hermes returns to its upstream broad ACP surface and generic native
delegation; LiquidAIty must fail closed rather than claim that a saved Card's prompt or grants bound
the native session in that state.

## Patch: bounded ACP transcript read and delete

Purpose: let an ACP host display one persisted native transcript without crossing standard
`session/load`, which necessarily restores an executable `AIAgent`, registers MCP servers, applies
host runtime configuration, and updates persistence state. The generic `_session/read_history`
extension accepts only `sessionId`, reads either the in-memory history snapshot or
`SessionDB.get_messages_as_conversation()` in its non-repairing inspection mode, and replays the
existing ACP message updates. It never creates or restores an agent, registers MCP, selects a model,
applies a tool surface, calls a provider, or mutates the session.

The companion `_session/delete_history` extension also accepts only `sessionId` and delegates to
Hermes' existing `SessionManager.remove_session`. Deletion refuses an active native turn. This gives
the owning UI one exact native lifecycle operation without direct database access or a second
conversation store.

Files and symbols:

- `acp_adapter/session.py`: `SessionManager.read_session_history` performs the non-mutating native
  transcript read; `remove_session` rejects active turns before using its existing native deletion.
- `acp_adapter/server.py`: `_session/read_history`, `_session/delete_history`, and `_replay_history`
  reuse native session identity without invoking executable session load/resume.
- `tests/acp_adapter/test_host_profiles.py`: proves cold persisted reads do not construct an agent and
  both extensions reject execution-configuration fields; active deletion fails closed.

Upstream behavior preserved: standard ACP `session/list`, `session/load`, `session/resume`,
`session/new`, and `session/prompt` are unchanged. The existing load/resume history replay delegates
to the same extracted notification helper. Hosts that do not call the extension retain stock Hermes
behavior.

Contribution plan: propose generic ACP transcript-inspection and deletion extensions, or adopt
upstream ACP lifecycle methods if they become available. Include cold-session proof that no provider,
agent, MCP registration, or persistence repair occurs, plus active-turn deletion refusal.

Rollback: remove the extensions and the read method, and restore `remove_session` only after an
equivalent native active-turn guard exists. LiquidAIty history must then fail closed until equivalent
native lifecycle contracts exist; it must not return to `session/load` or direct database access.

## Patch: model-authored ACP transcript identity

Purpose: distinguish actual native model text from deterministic ACP command, queue, redirect, error,
and status prose without inspecting or rewriting content. Native model stream chunks carry
`_meta.hermes.messageSource=model`. The standard `session/prompt` response carries the exact final
native assistant message in `_meta.hermes.finalAssistantText`. A host can therefore stream real model
deltas immediately, then reconcile the completed bubble to the same native text Hermes persisted.
Untagged command/status messages remain available to ordinary ACP clients but are not model output.
Agent execution exceptions propagate as failures instead of being converted into `Error: ...`
assistant prose.

Files and symbols:

- `acp_adapter/events.py`: `model_message_update` and `make_message_cb` tag native model deltas.
- `acp_adapter/server.py`: returns exact final native model text in prompt metadata, leaves locally
  generated command/status updates untagged, and propagates execution exceptions.
- `tests/acp/test_events.py`: proves the native model update carries the exact source metadata.

Upstream behavior preserved: ACP text chunks and prompt responses retain their standard shapes and
use ACP's reserved `_meta` extension point. Hosts that ignore the metadata render upstream behavior.
Slash commands, queue/redirect notices, and transformed plugin output remain available but are never
misrepresented as raw model text to a source-aware host.

Contribution plan: propose a generic ACP content-origin marker and exact final assistant message in
the prompt response metadata. Remove this patch when upstream offers equivalent source identity.

Rollback: remove the metadata and source-aware host filtering together. LiquidAIty Main must then
fail closed for transcript authoring; it must not guess model origin from prose or event timing.

## Patch: generic host-issued child execution context

Purpose: let an ACP host allocate and close an opaque execution context before a native Hermes child
makes its first model or MCP call. Hermes transports only generic session, native-child, lifecycle,
usage, and per-call metadata fields. It does not parse or own Cards, IDF, IDD,
AGE, projects, conversations, grants, or product authorization.

Files and symbols:

- `acp_adapter/host_profiles.py`: `attach_host_execution_requester`,
  `allocate_host_child_execution`, `finish_host_child_execution`, `host_execution_scope`, and
  `current_host_tool_call_meta`.
- `acp_adapter/server.py`: attaches one generic ACP extension requester and scopes the root run.
  Its existing `session/set_model` boundary also accepts a trusted public
  `apiMode` plus `openaiRuntime=auto`, so a host can explicitly retain Hermes'
  native model loop without changing OAuth or provider ownership. Omission
  preserves upstream model-switch behavior.
- `tools/delegate_tool.py`: allocates every child context before execution, scopes native child work,
  and closes the context once for completion, failure, interruption, or stop.
- `tools/mcp_tool.py`: snapshots the host-issued metadata in the synchronous
  tool handler before Hermes crosses to its dedicated MCP event-loop thread,
  then passes it through upstream MCP 2
  `ClientSession.call_tool(..., meta=...)`; calls without host metadata retain
  the exact upstream invocation.
- `tests/acp_adapter/test_host_profiles.py` and `tests/tools/test_mcp_tool.py`: focused no-provider
  allocation, scoping, closure, credential-absence, cross-thread propagation,
  and MCP 2 forwarding proof.

Public contract: the ACP host may implement `session/create_execution_context` and
`session/finish_execution_context`. The create result contains only an opaque context ID and
namespaced MCP metadata. Hermes never accepts Run or Card identity from model-authored tool arguments
and never mutates shared MCP headers. Sessions without the host configuration use upstream behavior.

Upgrade/reapply/drop procedure:

1. Check whether upstream Hermes now exposes a generic native-child lifecycle hook plus per-call MCP
   metadata propagation.
2. If equivalent, replace these marked hooks with the upstream contract and retain only the
   LiquidAIty host implementation.
3. Otherwise reapply only the five named generic symbols and three marked call sites, then run the
   focused tests above plus the normal delegation suite.
4. Drop the patch if LiquidAIty stops requiring truthful native-child attribution; the product must
   then fail closed for attributed native delegation rather than relabel child work as the parent.

Contribution plan: propose a generic ACP child-lifecycle extension upstream, independent of
LiquidAIty vocabulary, with tests for pre-execution allocation, ContextVar isolation during concurrent
children, MCP 2 `meta=`, exact-once closure, and no-op compatibility for ordinary Hermes sessions.

Rollback: remove the marked execution-context hooks from the four production files and stop sending
`executionContextId`/`toolCallMeta`. This preserves ordinary upstream delegation but disables
LiquidAIty child-Run attribution until truthful attribution is restored.

## Patch: generic ACP tool-error status preservation

Purpose: preserve Hermes' existing `tool_error()` contract across ACP for native, plugin, and MCP
tools. Upstream ACP recognized a structured `{"error": ...}` payload as failed only for the polished
core-tool set, so an MCP effect could fail while its ACP update reported `completed`. The patch changes
only the generic result-status classifier; tool output, rendering, dispatch, and retry behavior remain
unchanged.

Files and symbols:

- `acp_adapter/tools.py`: `_tool_result_failed` recognizes Hermes' generic structured error contract.
- `tests/acp/test_tools.py`: proves an unknown MCP tool's structured error remains failed.

Contribution plan: submit the one-condition correction and regression test upstream as an ACP status
fidelity fix. Drop this patch when upstream classifies generic `tool_error()` results consistently.

Rollback: restore the polished-tool guard. That preserves upstream behavior but makes host-visible ACP
status unreliable for failing MCP effects, so LiquidAIty must not report those Runs as successful.

## Patch: explicit authenticated provider first-run guard

Purpose: let a non-interactive native Kanban worker use an explicit task-level provider when Hermes'
official auth resolver reports that exact provider logged in. This closes only the first-run guard gap
for profiles that intentionally rely on Hermes' read-only global auth fallback; provider resolution,
OAuth storage, downstream inference, model selection, and ordinary setup behavior remain stock.

Files and symbols:

- `hermes_cli/main.py`: `_has_any_provider_configured` accepts an optional explicit provider and
  `cmd_chat` passes its existing `--provider` argument.
- `tests/hermes_cli/test_api_key_providers.py`: proves authenticated explicit providers pass and
  unauthenticated explicit providers remain blocked without an inference call.

Upstream behavior preserved: callers without `--provider`, unknown providers, and providers whose
normal Hermes auth status is not logged in retain the existing setup guard. No credential is copied or
written, and no provider, model, temperature, or profile default is changed.

Contribution plan: submit the optional explicit-provider check and focused tests upstream as a
non-interactive profile-worker correction. Drop this patch when upstream's first-run guard consults the
same exact authenticated provider already selected for runtime initialization.

Rollback: remove the marked block and stop passing `args.provider` to the guard. Hermes returns to the
upstream guard, and profile workers without profile-local defaults will again stop before the already
supported global auth fallback reaches runtime provider initialization.

## Patch: bounded Git Bash probe before native file tools

Purpose: make the Windows Git Bash health probe genuinely honor its timeout before lazy
`LocalEnvironment` creation. Python's raw `subprocess.run(timeout=...)` kills only the direct Bash
process and then performs an unbounded pipe drain; an MSYS descendant retaining stdout can therefore
pin `search_files` before the environment reports ready. Hermes already owns the correct generic
process-tree solution in `bounded_probe_run`, so the patch routes this one missed probe through it.

Files and symbols:

- `tools/environments/local.py`: `_bash_starts` and its optional Mandatory-ASLR diagnostic use
  `bounded_probe_run`; failed Bash probes retain a bounded visible diagnostic.
- `hermes_cli/_subprocess_compat.py`: bounded-probe cleanup gives the shared Windows tree killer a
  two-second `taskkill` allowance instead of inheriting its ordinary teardown allowance.
- `agent/deadline.py`: `kill_process_tree` accepts an optional Windows `taskkill` timeout while
  retaining the existing 15-second default for every other caller.
- `tests/tools/test_find_shell.py`: real Windows descendant-pipe timeout proof.
- `tests/tools/test_file_tools.py`: native search preserves the initialization diagnostic as a
  structured tool error.

Upstream behavior preserved: successful Bash selection, the external MSYS health command, candidate
ordering, caching, file-search behavior, shell configuration, providers, and models are unchanged.

Contribution plan: submit the missed `bounded_probe_run` call-site correction, its bounded Windows
cleanup allowance, and the descendant-pipe regression. Drop this patch when upstream `_bash_starts`
uses the same bounded helper without letting cleanup exceed the probe's bounded-return contract.

Rollback: restore raw `subprocess.run` in `_bash_starts`, remove the bounded-probe timeout argument,
and restore the original shared helper signature; this reopens an unbounded Windows startup hang and
is safe only after upstream supplies equivalent process-tree timeout handling.

## Patch: registered pre-spawn Kanban worker environment provider

Purpose: let a host add short-lived, run-scoped environment values to the one native profile-worker
child immediately before spawn. Hermes supplies only bounded native task, run, board, assignee,
profile, workspace, and claim-lock identity. Providers cannot inspect the task prompt or inherited
environment, replace existing or stock `HERMES_KANBAN_*` values, or persist credentials.

Files and symbols:

- `hermes_cli/plugins.py`: `KanbanWorkerEnvironmentContext`,
  `PluginContext.register_kanban_worker_environment_provider`, and
  `resolve_kanban_worker_environment` provide the generic synchronous registry.
- `hermes_cli/kanban_db.py`: `_default_spawn` resolves additive values after stock worker identity is
  fixed and before `Popen`; provider errors follow the existing visible spawn-failure/retry path.
  Optional process MCP configuration is validated against the exact child environment before spawn,
  and its MCP toolset names are added to the existing native worker toolsets.
- `tools/mcp_tool.py`: `process_mcp_servers` reads optional `HERMES_MCP_SERVERS` JSON without writing
  config files. `_load_mcp_config` merges it once, rejects conflicting names/duplicate URLs, and
  requires every environment placeholder to resolve from this process. Ordinary profile/portable
  configuration keeps its original interpolation behavior.
- `hermes_cli/mcp_startup.py`: the existing `ensure_mcp_discovery_before_agent_build` requires these
  process-provided connections before constructing a native agent; missing connections fail closed.
  It reuses native discovery and its existing timeout, not another connection owner or retry loop.
- `tests/plugins/test_kanban_worker_environment.py`: product-free compatibility, additive merge,
  non-overwrite, disposal, and spawn proof.
- `tests/tools/test_process_mcp_configuration.py`: real loader/interpolation, duplicate rejection,
  missing-value failure, pre-agent readiness, and unchanged unconfigured behavior.

The downstream LiquidAIty provider lives at `apps/hermes-liquidaity-plugin/`. It is installed into the
existing Hermes environment as a normal `hermes_agent.plugins` entry point and returns
`LIQUIDAITY_CARD_BEARER` plus one non-secret process MCP template referring to that variable.
Canonical startup removes the host-only signing secret before the Hermes
gateway starts, so no product-specific redaction remains in vendor source.

Upstream behavior preserved: no-provider dispatch retains the original command, environment, worker
ownership, profile, OAuth, and lifecycle. The provider cannot choose a model, task, or runtime.
The opt-in process template registers the host's MCP tools through the existing native registry;
the remote host remains responsible for enforcing their grants.
LiquidAIty correlation and bearer signing stay outside Hermes; ordinary tasks that do not resolve to a
saved Card Run receive no added value.

Contribution plan: propose the generic bounded pre-spawn environment-provider registry upstream with
tests for no-provider compatibility, non-overwrite, concurrent isolation, and visible provider
failure. Include the generic non-persistent MCP configuration handoff and required pre-agent discovery
as a bounded follow-up contract. Keep the LiquidAIty loopback provider in its external entry-point package.
Sync cost: three native call sites (spawn, config load/interpolation, pre-agent readiness); no Hermes
runtime or storage replacement. Provider-free tests prove configuration, not a live model worker.

Rollback: remove the marked registry and `_default_spawn` call site. Native workers then retain stock
spawning; the external LiquidAIty provider becomes inactive and Card-scoped Kanban MCP grants must fail
closed.

The process-MCP extension can be rolled back separately only by removing its optional loader/startup/
spawn handling and the external plugin's template producer together. Card worker MCP must then fail
closed until an equivalent native handoff exists; no static profile or duplicate connection is a fallback.
