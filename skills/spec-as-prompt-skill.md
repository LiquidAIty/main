# Skill: Spec As Prompt

@skill id=spec-as-prompt
@type Skill
@status active
@related_to context-packet
@related_to coder-report-protocol
@requires fresh_cbm_index

## Vector Summary

Use one temporary, reviewable CoderPacket as the active spec-as-prompt for a bounded part of
`PLAN.md`; do not create durable spec files for ordinary work.

## Procedure

1. Read `PLAN.md` and current PlanFlow state.
2. Pull a Context Packet with fresh CBM/code anchors and relevant skills.
3. Define one bounded active job with requirements, scope, proof, and stop conditions.
4. Let the user review or edit it.
5. Send it to a coder only after Go.
6. Compare the returned CoderReport against it.
7. Discard or archive the temporary job state; do not create `spec.md` by default.

## Guardrails

@guardrail id=spec-as-prompt.no-spec-sprawl
@guardrail id=spec-as-prompt.one-active-job
@guardrail id=spec-as-prompt.durable-spec-explicit-only

* Durable `spec.md` exists only by explicit user export/save or for a rare stable long-term
  contract.
* Existing `specs/*.md` are legacy/source documents during transition.
* PlanFlow may show one active CoderPacket, not a spec library.

## Query Patterns

@query id=spec-as-prompt.current-law "direct-read PLAN.md and AGENTS.md, then retrieve fresh CBM and relevant skills before creating one active CoderPacket"

## Documentation Refactor Attempt

@attempt id=spec-as-prompt.core-doc-model-refactor
@status active
@source_prompt "refactor core documentation around the living plan, Context Packet, one active CoderPacket, structured CoderReport, and no spec sprawl"
@requires_fresh_cbm true

@attempt_result id=spec-as-prompt.core-doc-model-refactor
@status succeeded
@cbm_after nodes=4650 edges=8255
@proved_by PLAN.md and AGENTS.md define spec-as-prompt/CoderPacket as default and durable spec files as explicit-only exceptions
@validated_by focused documentation audits and successful skill ingestion
@touches_code PLAN.md
@touches_code AGENTS.md

## Work Done

Replaced the old default-spec/task-file planning model with a living `PLAN.md`, one temporary
CoderPacket, structured CoderReport comparison, Context Packet pull, and explicit-only durable
spec policy.

## Actual Graph And Code Delta

Documentation and durable skills only; no implementation or runtime behavior changed. Fresh CBM
remains ready at 4650/8255.

Reasoning receipt:

* chosen approach: make `PLAN.md` and `AGENTS.md` the product/execution authority and use skills
  for reusable learning.
* rejected alternatives: deleting historical specs, creating a new feature spec, or implementing
  the active-job loop in a documentation pass.
* failed/blocked paths: none.
* guardrails created: one active job, no spec sprawl, durable specs explicit-only.
* retry direction: wire the active CoderPacket/CoderReport loop.
