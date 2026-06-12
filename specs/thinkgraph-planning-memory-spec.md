# ThinkGraph Planning Memory Spec

> Transition policy: this is a legacy/source implementation document. Current product law lives
> in `PLAN.md`, `AGENTS.md`, and the active CoderPacket/spec-as-prompt.

## Current Product Boundary

ThinkGraph is structured reasoning and event memory for the active engineering loop.

ThinkGraph stores:

* why the living plan changed
* what context was used
* what CoderPacket/job was created
* what CoderReport the coder returned
* what matched, missed, or changed
* what proof exists
* what failed or is blocked
* what should happen next

ThinkGraph does not replace `PLAN.md`, SkillGraph, CodeGraph, or KnowGraph. It does not store fake
AI plans, invented reasoning, hidden success, or markdown sprawl.

## PlanFlow Boundary

PlanFlow is Magentic-One/Sol's visible thinking and control surface. It shows:

* the living plan
* one current active job
* the active CoderPacket/spec-as-prompt
* CoderReport comparison and run/report status
* blockers
* proof summary
* next step

PlanFlow is not a spec/document/skill library, markdown graph, road-sign display, deterministic
fake plan, or Run Preview. Supporting sources and evidence may be opened on demand, but PlanFlow
must not dump every source document onto the canvas.

## Context Packet

ThinkGraph contributes bounded reasoning, event, proof, and blocker context to the Context Packet
initiated by Magentic-One/Sol. The Context Packet also receives user input, current PlanFlow state,
`PLAN.md`, fresh CBM/CodeGraph evidence, relevant SkillGraph/Neo4j skills, and KnowGraph when
relevant.

## Existing Implementation Evidence

The current implementation already has useful transition rails:

* real `ThinkGraphEvent` storage and readback
* links between real events and PlanFlow-related identifiers
* loud failure for unsupported event types/status
* real run requested/completed/failed events
* a provenance-backed markdown projection

The markdown projection is implementation/source evidence during transition. It is not the final
PlanFlow product model and must not make PlanFlow a spec library.

## Runtime Boundary

PlanFlow and ThinkGraph do not execute work. Runtime results remain runtime evidence. Only a real
planner/model/orchestrator path may claim Magentic-One/Sol provenance. No fake final output,
provider/model fallback, or mocked success is allowed.

## Acceptance

* ThinkGraph stores real structured reasoning/events/proof/blockers only.
* PlanFlow centers the living plan and one active CoderPacket.
* CoderReport is compared against the active CoderPacket.
* Existing markdown/spec projection is treated as transition evidence, not product law.
* Skills remain in SkillGraph/Neo4j and code facts remain in CodeGraph/CBM.
