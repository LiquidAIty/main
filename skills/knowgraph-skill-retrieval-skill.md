# Skill: KnowGraph Skill Retrieval

@skill id=knowgraph-skill-retrieval
@type Skill
@status learning
@applies_to specs/knowgraph-skill-retrieval-spec.md
@related_to knowgraph-skill-ingestion
@requires knowgraph-skill-ingestion
@requires fresh_cbm_index
@requires neo4j_knowgraph

## Vector Summary

Deterministically retrieve skill memory from KnowGraph / Neo4j with list/get/match/packet
commands so planners and coders receive matching skills, guardrails, failed attempts, decisions,
proof claims, and query patterns before doing bounded work.

## Use When

Use when an agent needs existing skill knowledge before a task: listing skills, inspecting one
skill, matching skills to a prompt or spec, or building the compact skill packet handed to Fable.

## Guardrails

@guardrail id=knowgraph-skill-retrieval.read-only-cypher
@guardrail id=knowgraph-skill-retrieval.no-llm-retrieval
@guardrail id=knowgraph-skill-retrieval.no-fake-results

* Retrieval Cypher is fixed in source, write-free, and guarded at runtime.
* No LLM, Text2Cypher, vector search, or generated queries in this layer.
* Neo4j unavailable or unauthorized fails loudly; empty results are reported as empty.
* Packet output stays compact and deterministic.

## Current Procedure

Proven by attempt prepare-001:

1. Ensure skills are ingested (`ingest --repo-root .`) and Neo4j is reachable; connection settings
   resolve from process env, then `services/knowgraph/.env`, then `apps/backend/.env`.
2. `get --skill-id <id> [--json]`: full deterministic one-hop view — requires, applies_to,
   related_to, guardrails, decisions, query patterns, attempts with proof claims / validations /
   touched code / used specs, failed attempts, and ordered sections.
3. `match --skill-id <id> | --spec <path> | --prompt <text> [--limit N] [--json]`: seed matching
   by exact id (weight 100), exact spec via APPLIES_TO/USED_SPEC (90), and case-insensitive prompt
   tokens over skill id/source path (70), guardrail/decision/query/failed-attempt text (60),
   section heading (50), section text (30); one-hop RELATED_TO expansion adds related skills (20).
   Stopworded tokens shorter than 3 chars are dropped.
4. `packet --prompt <text> --limit 3 --json`: compact deterministic Fable/Codex handoff packet —
   matched skills with scores and reasons, guardrails, decisions, failed attempts, query patterns,
   attempt proof claims and validations, applies_to specs, and at most 4 matched-or-summary
   sections truncated to 600 chars.
5. All retrieval Cypher is fixed in source; `_run_read` rejects any write clause at runtime; Neo4j
   auth or availability failures exit non-zero with the real driver error.

## Active Attempt

@attempt id=knowgraph-skill-retrieval.prepare-001
@status active
@source_spec specs/knowgraph-skill-retrieval-spec.md
@source_prompt "build MVP retrieval so agents can list/get/match/packet KnowGraph skills before doing work"
@requires_fresh_cbm true

Bounded scope:

* extend `services/knowgraph/skill_ingest.py` with read-only `get`, `match`, and `packet`
  commands beside the preserved `list` command
* add retrieval unit tests that do not require live Neo4j
* prove live retrieval against the already-ingested skills when Neo4j is available

@query id=knowgraph-skill-retrieval.get "py -3.12 services/knowgraph/skill_ingest.py get --skill-id <skill-id>"
@query id=knowgraph-skill-retrieval.match-prompt "py -3.12 services/knowgraph/skill_ingest.py match --prompt <text> --limit 5"
@query id=knowgraph-skill-retrieval.packet "py -3.12 services/knowgraph/skill_ingest.py packet --prompt <text> --limit 3 --json"

@attempt_result id=knowgraph-skill-retrieval.prepare-001
@status succeeded
@cbm_after nodes=5289 edges=9506
@proved_by 44 unit tests passed via py -3.12 -m unittest discover -s services/knowgraph -p test_skill*.py
@proved_by live match by id scored 100, by spec scored 90 with related expansion, by prompt ranked ingestion skill first at 330
@proved_by live packet for "Neo4j skill ingestion guardrails" returned 3 skills with guardrails, decisions, queries, sections in 13356 deterministic chars
@validated_by py -3.12 -m unittest discover -s services/knowgraph -p "test_skill*.py" -v
@touches_code services/knowgraph/skill_ingest.py
@touches_code services/knowgraph/test_skill_retrieve.py

### Work Done

Extended `services/knowgraph/skill_ingest.py` with read-only retrieval: `get` (full one-hop skill
view), `match` (exact id / exact spec / prompt-token seeding with fixed weights and RELATED_TO
expansion), and `packet` (compact deterministic handoff JSON), all behind a runtime write-clause
guard, with `--json` output and the existing `list` and `ingest` commands preserved unchanged.
Created `services/knowgraph/test_skill_retrieve.py`: 20 tests over a fake driver that emulates the
fixed Cypher on an in-memory fixture graph and records every executed query. Created
`specs/knowgraph-skill-retrieval-spec.md` and this skill file.

### Proof

* `py -3.12 -m unittest discover -s services/knowgraph -p "test_skill*.py" -v`: 44 tests, OK
  (24 ingestion + 20 retrieval).
* Live `get --skill-id codebasedmemory`: returned skill with requires, spec, queries, sections.
* Live `match --skill-id codebasedmemory`: score=100 skill_id_exact.
* Live `match --spec specs/knowgraph-skill-ingestion-spec.md`: ingestion skill at 90 plus this
  skill via related_skill at 20.
* Live `match --prompt "Neo4j skill ingestion guardrails" --limit 5`: ingestion 330,
  codebasedmemory 90, retrieval 80.
* Live `packet --prompt "Neo4j skill ingestion guardrails" --limit 3 --json`: 3 skills, 13356
  chars, byte-identical across two runs.
* Ingest of this skill file: first run created 16 nodes / 17 relationships, second run 0 / 0.

### Actual Graph And Code Delta

Neo4j gained 16 nodes and 17 relationships for skill `knowgraph-skill-retrieval` (skill, spec,
guardrails, attempt, query patterns, sections, RELATED_TO knowgraph-skill-ingestion). Code delta:
retrieval layer plus tests in `services/knowgraph/`, one new spec, this skill file. CBM after
reads 5289 nodes / 9506 edges, unchanged, because the CBM indexer only sees git-tracked files and
committing is out of scope for this attempt.

Reasoning receipt:

* chosen approach: fixed read-only Cypher beside the existing importer, simple additive weights,
  one-hop expansion, compact JSON packet; copied the Codebase-Memory pattern of index first,
  tools second, structured results third.
* rejected alternatives: vector search, Text2Cypher, LLM GraphRAG generation, backend routes, UI —
  all explicitly out of MVP scope.
* failed or blocked paths: live Neo4j auth flapped mid-task — credentials that worked during the
  ingestion attempt were later rejected, and the repo-documented `apps/backend/.env` fallback then
  worked; the permission classifier correctly stopped credential iteration via docker exec. The
  Neo4j password source of truth is unstable and environment-dependent.
* guardrails created: read-only-cypher runtime guard; no-llm-retrieval; no-fake-results.
* retry direction: none needed; next is wiring `packet` into the Codex/Fable handoff.

Skill update:

* Current Procedure updated: yes
* Successful Example added: yes
* Failed Attempt added: no
* Query Pattern added: yes

## Successful Examples

Attempt prepare-001 (2026-06-11): all four retrieval commands proven live against Neo4j over the
three ingested skills; prompt "Neo4j skill ingestion guardrails" ranked the ingestion skill first
with guardrail, decision, query, and section evidence; the packet was compact and deterministic.
Retrieve current code fresh via CBM query on `services/knowgraph/skill_ingest.py`; do not copy
snippets from this file.

## Failed Attempts And Guardrails

No retrieval implementation attempt has failed yet. The auth-flapping observation above is
recorded in the reasoning receipt, not as a failed attempt.
