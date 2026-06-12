# Skill: Magentic-One Runtime

@skill id=magentic-one-runtime
@type Skill
@status learning
@applies_to specs/magentic-one-autogen-runtime-spec.md
@related_to skill-packet-fable-handoff
@related_to codegraph-context-reader
@requires codebasedmemory
@requires skill-packet-fable-handoff
@requires codegraph-context-reader
@requires fresh_cbm_index

## Vector Summary

Edit the Sol / Magentic-One front-door runtime safely: real source-run Microsoft AutoGen v0.4.4
primitives in the Python sidecar, ReactFlow/TypeScript control plane, selected ToolSpecs only,
loud failures, no fake outputs, and bounded Fable handoffs carrying skill and code evidence
packets.

## Use When

Use when auditing, testing, or editing the Magentic-One/AutoGen runtime adapters, tool
resolution, orchestration wiring, or sidecar execution behavior.

## Current Known Shape

Direct-read evidence (2026-06-12):

* `apps/python-models/app/python_models/magentic_runtime.py` adapts ReactFlow cards onto locked
  AutoGen v0.4.4 primitives: LedgerOrchestrator bus, CardWorkerAgent, FanOutWorkerAgent,
  SocietyOfMindWorkerAgent, GraphScheduler edge obligations; every reply is a real model-client
  call and failures propagate loudly.
* `apps/python-models/app/python_models/orchestration_contracts.py`,
  `apps/backend/src/contracts/runtimeContracts.ts`, and `apps/backend/src/cards/runtime.ts`
  exist.
* `apps/python-models/app/python_models/tool_registry.py` does not exist yet: T001
  ToolSpec/ToolRegistry in `specs/agent-runtime-primitives.md` is still ready-for-fable.
* The PyPI `magentic-one` wheel is an empty stub; the runtime line is source-run v0.4.4.

## Guardrails

@guardrail id=magentic-one-runtime.locked-v044-line
@guardrail id=magentic-one-runtime.no-banned-frameworks
@guardrail id=magentic-one-runtime.no-fake-runtime-success
@guardrail id=magentic-one-runtime.selected-tools-only

* The runtime line is source-run AutoGen v0.4.4 / Magentic-One; do not swap rails.
* No AgentChat, AutoGen Studio, Semantic Kernel, LangChain, or Microsoft Agent Framework.
* No fake finalOutput, mocked sidecar success, or provider/model fallback.
* Tools resolve only from selected enabled ToolSpecs; unknown/disabled/unselected/empty/
  schema-missing tools fail loudly; Python never invents tools.

## Rejected Paths

@decision id=magentic-one-runtime.reject-agentchat-migration
@because the locked runtime line is source-run autogen_core plus autogen_magentic_one v0.4.4 and repo law bans AgentChat
@rejected migrating runtime execution to autogen-agentchat or AutoGen Studio
@use_instead the existing magentic_runtime.py adapters over v0.4.4 primitives
@proved_by AGENTS.md runtime guardrails and the magentic_runtime.py source header

@decision id=magentic-one-runtime.reject-pypi-magentic-one-wheel
@because the PyPI magentic-one package is an empty stub and cannot run the orchestrator
@rejected installing magentic-one from PyPI as the runtime dependency
@use_instead source-run microsoft/autogen tag v0.4.4
@proved_by magentic_runtime.py locked source line documentation

## Query Patterns

@query id=magentic-one-runtime.code-evidence "refresh CBM, then search_graph for magentic_runtime orchestrator worker tool registry symbols and direct-read apps/python-models/app/python_models/magentic_runtime.py before any claim"
@query id=magentic-one-runtime.handoff "py -3.12 services/knowgraph/skill_ingest.py handoff --prompt <runtime task> --spec specs/magentic-one-autogen-runtime-spec.md --code-evidence <packet.json>"

## Proof Requirements

* Fresh CBM before and after, with counts recorded.
* Direct-read evidence for every runtime file touched.
* `specs/agent-runtime-primitives.md` validation commands for ToolSpec/ToolRegistry work:
  pytest in `apps/python-models`, vitest plus tsc for backend contract changes.
* Real persisted-deck smoke through backend and sidecar if execution behavior changes; never
  mocked.
* Proof that no banned framework, fallback, or fake-success path entered the change.

## Future Edit Procedure

1. Retrieve `specs/magentic-one-autogen-runtime-spec.md` and this skill.
2. Build the handoff with Skill Memory Packet and a scout-composed Code Evidence Packet.
3. Execute only the bounded attempt; obey guardrails above.
4. Run the proof commands; write `@attempt_result` back here; re-ingest skills.

## Active Attempt

@attempt id=magentic-one-runtime.seed-001
@status active
@source_spec specs/magentic-one-autogen-runtime-spec.md
@source_prompt "seed the Magentic-One runtime skill from direct-read evidence before future runtime edits"
@requires_fresh_cbm true

Bounded scope: seed pass only — spec plus this evidence-backed skill stub. No runtime code edits.

@attempt_result id=magentic-one-runtime.seed-001
@status succeeded
@cbm_after nodes=5289 edges=9506
@proved_by direct reads of magentic_runtime.py header, orchestration_contracts.py, runtimeContracts.ts, cards/runtime.ts existence, and tool_registry.py absence
@validated_by glob and direct-read checks recorded in the seed pass report
@touches_code apps/python-models/app/python_models/magentic_runtime.py

Seed result: spec and skill exist; runtime untouched; T001 ToolSpec/ToolRegistry remains the
first bounded runtime implementation target.

## Audit Attempt

@attempt id=magentic-one-runtime.audit-001
@status active
@source_spec specs/magentic-one-runtime-audit-spec.md
@source_prompt "run the first bounded Magentic-One runtime audit and identify the smallest safe next implementation task"
@requires_fresh_cbm true

@attempt_result id=magentic-one-runtime.audit-001
@status succeeded
@cbm_after nodes=5289 edges=9506
@proved_by Skill Memory Packet ranked this skill first at score 330 and the audit consumed its guardrails and rejected paths
@proved_by direct reads confirmed inline _TOOL_REGISTRY and build_card_tools with loud failures but no typed ToolSpec, no tool_registry.py, no test_tool_registry.py, and zero ToolSpec matches in apps/backend/src
@proved_by provider_model_default_forbidden in orchestration_contracts.py and card_model_config_missing/mismatch in cards/runtime.ts confirm no-fallback guards already exist
@validated_by grep ToolSpec apps/backend/src returned no files and glob confirmed tool_registry.py absent
@touches_code apps/python-models/app/python_models/magentic_runtime.py
@touches_code apps/python-models/app/python_models/orchestration_contracts.py
@touches_code apps/backend/src/cards/runtime.ts
@query id=magentic-one-runtime.t001-proof "from apps/python-models: .venv pytest test_tool_registry.py test_contracts.py test_graph_compiler.py -v; from root: npx vitest run apps/backend/src/cards/runtime.spec.ts; npx tsc -p apps/backend/tsconfig.app.json --noEmit"

Audit result: T001 ToolSpec/ToolRegistry confirmed pending. Next bounded task, allowed files,
do-not-touch list, and proof commands are recorded in
`specs/magentic-one-runtime-audit-spec.md`. The integration point is
`_TOOL_REGISTRY`/`build_card_tools` in `magentic_runtime.py`; `tool_current_datetime` and
`tool_calculator` must keep executing through real FunctionTool behavior. No runtime code was
changed by the audit.

## Successful Examples

Audit-001 (2026-06-12): the first real learn-loop consumption of this skill — packet retrieval
surfaced it first, its guardrails bounded the audit, and direct-read evidence confirmed the
pending primitive without speculative implementation.

## Failed Attempts And Guardrails

No runtime edit attempts have been made through this skill yet.
