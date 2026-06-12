# Skill: SkillGraph Neo4j Indexing

@skill id=skillgraph-neo4j-indexing
@type Skill
@status active
@related_to context-packet
@requires fresh_cbm_index

## Vector Summary

Keep reusable learning in `skills/*.md` and retrieve it through SkillGraph / Neo4j before planning
or coding.

## Procedure

1. Search skills by task meaning, current plan, subsystem, CBM nodes, and guardrails.
2. Retrieve procedures, proof rules, failures, and reusable lessons.
3. Use relevant skills in the Context Packet and CoderPacket.
4. Update skills only when learning is reusable.
5. Re-ingest skills and prove retrieval after changes.

## Guardrails

@guardrail id=skillgraph-neo4j-indexing.skills-not-planflow-nodes
@guardrail id=skillgraph-neo4j-indexing.reusable-learning-only
@guardrail id=skillgraph-neo4j-indexing.no-fake-ingestion-success

## Query Patterns

@query id=skillgraph-neo4j-indexing.ingest "py -3.12 services/knowgraph/skill_ingest.py ingest --repo-root ."
@query id=skillgraph-neo4j-indexing.packet "py -3.12 services/knowgraph/skill_ingest.py packet --prompt <task> --limit 5 --json"
