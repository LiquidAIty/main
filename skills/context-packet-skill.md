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

## Backend Planning Boundary

* Assemble Context Packet fields before invoking the planner model; the client must not construct a
  deterministic CoderPacket.
* Keep trusted `projectId`, `repoPath`, `PLAN.md` excerpt, code anchors, and CBM queries backend
  owned when validating planner output.
* Require explicit planner model configuration and schema-validated output. Missing configuration,
  missing anchors, or invalid output blocks loudly.
* Persist only summarized packet provenance and outcome reconciliation to ThinkGraph; do not copy
  huge prompts or raw coder output into planning memory.
* Query the configured Codebase Memory MCP from the backend. Carry the exact query, matching files
  and symbols, graph counts, freshness status, and blocker into the Context Packet.
* Treat only CBM-returned files as trusted code anchors. `PLAN.md` paths and selected-object paths
  may become query hints, but they are not proof that CodeGraph found those files.
* A stale, unavailable, or empty CBM result must remain visible in the CoderPacket and ThinkGraph;
  do not silently replace it with guessed anchors.
* Bound every Context Packet source independently and persist a diagnostic containing source,
  criticality, status, elapsed time, evidence count, and blocker. A critical timeout/failure
  blocks assembly. A non-critical timeout/failure may continue only when it is visible in Context
  Packet warnings and CoderPacket guardrails.
* A timeout race bounds the caller but does not cancel the underlying operation. Source adapters
  still need deterministic client/session cleanup, especially in one-shot smoke harnesses.
* In bounded Cypher retrieval, never order after `RETURN DISTINCT` by a graph variable that was
  projected away. Carry the graph variable and a timestamp alias through `WITH DISTINCT`, apply
  `ORDER BY` and `LIMIT` while both are in scope, then return the required fields. Prove the real
  query with a source-only diagnostic because copied query fixtures can miss scope failures.

## Guardrails

@guardrail id=context-packet.planner-initiated
@guardrail id=context-packet.fresh-code-required
@guardrail id=context-packet.no-invented-context

## Query Patterns

@query id=context-packet.assemble "read PLAN.md, query ThinkGraph, refresh CBM/CodeGraph, retrieve relevant SkillGraph/Neo4j skills, and add KnowGraph only when relevant"
