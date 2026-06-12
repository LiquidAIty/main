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

Reuse the deterministic packet-composition evidence to support a planner-initiated Context Packet
and one active CoderPacket/spec-as-prompt; do not turn prompt authoring into the user workflow.

## Use When

Use when reusing or changing deterministic packet composition for Context Packet or CoderPacket
generation.

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
* Product-law transition: the renderer is useful source evidence, but the active product contract
  is one reviewable CoderPacket/spec-as-prompt created from a Context Packet.

## Guardrails

@guardrail id=graph-context-prompt-writer.deterministic-writer
@guardrail id=graph-context-prompt-writer.compose-not-merge
@guardrail id=graph-context-prompt-writer.no-rewrite-working-renderer
@guardrail id=graph-context-prompt-writer.ui-export-real-data-only
@guardrail id=graph-context-prompt-writer.user-does-not-prompt-a-prompt

* The writer stays deterministic; no LLM-rewritten handoffs until a spec changes that.
* The writer composes validated packets; it never merges graph storage or couples to raw
  databases.
* Extend the working five-section renderer when a bounded pass needs a missing anatomy slot; do
  not rewrite it to chase the anatomy.
* Every packet type joins through its own validated contract, mirroring the Code Evidence
  Packet pattern.
* UI copy/export remains deferred and may not manufacture planner, MissionSpec, ThinkGraph, or
  runtime-success state.
* Do not make prompt-template authoring the user-facing product loop.

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

## UI Export Deferral Attempt

@attempt id=graph-context-prompt-writer.deferred-after-real-planflow
@status active
@source_spec specs/graph-context-prompt-writer-spec.md
@source_prompt "remove the early deterministic deck-state prompt-maker interception so prompt/export cannot manufacture planner state"
@requires_fresh_cbm true

Bounded scope: remove the current client `/handoff` export path; retain the proven host-side
graph-packet handoff renderer; document that future UI copy/export is secondary and real-data-only.

## Real PlanFlow Deferral Attempt

@attempt id=graph-context-prompt-writer.deferred-until-planflow-real
@status active
@source_spec specs/graph-context-prompt-writer-spec.md
@source_prompt "keep prompt/export deferred while repairing PlanFlow provenance and markdown projection"
@requires_fresh_cbm true

Bounded scope: keep the removed early UI prompt/export interception removed; preserve the proven
host-side deterministic handoff renderer; document that future UI export consumes real
provenance-backed PlanFlow data and cannot manufacture planner state.

@attempt_result id=graph-context-prompt-writer.deferred-after-real-planflow
@status succeeded
@cbm_after nodes=4650 edges=8255
@proved_by the client handoff interception and coderHandoff module were removed while the host-side deterministic renderer was preserved
@validated_by exact audit found no production coderHandoff or planDraft mapping path
@touches_code client/src/pages/agentbuilder.tsx

@attempt_result id=graph-context-prompt-writer.deferred-until-planflow-real
@status succeeded
@cbm_after nodes=4650 edges=8255
@proved_by PlanFlow now consumes provenance-backed markdown and real trace proposals while UI prompt/export remains absent
@validated_by browser PlanFlow smoke and focused exact audit
@touches_code client/src/pages/agentbuilder.tsx

### Deferral Result

The early UI prompt/export interception remains removed. The proven host-side deterministic
renderer is unchanged. Future UI export is explicitly real-data-only and must consume
provenance-backed graph packets and PlanFlow state.

Reasoning receipt:

* chosen approach: preserve the working host renderer and defer UI export until its inputs are
  authoritative and inspectable.
* rejected alternatives: reintroducing `/handoff`, exporting deterministic deck summaries, or
  using copy/export as a hidden planner.
* guardrail created: UI export cannot manufacture planning or runtime state.
* retry direction: add UI export only after the true proposal/approval flow exists.

## Successful Examples

PlanFlow deferral repair (2026-06-12): host renderer preserved; fake client export path removed;
future UI export constrained to real provenance-backed data.

## Failed Attempts And Guardrails

No renderer change attempts have been made through this skill yet.
