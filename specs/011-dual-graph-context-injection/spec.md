# Spec 011: Dual Graph Context Injection

**Status**: Gated — do not implement until spec 010 T_ingest passes (KnowGraph proven live).
**Dependency**: Spec 010 complete (KnowGraph ingestion working and queryable).

---

## Purpose

Once both ThinkGraph (provisional reasoning) and KnowGraph (sourced evidence) are populated for
a project, Magentic-One's next chat turn should answer from dual-graph context rather than a
blank slate. This spec wires the context injection: before a deck run, the backend queries Neo4j
for relevant ThinkGraph and KnowGraph nodes scoped to the project and recent turn history, and
injects a structured context block into the system prompt sent to Magentic-One.

The result: Magentic-One answers with awareness of prior reasoning and sourced evidence without
reading arbitrary graph topology itself.

---

## Hard Boundaries

- Graph context injection happens server-side. The frontend does not send graph data to Magentic-One.
- Injected context is scoped to the project. No cross-project graph leakage.
- ThinkGraph context = provisional only. Must be labeled as such in the prompt.
- KnowGraph context = sourced evidence only. Source URLs must be included.
- Context injection must not exceed the model's context window. Truncation is explicit, not silent.
- Magentic-One must not be asked to update the graphs directly. Graph writes remain downstream.
- Injection is skipped gracefully if both graphs are empty — no errors, no invented context.

---

## Injected Context Shape (draft)

```
--- Graph Context (provisional reasoning) ---
Entity: ASTS | claim: ... | confidence: low
Relationship: ASTS RELATES_TO RKLB | assumption: ...
Open question: What is ASTS's current debt load?

--- Graph Context (sourced evidence) ---
Claim: ASTS raised $750M in Q1 2026 | source: reuters.com/... | confidence: 0.85
Claim: RKLB market cap ... | source: ... | confidence: 0.91
```

---

## Context Retrieval Strategy (draft)

1. Query ThinkGraph for the most recent N turns' entities, relationships, open questions.
2. Query KnowGraph for claims with `confidence ≥ 0.7` that share entities with ThinkGraph.
3. Rank by relevance to current user input (keyword overlap or embedding similarity — TBD in plan.md).
4. Truncate to `MAX_CONTEXT_TOKENS` (configurable, default TBD).

---

## Acceptance Criteria (to be expanded in plan.md once spec 010 T_ingest passes)

1. A deck run triggered after ThinkGraph + KnowGraph are populated injects graph context into the system prompt.
2. Injected context contains at least one ThinkGraph entity and one KnowGraph claim for a known project.
3. Injected context is labeled (provisional vs. sourced) in the prompt.
4. Source URLs are included for all KnowGraph claims.
5. Injection is skipped (not erroring) when both graphs are empty.
6. Context does not exceed the `MAX_CONTEXT_TOKENS` cap.
7. Magentic-One response references injected context — demonstrates the injection is live.

---

## Files Likely Touched (preliminary — subject to revision in plan.md)

- New: `apps/backend/src/services/graphContext/graphContextBuilder.ts`
- `apps/backend/src/cards/runtime.ts` — inject context block into system prompt before payload build
- `apps/backend/src/connectors/neo4j.ts` — ThinkGraph + KnowGraph query helpers
- `apps/python-models/app/python_models/orchestration_contracts.py` — add `graphContext` field to `ContextPack`
- `apps/python-models/app/python_models/autogen_orchestrator.py` — surface `graphContext` into Magentic-One system prompt

---

## Shared Graph UI (frontend, preliminary)

The ReactFlow canvas should surface both graph layers:
- ThinkGraph: provisional nodes (grey/dashed, labeled "provisional")
- KnowGraph: sourced nodes (solid, confidence-colored)
- Active traversal highlight during deck run (if safe to implement without blocking)

Frontend is explicitly out of scope for spec 011 tasks — it can be added as spec 012 or a follow-up.

---

## Plan and Tasks

plan.md and tasks.md are written only after spec 010 T_ingest passes.
