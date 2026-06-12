# Skill: Context Packet

@skill id=context-packet
@type Skill
@status active
@related_to spec-as-prompt
@related_to codebase-memory-indexing
@related_to skillgraph-neo4j-indexing
@requires fresh_cbm_index

## Vector Summary

Assemble project context initiated by Magentic-One/Sol before creating the next bounded
CoderPacket.

## Procedure

1. Start from user input, current PlanFlow state, and `PLAN.md`.
2. Read ThinkGraph reasoning, events, proof, and blockers.
3. Refresh CBM/CodeGraph and attach bounded code anchors.
4. Retrieve relevant SkillGraph/Neo4j memory.
5. Add KnowGraph research only when relevant.
6. Report missing or stale context as a blocker; never guess.

## Guardrails

@guardrail id=context-packet.planner-initiated
@guardrail id=context-packet.fresh-code-required
@guardrail id=context-packet.no-invented-context

## Query Patterns

@query id=context-packet.assemble "read PLAN.md, query ThinkGraph, refresh CBM/CodeGraph, retrieve relevant SkillGraph/Neo4j skills, and add KnowGraph only when relevant"
