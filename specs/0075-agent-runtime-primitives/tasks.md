# Spec 007.5 Tasks: Agent Runtime Primitives

**Status**: Spec-prep tasks complete; runtime implementation has not started.  
**Gate**: Fable implements only the T001 ToolSpec/ToolRegistry contract first, then stops.  
**First Fable implementation task**: T001 contract only.

## Atomic Task Order

- [x] T001 [US1] Define the ToolSpec/ToolRegistry contract and acceptance tests in docs/spec only; the card Tools tab remains the only source of allowed tools.
- [x] T002 [US2] Define AgentCardRuntimeSpec in docs/spec only while preserving explicit model configuration, tool selections/settings, fanOut, isSocietyOfMind, childGraphRef, and optional output/memory/context policies.
- [x] T003 [US3] Define PlanGraphDraft in docs/spec only as a ReactFlow-visible overlay that remains distinct from and constrained by AgentGraph.
- [x] T004 [US4] Define compact typed RuntimeTrajectoryEvent records and required event categories in docs/spec only.
- [x] T005 [US5] Define the minimal GraphContextSlice boundary in docs/spec only without designing full ThinkGraph/KnowGraph retrieval.
- [x] T006 [US6] Define GraphSkillCandidate in docs/spec only with the successful-run-only rule.
- [x] T007 [US6] Define GraphSkill promotion, quarantine, deprecation, and evidence-gated replacement rules in docs/spec only.
- [x] T008 Produce the Fable implementation prompt for T001 only.

## Task Acceptance Contracts

### T001 — ToolSpec / ToolRegistry

- Card Tools tab selections and settings are preserved into the runtime payload.
- ToolSpec contains `toolId`, `name`, `description`, `inputSchema`, `outputSchema`, `permissions`,
  `sideEffects`, `requiresApproval`, `timeoutMs`, `costHint`, `runtimeAdapter`, and `enabled`.
- Python ToolRegistry maps only card-selected IDs to declared callable/runtime adapters.
- Unknown, disabled, empty, or schema-less tools fail loudly.
- No default, fallback, substitution, guessing, auto-selection, or invention of tools.
- Tests prove both successful resolution and every required rejection.
- No new tool behavior, UI, persistence, telemetry persistence, or approval workflow.

### T002 — AgentCardRuntimeSpec

- Contract contains every field defined in `spec.md`.
- Explicit provider/model configuration remains mandatory.
- Tools tab selections/settings, fanOut, isSocietyOfMind, and child graph reference survive the
  backend-to-sidecar boundary.
- Missing required values fail loudly; fields are not weakened to make tests pass.

### T003 — PlanGraphDraft

- MissionSpec planning produces a proposed PlanGraphDraft.
- AgentGraph remains durable source of allowed cards, tools, subgraphs, settings, and connections.
- PlanGraph remains a mission-specific ReactFlow-visible overlay.
- Plan nodes cannot reference resources forbidden by AgentGraph.
- Approval does not silently mutate AgentGraph.

### T004 — RuntimeTrajectoryEvent

- Event contract contains every field and category defined in `spec.md`.
- Events record actual transitions and failures, not planned or fake success.
- Large transcripts/payloads are referenced rather than copied into every event.

### T005 — GraphContextSlice

- Slice contains the minimal fields defined in `spec.md`.
- Slice agrees with card tool and output contracts.
- No whole-project graph or random whole-history fallback.
- Full retrieval/ranking remains out of scope.

### T006 — GraphSkillCandidate

- Candidate requires successful proven source runs or validated graph slices.
- Candidate preserves graph slice, schemas, tools, model policy, trajectory provenance, tests,
  benchmark results, and validation status.
- Failed or unproven evidence cannot produce a promotable candidate.

### T007 — GraphSkill Promotion And Replacement

- Lifecycle states are candidate, validated, approved, active, deprecated, and quarantined.
- Candidate is not active by default.
- Replacement requires comparable validation evidence proving a fix or improvement.
- Failed or unproven candidates never replace active skills.
- Markdown remains a generated docs view, not the executable source of truth.

## Fable Prompt — T001 Only

```text
USE CODE BASED MEMORY MCP.

Implement only Spec 007.5 T001: ToolSpec / ToolRegistry.

Freshness gate:
- Refresh/rebuild the Code-Based Memory repository index in this run.
- Report before/after node and edge counts.
- Verify claims with current git status/diff and direct file reads.
- Stop without edits if freshness cannot be proven.

Read first:
- specs/0075-agent-runtime-primitives/spec.md
- specs/0075-agent-runtime-primitives/plan.md
- specs/0075-agent-runtime-primitives/tasks.md
- docs/runbooks/AUTOGEN_REACTFLOW_RUNTIME_ARCHITECTURE.md
- apps/backend/src/contracts/runtimeContracts.ts
- apps/backend/src/cards/runtime.ts
- apps/backend/src/cards/runtime.spec.ts
- apps/python-models/app/python_models/orchestration_contracts.py
- apps/python-models/app/python_models/magentic_runtime.py
- apps/python-models/app/python_models/test_graph_compiler.py
- apps/python-models/app/python_models/test_contracts.py

Goal:
- Add the canonical typed ToolSpec contract and Python ToolRegistry.
- Preserve the card Tools tab as the only source of allowed tool IDs/settings.
- Preserve real current_datetime and calculator execution.
- Resolve only card-selected tools to declared Python adapters.

Required ToolSpec fields:
toolId, name, description, inputSchema, outputSchema, permissions, sideEffects,
requiresApproval, timeoutMs, costHint, runtimeAdapter, enabled.

Tests must prove:
1. A complete enabled selected tool resolves to its declared adapter.
2. Unknown tool ID fails loudly.
3. Disabled tool fails loudly.
4. Missing inputSchema fails loudly.
5. Missing outputSchema fails loudly.
6. Empty tool ID fails loudly.
7. A registered but unselected tool cannot be resolved for a card.
8. No default, fallback, guessed, substituted, auto-selected, or invented tool is used.
9. Existing real current_datetime and calculator tool execution remains valid.

Banned behavior:
- No default/fallback tool.
- No Python-invented tool.
- No model/provider fallback.
- No fake success or swallowed error.
- No new tools.
- No UI, Prisma, env, Docker, vendored/subrepo, Spec 012, Spec 013, GraphSkill,
  trajectory persistence, memory retrieval, approval workflow, or marketplace work.
- Do not weaken required fields.
- Do not implement T002-T007.

Validation:
- Run the smallest focused Python ToolRegistry tests.
- Run focused backend runtime contract tests if the shared payload changes.
- Run npx tsc -p apps/backend/tsconfig.app.json --noEmit if TypeScript changes.
- Run git diff --check.

Stop condition:
- Stop after T001 implementation, focused tests, validation, T001 status update, and a detailed
  read-only git report. Do not begin T002.
```
