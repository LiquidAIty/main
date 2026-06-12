# Skill: ThinkGraph Planning Memory

@skill id=thinkgraph-planning-memory
@type Skill
@status learning
@applies_to specs/thinkgraph-planning-memory-spec.md
@related_to graph-context-prompt-writer
@related_to skill-packet-fable-handoff
@requires codebasedmemory
@requires skill-packet-fable-handoff
@requires codegraph-context-reader
@requires fresh_cbm_index

## Vector Summary

Keep project reasoning state — current route, active and deferred decisions, goals, assumptions,
open questions, next task, why-now — as a queryable ThinkGraph projection that feeds the prompt
writer, cleanly separated from SkillGraph learning memory, CodeGraph code facts, and KnowGraph
research.

## Use When

Use when implementing or changing the ThinkGraph Context Packet, deciding where planning or
reasoning state belongs, or wiring route/decision context into generated handoffs.

## Current Known Shape

Direct-read evidence (2026-06-12):

* `PLAN.md` is the durable living plan; the current CoderPacket/spec-as-prompt is the temporary
  active job contract.
* Existing markdown projection is useful transition evidence, but PlanFlow product law is the
  living plan, one active job, report/run status, blockers, proof, and next step, not a spec
  library.
* `thinkgraphMemory.ts` stores real `ThinkGraphEvent` nodes and links them to PlanFlow node IDs.
* A Magentic-One PlanFlow proposal is valid only when backed by a real runtime trace plan.
* The ThinkGraph packet reports linked PlanFlow nodes, recent events, decisions, assumptions,
  questions, last runs, next task, and warnings.

## Guardrails

@guardrail id=thinkgraph-planning-memory.not-skillgraph
@guardrail id=thinkgraph-planning-memory.packets-not-databases
@guardrail id=thinkgraph-planning-memory.markdown-projection-is-not-ai-plan
@guardrail id=thinkgraph-planning-memory.real-events-only
@guardrail id=thinkgraph-planning-memory.ai-source-requires-trace
@guardrail id=thinkgraph-planning-memory.planflow-not-document-library

* Planning/reasoning state never goes into SkillGraph, CodeGraph, or KnowGraph; learned execution
  memory never goes into ThinkGraph.
* ThinkGraph joins handoffs only as a validated packet through the prompt writer; no physical
  graph merge, no direct database coupling.
* PlanFlow must not present a spec/document/skill library as the product planning surface.
* ThinkGraph stores real events and links only; it never manufactures planner state or success.
* Any AI/planner source requires a real planner/runtime trace.
* Existing markdown projection is transition evidence, not the final PlanFlow product model.

## Rejected Paths

@decision id=thinkgraph-planning-memory.reject-synthesized-planner-state
@because planning authority and AI provenance must be backed by an authoritative document or real planner trace
@rejected deterministic client-generated plans, synthesized MissionSpec, and fake ThinkGraph success
@use_instead provenance-backed markdown projection, real trace proposals, and real ThinkGraph events
@proved_by PlanFlow projection tests, workspaceHarness refusal test, browser smoke, and live ThinkGraph event readback

@decision id=thinkgraph-planning-memory.reject-plan-md-replacement
@because humans still steer the route and Markdown remains the agent execution layer
@rejected replacing PLAN.md with a generated graph view now
@use_instead ThinkGraph as a queryable projection beside PLAN.md
@proved_by AGENTS.md documentation model and the spec's PLAN.md rule

## Query Patterns

@query id=thinkgraph-planning-memory.spec "direct-read specs/thinkgraph-planning-memory-spec.md and PLAN.md Current 11-Day Fast Build Route before any ThinkGraph claim"
@query id=thinkgraph-planning-memory.packet-shape "MATCH (s:Skill {id:'thinkgraph-planning-memory'})-[:HAS_SECTION]->(x:SkillSection) WHERE x.heading = 'Current Known Shape' RETURN x.text"

## Proof Requirements

* Fresh CBM before and after any future implementation attempt.
* The projection must emit provenance for every node and use only documented source classes.
* ThinkGraph must reject unsupported event types and invalid status values loudly.
* Deterministic markdown projection is allowed; deterministic AI/planner claims are forbidden.

## Future Edit Procedure

1. Retrieve `specs/thinkgraph-planning-memory-spec.md`, this skill, and fresh CBM.
2. Classify each proposed source as authoritative markdown, real planner proposal, real event, or
   forbidden synthesized state.
3. Preserve provenance and keep runtime status separate from planning authority.
4. Run projection, event-memory, route, and browser proof as appropriate.
5. Write `@attempt_result` back here; re-ingest skills.

## Active Attempt

@attempt id=thinkgraph-planning-memory.seed-001
@status active
@source_spec specs/thinkgraph-planning-memory-spec.md
@source_prompt "seed the ThinkGraph planning memory skill so the next graph after skill/code packets has a clean boundary"
@requires_fresh_cbm true

Bounded scope: seed pass only — spec plus this skill stub. No implementation.

@attempt_result id=thinkgraph-planning-memory.seed-001
@status succeeded
@cbm_after nodes=5289 edges=9506
@proved_by spec created with versioned packet contract and explicit non-overlap boundaries against SkillGraph, CodeGraph, and KnowGraph
@validated_by direct reads of PLAN.md and AGENTS.md documentation model during the seed pass

Seed result: boundary and packet contract specified; implementation correctly deferred.

## Corrective Run-Memory Attempt

@attempt id=thinkgraph-planning-memory.remove-fake-planflow
@status active
@source_spec specs/thinkgraph-planning-memory-spec.md
@source_prompt "remove deterministic client planner claims and ordinary run-state leakage from PlanFlow and ThinkGraph while preserving real runtime events"
@requires_fresh_cbm true

Bounded scope: replace fake plan/run naming in the minimal ThinkGraph write/read path with honest
run-event memory; prevent deterministic client run state from seeding ThinkGraph or PlanFlow;
leave full ontology and true planner generation deferred.

## PlanFlow Provenance Repair Attempt

@attempt id=thinkgraph-planning-memory.planflow-provenance-repair
@status active
@source_spec specs/thinkgraph-planning-memory-spec.md
@source_prompt "project authoritative PLAN.md/spec/task-ledger state into PlanFlow with provenance and connect only real events to ThinkGraph"
@requires_fresh_cbm true

Bounded scope: implement the smallest honest markdown-to-PlanFlow projection, expose it through
the existing Plan canvas, map only real Magentic-One trace plans with planner provenance, and
extend the minimal ThinkGraph rail to store real events linked to PlanFlow node ids.

@attempt_result id=thinkgraph-planning-memory.remove-fake-planflow
@status succeeded
@cbm_after nodes=4650 edges=8255
@proved_by deterministic client plan fallbacks, ordinary run-history promotion, prompt interception, and synthesized MissionSpec paths were removed or changed to fail/ask for provenance
@validated_by focused exact audit and workspaceHarness/PlanFlow adapter tests
@touches_code client/src/components/builder/workspaceHarness.ts
@touches_code client/src/components/builder/deckRunState.ts
@touches_code client/src/pages/agentbuilder.tsx

@attempt_result id=thinkgraph-planning-memory.planflow-provenance-repair
@status succeeded
@cbm_after nodes=4650 edges=8255
@proved_by real repository projection emitted 18 nodes and 17 edges using only plan_md, spec_md, and task_ledger sources with zero warnings
@proved_by live AGE route readback stored planflow_loaded_from_markdown and linked all 18 projected node IDs without fake planner data
@validated_by planFlowProjection.spec.ts, thinkgraphMemory.spec.ts, backend tsc, and browser smoke of the rendered 18-node PlanFlow canvas
@touches_code apps/backend/src/services/planflow/planFlowProjection.ts
@touches_code apps/backend/src/services/thinkgraph/thinkgraphMemory.ts
@touches_code apps/backend/src/routes/kg.routes.ts
@touches_code client/src/features/agentbuilder/plan/planFlowProjection.ts
@touches_code client/src/pages/agentbuilder.tsx

### Work Done

Implemented authoritative markdown-to-PlanFlow projection, a provenance-preserving client
adapter, and real-event ThinkGraph storage with PlanFlow links. Removed production paths that
promoted ordinary run state or deterministic client output into planning authority. MissionSpec
drafting now asks for explicit provenance instead of synthesizing a fake.

### Actual Graph And Code Delta

New backend PlanFlow projection service and tests; generalized ThinkGraph event service and tests;
new projection route and real deck-run events; new client adapter/types and PlanFlow canvas wiring;
fake client plan/handoff modules removed. Fresh CBM is ready at 4650/8255; its search still
returns deleted `coderHandoff.ts`, so direct reads and proof output remain authoritative for the
working tree.

Reasoning receipt:

* chosen approach: project markdown deterministically with explicit source/provenance, store only
  real events in ThinkGraph, and accept only real runtime trace plans as AI proposals.
* rejected alternatives: keeping Run Preview, inventing a PlanFlow fallback, promoting ordinary
  run history, or synthesizing MissionSpec/ThinkGraph success.
* guardrails created: markdown projection is not AI planning; AI source requires trace; ThinkGraph
  stores real events only.
* retry direction: implement a true proposal/approval flow from the approved planner path.

## Successful Examples

PlanFlow provenance repair (2026-06-12): authoritative markdown rendered as an 18-node canvas;
real ThinkGraph load event linked all projected nodes; no fake planner state was introduced.

## Failed Attempts And Guardrails

No failed implementation attempt in this repair.

## PlanFlow Readable Canvas Attempt

@attempt id=thinkgraph-planning-memory.planflow-readable-canvas
@status active
@source_spec specs/thinkgraph-planning-memory-spec.md
@source_prompt "make the provenance-backed PlanFlow canvas readable and navigable without changing planning or runtime behavior"
@requires_fresh_cbm true

Bounded scope: improve PlanFlow node cards, hierarchy/layout, view controls, explanatory UI, and
selected-node details. Preserve projection provenance, real-planner-only labeling, runtime
separation, and the no-preview rule.

@attempt_result id=thinkgraph-planning-memory.planflow-readable-canvas
@status succeeded
@cbm_after nodes=4650 edges=8255
@proved_by browser smoke rendered 18 hierarchy-laid-out nodes at about 161px screen width in the companion surface, showed the explanatory header, opened provenance details on click, reset the layout, and produced zero console errors
@proved_by focused adapter test verifies route above specs, specs distributed across columns, and tasks below specs
@validated_by npx vitest run client/src/features/agentbuilder/plan/planFlowProjection.spec.ts; browser smoke at http://127.0.0.1:5173
@touches_code client/src/components/assist/PlanMissionFlow.tsx
@touches_code client/src/features/agentbuilder/plan/planFlowProjection.ts
@touches_code client/src/pages/agentbuilder.tsx

### Work Done

Replaced the endlessly tall spec stack with a bounded route/spec/task/runtime/ThinkGraph
hierarchy, enlarged cards, added explicit type/status/source text, added a lane legend and
selected-node provenance/details panel, increased companion canvas height, versioned away stale
tiny saved views, and made the reset control restore the authored hierarchy before fitting.

### Proof

The focused PlanFlow adapter suite passes three tests, including the new hierarchy regression
test. Browser smoke proved 18 nodes, explanatory pending-planner text, visible reset control,
click-to-details with source path/provenance/status/links, readable card sizing, and zero console
errors. Full client TypeScript remains blocked by the pre-existing AgentBuilder type backlog.

### Actual Graph And Code Delta

Three client files changed plus this spec/skill write-back. No backend, runtime, sidecar,
ThinkGraph storage, provider/model, or ToolRegistry behavior changed. Fresh CBM remains ready at
4650 nodes / 8255 edges and reflects committed-state structure rather than the full working-tree
UI delta.

Reasoning receipt:

* chosen approach: bounded semantic lanes/grid plus larger cards and an in-canvas details panel;
  preserve compact map metadata and keep full documents at their source paths.
* rejected alternatives: dumping markdown onto nodes, fitting every node by shrinking below
  readability, broad theme redesign, or changing planning/runtime data.
* failed/blocked paths: screenshot capture timed out, so visual proof used live DOM measurements,
  interaction checks, and console logs; full client compile remains blocked by existing errors.
* guardrails created: overview fitting must prefer readable minimum zoom and modest panning over
  tiny cards; canvas nodes remain compact map/index entries.
* retry direction: none for this pass.

@query id=thinkgraph-planning-memory.planflow-readable-ui "refresh CBM, direct-read PlanMissionFlow and planFlowProjection adapter, then browser-smoke Plan view for hierarchy, reset control, node details, and console errors"
