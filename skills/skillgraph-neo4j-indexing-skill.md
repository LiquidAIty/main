# Skill Index Recovery Reference

@skill id=skillgraph-neo4j-indexing
@type Skill
@status reference
@related_to skillgraph

Recovered from `2ddadeeb^` on September 9, 2026. The historical procedure indexed `skills/*.md`
in Neo4j using a now-retired importer and replaced its whole projection after edits. That is not
the current runtime and this recovered file does not authorize rebuilding or running it.

The reusable intent remains: help agents retrieve relevant, proven procedures, retain source
identity, and avoid stale copies. Current owners are repo skill files and native Hermes profile
skill/memory files. The Hermes SkillGraph/Learning Journey view projects native profile state;
it is not the removed repository Neo4j importer or a new knowledge store.

For current publishing and retrieval, use [knowgraph-skill-ingestion-skill.md](knowgraph-skill-ingestion-skill.md)
and [knowgraph-skill-retrieval-skill.md](knowgraph-skill-retrieval-skill.md). Neither requires an
index rebuild or data migration.

If the owner resumes the code-wiki/index idea, compare a bounded retrieval experiment against
the current file/profile path. Show which recurring lookup it improves, exact source/version
provenance, update ownership, relevance, latency and context size. Prove the consumer uses it;
an indexed node count is not benefit. Decide authority and migration explicitly before storage
changes. Preserve the historical design in Git rather than loading old commands into every agent.
