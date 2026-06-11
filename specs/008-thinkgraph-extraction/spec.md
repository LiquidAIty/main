# Spec 008: ThinkGraph Extraction Agent

**Status**: Gated — do not implement until spec 007 T005 passes.
**Dependency**: Spec 007 complete (runtime contract proven end-to-end).

---

## Purpose

After a Magentic-One chat turn completes, a downstream async call runs a second AutoGen pass.
This pass reads the completed chat pair (user turn + assistant turn) and extracts ThinkGraph
entities, relationships, assumptions, risks, and open questions. These are persisted to Neo4j
and returned to the frontend as a graph update event.

ThinkGraph is provisional reasoning memory. It must not be confused with KnowGraph (sourced
evidence). Magentic-One does NOT extract ThinkGraph itself — this is a separate downstream agent.

---

## Hard Boundaries

- Magentic-One does NOT call the ThinkGraph agent. ThinkGraph runs after the chat turn.
- ThinkGraph stores provisional reasoning only. No sourced facts, no citations.
- No Research Agent. No KnowGraph writes. No PlanFlow.
- ThinkGraph extraction runs async and must not block deck run response delivery. Extraction failures are logged and surfaced; they do not fail the deck run.

---

## Acceptance Criteria (to be expanded in plan.md once spec 007 T005 passes)

1. A completed chat pair triggers a ThinkGraph extraction call.
2. Extraction returns entities[], relationships[], assumptions[], openQuestions[].
3. Results are written to Neo4j under the project's ThinkGraph layer.
4. Frontend receives a graph update event with new ThinkGraph nodes/edges.
5. Magentic-One chat is unaffected — ThinkGraph extraction is downstream and async.
6. Input: `test` → ThinkGraph stays empty or minimal. No invented entities.
7. Input: `I want to research ASTS vs RKLB` → ThinkGraph populates with entities and questions.

---

## Files Likely Touched (preliminary — subject to revision in plan.md)

- New: `apps/backend/src/services/thinkgraph/thinkgraphExtractionClient.ts`
- New: `apps/python-models/app/python_models/thinkgraph_agent.py`
- New route or hook in `apps/python-models/app/main.py`
- `apps/backend/src/connectors/neo4j.ts` or new ThinkGraph Neo4j sink
- `apps/backend/src/routes/decks.routes.ts` — trigger extraction after deck run completes
- `apps/python-models/app/python_models/orchestration_contracts.py` — add ThinkGraph extraction request/response types

---

## ThinkGraph Neo4j Schema (preliminary — to be defined in plan.md)

Node labels: `ThinkEntity`, `ThinkClaim`, `ThinkRisk`, `ThinkQuestion`
Edge types: `RELATES_TO`, `ASSUMES`, `CONTRADICTS`, `REQUIRES_EVIDENCE`
Properties: `projectId`, `turnId`, `provisional: true`, `createdAt`

---

## Plan and Tasks

plan.md and tasks.md are written only after spec 007 T005 passes.
