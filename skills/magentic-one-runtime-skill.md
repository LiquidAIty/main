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

## T001 Implementation Attempt

@attempt id=magentic-one-runtime.t001-toolspec-toolregistry
@status active
@source_spec specs/agent-runtime-primitives.md
@source_prompt "implement T001 only: typed ToolSpec contracts and a Python ToolRegistry resolving selected enabled schema-complete card tools while preserving real FunctionTool behavior"
@requires_fresh_cbm true

@attempt_result id=magentic-one-runtime.t001-toolspec-toolregistry
@status succeeded
@cbm_after nodes=5289 edges=9506
@proved_by pytest 67 passed including 20 new tool registry tests with real FunctionTool run_json execution
@proved_by vitest runtime.spec.ts 19 tests passed including new card_tool_unknown and card_tool_name_empty tests, tsc noEmit exit 0
@proved_by AgentChat ban, v0.4.4 source check, providerModelId default rejection, and unknown-tool loud failure all still pass on the new path
@validated_by .venv pytest test_tool_registry.py test_contracts.py test_graph_compiler.py -v; npx vitest run apps/backend/src/cards/runtime.spec.ts; npx tsc -p apps/backend/tsconfig.app.json --noEmit
@touches_code apps/python-models/app/python_models/tool_registry.py
@touches_code apps/python-models/app/python_models/orchestration_contracts.py
@touches_code apps/python-models/app/python_models/magentic_runtime.py
@touches_code apps/backend/src/contracts/runtimeContracts.ts
@touches_code apps/backend/src/cards/runtime.ts

### Work Done

Typed ToolSpec contract in both languages (pydantic in `orchestration_contracts.py`, type plus
`RUNTIME_TOOL_SPECS` in `runtimeContracts.ts`); new `tool_registry.py` with loud-failing
selected-only resolution and the real `tool_current_datetime`/`tool_calculator` callables moved
verbatim; `build_card_tools` in `magentic_runtime.py` now a thin resolve through
`DEFAULT_TOOL_REGISTRY` with identical name, signature, call sites, and error prefixes;
`resolveCardTools` in `cards/runtime.ts` validates Tools-tab selections against known enabled
specs; 23 new tests. `run_magentic_mission` untouched; no T002+ primitive touched.

### Proof

67 pytest passed; 19 vitest passed; tsc clean. Loud-failure matrix proven: unknown, empty name,
disabled, registered-but-unselected, missing inputSchema, missing outputSchema, empty schema,
schema-incomplete, duplicate registration, non-callable adapter, mutated-spec resolve. Real
FunctionTool behavior proven by executing calculator ("2+3*4" -> "14.0") and current_datetime
(ISO-8601 parseable) through `run_json`.

### Actual Graph And Code Delta

Two new sidecar modules, ToolSpec contracts in both languages, registry-backed tool resolution at
backend and sidecar, 23 new tests. CBM after reads 5289/9506 unchanged because the indexer reads
committed HEAD state, not the working tree (verified: pre-T001 symbols still listed); direct
reads and test output are the delta evidence.

Reasoning receipt:

* chosen approach: move the real callables into the new registry module and re-export through
  magentic_runtime, keeping `build_card_tools` name/signature/messages stable so callers and
  existing tests need zero changes; validate specs at construction (pydantic) plus defensively at
  resolve.
* rejected alternatives: importing callables from magentic_runtime into tool_registry (circular
  import); auto-selecting or substituting tools on failure (forbidden); editing
  `test_graph_compiler.py` (unnecessary — message compatibility preserved).
* failed/blocked paths: the prompt's `apps/backend/src/agents/runtimeContracts.ts` path does not
  exist; the real file is `apps/backend/src/contracts/runtimeContracts.ts` (reported, not
  widened).
* guardrails created: backend now fails loudly on unknown/disabled/empty card tools at payload
  build; mutated specs cannot resolve; DEFAULT_TOOL_REGISTRY must not be mutated by future
  per-card registries.
* retry direction: none needed.

Skill update:

* Current Procedure updated: no (seed procedure still accurate)
* Successful Example added: yes
* Failed Attempt added: no
* Query Pattern added: no (t001-proof query already present)

## T001 Runtime Smoke Attempt

@attempt id=magentic-one-runtime.t001-runtime-smoke
@status active
@source_spec specs/agent-runtime-primitives.md
@source_prompt "prove the T001 ToolSpec/ToolRegistry path through the real backend payload shape, contracts, compiler, registry, and real FunctionTool execution"
@requires_fresh_cbm true

@attempt_result id=magentic-one-runtime.t001-runtime-smoke
@status succeeded
@cbm_after nodes=5289 edges=9506
@proved_by 70 pytest passed including 3 new cross-layer smoke tests; pytest -k smoke 3 passed
@proved_by backend payload shape validated through ContextPack, compiled through compile_card_graph, resolved through the typed ToolRegistry, and both tools actually executed: current_datetime returned parseable ISO-8601 UTC and calculator returned 14.0 for 2+3*4
@proved_by unknown tool in the payload failed loudly with card_tool_unknown at resolution and an unselected registered tool never reached the worker
@validated_by .venv pytest app/python_models/test_tool_registry.py -k smoke -v
@touches_code apps/python-models/app/python_models/test_tool_registry.py

### Work Done

Added three smoke tests to `test_tool_registry.py` exercising the real cross-layer path:
backend `buildPythonAutoGenCardRuntimePayload` shape -> `ContextPack` contract ->
`compile_card_graph` -> `build_card_tools` (typed registry) -> real FunctionTool execution.
No runtime code changed: the smoke found no bug in the T001 path.

### Proof

70 pytest passed (67 prior + 3 smoke); `-k smoke` selects exactly the 3 new tests, all passed.
Backend files unchanged, so vitest/tsc were not required this pass (both passed yesterday on the
same surface). The only layer not exercised is the paid model-client exchange itself; tool travel
and execution are real, and outputs come from actually running the tools — no fake finalOutput
path exists.

### Actual Graph And Code Delta

One test file extended by three tests; no production code changed. CBM reads 5289/9506 unchanged
(indexer reflects committed HEAD state, established previously).

Reasoning receipt:

* chosen approach: deterministic cross-layer smoke binding the vitest-proven backend payload
  shape to the Python contract/compiler/registry/execution chain, stopping exactly at the
  model-client boundary.
* rejected alternatives: full live LLM mission smoke (requires provider billing and a running
  backend; nondeterministic; not the smallest honest proof of the T001 surface); mocking the
  model client inside run_magentic_mission (banned: mocked sidecar success).
* failed/blocked paths: none.
* guardrails created: none new; existing guardrails held.
* retry direction: none needed; the remaining unproven layer is the real persisted-deck mission
  smoke with live model calls, which needs explicit user authorization for billing.

Skill update:

* Current Procedure updated: no
* Successful Example added: yes
* Failed Attempt added: no
* Query Pattern added: no

## Live Chat Runtime Smoke Attempt

@attempt id=magentic-one-runtime.live-chat-runtime-smoke
@status active
@source_spec specs/agent-runtime-primitives.md
@source_prompt "prove the T001 path live: real sidecar, real OpenAI model exchange, selected tools executing, loud failures, no fake output"
@requires_fresh_cbm true

@attempt_result id=magentic-one-runtime.live-chat-runtime-smoke
@status succeeded
@cbm_after nodes=5289 edges=9506
@proved_by live POST to the sidecar /autogen/orchestrate with openai gpt-5.1-chat-latest returned ok=True stopReason=magentic_one_complete in 22187ms with both tool results in the final text
@proved_by the final response contained a microsecond-precision tool-produced UTC timestamp and 14 for 2+3*4, impossible without real FunctionTool execution inside the live exchange
@proved_by unknown tool in the live payload returned HTTP 500 card_tool_unknown before any model call
@proved_by regression suite 70 pytest passed after the smoke with zero code changes
@validated_by uvicorn app.main:app --port 8003 then POST /autogen/orchestrate with the magentic_one ContextPack selecting current_datetime and calculator
@touches_code apps/python-models/app/main.py
@touches_code apps/python-models/app/python_models/autogen_orchestrator.py
@touches_code apps/backend/src/services/autogen/autogenOrchestratorClient.ts

### Work Done

No code changed. Started the real sidecar (`uvicorn app.main:app --port 8003`; it self-loads
`apps/backend/.env` via `autogen_provider_env._load_repo_env`), then drove the exact HTTP surface
the backend calls with a real paid OpenAI exchange. Positive smoke: selected tools traveled the
payload, resolved through the typed ToolRegistry, and executed inside the live LedgerOrchestrator
mission. Negative smoke: unknown tool failed loudly over HTTP before any model spend.

### Proof

ok=True, stopReason=magentic_one_complete, turnsUsed=1, elapsedMs=22187, final:
"The current UTC datetime is 2026-06-12T12:55:04.823559+00:00, and the result of 2 + 3 * 4 is
14." Negative: HTTP 500 "card_tool_unknown: made_up_tool (known: calculator,current_datetime)".
Regression: 70 pytest passed.

### Actual Graph And Code Delta

Zero code delta; spec and skill write-backs only. CBM 5289/9506 unchanged (committed-HEAD
indexer). The proven-live boundary moved from unit/contract level to the real sidecar HTTP
surface with a real provider exchange.

Reasoning receipt:

* chosen approach: Path C — sidecar live mission via the exact endpoint
  `orchestrateWithAutoGen` calls, with the magentic-safe approved model; cheapest honest proof of
  the unproven layer and identical payload shape to the vitest-proven backend builder.
* rejected alternatives: full backend+chat stack execution (needs database and app shell — large,
  many unrelated failure modes for a smoke); mocking the model client (banned); unapproved
  models (magentic_model_not_approved guard).
* failed/blocked paths: none; provider call succeeded first try.
* guardrails created: none new; existing loud-failure guards proven live.
* retry direction: not needed. Remaining unexecuted layers are the backend deck-run route and the
  chat UI, whose code chain exists end to end (resolveDeckRunChatReply -> decks.routes.ts ->
  deckRuntime.ts -> cards/runtime.ts -> autogenOrchestratorClient -> sidecar).

Skill update:

* Current Procedure updated: no
* Successful Example added: yes
* Failed Attempt added: no
* Query Pattern added: yes

@query id=magentic-one-runtime.live-smoke "from apps/python-models: .venv uvicorn app.main:app --port 8003; then POST /autogen/orchestrate with a magentic_one ContextPack selecting current_datetime and calculator, provider openai, model gpt-5.1-chat-latest"

## Successful Examples

Audit-001 (2026-06-12): the first real learn-loop consumption of this skill — packet retrieval
surfaced it first, its guardrails bounded the audit, and direct-read evidence confirmed the
pending primitive without speculative implementation.

Live smoke (2026-06-12): the first real paid model exchange through the full sidecar surface —
selected tools executed inside a live Magentic-One mission and unknown tools failed loudly before
any model spend.

T001 (2026-06-12): first real runtime implementation through the loop — typed ToolSpec +
ToolRegistry landed exactly per spec with 67 pytest / 19 vitest / tsc clean, real FunctionTool
behavior preserved for current_datetime and calculator, and the full loud-failure matrix proven.

## Failed Attempts And Guardrails

No runtime edit attempts have been made through this skill yet.
