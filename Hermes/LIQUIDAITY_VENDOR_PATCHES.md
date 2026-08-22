# LiquidAIty-maintained Hermes patches

This copied Hermes tree tracks upstream
[`NousResearch/hermes-agent`](https://github.com/NousResearch/hermes-agent). The refresh base for the
current LiquidAIty integration is upstream release `v2026.8.18` (package version `0.20.4`), commit
`e624e9fde561e1add9388384012b295fde669ade`.

Every local Hermes change must remain contained, carry a `LIQUIDAITY VENDOR PATCH` code comment, have
focused upstream-style tests, and include a concrete plan to contribute the capability upstream. A
local patch is not permission to fork Hermes architecture or copy LiquidAIty Card concepts into the
vendor.

## Updating Hermes while patches are pending

1. Record the current upstream commit and this patch register before replacing vendor files.
2. Refresh the unmodified upstream tree first while preserving only runtime state directories
   (`.hermes`, `.venv`, and `venv`).
3. Check whether upstream now supplies each registered capability. If it does, delete the local patch
   and run its acceptance tests against the upstream implementation.
4. Otherwise reapply only the exact registered files/symbols, resolve conflicts in favor of the new
   upstream public contract, and rerun both the focused patch tests and the affected upstream tests.
5. Update the upstream base, conflict notes, and contribution status below. Never carry an unexplained
   vendor diff forward.

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
3. Replace this patch with the accepted upstream implementation at the first Hermes refresh that
   contains it; keep only LiquidAIty's host-side mapping.

Rollback: remove this module and the marked hooks, then stop sending `hermes.sessionConfig` and
`_session/configure_host`. Hermes returns to its upstream broad ACP surface and generic native
delegation; LiquidAIty must fail closed rather than claim that a saved Card's prompt or grants bound
the native session in that state.

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
