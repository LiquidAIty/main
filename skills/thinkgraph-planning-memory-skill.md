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

* No ThinkGraph runtime code exists; implementation is intentionally deferred until the handoff
  loop proves itself on a real implementation attempt.
* `PLAN.md` is the human-readable route and remains so; the spec defines ThinkGraph as a
  queryable projection of that planning state, not a replacement.
* The packet contract (`source: "thinkgraph"`, current_route, active_decisions,
  deferred_decisions, assumptions, open_questions, next_task, why_now, warnings) is defined in
  `specs/thinkgraph-planning-memory-spec.md`.
* The handoff renderer (`services/knowgraph/skill_ingest.py`) already shows the embed pattern a
  future ThinkGraph packet should follow: validated JSON section via the prompt writer.

## Guardrails

@guardrail id=thinkgraph-planning-memory.not-skillgraph
@guardrail id=thinkgraph-planning-memory.defer-until-loop-proven
@guardrail id=thinkgraph-planning-memory.packets-not-databases

* Planning/reasoning state never goes into SkillGraph, CodeGraph, or KnowGraph; learned execution
  memory never goes into ThinkGraph.
* Do not implement ThinkGraph before the handoff loop proves itself on a real attempt.
* ThinkGraph joins handoffs only as a validated packet through the prompt writer; no physical
  graph merge, no direct database coupling.
* PLAN.md stays the human-readable route until a future spec changes that.

## Rejected Paths

@decision id=thinkgraph-planning-memory.reject-early-implementation
@because the skill/code packet loop must prove itself on a real attempt before adding a third graph
@rejected implementing ThinkGraph storage or packet builders in the seed pass
@use_instead spec-first boundary definition with a versioned packet contract
@proved_by PLAN.md deferred-work section and the absence of any ThinkGraph runtime code

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
* The first implementation must emit the exact versioned packet shape from the spec and validate
  it loudly at the renderer, mirroring the Code Evidence Packet pattern.
* Deterministic output; no LLM-generated planning state in the MVP.

## Future Edit Procedure

1. Confirm the handoff loop has completed one real end-to-end attempt first.
2. Retrieve `specs/thinkgraph-planning-memory-spec.md` and this skill.
3. Implement the smallest deterministic ThinkGraph Context Packet builder; embed via the prompt
   writer after the Code Evidence Packet.
4. Write `@attempt_result` back here; re-ingest skills.

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

## Successful Examples

None yet; seed pass only.

## Failed Attempts And Guardrails

No implementation attempts have been made through this skill yet.
