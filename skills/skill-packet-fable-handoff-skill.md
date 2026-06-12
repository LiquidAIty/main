# Skill: Active CoderPacket Handoff

@skill id=skill-packet-fable-handoff
@type Skill
@status active
@related_to context-packet
@related_to spec-as-prompt
@related_to coder-report-protocol
@requires fresh_cbm_index

## Vector Summary

Hand one bounded active CoderPacket prompt to a coder and require a structured CoderReport back.
The prompt itself is both spec and task.

## Procedure

1. Retrieve relevant skills and fresh code evidence.
2. Build one active CoderPacket prompt from user intent, `PLAN.md`, and Context Packet evidence.
3. Include requirements, scope, proof, blockers, and stop conditions.
4. Send the prompt to the coder only after user Go.
5. Require a structured CoderReport.
6. Compare every report claim against the active prompt.
7. Update `PLAN.md`, ThinkGraph, and reusable skills as appropriate.

## Guardrails

@guardrail id=skill-packet-fable-handoff.prompt-is-spec-and-task
@guardrail id=skill-packet-fable-handoff.no-spec-or-task-files
@guardrail id=skill-packet-fable-handoff.context-before-handoff
@guardrail id=skill-packet-fable-handoff.report-required

## Query Patterns

@query id=skill-packet-fable-handoff.prepare "retrieve relevant skills and fresh CBM evidence, then create one active CoderPacket prompt"

