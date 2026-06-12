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

Proven by attempt prepare-001:

1. Refresh or prove fresh CBM, then direct-read `services/knowgraph/skill_ingest.py` and the
   current `skills/*.md` files.
2. Run `python services/knowgraph/skill_ingest.py ingest --repo-root .` from the repo root.
   Connection settings resolve from the process environment first, then
   `services/knowgraph/.env`, then `apps/backend/.env` (read-only fallback).
3. The importer parses optional frontmatter and the narrow graphable line grammar, fails loudly on
   malformed important lines, warns explicitly on foreign graphable lines, and skips unfilled
   closeout template placeholders with a warning.
4. Canonical lane: deterministic MERGE upserts keyed on stable ids produce Skill, SkillAttempt,
   FailedAttempt, Guardrail, Decision, QueryPattern, Spec, ProofClaim, Validation,
   CodeGraphReference, and SkillSection nodes plus their relationships, each stamped with
   source="repo", source_path, skill_id, import_kind="skill_markdown".
5. Semantic lane integration point: prose sections become SkillSection nodes, and
   `build_semantic_documents()` returns payloads shaped for the existing GraphRAG
   `ingest_text_document` pipeline; the CLI never invokes that pipeline and the LLM lane is never
   the authority for canonical skill metadata.
6. Re-run the same ingest to prove idempotency (second run must create 0 nodes / 0 relationships).
7. Verify with `python services/knowgraph/skill_ingest.py list --skill-id <skill-id>`.

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
@status succeeded
@cbm_after nodes=5289 edges=9506
@proved_by 24 unit tests passed via python -m unittest discover -s services/knowgraph -p test_skill_ingest.py
@proved_by live Neo4j double ingest idempotent: first run created 57 nodes and 58 relationships, second run created 0 and 0
@proved_by list --skill-id codebasedmemory returned the indexed skill with spec, query, and section relationships
@validated_by python -m unittest discover -s services/knowgraph -p "test_skill_ingest.py" -v
@touches_code services/knowgraph/skill_ingest.py
@touches_code services/knowgraph/test_skill_ingest.py
@query id=knowgraph-skill-ingestion.cli-list "python services/knowgraph/skill_ingest.py list --skill-id <skill-id>"

### Work Done

Created `services/knowgraph/skill_ingest.py`: deterministic two-lane importer with `ingest` and
`list` CLI commands, narrow graphable line parser, stable-id MERGE upserts, loud Neo4j and parse
failures, explicit warnings for foreign graphable lines and unfilled closeout placeholders, and a
non-invoked `build_semantic_documents()` integration point for the existing GraphRAG lane.
Created `services/knowgraph/test_skill_ingest.py`: 24 unit tests covering parser, stable ids,
idempotent upsert plan against a fake MERGE-semantics driver, propagated Neo4j errors, non-zero
CLI exits, real repo skill files as fixtures, and semantic-lane payload shape. No other runtime
files were changed; no dependency files were edited (the already-declared `neo4j` wheel was
installed into the host Python used for the live proof).

### Proof

* `python -m unittest discover -s services/knowgraph -p "test_skill_ingest.py" -v`: 24 tests, OK.
* First live ingest: RESULT skills=2 nodes_created=57 relationships_created=58.
* Second live ingest: RESULT skills=2 nodes_created=0 relationships_created=0 (idempotent).
* `list --skill-id codebasedmemory`: returned skill with APPLIES_TO spec, 2 query patterns, and
  section nodes.
* Wrong credentials fail loudly: NEO4J_FAILURE AuthError Neo.ClientError.Security.Unauthorized,
  exit code 2.

### Actual Graph And Code Delta

Neo4j gained 57 nodes and 58 relationships across 2 skills: Skill, SkillAttempt, Guardrail,
Decision, QueryPattern, Spec, ProofClaim, Validation, CodeGraphReference, and SkillSection records
for `codebasedmemory` and `knowgraph-skill-ingestion`, all stamped source="repo",
import_kind="skill_markdown". Code delta: two new files under `services/knowgraph/`. CBM after
reads 5289 nodes / 9506 edges, unchanged from before, because the CBM indexer only sees
git-tracked files and committing was out of scope for this attempt.

Reasoning receipt:

* chosen approach: standalone deterministic host-Python CLI beside the existing KnowGraph service,
  direct `Driver.execute_query` MERGE upserts, env config resolved from process environment with
  read-only `.env` fallbacks, prose captured as SkillSection nodes plus a GraphRAG payload builder
  that the CLI never calls.
* rejected alternatives: routing skill Markdown through the LLM GraphRAG extraction pipeline
  (non-deterministic authority, needs LLM/embedding config); adding a backend route or UI;
  invoking `ingest_text_document` in this pass.
* failed or blocked paths: `apps/backend/.env` declares NEO4J_PASSWORD=changeme but the running
  Neo4j container was started with NEO4J_AUTH=neo4j/password, so the first live ingest failed
  loudly with AuthError; the live proof used corrected credentials via shell environment
  variables. New untracked files are invisible to the CBM indexer until committed.
* guardrails created: closeout template placeholders (values containing | or <>) are detected and
  skipped with explicit warnings so unfilled templates never become graph data.
* retry direction: none needed; next bounded task is skill retrieval/matching from prompt/spec
  context.

Skill update:

* Current Procedure updated: yes
* Successful Example added: yes
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

Attempt prepare-001 (2026-06-11): ingested `skills/codebasedmemory.md` and
`skills/knowgraph-skill-ingestion-skill.md` into live Neo4j; first run created 57 nodes / 58
relationships, second run created 0 / 0, and
`python services/knowgraph/skill_ingest.py list --skill-id codebasedmemory` returned the indexed
skill with its spec, query patterns, and prose sections. Retrieve current code fresh via CBM query
on `services/knowgraph/skill_ingest.py`; do not copy snippets from this file.

## Failed Attempts And Guardrails

No implementation attempts have completed or failed yet.
