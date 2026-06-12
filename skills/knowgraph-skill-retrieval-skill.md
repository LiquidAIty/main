# Skill: SkillGraph Retrieval

@skill id=knowgraph-skill-retrieval
@type Skill
@status active
@related_to skillgraph-neo4j-indexing
@requires fresh_cbm_index

## Vector Summary

Retrieve relevant reusable learning from Neo4j/SkillGraph for Context Packet and active CoderPacket
creation.

## Procedure

1. Ensure current skills are ingested.
2. Match skills using user intent, current `PLAN.md`, active prompt, subsystem, CBM nodes, and
   guardrails.
3. Retrieve relevant procedures, failures, proof rules, and query patterns.
4. Feed relevant learning into the Context Packet.
5. Keep retrieval bounded and report warnings honestly.

## Guardrails

@guardrail id=knowgraph-skill-retrieval.no-spec-or-task-dependency
@guardrail id=knowgraph-skill-retrieval.no-invented-skill-memory
@guardrail id=knowgraph-skill-retrieval.bounded-results

## Query Patterns

@query id=knowgraph-skill-retrieval.get "py -3.12 services/knowgraph/skill_ingest.py get --skill-id <skill-id>"
@query id=knowgraph-skill-retrieval.match "py -3.12 services/knowgraph/skill_ingest.py match --prompt <text> --limit 5"
@query id=knowgraph-skill-retrieval.packet "py -3.12 services/knowgraph/skill_ingest.py packet --prompt <text> --limit 5 --json"

