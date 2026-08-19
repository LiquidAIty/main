# LiquidAIty-maintained Hermes patches

This copied Hermes tree tracks upstream
[`NousResearch/hermes-agent`](https://github.com/NousResearch/hermes-agent). The refresh base for the
current LiquidAIty integration is upstream commit `210cdb0ed35d4f7ef0957182312baaaa9e19bfbc`.

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

## Patch: trusted ACP session and delegate profiles

Purpose: let an ACP host constrain one Hermes session and its native `delegate_task` children using
native Hermes prompts, models, toolsets, explicit tools, and named profiles. The host configuration is
received only through ACP's namespaced `_meta.hermes.sessionConfig`; it never accepts credentials and
is never read from model tool arguments.

Files and symbols:

- `acp_adapter/host_profiles.py`: bounded metadata parsing, tool-surface publication, profile schema,
  and trusted profile resolution.
- `acp_adapter/session.py`: retain ephemeral host configuration across agent reconstruction.
- `acp_adapter/server.py`: read ACP metadata and reapply it after MCP registration/model switches.
- `tools/delegate_tool.py`: select a trusted profile and apply its native child prompt/model/tools.
- `tests/acp_adapter/test_host_profiles.py` and focused delegation tests: no-provider contract proof.

Upstream behavior preserved: sessions without `_meta.hermes.sessionConfig` use the normal upstream ACP
and `delegate_task` paths unchanged. Model-supplied goals, context, roles, and control actions retain
their upstream behavior. A configured child may receive capabilities not visible to the parent only
when the trusted ACP host explicitly supplied that profile; the model cannot supply toolsets, tool
names, credentials, or profile definitions.

Contribution plan:

1. Open an upstream design issue proposing host-defined ACP session/delegate profiles as an ACP
   extensibility feature, using generic Hermes vocabulary and the official `_meta` contract.
2. Submit the parser and session-scoped tool/profile hooks as one focused PR with tests showing
   backward compatibility, bounded validation, and no credential transport.
3. Submit child-profile selection/tool scoping either in the same PR if maintainers prefer an atomic
   feature, or as a dependent second PR.
4. Replace this patch with the accepted upstream implementation at the first Hermes refresh that
   contains it; keep only LiquidAIty's host-side mapping.

Rollback: remove this module and the marked hooks, then stop sending `hermes.sessionConfig`. Hermes
returns to its upstream broad ACP tool surface and generic native delegation; LiquidAIty must fail
closed rather than claim saved Card-specific native delegation in that state.

## Patch: generic host-issued child execution context

Purpose: let an ACP host allocate and close an opaque execution context before a native Hermes child
makes its first model or MCP call. Hermes transports only generic session, native-child, optional
profile, lifecycle, usage, and per-call metadata fields. It does not parse or own Cards, IDF, IDD,
AGE, projects, conversations, grants, or product authorization.

Files and symbols:

- `acp_adapter/host_profiles.py`: `attach_host_execution_requester`,
  `allocate_host_child_execution`, `finish_host_child_execution`, `host_execution_scope`, and
  `current_host_tool_call_meta`.
- `acp_adapter/server.py`: attaches one generic ACP extension requester and scopes the root run.
- `tools/delegate_tool.py`: allocates every child context before execution, scopes native child work,
  and closes the context once for completion, failure, interruption, or stop.
- `tools/mcp_tool.py`: passes the host-issued metadata through upstream MCP 2
  `ClientSession.call_tool(..., meta=...)`; calls without host metadata retain the exact upstream
  invocation.
- `tests/acp_adapter/test_host_profiles.py` and `tests/tools/test_mcp_tool.py`: focused no-provider
  allocation, scoping, closure, credential-absence, and MCP 2 forwarding proof.

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
   then fail closed for saved-profile delegation rather than relabel child work as the parent.

Contribution plan: propose a generic ACP child-lifecycle extension upstream, independent of
LiquidAIty vocabulary, with tests for pre-execution allocation, ContextVar isolation during concurrent
children, MCP 2 `meta=`, exact-once closure, and no-op compatibility for ordinary Hermes sessions.

Rollback: remove the marked execution-context hooks from the four production files and stop sending
`executionContextId`/`toolCallMeta`. This preserves ordinary upstream delegation but disables the
LiquidAIty saved-profile child path until truthful attribution is restored.
