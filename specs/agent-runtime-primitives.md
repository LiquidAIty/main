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

Status: ready-for-fable

User request: Implement only ToolSpec and ToolRegistry as the first Agent Runtime Primitives task.

#### CBM Before

* method:
* index status:
* nodes:
* edges:
* relevant graph nodes:
* relevant graph edges:
* relevant files/symbols:

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

#### Changed-File Manifest

#### Proof

#### CBM After

* method:
* index status:
* nodes:
* edges:
* actual graph/code delta:

#### Summary of Task Done

#### Expected Versus Actual

#### Risks

#### Next State

## Completed Summaries

None yet.
