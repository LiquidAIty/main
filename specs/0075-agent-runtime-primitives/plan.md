# Spec 007.5 Plan: Agent Runtime Primitives

## Objective

Introduce the minimum permanent runtime contracts in atomic stages while preserving the proven
Spec 007 host-source AutoGen runtime. Begin with ToolSpec/ToolRegistry only. Do not combine this
work with ThinkGraph, GraphSkills execution, scheduler expansion, UI work, or persistence changes.

## Inverse Audit

### Existing behavior to preserve

- `apps/backend/src/cards/runtime.ts` preserves card tool IDs from `runtimeOptions.tools` or
  `card.tools`, explicit model configuration, fan-out, Society-of-Mind state, graph nodes, and
  graph edges.
- `apps/python-models/app/python_models/magentic_runtime.py` has a small fixed `_TOOL_REGISTRY`,
  builds real AutoGen `FunctionTool` instances, and fails on empty or unknown tool names.
- `apps/python-models/app/python_models/orchestration_contracts.py` contains strict participant
  model contracts and current graph/card payload models.
- `client/src/features/agentbuilder/plan/planDraftTypes.ts` and
  `client/src/components/assist/planMissionModel.ts` contain partial plan authoring and
  ReactFlow-visible plan surfaces.
- Spec 007 T005 proves the current host-source runtime rail.

### Existing concepts that are not canonical primitives

- `apps/backend/src/agents/registry.ts` is a legacy backend executable-tool list with weak `any`
  contracts and optional enabled state.
- `apps/backend/src/agents/mcp-tool-registry.ts` is an MCP catalog/install surface, not the Python
  runtime ToolRegistry.
- Existing `PlanDraft`, `PlanMissionGraph`, runtime `events?: any[]`, and graph-context-shaped
  fields are migration inputs, not completed Spec 007.5 contracts.

### Risks

- Accidentally allowing a backend registry, model, or Python runtime to invent/substitute tools.
- Breaking the proven Spec 007 payload while introducing canonical names.
- Treating PlanGraph approval as permission to mutate AgentGraph.
- Storing large transcripts in trajectory events.
- Promoting generated Markdown or failed runs as executable GraphSkills.

## Contract Ownership

| Primitive | Canonical ownership | First implementation boundary |
|---|---|---|
| ToolSpec | Shared backend-to-sidecar runtime contract | Task 001 |
| ToolRegistry | Python runtime resolution boundary, fed by card-selected IDs | Task 001 |
| AgentCardRuntimeSpec | Shared card runtime payload contract | Task 002 |
| PlanGraphDraft | Mission planning contract and later ReactFlow overlay | Task 003 |
| RuntimeTrajectoryEvent | Shared compact execution-event contract | Task 004 |
| GraphContextSlice | Shared runtime-memory context boundary | Task 005 |
| GraphSkillCandidate | Future evidence-backed candidate contract | Task 006 |
| GraphSkill | Future validated executable subgraph contract | Task 007 |

## Implementation Sequence

1. Define and test ToolSpec/ToolRegistry without changing card selection behavior.
2. Replace loose card payload shapes with AgentCardRuntimeSpec while preserving current fields.
3. Reconcile existing plan surfaces into PlanGraphDraft without changing AgentGraph ownership.
4. Add compact typed trajectory events at proven runtime transition points.
5. Introduce GraphContextSlice as a bounded interface before implementing retrieval.
6. Create GraphSkillCandidate only from successful trajectory evidence.
7. Add explicit GraphSkill promotion, quarantine, deprecation, and replacement validation.

Each implementation task must pass its own contract tests before the next task begins.

## Task 001 Implementation Boundary

Task 001 is intentionally narrow:

- Define a typed shared `ToolSpec` and tool reference/settings shape.
- Define a Python `ToolRegistry` that resolves only card-selected tool IDs.
- Preserve current real tools and current AutoGen `FunctionTool` execution.
- Reject unknown, disabled, empty, or schema-less tool definitions before execution.
- Add focused backend/Python contract tests.
- Do not implement permissions enforcement, approvals, telemetry persistence, UI changes, or new
  tools. Those fields are declared now so later work does not break the contract.

## Acceptance-Test Strategy

### Task 001

- Complete enabled ToolSpec resolves to its declared Python adapter.
- Unknown ID, disabled ToolSpec, missing input schema, and missing output schema each fail loudly.
- An unselected registered tool cannot be resolved for a card.
- Registry does not use a default, fallback, guessed, or invented tool.
- Existing `current_datetime` and `calculator` behavior remains real and tested.

### Later tasks

- Task 002 proves card contract preservation and strict explicit model configuration.
- Task 003 proves PlanGraph references only allowed AgentGraph resources and remains a separate
  overlay.
- Task 004 proves required compact event categories and failure truth.
- Task 005 proves slices are bounded and agree with card/tool/output contracts.
- Tasks 006-007 prove successful-run provenance and evidence-gated promotion/replacement.

## Validation Gates

For each implementation task:

1. Run the smallest focused Python contract tests.
2. Run focused backend runtime contract tests when shared payloads change.
3. Run backend TypeScript compile when TypeScript contracts change.
4. Run `git diff --check`.
5. Do not claim runtime success without a real runtime validation appropriate to the changed
   behavior.

## Documentation Updates During Implementation

- Keep this spec and tasks file current.
- Update `docs/runbooks/AUTOGEN_REACTFLOW_RUNTIME_ARCHITECTURE.md` only when behavior is implemented
  and validated.
- Do not create standalone audit notes or random skill Markdown.

## Explicit Non-Goals

- No runtime source changes in this prep pass.
- No UI, Prisma, env, Docker, vendored/subrepo, Spec 012, or Spec 013 work.
- No full memory retrieval, trajectory persistence, GraphSkill execution, marketplace, or
  auto-learning implementation.

