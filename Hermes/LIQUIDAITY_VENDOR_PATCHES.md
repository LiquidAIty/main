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

## Patch: bounded native child-model/background review and memory-provider profile readback

Purpose: expose Hermes' existing `auxiliary.background_review` selector through the native profile
API, expose its existing top-level `delegation.provider/model` selector, and make the actual provider/model
of each native child observable through the existing generic host child execution. The review is allocated
before its daemon thread starts, never delays the foreground response, closes exactly once with bounded
usage/failure state, and keeps the existing owning-profile memory/skill tool whitelist. The prompt correction
permits a clean no-op instead of pressuring the model to create filler skills. The same profile API also
reports Hermes' existing single `memory.provider`, installed provider IDs, and profile-local Holographic
database status. LiquidAIty requests the separate bounded host-scoped Honcho reachability probe only while
reading Main's Inspector; ordinary profile reads and Run-start synchronization perform no Honcho I/O. Native
`profiles.configure` remains the single memory selector, but LiquidAIty exposes it only to Main for `builtin`
or `honcho`, without returning credentials or creating a second registry/store.

Files and symbols:

- `tui_gateway/methods_profiles.py`: `profiles.describe` returns the secret-free review/delegation
  selectors plus native memory-provider/database metadata; optional `probe_honcho` adds one bounded,
  read-only Main Inspector reachability result. `profiles.configure` validates and writes only the native
  review, delegation, and memory-provider fields through Hermes' config owner.
- `acp_adapter/host_profiles.py`: child allocation and closure carry the provider/model actually selected
  by Hermes plus explicit fallback state over the existing generic host lifecycle extension.
- `agent/background_review.py`: `_BackgroundReviewRun` exact-once host closure,
  `finish_background_review_host_execution`, honest actual-model/fallback completion/failure/cancellation,
  and the no-junk native review prompt.
- `run_agent.py`: `_spawn_background_review` publishes the configured review provider/model, allocates the
  existing generic host child before `Thread.start()`, and closes allocation failures.
- `tests/tui_gateway/test_profile_background_review.py` and
  `tests/acp_adapter/test_host_profiles.py`: profile read/apply, profile-local memory isolation/status,
  exact child model/fallback receipt, exact-once closure and bounded usage proof.

Upstream behavior preserved: ordinary CLI/gateway sessions have no host requester and retain native
review behavior. The selected provider's normal Hermes credential resolver remains authoritative.
Review memory/skills remain inside the owning profile, background children keep external memory disabled,
and zero reusable learning remains a valid result. Provider availability checks use native provider
discovery/configuration and do not perform a memory write, remote recall, OAuth exchange, or credential export.

Contribution plan: propose the secret-free profile selectors/readiness and generic actual-child-model
receipt independently. Keep LiquidAIty's saved Card choices and Inspector outside upstream Hermes. Sync
cost: four contained production files plus profile RPC fields. Remove the divergence if upstream exposes
equivalent delegation/review/memory profile configuration and actual child lifecycle receipts.

Rollback: remove the added profile fields and child model/fallback fields while preserving the older generic
child allocation/closure seam, then restore the upstream review prompt. Native background review continues
but cannot be configured/proven from a Card, saved memory selection cannot be materialized/read back through
the Inspector, and actual child model identity must fail closed rather than be inferred from the parent.

## Patch: fail-closed CLI plugin input, one-turn memory mode, and idle transcript snapshot

Purpose: let a plugin use Hermes' existing CLI message-injection API as an alternate human input
driver without interrupting or queueing behind an already accepted turn. The optional
`interrupt_running=False` form returns `False` while the agent is running or the CLI input queue is
non-empty. A validated single-use `external_memory_mode="bypass_automatic"` lets a contextualized
external driver skip automatic provider turn-start, prefetch and end-of-turn sync for exactly that
accepted turn while leaving provider tools callable. The paired `cli_conversation_snapshot()` returns
a detached copy of the live interactive CLI session ID and conversation only while the agent is idle.
It adds no process, session, scheduler, provider, tool, or persistence owner and never opens Hermes'
session database.

Files and symbols:

- `hermes_cli/plugins.py`: `PluginContext.inject_message(..., interrupt_running=True,
  external_memory_mode="normal")` retains both upstream defaults, validates the trusted mode and
  stages it only on a live idle agent;
  `PluginContext.cli_conversation_snapshot()` exposes one read-only detached idle snapshot.
- `agent/turn_context.py`: `consume_external_memory_mode` consumes once and gates only automatic
  provider turn-start/prefetch.
- `run_agent.py`: `_sync_external_memory_for_turn` skips automatic sync/next-prefetch for that turn.
- `tests/hermes_cli/test_plugin_message_injection.py`, `tests/agent/test_turn_context.py`, and
  `tests/run_agent/test_memory_sync_interrupted.py`: idle refusal, single-use/fail-open mode,
  prefetch/sync mutual exclusion and unchanged normal-turn proof.
- Downstream proof in `apps/hermes-liquidaity-plugin/tests/test_plugin.py` verifies structured native
  hooks, public-text-only forwarding, busy refusal, and cancellation reporting.

Upstream behavior preserved: every existing caller omits the new argument and keeps the original
interrupt-or-queue semantics. No existing code calls the new observation method. Gateway injection,
plugin consent, roles, session keys, persistence, and native CLI queue ownership are unchanged.

Contribution plan: submit the optional idle-only flag, generic one-turn external-memory mode and
read-only idle snapshot with focused compatibility tests upstream as one multiple-human-surface
contract. Drop this patch when upstream exposes equivalent non-interrupting injection, scoped memory
lifecycle control and live-CLI observation operations.

Rollback: remove the optional arguments, their guards, the turn/sync gates and the snapshot method. LiquidAIty's
external Main drivers and Chat history must then fail closed because the stock plugin contract cannot
prove single-driver ownership or observe the live CLI conversation; no ACP process, direct database
read, input queue, or terminal-scraping fallback is permitted.

## Patch: immutable trusted-host Script on the existing Python child runner

Vendored project: `NousResearch/hermes-agent` at the repository-pinned commit.

Purpose: execute one host-supplied, saved and immutable Card Python Script through Hermes' existing
child-process runner and tool-RPC dispatcher. The model sees one compact `execute_host_script` contract
instead of the component schemas the Script wraps, and Hermes decides whether to call it through the
ordinary native model-tool path. Internal execution evidence retains exact version/hash, timing, native
tool-call and fallback state without becoming a separate product result authority.

External alternative check: stock `execute_code` accepts model-authored source and its normal sandbox
tool names, but ACP has no contract for immutable host source, canonical tool aliases, typed input/output,
or exact host-session execution. A second runner, sandbox, workflow engine, MCP host, shell/CLI adapter and
direct database call were rejected. The downstream plugin alone cannot safely supply canonical aliases to
the generated `hermes_tools` module without the contained generic runner seam.

Files and symbols:

- `tools/code_execution_tool.py`: optional `host_script` input to `execute_code`, canonical-alias dispatch,
  compact `input`/`tools.call`/`output.emit` generation, and canonical/native/duration receipts. The local
  child process, approval context, RPC server, timeout, process-tree termination and secret scrub are the
  existing owners.
- `acp_adapter/host_profiles.py`: strict host Script version/hash/schema/alias/budget validation,
  immutable turn-scoped lookup, compact model-tool registration/schema projection, and exact
  pre-registered MCP fallback after a Script failure before any wrapped operation begins.
- `acp_adapter/server.py`: retains ordinary ACP prompt/tool dispatch; the retired host pre-execution
  `_session/execute_host_script` doorway is absent.
- `tests/tools/test_code_execution.py` and `tests/acp_adapter/test_host_profiles.py`: generated-module
  isolation, real Python child execution, canonical/native receipt, configuration validation and exact
  failure fallback proof.
- `apps/hermes-liquidaity-plugin/`: downstream entry-point registration, typed input/output validation,
  one-call/output limits, Script receipt and dynamic fallback. Its tests prove installed discovery plus
  load/reload/unload and failure handling.

Upstream behavior preserved: omission of `host_script` takes the original branch. Ordinary CLI,
`execute_code`, remote environments, sandbox tools, toolsets, approvals, timeouts, termination, environment
scrubbing and result formatting are unchanged. The host path is local-only, requires exact aliases supplied
by trusted ACP metadata, never exposes native registry names to the child, and supplies no shell,
filesystem, network, database or credential capability unless an already-authorized native tool itself owns
that operation. LiquidAIty still enforces saved Card grants before configuration.

Contracts and proof: the saved Script version, source/compiled hashes, JSON schemas, literal handle set and
budgets are validated before session configuration. The child may call only the alias values already
registered for that session. Failure before any wrapped operation begins removes the compact Script tool
and reveals only those same pre-registered component tools for the next model iteration; failure after an
operation is terminal and cannot replay. Focused proof uses the pinned Hermes environment; no production
requirement or test assertion is weakened.

Fork cost and contribution plan: the existing child-runner seam plus the narrow host-profile projection and
focused tests. Propose the generic trusted-host immutable-code/alias and typed model-tool projection upstream
without LiquidAIty Card types or policy. Keep compiler, IDD projection, saved authority and downstream plugin
outside Hermes.

Rollback: remove the optional host arguments/helpers and host-profile Script validation/projection/fallback,
then remove the downstream compact model-tool registration. Saved Script source may
remain inspectable but must fail closed as unavailable; never replace this path with direct `exec`, a second
sandbox or raw MCP schema suppression.

## Patch: headless durable Team on native `delegate_task` and Auto-Kanban

Vendored project: `NousResearch/hermes-agent` at the repository-pinned commit.

Purpose: add `role="team"` to the one native `delegate_task` tool as a headless durable recipe over
Hermes' existing Auto-Kanban SQLite graph, decomposer, dispatcher, task workers, dependency handoffs,
retries, recovery, notifications and rejoin. One originating Card mission/context packet becomes two to
four bounded worker tasks; the original root then resumes under the Card-projected Team-lead model for final
synthesis and returns one result to the exact originating Hermes session. Team is not a Card, board UI,
profile UI, scheduler,
transcript store, or second Hermes tool.

External alternative check: native `leaf` is one ephemeral child and native `orchestrator` owns a
recursive dynamic delegation strategy. The former explicit Kanban Card route required a separate saved
Card Run and is now retired as a product doorway. Neither native alternative gives an ordinary authorized
Card a bounded, durable, depth-one Auto-Team that rejoins
its own session. A LiquidAIty-owned task database, scheduler, model fan-out, polling loop or synthesis call
was rejected because it would duplicate Hermes' native execution owners. The contained adapter is the
smallest upstream-shaped seam.

Files and symbols:

- `tools/delegate_tool.py`: preserves native `leaf` and `orchestrator`, adds only the top-level `team`
  branch, validates one goal/context packet and blocks nested delegation in Team processes.
- `hermes_cli/kanban_team.py`: validates the trusted Card/session Team projection over the bounded native
  defaults, records the exact applied policy on the native root, creates one blocked/idempotent root,
  correlates it before activation and then hands ownership to native Auto-Kanban.
- `hermes_cli/config_defaults.py`: declares the generic maximum-worker and worker provider/model settings.
- `hermes_cli/kanban_decompose.py`: reads the root's applied policy, applies the depth-one
  two-to-four-worker recipe, exposes only the persisted originating profile to Team decomposition, pins
  every parsed child to that profile, retains the lead provider/model on the root, and assigns exact
  per-task worker provider/model and retry overrides.
- `hermes_cli/kanban_db.py`: persists the generic workflow/step fields already present in the schema,
  activates the correlated root, independently canonicalizes every Team child/root assignee to the
  persisted root owner inside the atomic decomposition transaction, propagates the Team marker and
  retry/model fields, blocks nested task creation, gives the resumed root every completed worker handoff
  plus an explicit synthesis contract, and records exact Team provider/model at the native spawn boundary.
- `acp_adapter/host_profiles.py`: strictly validates the Card-scoped Team policy, generalizes the existing
  opaque host child-allocation callback to accept
  any durable native execution ID; the previous leaf helper delegates to it unchanged. A trusted
  per-session host projection narrows the model-visible native role enum without changing Hermes' native
  tool contract when that projection is absent. The transport-neutral context attachment lets an
  already-live native CLI agent enter the same opaque host lifecycle without replacing its configuration.
- `agent/native_team_result.py`, `acp_adapter/session.py`, and `acp_adapter/server.py`: share bounded
  result validation/message construction while ACP retains its exact idle-session database/history owner.
- `hermes_cli/plugins.py`: exposes generic trusted-plugin operations that bind an already-live CLI agent
  to an opaque host lifecycle, or hold one immutable execution/request/session binding while the first
  native CLI agent is constructed, and append a terminal result through that CLI's own native session owner.
- `hermes_cli/cli_agent_setup_mixin.py` and `cli.py`: consume the exact pending binding onto the newly
  constructed agent before provider inference, and reject/clear it on initialization, route or credential
  failure instead of allowing an uncorrelated first turn.

Upstream behavior preserved: omission of `role="team"` retains native leaf/orchestrator schemas,
temporary-agent construction, depth, provider/model and result behavior. LiquidAIty Card sessions project
Team only when enabled; when Team is Off, `delegate_task` remains only if another separately authorized role
such as an outgoing profile target exists. This narrows one trusted session without rewriting the native
tool. Ordinary Kanban tasks keep their existing event shape, profile roster,
decomposition freedom, manual controls, models, and prompts. Team markers and limits apply only to
`workflow_template_id="delegate-team-v1"`; no profile, global configuration, credential or user-global
Hermes home is rewritten by a Team run.

Contracts: the saved Card/PostgreSQL policy owns Off/Auto, maximum workers, retry limit, worker model and
one Team-lead model. The trusted session projection applies those values without mutating a profile-global
default: Off omits only the Team role; Auto lets Hermes decide whether to call it. Team rejects fewer than
two or more than four workers, maps user retries to the native attempt count, rejects fan-in as a single task,
and stamps every worker plus the root with a process-only recursion guard. Native dependency links make every worker task a
parent of the original root. A durable `spawned` event records the exact step/provider/model used at the
process boundary. Host correlation is committed before activation; terminal session append occurs before
the child Card Run is closed. A busy originating session receives bounded idempotent retries; if that
window expires, the completed native root and active child Run remain recoverable instead of being
relabeled as failed. Fresh-CLI staging contains no prompt, configuration or credential, invokes neither
the host requester nor native task creation, preserves any unsent local prompt buffer, and is consumed only
after exact CLI/profile/session/request validation. Competing bindings and every mismatch fail closed and
clear the slot; teardown and cancellation clear it as well. The initialized-agent binding path remains
unchanged apart from carrying the same request identity.

Tests: `tests/tools/test_delegate_team.py`, `tests/hermes_cli/test_kanban_team.py`,
`tests/hermes_cli/test_plugin_message_injection.py`, `tests/acp/test_session.py`, and
`tests/acp_adapter/test_host_profiles.py` prove the one-tool branch, strict Card policy, host projection
narrowing without changing the native compatibility schema, two-to-four bound, origin-profile-only
decomposition and database pinning, exact lead/worker/retry application, all-worker synthesis context,
non-recursion, opaque host
allocation, ACP/CLI same-session idempotent result append, first-turn construction at the real
`HermesCLI`/`AIAgent` provider boundary, competing/mismatch/teardown cleanup, preservation of unsent local
input and unchanged native roles. Downstream
LiquidAIty lifecycle, recovery and Run-correlation tests live beside the backend/Python owners.

Historical live proof: the first remote turn before the Card-scoped policy layer bound before inference and produced native
root `t_0c8618b6`, exactly two Luna workers (`t_0a5610dc`, `t_91562520`), one Terra synthesis run, one
host-correlated child Run and one same-session result append. The parent, child and native root all completed;
readback found no provider fallback, duplicate task/Run/message, nested delegation or retry. That run does
not prove the later editable Card-scoped settings; their current proof is provider-free.

Fork cost and contribution plan: nine narrow existing native files, two new adapter modules and focused tests.
Propose a generic durable `team` delegation recipe upstream using workflow metadata and the existing
Auto-Kanban lifecycle, independently propose the generic durable native-execution host allocation and
idle session-result append operations, and keep LiquidAIty Card/IDD/Run policy downstream. Remove each
piece only when an upstream equivalent exists in a separately authorized Hermes refresh.

Rollback: remove the `team` branch, trusted session Team policy, Team adapter/workflow handling, generic host allocation
extension and native session append together; restore the previous leaf helper body and unchanged Kanban
event/context behavior. Native leaf/orchestrator and internal native Kanban operation continue. LiquidAIty must
then remove only its `team` projection and fail closed for Team rather than route through a standalone
helper Card, another database, direct model fan-out or a synthetic result.

## Patch: trusted direct profile delegation through native `delegate_task`

Vendored project: `NousResearch/hermes-agent` at the repository-pinned commit.

Purpose: add `role="profile"` to Hermes' one native `delegate_task` doorway so a trusted host may expose
only a bounded roster of installed target profiles for the current session. LiquidAIty derives that roster
from the calling Card's current enabled outgoing orange `flow` edges; Hermes never receives LiquidAIty Card
IDs, target grants, prompts, tools, memory, or configuration.

External alternative check: native `leaf` creates a disposable child of the current profile, `orchestrator`
owns recursive delegation, and `team` is private same-profile durable fan-out. None expresses a direct handoff
to another existing named profile. A new Card tool, router, message bus, or session registry was rejected
because the canonical receiving-Card Run/IDF owner already exists downstream.

Files and symbols:

- `tools/delegate_tool.py` validates `target_profile` against the exact trusted host roster, rejects batching,
  output schemas and Team-worker nesting, then requests one synchronous host profile handoff.
- `run_agent.py` forwards the exact native parameter without interpreting profile or Card meaning.
- `acp_adapter/host_profiles.py` validates compact profile/title/description targets and projects them into
  the existing `delegate_task` role enum and `target_profile` enum. Empty/cleared projection restores the
  previous tool definition.
- `hermes_cli/plugins.py` carries the same immutable roster through first-turn CLI staging and clears the
  projection with the existing host execution binding.
- Downstream `apps/hermes-liquidaity-plugin` forwards only the compact roster; LiquidAIty backend code maps
  the selected profile to a Card and invokes the private canonical Card runner.

Upstream behavior preserved: without a trusted target roster, no `profile` choice is projected into a
LiquidAIty Card session. Existing Leaf, Orchestrator and Team branches retain their own validation,
provider/model, recursion and execution behavior. Profile delegation does not mutate the caller or target
profile, select a different target configuration, or expose another public model tool.

Contracts: a profile choice must be an exact enum member. The host revalidates the current saved deck
revision, directed enabled orange edge, enabled top-level Hermes `delegate` target, and exact target profile;
the downstream canonical runner independently checks the target Card revision and edge before creating the
child Run and IDF. The target executes as its own profile and may independently use its own private Team.

Tests: `tests/tools/test_delegate_team.py` covers authorized profile dispatch, forged-profile rejection and
preserved Team-worker recursion blocking. `tests/acp_adapter/test_host_profiles.py` covers strict roster
parsing, exact model schema projection, and reversible CLI projection. Downstream backend/Python tests cover
orange directionality, blue/disabled/child/non-Hermes exclusion, stale deck/profile rejection, compact model
transport and use of the existing Card Run handler.

Fork cost and contribution plan: three narrow existing Hermes owners plus the existing plugin binding.
Propose the generic trusted-host named-profile roster and synchronous callback upstream without Card, graph,
Run, IDF, or LiquidAIty policy. Keep saved-edge authority and Card mapping downstream.

Rollback: remove the `profile` branch, target roster projection and plugin-carried roster together. Leave
Leaf, Orchestrator, Team and native Kanban machinery unchanged; downstream must then fail closed rather than
restore a duplicate model-facing Card-run tool.
