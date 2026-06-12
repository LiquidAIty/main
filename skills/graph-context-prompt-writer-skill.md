# Skill: Graph Context Prompt Writer

@skill id=graph-context-prompt-writer
@type Skill
@status learning
@applies_to specs/graph-context-prompt-writer-spec.md
@related_to skill-packet-fable-handoff
@related_to codegraph-context-reader
@related_to thinkgraph-planning-memory
@requires codebasedmemory
@requires skill-packet-fable-handoff
@requires codegraph-context-reader
@requires fresh_cbm_index

## Vector Summary

Treat prompt writing as a product surface: compose bounded Fable/Codex handoffs from graph-backed
packets — Skill Memory, Code Evidence, later ThinkGraph and KnowGraph — in a standardized anatomy
(Purpose, Task, Context, Effort, Boundaries, Verification Rules, Stop Conditions, Output Format)
that the UI can eventually show and edit before execution.

## Use When

Use when generating or changing the Fable handoff renderer, adding a new packet type to the
handoff, mapping handoff sections to the standardized anatomy, or planning the UI prompt-writer
surface.

## Current Known Shape

Direct-read evidence (2026-06-12):

* `services/knowgraph/skill_ingest.py` implements the working MVP: `handoff` renders five
  deterministic sections — Task Prompt, Source Spec, Skill Memory Packet, Code Evidence Packet,
  Required Behavior — with loud packet validation and an explicit placeholder when code evidence
  is absent.
* 52 tests cover retrieval, packet, and handoff behavior in
  `services/knowgraph/test_skill_retrieve.py` and `test_skill_ingest.py`.
* The anatomy mapping (five sections into eight anatomy slots) is defined in
  `specs/graph-context-prompt-writer-spec.md`.

## Guardrails

@guardrail id=graph-context-prompt-writer.deterministic-writer
@guardrail id=graph-context-prompt-writer.compose-not-merge
@guardrail id=graph-context-prompt-writer.no-rewrite-working-renderer

* The writer stays deterministic; no LLM-rewritten handoffs until a spec changes that.
* The writer composes validated packets; it never merges graph storage or couples to raw
  databases.
* Extend the working five-section renderer when a bounded pass needs a missing anatomy slot; do
  not rewrite it to chase the anatomy.
* Every packet type joins through its own validated contract, mirroring the Code Evidence
  Packet pattern.

## Rejected Paths

@decision id=graph-context-prompt-writer.reject-llm-handoff-generation
@because handoffs must be replayable, auditable, and free of invented context
@rejected generating or rewriting handoffs with an LLM in the MVP
@use_instead deterministic section rendering from validated graph packets
@proved_by the deterministic build_fable_prompt implementation and its determinism tests

@decision id=graph-context-prompt-writer.reject-anatomy-rewrite
@because the five-section renderer is proven by tests and live runs
@rejected rewriting the renderer into the eight-slot anatomy now
@use_instead the documented mapping table; grow slots in bounded passes
@proved_by specs/graph-context-prompt-writer-spec.md mapping section

## Query Patterns

@query id=graph-context-prompt-writer.render "py -3.12 services/knowgraph/skill_ingest.py handoff --prompt <task> --spec <spec> --code-evidence <packet.json>"
@query id=graph-context-prompt-writer.code-evidence "refresh CBM, then search_graph for build_fable_prompt handoff_command load_code_evidence and direct-read services/knowgraph/skill_ingest.py before changes"

## Proof Requirements

* Fresh CBM before and after any renderer change.
* `py -3.12 -m unittest discover -s services/knowgraph -p "test_skill*.py" -v` passes.
* Determinism proof: identical inputs render byte-identical handoffs.
* New packet types prove loud validation of malformed input before merging into the handoff.

## Future Edit Procedure

1. Retrieve `specs/graph-context-prompt-writer-spec.md` and this skill.
2. Build the handoff for the change itself (dogfood the writer).
3. Extend the renderer in a bounded pass; keep existing sections stable.
4. Write `@attempt_result` back here; re-ingest skills.

## Active Attempt

@attempt id=graph-context-prompt-writer.seed-001
@status active
@source_spec specs/graph-context-prompt-writer-spec.md
@source_prompt "seed the prompt writer skill so handoff generation is treated as a core product surface"
@requires_fresh_cbm true

Bounded scope: seed pass only — spec plus this skill stub. No renderer changes.

@attempt_result id=graph-context-prompt-writer.seed-001
@status succeeded
@cbm_after nodes=5289 edges=9506
@proved_by spec created with input/output contract, eight-slot anatomy, and the mapping from the tested five-section renderer
@validated_by direct read of services/knowgraph/skill_ingest.py handoff implementation during the seed pass
@touches_code services/knowgraph/skill_ingest.py

Seed result: prompt writer specified as a product surface; working renderer documented as the
MVP; no code changed.

## Successful Examples

None yet; seed pass only.

## Failed Attempts And Guardrails

No renderer change attempts have been made through this skill yet.
