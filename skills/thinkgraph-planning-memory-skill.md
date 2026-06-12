# Skill: ThinkGraph Planning Memory

@skill id=thinkgraph-planning-memory
@type Skill
@status active
@related_to context-packet
@related_to spec-as-prompt
@requires fresh_cbm_index

## Vector Summary

Store structured reasoning and event memory for the living plan, active CoderPacket prompt,
CoderReport comparison, proof, blockers, and next step.

## Procedure

1. Read the living `PLAN.md`.
2. Retrieve real ThinkGraph events, decisions, blockers, proof, and prior report outcomes.
3. Feed relevant state into the Context Packet.
4. Record why the plan changed, what active prompt was created, what coder returned, what matched
   or missed, and what should happen next.
5. Keep reusable procedures in SkillGraph, code facts in CodeGraph, and research in KnowGraph.

## Guardrails

@guardrail id=thinkgraph-planning-memory.real-events-only
@guardrail id=thinkgraph-planning-memory.no-fake-planner-state
@guardrail id=thinkgraph-planning-memory.no-markdown-sprawl
@guardrail id=thinkgraph-planning-memory.no-spec-or-task-library

* PlanFlow is the visible active thinking/control surface, not a document map.
* AI planner claims require real planner/runtime provenance.
* ThinkGraph never manufactures success.

## Query Patterns

@query id=thinkgraph-planning-memory.current-state "read PLAN.md, retrieve real ThinkGraph events and blockers, and feed relevant state into the Context Packet"

