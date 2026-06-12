# KnowGraph Skill Ingestion Spec

## Purpose

Make graphable Markdown skill files queryable through KnowGraph / Neo4j so Codex and Fable can find
skills, guardrails, failed attempts, proof claims, validations, and query patterns before doing
code work.

## Decision

Skills belong in KnowGraph for now. ThinkGraph is not required for this first implementation.
Markdown remains the authoring format. Neo4j / KnowGraph becomes the queryable operating format.

This first implementation is a deterministic host-source importer. It must not send skill Markdown
through the existing LLM GraphRAG extraction pipeline.

## Source Files

* `skills/*.md`
* `specs/*.md`
* `PLAN.md`

The minimum implementation ingests `skills/*.md`. Specs and PLAN are graph targets referenced by
skill metadata, not separate ingestion inputs yet.

## Core Labels

* `Skill`
* `SkillAttempt`
* `FailedAttempt`
* `Guardrail`
* `Decision`
* `ReasoningReceipt`
* `ProofClaim`
* `Validation`
* `QueryPattern`
* `Spec`
* `PlanSection`
* `CodeGraphReference`

## Core Relationships

* `Skill APPLIES_TO Spec`
* `Skill HAS_ATTEMPT SkillAttempt`
* `Skill HAS_FAILED_ATTEMPT FailedAttempt`
* `Skill HAS_GUARDRAIL Guardrail`
* `Skill HAS_DECISION Decision`
* `Skill HAS_QUERY QueryPattern`
* `SkillAttempt CAME_FROM_PROMPT Prompt`
* `SkillAttempt USED_SPEC Spec`
* `SkillAttempt TOUCHED_CODE CodeGraphReference`
* `SkillAttempt PROVED ProofClaim`
* `SkillAttempt VALIDATED_BY Validation`
* `FailedAttempt FAILED_BECAUSE ReasoningReceipt`
* `FailedAttempt CREATED_GUARDRAIL Guardrail`
* `QueryPattern RETURNS CodeGraphReference`
* `Skill RELATED_TO Skill`

## Graphable Markdown Import Format

The importer accepts optional frontmatter for basic metadata and graphable lines beginning with:

* `@skill`
* `@attempt`
* `@example`
* `@failed_attempt`
* `@guardrail`
* `@decision`
* `@because`
* `@rejected`
* `@use_instead`
* `@proved`
* `@proved_by`
* `@validated_by`
* `@query`

Prose sections remain available for later vector search. Unknown or malformed graphable lines must
fail loudly or appear in a clear error report. The importer must not silently invent nodes,
relationships, IDs, or defaults.

## Reasoning Receipt

Decision-grade reasoning uses:

```text
@decision id=<id>
@because <why>
@rejected <alternative>
@use_instead <chosen path>
@proved_by <proof>
@guardrail <avoid repeating nonsense>
```

Reasoning records why an approach was chosen, rejected alternatives, failed or blocked paths,
resulting guardrails, believable proof, and the query that retrieves current evidence.

## Freshness

* Skill ingestion reads current Markdown files.
* Code examples are not stored as copied code.
* Current code snippets are retrieved fresh from CBM / CodeGraph by query.
* Fresh CBM remains required before code work.
* Re-ingesting unchanged skill IDs and graphable record IDs is idempotent.

## Current Repo Evidence

* `services/knowgraph/app.py` is the host Python KnowGraph API entrypoint.
* `services/knowgraph/ingest.py` owns the current LLM GraphRAG PDF, web, and code ingestion path.
* `services/knowgraph/neo4j_index.py` demonstrates direct Neo4j `Driver.execute_query` usage.
* `services/knowgraph/requirements.txt` already declares `neo4j`.
* `apps/backend/src/routes/knowgraph.routes.ts` reads project-scoped Neo4j records and exposes
  existing graph and expansion routes.
* `apps/backend/src/services/graphContext/graphContextBuilder.ts` consumes KnowGraph records for
  graph context.
* No current Markdown skill parser or skill ingestion test exists.

## Minimum Useful Implementation

Create a deterministic host-Python command that:

1. reads `skills/*.md` from an explicit repository root;
2. parses optional frontmatter and supported graphable `@` lines;
3. validates IDs and supported record types without fallback or invention;
4. upserts Skill-related nodes and relationships into Neo4j using stable IDs;
5. sets source-file provenance on every imported node;
6. supports listing indexed skills by ID, name, spec, or tag-like metadata;
7. exits non-zero for invalid Markdown records, unavailable Neo4j, or unauthorized Neo4j;
8. reports inserted, updated, unchanged, and failed records honestly.

The first implementation is a CLI/service module beside the existing KnowGraph host service. It
does not add a backend route or UI.

## Fable Allowed Files

* `services/knowgraph/skill_ingest.py`
* `services/knowgraph/test_skill_ingest.py`
* `skills/knowgraph-skill-ingestion-skill.md` only for attempt closeout

Do not edit other files unless the implementation is blocked by a directly proven missing
dependency. Stop and report that blocker instead of broadening scope.

## Acceptance Criteria

* A skill Markdown file can be parsed and represented as Skill nodes and relationships.
* `skills/codebasedmemory.md` is the first fixture.
* Duplicate ingestion is idempotent.
* Invalid or unsupported graphable lines fail loudly or are clearly reported.
* Missing source skill ID fails loudly.
* Neo4j unavailable or unauthorized fails loudly and returns a non-zero process status.
* A CLI query can at least list indexed skills and filter by ID, spec, or text metadata.
* No LLM, provider, model, GraphRAG extraction, raw diff memory, or fake success is used.
* No UI, ThinkGraph, Prisma, backend route, AutoGen runtime, or unrelated code is changed.

## Validation

From repo root:

```powershell
python -m unittest discover -s services/knowgraph -p "test_skill_ingest.py" -v
```

With the real Neo4j configuration already present in the shell:

```powershell
python services/knowgraph/skill_ingest.py ingest --repo-root .
python services/knowgraph/skill_ingest.py ingest --repo-root .
python services/knowgraph/skill_ingest.py list --skill-id codebasedmemory
```

The second ingest must prove idempotency. The real ingest and list commands must fail loudly if
Neo4j is unavailable or unauthorized.

## Risks

* Neo4j authentication and database selection are environment-dependent and currently unproven in
  this planning pass.
* Graphable line grammar must remain intentionally narrow or malformed Markdown may become
  misleading graph data.
* Current backend KnowGraph reads are project-scoped; repo-authored skills need an explicit stable
  scope property that later consumers can query.

## Next Task

Fable implements only the minimum useful deterministic importer and listing query described here.
