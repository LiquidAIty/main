# Skill: KnowGraph Skill Ingestion

@skill id=knowgraph-skill-ingestion
@type Skill
@status learning
@applies_to specs/knowgraph-skill-ingestion-spec.md
@requires fresh_cbm_index
@requires neo4j_knowgraph

## Vector Summary

Deterministically parse graphable Markdown skills and upsert their durable skill knowledge into
KnowGraph / Neo4j so planners and coders can query procedures, attempts, failures, guardrails,
proof, and current-code query patterns before work.

## Use When

Use when importing or querying repo-authored `skills/*.md` knowledge in KnowGraph, or when changing
the narrow Markdown-to-Neo4j skill ingestion contract.

## Guardrails

@guardrail id=knowgraph-skill-ingestion.no-llm-extraction
@guardrail id=knowgraph-skill-ingestion.no-silent-invalid-lines
@guardrail id=knowgraph-skill-ingestion.no-fake-neo4j-success
@guardrail id=knowgraph-skill-ingestion.no-copied-code-memory

* Do not send graphable skill Markdown through the LLM GraphRAG extraction pipeline.
* Do not invent missing IDs, labels, relationships, or defaults.
* Invalid graphable lines must fail loudly or be clearly reported.
* Neo4j unavailable or unauthorized must fail loudly.
* Re-ingestion must be idempotent.
* Store CodeGraph references and queries, not copied current-code examples.
* Do not add UI, ThinkGraph, Prisma, backend routes, or AutoGen runtime changes in the first
  implementation.

## Current Procedure

No proven ingestion procedure exists yet. The current evidence supports a deterministic host-Python
importer beside `services/knowgraph/app.py`, using the already declared Neo4j driver directly.

## Active Attempt

@attempt id=knowgraph-skill-ingestion.prepare-001
@status active
@source_spec specs/knowgraph-skill-ingestion-spec.md
@source_prompt "make skills exist in KnowGraph Neo4j so Codex/Fable can use skills before tasks"
@requires_fresh_cbm true

Codex interpretation:

The user wants skills and skill attempts to be KnowGraph-backed now, using graphable Markdown as
the authoring format and Neo4j as the queryable format. Codex has audited the current surfaces and
prepared a bounded Fable coding attempt.

CBM before:

* method: full repository index
* status: ready
* nodes: 5253
* edges: 9472

### Relevant Graph Nodes And Files

* `services/knowgraph/app.py`: host FastAPI KnowGraph entrypoint
* `services/knowgraph/ingest.py`: existing LLM GraphRAG ingest pipeline; rejected for deterministic
  skill records
* `services/knowgraph/neo4j_index.py`: direct Neo4j query precedent
* `services/knowgraph/requirements.txt`: existing `neo4j` dependency
* `apps/backend/src/routes/knowgraph.routes.ts`: existing project-scoped KnowGraph graph query
* `apps/backend/src/services/graphContext/graphContextBuilder.ts`: KnowGraph context consumer
* `skills/codebasedmemory.md`: first real graphable skill fixture

Allowed scope:

* `services/knowgraph/skill_ingest.py`
* `services/knowgraph/test_skill_ingest.py`
* this skill file for Fable closeout only

Expected delta:

* PLAN says skills live in KnowGraph for now.
* The spec defines deterministic KnowGraph skill ingestion.
* This skill contains the active attempt.
* Fable has an exact bounded implementation target.
* No runtime code was changed by Codex.

Proof required:

* fresh CBM before and after
* direct-read evidence files
* deterministic parser tests
* idempotent upsert proof
* loud invalid-line and Neo4j failure proof
* real Neo4j ingest/list smoke if configuration is available
* no unrelated runtime code changes

## Reasoning Receipt

@decision id=knowgraph-skill-ingestion.use-deterministic-host-python-importer
@because graphable Markdown already declares exact entities and relationships and should not be reinterpreted by an LLM
@rejected existing services/knowgraph/ingest.py GraphRAG extraction path
@use_instead services/knowgraph/skill_ingest.py with direct Neo4j upserts
@proved_by existing neo4j dependency and direct query patterns in services/knowgraph/neo4j_index.py
@guardrail do not turn deterministic skill metadata into probabilistic LLM extraction

Chosen approach:

* Add a standalone host-Python importer and CLI beside the existing KnowGraph service.
* Parse only explicit optional frontmatter and supported graphable `@` lines.
* Upsert with stable IDs and source-file provenance.
* Provide a minimal CLI list/filter query.

Rejected alternatives:

* Existing GraphRAG ingestion: it requires model and embedding configuration and can reinterpret
  deterministic metadata.
* Backend route first: it adds an unnecessary cross-service API before the importer contract is
  proven.
* UI or ThinkGraph integration: explicitly deferred.

Blocked or uncertain paths:

* Real Neo4j authentication and selected database are not proven in this preparation pass.
* Repo-wide planner consumption of indexed skills is a later task.

Query-ready evidence:

@query id=knowgraph-skill-ingestion.current-code "refresh CBM, resolve the KnowGraph importer and Neo4j query symbols, then direct-read current source"
@query id=knowgraph-skill-ingestion.list-skills "MATCH (s:Skill) RETURN s ORDER BY s.id"

## Fable Implementation Attempt

This is the bounded task Fable should execute next.

Fable goal:

Implement the smallest useful deterministic KnowGraph skill ingestion and listing path.

Fable must:

1. Read `AGENTS.md`.
2. Read `PLAN.md`.
3. Read `specs/knowgraph-skill-ingestion-spec.md`.
4. Read `skills/codebasedmemory.md`.
5. Read this skill.
6. Refresh or prove fresh CBM.
7. Direct-read the exact allowed implementation files and current Neo4j precedents.
8. Create only `services/knowgraph/skill_ingest.py` and
   `services/knowgraph/test_skill_ingest.py`.
9. Implement the deterministic parser, idempotent Neo4j upsert, and minimal list/filter CLI.
10. Run focused unit proof.
11. Run real Neo4j ingest, second-ingest idempotency, and list smoke when configuration is
    available. Report the exact blocker otherwise.
12. Refresh CBM and update this attempt with result and proof.
13. Stop.

Fable allowed implementation scope:

* `services/knowgraph/skill_ingest.py`
* `services/knowgraph/test_skill_ingest.py`
* `skills/knowgraph-skill-ingestion-skill.md` for closeout only

Fable not allowed:

* no UI
* no ThinkGraph
* no backend routes
* no GraphRAG or LLM extraction for skill Markdown
* no broad graph rewrite
* no Prisma
* no env edits
* no fake Neo4j success
* no swallowed Neo4j unavailable or unauthorized errors
* no AutoGen runtime changes
* no dependency edits unless a directly proven blocker is reported before broadening

Fable proof required:

```powershell
python -m unittest discover -s services/knowgraph -p "test_skill_ingest.py" -v
python services/knowgraph/skill_ingest.py ingest --repo-root .
python services/knowgraph/skill_ingest.py ingest --repo-root .
python services/knowgraph/skill_ingest.py list --skill-id codebasedmemory
```

Unit tests must prove:

* `skills/codebasedmemory.md`-shaped content parses.
* Optional frontmatter parses.
* Supported graphable lines create expected records and relationships.
* Missing skill ID fails.
* Malformed or unsupported graphable lines fail or are explicitly reported.
* Stable IDs produce idempotent Cypher parameters or equivalent upsert operations.
* Neo4j errors are propagated and produce non-zero CLI status.

Fable closeout:

@attempt_result id=knowgraph-skill-ingestion.prepare-001
@status succeeded|failed|blocked
@cbm_after nodes=<count> edges=<count>

### Work Done

Pending Fable.

### Proof

Pending Fable.

### Actual Graph And Code Delta

Pending Fable.

Reasoning receipt:

* chosen approach:
* rejected alternatives:
* failed or blocked paths:
* guardrails created:
* retry direction:

Skill update:

* Current Procedure updated: no
* Successful Example added: no
* Failed Attempt added: no
* Query Pattern added: yes

## Codex Preparation Result

@decision id=knowgraph-skill-ingestion.preparation-ready-for-fable
@because current repo evidence supports a bounded deterministic importer beside the host KnowGraph service
@rejected backend route, UI, ThinkGraph, and LLM GraphRAG ingestion in the first implementation
@use_instead the exact Fable implementation scope in this skill
@proved_by fresh CBM after at 5289 nodes and 9506 edges plus direct reads of KnowGraph and Neo4j surfaces
@guardrail stop before implementation in the Codex preparation pass

* Codex preparation status: complete
* CBM after method: full repository index
* CBM after status: ready
* CBM after nodes: 5289
* CBM after edges: 9506
* Runtime code changed by Codex: no
* Fable implementation started: no

## Successful Examples

None yet.

## Failed Attempts And Guardrails

No implementation attempts have completed or failed yet.
