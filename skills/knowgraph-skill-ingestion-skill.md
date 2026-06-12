# Skill: SkillGraph Ingestion

@skill id=knowgraph-skill-ingestion
@type Skill
@status active
@related_to skillgraph-neo4j-indexing
@requires fresh_cbm_index

## Vector Summary

Parse and ingest reusable `skills/*.md` learning into Neo4j/SkillGraph without inventing success.

## Procedure

1. Direct-read changed skill files.
2. Run ingestion dry-run and resolve parse errors.
3. Run focused skill-ingestion tests.
4. Replace the importer-owned SkillGraph projection and ingest current skills into Neo4j.
5. Prove retrieval of changed skills.
6. Report created relationships, warnings, and blockers honestly.

## Guardrails

@guardrail id=knowgraph-skill-ingestion.reusable-learning-only
@guardrail id=knowgraph-skill-ingestion.no-fake-ingestion-success
@guardrail id=knowgraph-skill-ingestion.no-spec-or-task-nodes
@guardrail id=knowgraph-skill-ingestion.no-stale-importer-owned-memory

## Query Patterns

@query id=knowgraph-skill-ingestion.dry-run "py -3.12 services/knowgraph/skill_ingest.py ingest --repo-root . --dry-run"
@query id=knowgraph-skill-ingestion.ingest "py -3.12 services/knowgraph/skill_ingest.py ingest --repo-root ."
