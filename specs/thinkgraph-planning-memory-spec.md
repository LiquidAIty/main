# ThinkGraph Planning Memory Spec

## Purpose

Define ThinkGraph as the project reasoning / current-route graph that improves planning and
prompt writing. ThinkGraph is the next graph after the SkillGraph packet and Code Evidence Packet
handoff proved out.

## What ThinkGraph Is Not

* ThinkGraph is not SkillGraph: SkillGraph stores learned agent execution memory — attempts,
  failures, guardrails, decisions about how to do work, proof requirements, query patterns.
* ThinkGraph is not CodeGraph: CodeGraph/CBM stores current code facts.
* ThinkGraph is not KnowGraph: KnowGraph stores broader knowledge, research, and public imports.

## What ThinkGraph Stores

Project reasoning state:

* current route
* active decisions
* user goals
* why a path was chosen
* deferred choices
* plan dependencies
* next intended task
* assumptions
* open questions

## Role

* ThinkGraph feeds the prompt writer (`specs/graph-context-prompt-writer-spec.md`) so generated
  Fable/Codex handoffs carry the current route, active decisions, and why-now reasoning.
* ThinkGraph does not replace `PLAN.md` yet. `PLAN.md` remains the human-readable route;
  ThinkGraph is a queryable projection of planning/reasoning state.
* Implementation is deferred until the handoff loop proves itself on a real implementation
  attempt. Creating this spec now keeps the boundary clean so other passes do not absorb
  planning state into the wrong graph.

## ThinkGraph Context Packet

Later implementation should produce a ThinkGraph Context Packet for handoffs:

```json
{
  "packet_version": 1,
  "source": "thinkgraph",
  "current_route": [],
  "active_decisions": [],
  "deferred_decisions": [],
  "assumptions": [],
  "open_questions": [],
  "next_task": "",
  "why_now": "",
  "warnings": []
}
```

It joins the handoff after the Code Evidence Packet, through the prompt writer only.

## Clean Overlap

* SkillGraph: learned agent execution memory.
* ThinkGraph: project planning / current-route reasoning.
* CodeGraph/CBM: current code facts.
* KnowGraph: broader knowledge/research/imports.
* The prompt writer combines them; the graphs are not physically merged. Storage can differ
  underneath; agents consume packets and tools, not raw databases.

## MVP

* This spec exists now; no runtime code in this pass.
* First implementation target: a deterministic ThinkGraph Context Packet builder that reads
  planning state (initially projectable from `PLAN.md` and active specs) and emits the packet
  shape above for the prompt writer.

## Not Included Yet

* runtime implementation
* UI planning surface
* automatic PLAN.md generation
* merging with SkillGraph/KnowGraph storage

## Acceptance

* ThinkGraph's boundary against SkillGraph, CodeGraph, and KnowGraph is explicit.
* The packet shape is defined and versioned.
* PLAN.md remains the human-readable route until a future spec changes that.
