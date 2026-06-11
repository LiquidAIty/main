# Spec 010: Research Agent + KnowGraph Ingestion

**Status**: Gated — do not implement until spec 009 T_approval passes (PlanFlow gate proven).
**Dependency**: Spec 009 complete (Research Pack exists, approval gate enforced).

---

## Purpose

After the user approves a Research Pack (spec 009), the Research Agent executes the swarm.
Each worker is an AutoGen agent that runs one ResearchQuestion's web search and returns
source-backed evidence objects. Evidence objects are ingested into KnowGraph (Neo4j) as
they arrive — not batched at the end.

KnowGraph is sourced evidence only. No provisional reasoning (that's ThinkGraph). KnowGraph
nodes carry citations, publication dates, confidence scores, and source URLs.

---

## Hard Boundaries

- Research Agent only runs after a valid `ResearchPack.approvedAt` is set.
- KnowGraph writes are sourced evidence only. No invented entities. No reasoning.
- `swarm_count` cap enforced server-side — do not trust frontend-submitted values above cap.
- Each evidence object must carry a source URL or be rejected at ingestion.
- Research Agent does NOT call Magentic-One and does NOT write to ThinkGraph.
- Progress is visible to the user. No silent background execution.

---

## KnowGraph Neo4j Schema (draft)

Node labels: `KnowEntity`, `KnowClaim`, `KnowSource`
Edge types: `SOURCED_FROM`, `SUPPORTS`, `CONTRADICTS`, `WEAKENS`, `GAP`
Properties: `projectId`, `planId`, `questionId`, `sourceUrl`, `confidence`, `ingestedAt`

All `KnowClaim` nodes must have a `KnowSource` via `SOURCED_FROM`. Orphaned claims are
rejected at ingestion.

---

## Evidence Object Shape (draft)

```python
class EvidenceObject(BaseModel):
    questionId: str
    claim: str
    sourceUrl: str
    sourceTitle: str
    confidence: float  # 0.0–1.0
    ingestedAt: str
```

---

## Worker Progress

Frontend must show per-worker status:
- `running` — currently executing
- `done` — returned evidence
- `failed` — failed with error (surfaced, not silenced)

Countdown from `swarm_count` → 0 as workers complete.

---

## Acceptance Criteria (to be expanded in plan.md once spec 009 T_approval passes)

1. Research Agent spawns `swarm_count` workers from an approved Research Pack.
2. Each worker executes one ResearchQuestion and returns ≥1 evidence objects.
3. Evidence objects are ingested to KnowGraph in real time as they arrive.
4. All `KnowClaim` nodes have a `sourceUrl`.
5. Worker progress is surfaced to the frontend.
6. Research Agent rejects launch without `ResearchPack.approvedAt`.
7. `swarm_count` > server cap is rejected.

---

## Files Likely Touched (preliminary — subject to revision in plan.md)

- New: `apps/python-models/app/python_models/research_agent.py`
- New: `apps/python-models/app/python_models/knowgraph_ingestion.py`
- New: `apps/backend/src/connectors/knowgraph.ts`
- `apps/backend/src/routes/` — research execution endpoint
- `apps/python-models/app/python_models/orchestration_contracts.py` — EvidenceObject, ResearchSwarmConfig
- Frontend — worker status component, KnowGraph layer toggle

---

## Plan and Tasks

plan.md and tasks.md are written only after spec 009 T_approval passes.
