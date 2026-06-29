# Skill: PlanFlow No Deterministic Projection

@skill id=planflow-no-deterministic-projection
@type Skill
@status active
@related_to no-fake-surfaces
@related_to magentic-one-runtime
@related_to spec-as-prompt

## Vector Summary

Before touching Agent Builder, PlanFlow, Task Ledger, deckRunState, PlanMissionFlow, the AutoGen
runtime, or Python rails artifact wiring: never rebuild PlanFlow by deterministically parsing prose,
markdown, finalResponseText, autogenMessages, chat text, rawOutput, fallback text, status text, or
model transcript text. Real task nodes come only from real Task Ledger structured artifacts (or future
Mag One card prompt-chain structured output) — otherwise fail closed or show one honest TaskLedgerArtifact
node. This poison path has been removed many times under renamed helpers; do not reintroduce it.

## Guardrails

@guardrail id=planflow-no-deterministic-projection.no-prose-parsing
@guardrail id=planflow-no-deterministic-projection.no-sanitizer-rebuild
@guardrail id=planflow-no-deterministic-projection.no-label-stripping
@guardrail id=planflow-no-deterministic-projection.fail-closed-or-raw-artifact
@guardrail id=planflow-no-deterministic-projection.no-renamed-guardrail-reimpl

* Never parse prose/markdown/finalResponseText/autogenMessages/chat/rawOutput/fallback/status/transcript text into PlanFlow task nodes.
* Never add sanitizer/regex/poison-filter/keyword-router logic to make AI planning text look nicer.
* Never strip agent names, Source labels, TaskLedger labels, team composition, or Magentic-One planning text.
* If real structured task objects do not exist, show missing state or one honest TaskLedgerArtifact node.
* Do not call it a guardrail and reimplement the same projection anyway — the correct behavior is fail closed or show raw real artifact state.

## Forbidden Names

@forbidden id=planflow-no-deterministic-projection.names
planFlowProjection, buildPlanFlowMissionGraph, buildPlanStepCardView, planResultFeedback,
sanitizePlanText, isPlanRuntimeNoiseText, fallback_step, wantsPlanSurface,
"Plan created on canvas" unless a real node exists.

## Proof

@proof id=planflow-no-deterministic-projection.audit rg the forbidden names/patterns across client/src, apps/backend/src, apps/python-models/app/python_models
@proof id=planflow-no-deterministic-projection.client-compile npx tsc -p client/tsconfig.json --noEmit
@proof id=planflow-no-deterministic-projection.backend-compile npx tsc -p apps/backend/tsconfig.app.json --noEmit (only when backend touched)

## Query Patterns

@query id=planflow-no-deterministic-projection.audit "search changed PlanFlow/Task Ledger/Agent Builder paths for projection, sanitizer, fallback_step, keyword router, and finalResponseText/autogenMessages/chat used as a task-node source"

## Removal Log

@removal id=planflow-no-deterministic-projection.2026-06-28 the outer deterministic plan layer was deleted in full (not patched).

Deleted files:
* `client/src/components/builder/assistPlanSurface.ts` (whole deterministic projection: `buildStructuredAssistPlanSurface`, `StructuredAssistPlanSurface`, `StructuredAssistPlanStep`, `PlanContractMode`, `PlanStepStatus`, anchor-text derivation, executor classification, the broken no-arg `safeText()`).
* `client/src/components/assist/PlanWikiSurface.tsx` (+ spec) — was never rendered.

Removed symbols (zero active references after removal): `buildStructuredAssistPlanSurface`, `buildPlanMissionGraph` (+ helpers `makeNode`/`normalizeStatusForNode`/`inferNodeKind`/`buildStepDescription`/`toNodeId`), `StructuredAssistPlanSurface`, `EMPTY_PLANFLOW_STRUCTURED_PLAN`, the deterministic `structuredPlan` fallback in `PlanMissionFlow`, the Go-gate (`PlanFlowGoGateState`, `goGateState`, `handlePlanGoGate`, `onGoGate`/`onTaskGoGate`/`goGateStatus`, SWAT tray, inspector/editor "Run Agents" buttons, `PlanMissionNodeData.onGoGate/goGateStatus/onRunTask/isRunTaskNode/runnable`).

Kept (native Mag One Task Ledger display — do NOT rebuild a projection over it): `buildTaskLedgerArtifactGraph`, `makeEdge`, `PlanMissionFlow` (now renders only the real `missionGraph` from the artifact, honest empty `{nodes:[],edges:[]}` otherwise), `TaskNodeInspector` real `planFlowTaskObjects` fields.

Neutral home for the only escaping data shapes: `client/src/components/builder/deckContinuityTypes.ts` holds `PlanItem` + `LinkRef` (no planning semantics, no Mag One).

Must never be reintroduced: any `structuredPlan` → task-card projection, any Go/Run gate threaded into the canvas/inspector, any backend/client deterministic conversion of plan prose into nodes.

@proof id=planflow-no-deterministic-projection.removed-audit rg -c "buildStructuredAssistPlanSurface|buildPlanMissionGraph|StructuredAssistPlanSurface|PlanFlowGoGateState|onTaskGoGate|EMPTY_PLANFLOW" client/src apps/backend/src  → zero
@proof id=planflow-no-deterministic-projection.compile backend `tsc -p apps/backend/tsconfig.app.json --noEmit` = 0; client `tsc -p client/tsconfig.app.json --noEmit` = 4 pre-existing unrelated errors (xyflow typing ×2, tsconfig-include, pre-existing `PlanMissionNodeData.title`)
@proof id=planflow-no-deterministic-projection.tests client `deckRuntime.spec.ts` 20/20, backend `src/decks/` 4/4
