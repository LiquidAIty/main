---
feature: agent-runtime-primitives
status: active
authority: current
last_task: T001
last_cbm_nodes:
last_cbm_edges:
last_updated: 2026-06-11
---

# Agent Runtime Primitives

## Spec

### Purpose

Define the minimum permanent runtime primitives before future graph skills, scheduler, richer
tools, and automatic learning.

### User Intent

Keep LiquidAIty on the real source-run Microsoft AutoGen v0.4.4 / Magentic-One runtime, with
TypeScript/ReactFlow as the control plane and Python as the agent runtime sidecar. Add only the
smallest required runtime primitives before future graph skills and richer orchestration.

### Non-Goals

* Do not implement Spec 012 or Spec 013/trading.
* Do not migrate to AgentChat.
* Do not add LangChain, Semantic Kernel, Microsoft Agent Framework, or AutoGen Studio.
* Do not add Redis/RQ for AutoGen.
* Do not use Docker python-models runtime.
* Do not fake runtime success.

### Architecture Invariants

* ReactFlow / TypeScript remains the control plane.
* Node backend owns contracts and persistence.
* Python sidecar owns real agent runtime.
* AutoGen v0.4.4 / Magentic-One remains the runtime line.
* Agent card Tools tab is the source of selected tool access.
* Python must not invent tools.
* Unknown, disabled, unselected, empty, or schema-missing tools fail loudly.
* No provider/model fallback.
* No fake `finalOutput`.
* No mocked sidecar success.

### Runtime Primitives

1. **ToolSpec**: Canonical typed description of a tool the runtime may expose.
2. **ToolRegistry**: Runtime resolver that exposes only selected enabled ToolSpecs and fails loudly
   for unknown, disabled, unselected, empty, or schema-missing tools.
3. **AgentCardRuntimeSpec**: Canonical runtime projection of an agent card into backend/Python
   execution settings.
4. **PlanGraphDraft**: Mission-specific proposed execution overlay derived from user intent and
   current graph state.
5. **PlanNode**: One executable or reasoning step inside a PlanGraphDraft.
6. **PlanEdge**: Dependency or ordering relationship between PlanNodes.
7. **RuntimeTrajectoryEvent**: Append-only event emitted by real runtime execution.
8. **GraphContextSlice**: Bounded graph context selected for a mission/task.
9. **GraphSkillCandidate**: Candidate reusable skill derived from proven successful runtime
   evidence.
10. **GraphSkill**: Approved reusable skill that passed validation and can be selected by future
    agents.

### AgentGraph Versus PlanGraph

* AgentGraph is durable system wiring: cards, tools, settings, subgraphs, and allowed connections.
* PlanGraph is a mission-specific proposed execution overlay.
* PlanGraph must respect AgentGraph.
* Approving PlanGraph does not silently mutate AgentGraph.

### GraphSkill Rules

* Candidates come only from successful proven runtime evidence.
* Candidates are inactive until validated and approved.
* Improvement candidates must fix a demonstrated defect or outperform the active skill before
  replacement.
* Markdown is a documentation view, not executable source of truth.

### Acceptance Criteria

* T001 implements ToolSpec / ToolRegistry only.
* Later primitives are not implemented until their task run is active.
* Unknown, disabled, unselected, empty, and schema-missing tools fail loudly.
* Current datetime and calculator keep working through real AutoGen FunctionTool behavior.
* No AgentChat or banned framework enters runtime.
* No fake success path is introduced.

## Task Runs

### T001 - ToolSpec / ToolRegistry

Status: completed (2026-06-12, Fable)

User request: Implement only ToolSpec and ToolRegistry as the first Agent Runtime Primitives task.

#### CBM Before

* method: full repository index
* index status: indexed/ready
* nodes: 5289
* edges: 9506
* relevant graph nodes: magentic_runtime.tool_current_datetime, magentic_runtime.tool_calculator,
  magentic_runtime.build_card_tools, run_magentic_mission, CardWorkerAgent, FanOutWorkerAgent,
  SocietyOfMindWorkerAgent
* relevant graph edges: build_card_tools callers at magentic_runtime.py lines 640/662/686
* relevant files/symbols: magentic_runtime.py inline _TOOL_REGISTRY (124-127) and build_card_tools
  (130-143); orchestration_contracts.py RequiredRuntimeString and
  provider_model_default_forbidden; cards/runtime.ts resolveCardTools (126-131);
  RuntimeGraphNode.tools in runtimeContracts.ts

#### Intended Delta

* implement typed ToolSpec
* implement Python ToolRegistry
* card Tools tab is the only allowed source
* selected enabled ToolSpec resolves
* unknown tools fail loudly
* disabled tools fail loudly
* empty toolId fails loudly
* missing inputSchema fails loudly
* missing outputSchema fails loudly
* registered but unselected tool cannot resolve
* current_datetime and calculator still execute through real AutoGen FunctionTool behavior

#### Expected Files

* `apps/backend/src/contracts/runtimeContracts.ts`
* `apps/backend/src/cards/runtime.ts`
* `apps/backend/src/cards/runtime.spec.ts`
* `apps/python-models/app/python_models/orchestration_contracts.py`
* `apps/python-models/app/python_models/magentic_runtime.py`
* `apps/python-models/app/python_models/tool_registry.py`
* `apps/python-models/app/python_models/test_tool_registry.py`
* `apps/python-models/app/python_models/test_contracts.py`
* `apps/python-models/app/python_models/test_graph_compiler.py`
* `specs/agent-runtime-primitives.md`

#### Forbidden

* T002 or later tasks
* AgentCardRuntimeSpec, PlanGraph, trajectory events, context slices, GraphSkillCandidate, GraphSkill
* broad refactors, unrelated tools/features, UI implementation, Prisma, env edits, Docker changes
* Spec 012 or Spec 013
* AgentChat / `autogen-agentchat`, LangChain, Semantic Kernel, Microsoft Agent Framework, AutoGen Studio
* Redis for AutoGen or Docker python-models runtime
* provider/model fallback or `providerModelId="default"`
* fake `finalOutput` or mocked sidecar success

#### Proof Required

1. Complete enabled selected ToolSpec resolves to its declared adapter.
2. Unknown tool fails loudly.
3. Disabled tool fails loudly.
4. Empty toolId fails loudly.
5. Missing inputSchema fails loudly.
6. Missing outputSchema fails loudly.
7. Registered but unselected tool cannot resolve.
8. No fallback, substitution, guessing, auto-selection, or invention occurs.
9. current_datetime and calculator still execute through real AutoGen FunctionTool behavior.
10. AgentChat ban still passes.
11. `providerModelId="default"` rejection still passes.
12. No fake `finalOutput` or mocked sidecar success is introduced.

#### Validation Commands

From `apps/python-models`:

```powershell
.\.venv\Scripts\python.exe -m pytest app/python_models/test_tool_registry.py app/python_models/test_contracts.py app/python_models/test_graph_compiler.py -v
```

From repo root, if backend files changed:

```powershell
npx vitest run apps/backend/src/cards/runtime.spec.ts
npx tsc -p apps/backend/tsconfig.app.json --noEmit
```

If runtime execution behavior changed, run the real host-source T005 persisted-deck smoke through
the real backend and Python sidecar. Do not mock it.

#### Fable Handoff

Use Code-Based Memory MCP. Read `AGENTS.md` and `specs/agent-runtime-primitives.md`. Execute only
T001 - ToolSpec / ToolRegistry. Run or prove fresh CBM before work and fill in T001 CBM before,
relevant graph findings, files, and intended delta. Use CBM first for structure, focused grep only
for exact checks, and direct-read files before editing. Implement only T001. Run required proof.
Run or prove fresh CBM after work. Record actual graph/code delta, changed-file manifest, proof,
summary, risks, and next state in this task run. Stop before T002. Do not include routine git
status/diff/diff-stat. Do not fake success.

#### Work Done

* Added `ToolSpec` pydantic contract to `orchestration_contracts.py`: required non-empty name and
  description, `enabled` flag, required `inputSchema`/`outputSchema` dicts validated for
  completeness (`tool_schema_missing`, `tool_schema_incomplete: missing type`).
* Created `tool_registry.py`: `ToolRegistry` with `register` (rejects non-ToolSpec, duplicate,
  non-callable adapter), `resolve_one`/`resolve_selected` (loud `card_tool_name_empty`,
  `card_tool_unknown`, `card_tool_disabled`, `card_tool_schema_missing`; selected-only
  resolution; whole-selection abort on any invalid entry — no fallback or substitution), and
  `build_default_tool_registry()` binding the real `tool_current_datetime` and `tool_calculator`
  callables (moved verbatim from `magentic_runtime.py`) to schema-complete enabled specs.
* `magentic_runtime.py` minimal integration: inline `_TOOL_REGISTRY`/`build_card_tools` replaced
  by a thin `build_card_tools` resolving through `DEFAULT_TOOL_REGISTRY`; same function name,
  signature, call sites, and error message prefixes; orphaned `ast`/`operator`/`datetime`/
  `Callable` imports removed; `run_magentic_mission` untouched.
* Added `ToolSpec` type and `RUNTIME_TOOL_SPECS` to `runtimeContracts.ts`; `resolveCardTools` in
  `cards/runtime.ts` now validates card-Tools-tab selections against known enabled specs with
  loud `card_tool_name_empty`/`card_tool_unknown`/`card_tool_disabled`.
* Added `test_tool_registry.py` (20 tests) and three T001 tests to `runtime.spec.ts`.
  `test_contracts.py` and `test_graph_compiler.py` needed no changes and still pass, including
  `test_unknown_card_tool_fails_loudly` against the new path.

#### Changed-File Manifest

* `apps/python-models/app/python_models/orchestration_contracts.py` (ToolSpec added)
* `apps/python-models/app/python_models/tool_registry.py` (new)
* `apps/python-models/app/python_models/test_tool_registry.py` (new)
* `apps/python-models/app/python_models/magentic_runtime.py` (registry integration only)
* `apps/backend/src/contracts/runtimeContracts.ts` (ToolSpec + RUNTIME_TOOL_SPECS)
* `apps/backend/src/cards/runtime.ts` (resolveCardTools validation)
* `apps/backend/src/cards/runtime.spec.ts` (3 T001 tests)
* `specs/agent-runtime-primitives.md` (this write-back)
* `skills/magentic-one-runtime-skill.md` (attempt closeout)

#### Proof

* pytest (`test_tool_registry.py` + `test_contracts.py` + `test_graph_compiler.py`):
  **67 passed**. Covers: selected enabled spec resolves to its declared adapter; unknown,
  disabled, empty-name, missing-inputSchema, missing-outputSchema, empty-schema, and
  schema-incomplete all fail loudly; registered-but-unselected cannot resolve; invalid selection
  aborts without substitution; duplicate registration fails; real FunctionTool behavior proven by
  executing `run_json` (`calculator` "2+3*4" -> "14.0"; `current_datetime` ISO-8601 parseable);
  AgentChat ban (`test_runtime_modules_do_not_import_agentchat`) and v0.4.4 source test still
  pass; `providerModelId="default"` rejection still passes.
* vitest `runtime.spec.ts`: **19 tests passed** (both project configs, 38 total), including the
  new card_tool_unknown / card_tool_name_empty / pass-through tests.
* `npx tsc -p apps/backend/tsconfig.app.json --noEmit`: exit 0.
* No fake finalOutput or mocked sidecar success introduced; no provider fallback added.

#### CBM After

* method: full repository index
* index status: indexed/ready
* nodes: 5289
* edges: 9506
* actual graph/code delta: counts unchanged because the CBM indexer reads the committed HEAD
  state, not the working tree (verified: the index still lists tool_current_datetime/
  tool_calculator inside magentic_runtime.py after they moved to tool_registry.py). Real delta by
  direct read and tests: two new sidecar modules, ToolSpec contracts in both languages, registry
  integration, 23 new tests.

#### Summary of Task Done

T001 implemented exactly: typed ToolSpec (TS + Python) and a loud-failing Python ToolRegistry
resolving only selected, enabled, schema-complete card tools, wrapping the existing real
current_datetime/calculator FunctionTool behavior. No T002+ primitive touched.

#### Expected Versus Actual

Expected files matched, with one correction: the runtime contracts file is
`apps/backend/src/contracts/runtimeContracts.ts` (an `agents/runtimeContracts.ts` path referenced
in one prompt does not exist). `test_contracts.py`/`test_graph_compiler.py` required no edits.

#### Risks

* CBM indexes committed state; until this work is committed, graph queries return the pre-T001
  runtime shape. Direct-read before trusting CBM for these files.
* Backend now rejects unknown card tools at payload build time (previously deferred to the
  sidecar); any stored deck with a stale tool name will fail loudly at the backend instead —
  same failure class, earlier surface.
* `DEFAULT_TOOL_REGISTRY` is module-level; future dynamic per-card registries (T002+) should
  construct their own `ToolRegistry` rather than mutating the default.

#### Next State

T001 complete and proven. Next: one real chat/runtime smoke using selected card tools through the
Sol/Magentic-One path (T005-style persisted-deck smoke), then T002 when its task run is activated.

## Completed Summaries

None yet.
