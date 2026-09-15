# LiquidAIty Hermes divergence register

This file records the only two LiquidAIty-owned changes that are intended to
remain in the vendored Hermes source. It is a source-scope register, not proof
that either path has passed loaded application acceptance.

The checked-in package declares Hermes Agent `0.21.0` from
`https://github.com/NousResearch/hermes-agent`. The imported source does not
record its original upstream commit SHA, so this register can prove the
intended local patches and their current markers, but it cannot by itself prove
an exhaustive byte-for-byte diff against the exact upstream import.

Hermes' upstream ACP implementation remains vendored upstream functionality.
LiquidAIty does not use it as its Card runtime boundary: Main, Builder, and
ordinary Hermes-backed Cards run through the native Gateway/TUI system. The
removed LiquidAIty ACP adapter, callback routes, editable plugin, execution
context registry, transcript projection, and child-Run bridge are not fallback
paths and must not be restored.

Any LiquidAIty-specific Hermes change outside the two entries below is residue
unless a later owner-approved ImplementationPacket updates this register.

## 1. Durable Team through `delegate_task(role="team")`

VENDORED PROJECT: `NousResearch/hermes-agent` 0.21.0, imported upstream commit unknown.

PURPOSE: add one top-level `team` role to Hermes' existing `delegate_task`
tool. It creates one durable native Auto-Kanban root and then leaves
decomposition, dispatch, worker execution, review, retry, synthesis,
notification, Stop, and rejoin with Hermes' existing Kanban owners.

EXTERNAL ALTERNATIVE CHECK: native leaf/orchestrator delegation is temporary
child execution and cannot provide a durable Kanban task graph. A LiquidAIty
scheduler, ACP callback loop, second task database, or TypeScript planner would
duplicate Hermes owners and is rejected.

FILES AND SYMBOLS:

- `tools/delegate_tool.py`: validates the single top-level Team mission,
  prevents nested delegation from Team workers, and calls
  `hermes_cli.kanban_team.submit_team` before temporary-child construction.
- `hermes_cli/kanban_team.py`: validates native configuration and dispatcher
  readiness, creates one initially blocked root, activates it into Triage, and
  subscribes the originating native session.
- `hermes_cli/config_defaults.py`: defines the optional native Team worker
  provider/model/reasoning fields.
- `hermes_cli/kanban_decompose.py`: carries the native Team worker selection
  into decomposed child tasks.
- `hermes_cli/kanban_db.py`: preserves the Team root/worker invariants,
  activation boundary, depth-one worker environment, and root synthesis.

UPSTREAM BEHAVIOR PRESERVED: `leaf` and `orchestrator` keep their upstream
temporary-child paths. Ordinary manually created Kanban tasks retain their
normal behavior. No Card ID, saved Card prompt, IDF, graph selection, or
LiquidAIty Run definition is stored in Hermes' Kanban database.

CONTRACTS:

- Team accepts one non-empty `goal` and optional string `context`.
- `tasks[]`, `output_schema`, and nested delegation are rejected for Team.
- the native decomposer and worker provider/model must be configured before a
  Team root is created;
- a live repository Gateway dispatcher and durable originating Hermes session
  are required;
- the root is committed blocked before activation, preventing dispatch before
  correlation exists;
- the Team recipe has native depth one; Hermes owns retries and synthesis.

TESTS:

- `tests/tools/test_delegate_team.py`
- `tests/hermes_cli/test_kanban_team.py`

FORK COST: one small adapter module plus contained changes in the existing
delegate, configuration, decomposition, and Kanban owners. No downstream ACP
plugin or callback service is part of this patch.

ROLLBACK: remove the `team` enum/branch, `kanban_team.py`, Team-only config,
decomposition metadata, database invariants, and matching tests together.
Leave upstream leaf/orchestrator delegation and ordinary Kanban untouched.

Current proof limit: focused source tests and compilation can prove the
contained contract. Real Gateway/TUI input, native worker activity, synthesis,
and returned output require separate loaded acceptance.

## 2. Named-profile branch through `delegate_task(role="profile")`

VENDORED PROJECT: `NousResearch/hermes-agent` 0.21.0, imported upstream commit unknown.

PURPOSE: reserve one direct `profile` role on the existing `delegate_task`
doorway. A trusted host may expose an exact bounded roster of installed native
profiles, after which Hermes can request one receiving-profile handoff with the
parent-authored goal, context, and optional bounded native data references.

EXTERNAL ALTERNATIVE CHECK: native leaf/orchestrator children inherit the
current profile and Team is same-profile durable fan-out. None selects another
existing profile. A second model-facing Card tool, deterministic router, ACP
adapter, callback plugin, or duplicate Run materializer is rejected.

FILES AND SYMBOLS:

- `tools/delegate_tool.py`: `role="profile"`, `target_profile`, bounded
  `dataAnchors`, exact roster validation, and the fail-closed trusted-host
  request.
- `run_agent.py`: transports the profile arguments through the ordinary native
  delegate-tool invocation without interpreting their meaning.
- `tests/tools/test_delegate_team.py`: unit proof of exact-roster acceptance,
  forged-target rejection, argument forwarding, and preserved Team nesting
  constraints.

UPSTREAM BEHAVIOR PRESERVED: without a trusted roster and request function the
profile branch fails closed. Leaf, orchestrator, Team, model/provider selection,
profile storage, memory, skills, MCP, and normal Gateway sessions are unchanged.

CONTRACTS:

- one exact roster member is required;
- one non-empty goal and optional string context are accepted;
- batches and output schemas are rejected;
- at most sixteen object-shaped `dataAnchors` may be transported; the receiving
  LiquidAIty Python IDF owner, not Hermes, must validate and read them;
- the receiving saved Card remains the sole owner of its profile, prompt,
  grants, Run, and IDF;
- missing trusted host context returns an explicit unavailable error and never
  falls back to leaf, Team, ACP, a generic model call, or direct profile launch.

TESTS:

- `tests/tools/test_delegate_team.py`

FORK COST: a contained schema and dispatch branch in the existing delegate
tool, plus argument transport in `run_agent.py`.

ROLLBACK: remove `profile`, `target_profile`, `dataAnchors`, the profile branch,
the matching `run_agent.py` arguments, and profile-specific tests together.
Leave Team, leaf, orchestrator, and native profile management untouched.

Current proof limit: the branch is intentionally unavailable in the current
stock Gateway/TUI integration because no supported native Gateway method yet
supplies the trusted roster/request context. The old ACP host-profile adapter
and editable LiquidAIty plugin that once supplied private `_host_*` attributes
were removed. Unit injection proves only branch behavior, not a live Card
handoff. The next implementation must either connect this branch through a
documented native Gateway extension point or remove it; it must not restore the
retired ACP/plugin system.
