# Skill: Skill Packet Fable Handoff

@skill id=skill-packet-fable-handoff
@type Skill
@status learning
@applies_to specs/skill-packet-fable-handoff-spec.md
@related_to knowgraph-skill-retrieval
@related_to knowgraph-skill-ingestion
@related_to codebasedmemory
@requires knowgraph-skill-retrieval
@requires fresh_cbm_index
@requires neo4j_knowgraph

## Vector Summary

Wire deterministic KnowGraph skill packets into every Codex/Fable handoff: retrieve the packet
with the task prompt, embed it in the bounded Fable prompt with fixed obligations, and write
attempt results back to the skill file so re-ingestion makes the next task smarter.

## Use When

Use when preparing any real Fable implementation attempt, building the bounded attempt prompt, or
changing the handoff contract between scout/planner retrieval and Fable execution.

## Guardrails

@guardrail id=skill-packet-fable-handoff.packet-before-attempt
@guardrail id=skill-packet-fable-handoff.no-llm-packet
@guardrail id=skill-packet-fable-handoff.write-back-required

* No real Fable attempt starts without a Skill Memory Packet section.
* The packet comes from the deterministic retrieval command, never from an LLM.
* An empty packet triggers the new-skill rule instead of blocking the handoff.
* Fable must write `@attempt_result` back to the matching skill file and re-ingest.

## Current Procedure

Proven by attempt prepare-001:

1. Scout reads `AGENTS.md`, `PLAN.md`, and relevant specs, then refreshes or proves fresh CBM.
2. Scout renders the bounded Fable prompt with
   `py -3.12 services/knowgraph/skill_ingest.py handoff --prompt "<task>" [--spec <path>] [--limit 3]`,
   which retrieves the deterministic skill packet and emits, in order: Task Prompt, Source Spec,
   Skill Memory Packet (generating command plus packet JSON verbatim), and Required Behavior.
3. If the packet matched no skills, the Skill Memory Packet section carries the rule
   `No matching skill found; successful completion must create a new skill.` and the handoff
   proceeds (exit 0).
4. Fable executes under the Required Behavior obligations: fresh CBM, guardrails as hard
   constraints, no failed-attempt retries off the recorded direction, packet query patterns for
   fresh evidence, honest validations, attempt-result write-back to `skills/*.md`.
5. After closeout, re-ingest with
   `py -3.12 services/knowgraph/skill_ingest.py ingest --repo-root .` so the next task starts
   smarter.

## Active Attempt

@attempt id=skill-packet-fable-handoff.prepare-001
@status active
@source_spec specs/skill-packet-fable-handoff-spec.md
@source_prompt "wire packet output into the Codex/Fable handoff so every real implementation attempt starts with relevant skill memory"
@requires_fresh_cbm true

Bounded scope:

* define the handoff rule, loop, packet contract, and Fable prompt template in the spec
* implement the minimal `handoff` CLI subcommand that renders the Fable prompt from task prompt,
  optional spec path, and the live skill packet
* add tests; prove live output when Neo4j is available

@query id=skill-packet-fable-handoff.packet "py -3.12 services/knowgraph/skill_ingest.py packet --prompt <task> --limit 3 --json"
@query id=skill-packet-fable-handoff.render "py -3.12 services/knowgraph/skill_ingest.py handoff --prompt <task> --spec <spec-path> --limit 3"

@attempt_result id=skill-packet-fable-handoff.prepare-001
@status succeeded
@cbm_after nodes=5289 edges=9506
@proved_by 49 unit tests passed via py -3.12 -m unittest discover -s services/knowgraph -p test_skill*.py
@proved_by live handoff rendered Task Prompt, Source Spec, Skill Memory Packet, and Required Behavior sections with the live packet for "Neo4j skill ingestion guardrails"
@proved_by live handoff with an unmatchable prompt emitted the new-skill rule and exit 0
@validated_by py -3.12 -m unittest discover -s services/knowgraph -p "test_skill*.py" -v
@touches_code services/knowgraph/skill_ingest.py
@touches_code services/knowgraph/test_skill_retrieve.py

### Work Done

Created `specs/skill-packet-fable-handoff-spec.md` defining the handoff rule, the nine-step learn
loop, the packet JSON shape, and the Fable prompt contract. Added `build_fable_prompt()` and the
read-only `handoff` CLI subcommand to `services/knowgraph/skill_ingest.py`, reusing the existing
deterministic packet retrieval unchanged. Added one Skill Memory Packet input line to
`specs/code-task-packet.md`. Added five handoff tests plus CLI coverage to
`services/knowgraph/test_skill_retrieve.py`. Created this skill file.

### Proof

* `py -3.12 -m unittest discover -s services/knowgraph -p "test_skill*.py" -v`: 49 tests, OK.
* Live `handoff --prompt "Neo4j skill ingestion guardrails" --spec specs/knowgraph-skill-ingestion-spec.md`:
  365-line prompt with all four contract sections and the embedded live packet.
* Live `handoff` with an unmatchable prompt: new-skill rule emitted, exit 0.
* Ingest of this skill file: first run created 15 nodes / 18 relationships, second run 0 / 0.

### Actual Graph And Code Delta

Neo4j gained 15 nodes and 18 relationships for skill `skill-packet-fable-handoff` (skill, spec,
guardrails, attempt, query patterns, sections, RELATED_TO retrieval/ingestion/codebasedmemory).
Code delta: handoff helper and subcommand plus tests in `services/knowgraph/`, one new spec, one
input line in the CodeTaskPacket spec, this skill file. CBM after reads 5289 nodes / 9506 edges,
unchanged, because the CBM indexer only sees git-tracked files and committing is out of scope.

Reasoning receipt:

* chosen approach: a deterministic `handoff` renderer beside the existing retrieval commands,
  embedding the packet JSON verbatim with fixed Required Behavior obligations; spec documents the
  rule so scouts without the CLI can still follow the contract by hand.
* rejected alternatives: editing AGENTS.md/PLAN.md planner flow (redesign out of scope), changing
  the CodeTaskPacket schema, building an automatic re-ingest watcher, any LLM-generated packet.
* failed or blocked paths: none in this attempt.
* guardrails created: packet-before-attempt; no-llm-packet; write-back-required.
* retry direction: none needed; next is using the handoff output in a real scouted task.

Skill update:

* Current Procedure updated: yes
* Successful Example added: yes
* Failed Attempt added: no
* Query Pattern added: yes

## Successful Examples

Attempt prepare-001 (2026-06-12): live handoff for "Neo4j skill ingestion guardrails" embedded a
3-skill packet (ingestion 330, codebasedmemory, retrieval) under the four contract sections;
the unmatchable-prompt path emitted the new-skill rule without blocking. Retrieve current code
fresh via CBM query on `services/knowgraph/skill_ingest.py`; do not copy snippets from this file.

## Failed Attempts And Guardrails

No handoff implementation attempt has failed yet.
