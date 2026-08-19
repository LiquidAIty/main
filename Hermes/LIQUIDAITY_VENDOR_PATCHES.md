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
