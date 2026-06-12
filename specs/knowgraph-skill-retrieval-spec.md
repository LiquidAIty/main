# KnowGraph Skill Retrieval Spec

## Purpose

Retrieve useful skill memory from KnowGraph before agents do work. Codex, Fable, and Sol ask what
skills exist, what one skill contains, what skills match a prompt or spec, which guardrails,
failed attempts, decisions, and query patterns apply, and what compact skill packet should be
handed to Fable before coding.

## Design Principle

Copy the Codebase-Memory pattern: index first, expose tools second, agents consume structured
results third. Retrieval is boring, deterministic, and read-only. No LLM is involved.

## MVP

* `list` / `get` / `match` / `packet` commands on `services/knowgraph/skill_ingest.py`
* exact skill-id lookup
* exact spec-path lookup via `APPLIES_TO` and attempt `USED_SPEC`
* simple case-insensitive token matching over Skill id/source path, SkillSection heading/text,
  Guardrail text, Decision text, QueryPattern text, and FailedAttempt text
* one-hop traversal around matched skills: `HAS_GUARDRAIL`, `HAS_FAILED_ATTEMPT`, `HAS_DECISION`,
  `HAS_QUERY`, `HAS_SECTION`, `APPLIES_TO`, `RELATED_TO`, `HAS_ATTEMPT`, and attempt-level
  `PROVED` / `VALIDATED_BY` / `TOUCHED_CODE`
* simple fixed ranking: exact skill id highest, exact spec high, guardrail/decision/query/failed
  attempt text medium, section heading medium, section text low, related skill low
* compact deterministic Fable/Codex handoff packet; `--json` output is machine-consumable

## Not Included Yet

* vector search
* LLM GraphRAG answer generation
* Text2Cypher
* UI
* backend route
* local model query generation

## Behavior Rules

* Retrieval Cypher is fixed in source and contains no write clauses; a runtime guard rejects any
  write keyword before execution.
* Neo4j unavailable or unauthorized fails loudly with a non-zero exit.
* Ranking and output ordering are deterministic for identical graph state and arguments.
* Packet output stays small by default: matched and summary sections only, truncated section text,
  capped list lengths.

## Acceptance

* can get `codebasedmemory` by id
* can match `knowgraph-skill-ingestion` by spec path
* can match prompt text like "Neo4j skill ingestion guardrails"
* can return a compact packet with guardrails, decisions, sections, and query patterns
* retrieval is read-only
* errors loudly if Neo4j credentials are wrong
* tests pass without a live Neo4j server

## Validation

```powershell
py -3.12 -m unittest discover -s services/knowgraph -p "test_skill*.py" -v
py -3.12 services/knowgraph/skill_ingest.py get --skill-id codebasedmemory
py -3.12 services/knowgraph/skill_ingest.py match --skill-id codebasedmemory
py -3.12 services/knowgraph/skill_ingest.py match --spec specs/knowgraph-skill-ingestion-spec.md
py -3.12 services/knowgraph/skill_ingest.py match --prompt "Neo4j skill ingestion guardrails" --limit 5
py -3.12 services/knowgraph/skill_ingest.py packet --prompt "Neo4j skill ingestion guardrails" --limit 3 --json
```

## Next Task

Wire `packet` output into the Codex/Fable handoff so every real implementation attempt starts with
relevant skills, guardrails, failed attempts, decisions, proof requirements, and query patterns.
