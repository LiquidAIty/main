# Magentic-One Runtime Audit Spec

## Purpose

Record the first bounded Magentic-One / AutoGen runtime audit (2026-06-12) and define the next
bounded implementation task. This audit changed no runtime code.

## Audit Method

Skill Memory Packet (top match: `magentic-one-runtime`, score 330, 4 guardrails, 2 decisions) plus
a Code Evidence Packet composed from CBM `search_graph` lookups and direct reads. Every claim
below is direct-read backed.

## What Exists (direct-read evidence)

* `apps/python-models/app/python_models/magentic_runtime.py`: real AutoGen v0.4.4 adapters —
  LedgerOrchestrator bus, `CardWorkerAgent`, `FanOutWorkerAgent`, `SocietyOfMindWorkerAgent`,
  `SubgraphRunner`, `GraphScheduler` edge obligations, `run_magentic_mission` (lines 581-772).
* Real tools: `tool_current_datetime` (113-115) and `tool_calculator` (118-121, safe-AST
  arithmetic) execute through real `FunctionTool` in `execute_llm_step`, which fails loudly:
  `card_tool_unknown`, `card_tool_name_empty`, `card_worker_empty_output`,
  `card_tool_loop_exceeded`. No fake output path observed.
* An inline registry `_TOOL_REGISTRY` (124-127) plus `build_card_tools` (130-143): a hardcoded
  name-to-callable map with loud unknown/empty failures.
* `apps/python-models/app/python_models/orchestration_contracts.py`:
  `provider_model_default_forbidden` rejection of `providerModelId="default"` (lines 11-14);
  pydantic contracts including `BlackboardSnapshot`/`ProjectSession`.
* `apps/backend/src/cards/runtime.ts`: loud `card_model_config_missing` and
  `card_model_config_mismatch`; model resolution through the registry; no provider fallback
  observed.
* Tests that exist: `apps/python-models/app/python_models/test_contracts.py`,
  `test_graph_compiler.py` (includes `test_unknown_card_tool_fails_loudly`), and
  `apps/backend/src/cards/runtime.spec.ts`.

## What Is Missing (confirmed, not assumed)

T001 ToolSpec / ToolRegistry from `specs/agent-runtime-primitives.md` is still pending:

* `apps/python-models/app/python_models/tool_registry.py` does not exist.
* `apps/python-models/app/python_models/test_tool_registry.py` does not exist.
* No `ToolSpec` symbol exists anywhere under `apps/backend/src` (grep: zero matches), so the
  typed contract in `runtimeContracts.ts` is absent.
* The inline `_TOOL_REGISTRY` does not satisfy T001: it has no typed ToolSpec, no card-Tools-tab
  selection source, no disabled-tool check, no unselected-tool check, and no
  inputSchema/outputSchema requirements.

## Next Bounded Task

Implement T001 exactly as specified in `specs/agent-runtime-primitives.md`: typed ToolSpec
(TS + Python) and a Python ToolRegistry that resolves only selected, enabled, schema-complete
tools from the card Tools tab, failing loudly otherwise — wrapping the proven
`tool_current_datetime`/`tool_calculator` callables so they keep executing through real AutoGen
FunctionTool behavior. The integration point is `_TOOL_REGISTRY`/`build_card_tools` in
`magentic_runtime.py`.

Allowed files (per T001 expected files):

* `apps/backend/src/contracts/runtimeContracts.ts`
* `apps/backend/src/cards/runtime.ts`
* `apps/backend/src/cards/runtime.spec.ts`
* `apps/python-models/app/python_models/orchestration_contracts.py`
* `apps/python-models/app/python_models/magentic_runtime.py`
* `apps/python-models/app/python_models/tool_registry.py` (new)
* `apps/python-models/app/python_models/test_tool_registry.py` (new)
* `apps/python-models/app/python_models/test_contracts.py`
* `apps/python-models/app/python_models/test_graph_compiler.py`
* `specs/agent-runtime-primitives.md` (T001 task-run write-back)

Do not touch: UI, ThinkGraph, model routing, Docker/env, Prisma, KnowGraph services, AgentChat or
any banned framework, T002+ primitives (AgentCardRuntimeSpec, PlanGraph, trajectory events,
context slices, GraphSkillCandidate/GraphSkill).

Proof commands (from `specs/agent-runtime-primitives.md` T001):

```powershell
# from apps/python-models
.\.venv\Scripts\python.exe -m pytest app/python_models/test_tool_registry.py app/python_models/test_contracts.py app/python_models/test_graph_compiler.py -v
# from repo root, if backend files changed
npx vitest run apps/backend/src/cards/runtime.spec.ts
npx tsc -p apps/backend/tsconfig.app.json --noEmit
```

Plus the T001 proof list: selected enabled ToolSpec resolves; unknown/disabled/empty/
schema-missing/unselected all fail loudly; no fallback or invention; current_datetime and
calculator still run through real FunctionTool; AgentChat ban and
`providerModelId="default"` rejection still pass; no fake finalOutput or mocked sidecar success.

## Acceptance

* Future T001 work retrieves this audit, `specs/magentic-one-autogen-runtime-spec.md`,
  `specs/agent-runtime-primitives.md`, and `skills/magentic-one-runtime-skill.md`.
* The Fable handoff for T001 includes the Skill Memory Packet and a Code Evidence Packet.
* No runtime file outside the allowed list is touched.
