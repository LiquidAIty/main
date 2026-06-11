# Spec 012: First Real Research-Graph Loop

**Status**: Pending and gated. Implementation must not start until Spec 007 T005 passes.

**Depends on**: A real source-run AutoGen ReactFlow graph runtime smoke with real non-empty output.

**Does not replace**: The broader ThinkGraph, PlanFlow, Research Agent, KnowGraph, dual-context, UI, or trading work.

## Purpose

Prove the first honest downstream memory and research-planning loop from a real completed AutoGen deck run:

```text
real ReactFlow graph payload
-> real host-source backend and Python AutoGen runtime
-> GraphFlow execution inside ReactFlow constraints
-> MagenticOneGroupChat bus
-> real non-empty final output
-> completed chat/run pair
-> separate ThinkGraph extraction
-> project-scoped Apache AGE memory
-> read-only Research Pack candidate derived from real graph gaps
```

## Entry Gate

Spec 007 T005 must pass before any Spec 012 implementation begins. The proven run must:

- use the real backend route and real host-source Python sidecar
- return real non-empty Mag One final output
- preserve ReactFlow nodes, edges, edge relationships, and card settings in the run payload
- preserve explicit participant provider/model configuration
- execute ReactFlow-derived paths through the real AutoGen graph runtime
- produce a real completed chat/run pair suitable for downstream capture
- use no fake transcript, fake final output, mocked AutoGen success, Docker `python-models`, or Redis

`MissionSpec` plans inside ReactFlow graph constraints and does not own graph connections.

## Scope

- Capture a completed chat/run pair only after a verified real deck success with non-empty final output.
- Preserve project, deck, run, turn, source, graph-constraint, and card-setting provenance needed by the bounded loop.
- Trigger a separate strict Python ThinkGraph extraction pass from the completed pair.
- Validate extraction output before persistence.
- Persist only validated, project-scoped provisional ThinkGraph records to Apache AGE graph `graph_liq`.
- Derive a read-only Research Pack candidate only from persisted open questions, evidence gaps, or evidence-needed relationships.
- Expose honest downstream state and a read-only candidate retrieval route.
- Add an end-to-end smoke proving the complete bounded loop.

## Out of Scope

- Implementing or repairing the Spec 007 AutoGen runtime inside Spec 012.
- Full web research execution or Research Agent workers.
- PlanFlow approval UI or editable research plans.
- KnowGraph ingestion or sourced evidence writes.
- Graph context injection into later turns.
- Trading, broker integrations, orders, or portfolio automation.
- UI, Prisma, schema migration, Docker, or env-file changes.
- Heuristic extraction, fallback records, fake graph writes, sample output, or invented entities.

## Functional Requirements

- **FR-001**: Spec 012 work must remain pending until Spec 007 T005 proves the real source-run runtime.
- **FR-002**: Deck success remains defined by the verified real runtime result. Downstream work must never invent or rewrite deck truth.
- **FR-003**: A completed chat/run pair must preserve project, deck, run, turn, user text, real assistant text, source metadata, graph constraints, relevant card settings, and timestamps.
- **FR-004**: Failed or empty-output runs create no completed pair and trigger no extraction.
- **FR-005**: Repeated handling of the same successful run is idempotent.
- **FR-006**: ThinkGraph extraction is a separate strict downstream Python service or endpoint, not part of Mag One orchestration.
- **FR-007**: Extraction may return an honest empty record set and must not use heuristic/model fallback output.
- **FR-008**: Backend validation must run before any ThinkGraph write.
- **FR-009**: ThinkGraph records must be project-scoped, provenance-bearing, and idempotent in `graph_liq`.
- **FR-010**: Downstream status must distinguish pending, complete, empty, and failed without swallowing errors.
- **FR-011**: A Research Pack candidate must derive only from persisted real graph gaps and include source record IDs.
- **FR-012**: Candidate retrieval is project-scoped and read-only; it must not launch research.
- **FR-013**: No model, provider, graph record, research question, transcript, or output may come from a default, fallback, mock, or fake path.

## Guardrails

- No default model, fallback model, fallback provider, OpenAI fallback, OpenRouter fallback, `providerModelId="default"`, or optional participant model fields.
- No fake transcript, fake final output, mocked AutoGen success, fake graph writes, heuristic fallback extraction, or invented Research Pack questions.
- No Docker `python-models`, Redis for AutoGen, Microsoft Agent Framework, Semantic Kernel, AutoGen Studio, or RoundRobin/Selector/Ledger product runtime.
- No automatic research execution.
- No vendored/subrepo path may be used as active architecture truth.
- ThinkGraph extraction failure is an honest downstream failure and does not rewrite the verified deck result.

## Success Criteria

1. Spec 007 T005 passes first with real non-empty AutoGen output.
2. One real successful deck run produces one completed chat/run pair with full provenance.
3. A separate real Python extraction call returns strict output that passes backend validation.
4. Valid records are queryable from `graph_liq` only under the correct project.
5. A read-only route returns a Research Pack candidate derived from persisted real gaps.
6. Empty/minimal input produces honest empty/minimal output without invented content.
7. Failed extraction or persistence is surfaced as failed downstream status.
8. Automated contract tests and a real end-to-end smoke prove the bounded loop.
