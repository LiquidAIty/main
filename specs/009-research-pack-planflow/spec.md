# Spec 009: Research Pack + PlanFlow Approval Gate

**Status**: Gated — do not implement until spec 008 T005 passes (ThinkGraph extraction proven).
**Dependency**: Spec 008 complete (ThinkGraph writes to Neo4j).

---

## Purpose

After ThinkGraph populates from a chat turn, a PlanFlow agent reads the ThinkGraph and builds
a Research Pack — a structured plan describing what to search, why, and how many parallel
research workers to spawn. PlanFlow does NOT run the research itself. It surfaces an editable
plan to the user and waits for manual approval before spawning any Research Agents.

The approval gate is non-negotiable. No research swarm runs without explicit user sign-off.

---

## Hard Boundaries

- PlanFlow reads ThinkGraph only. Does NOT read KnowGraph (spec 010).
- PlanFlow produces a Research Pack data structure. Does NOT execute searches.
- `swarm_count` is set by PlanFlow from ThinkGraph density, but the user can edit it.
- No research swarm without user approval. No auto-run. No silent fallback.
- PlanFlow must not invent research questions not derivable from ThinkGraph.

---

## Research Pack Shape (draft)

```typescript
interface ResearchPack {
  planId: string;
  projectId: string;
  turnId: string;
  questions: ResearchQuestion[];
  swarmCount: number;
  approvedAt?: string;    // null until user approves
}

interface ResearchQuestion {
  id: string;
  query: string;
  rationale: string;
  sourceThinkNodeId: string;
  priority: 'high' | 'medium' | 'low';
}
```

---

## User-Facing Approval Gate

The frontend must surface:
1. A Research Pack preview (editable `swarm_count`, editable question list)
2. An explicit "Approve and Run" button
3. No research runs until the button is clicked

Backend enforcement: the Research Agent start endpoint must reject requests without a
`ResearchPack.approvedAt` timestamp.

---

## Acceptance Criteria (to be expanded in plan.md once spec 008 T005 passes)

1. PlanFlow reads ThinkGraph nodes and builds a Research Pack for a given `turnId`.
2. Research Pack is persisted and surfaced to the frontend.
3. `swarm_count` reflects ThinkGraph open question density.
4. User can edit the plan before approval.
5. No Research Agent spawns without a valid `approvedAt` timestamp.
6. PlanFlow does not invent questions absent from ThinkGraph.

---

## Files Likely Touched (preliminary — subject to revision in plan.md)

- New: `apps/python-models/app/python_models/planflow_agent.py`
- New: `apps/backend/src/services/researchPack/researchPackService.ts`
- New: Postgres or Neo4j storage for `ResearchPack` (TBD in plan.md)
- `apps/backend/src/routes/` — new route for approval gate
- `apps/python-models/app/python_models/orchestration_contracts.py` — PlanFlow request/response types
- Frontend (canvas or sidebar component) — Research Pack preview and approval UI

---

## Plan and Tasks

plan.md and tasks.md are written only after spec 008 T005 passes.
