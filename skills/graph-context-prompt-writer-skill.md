# Skill: Context To Active Prompt

@skill id=graph-context-prompt-writer
@type Skill
@status active
@related_to context-packet
@related_to spec-as-prompt
@related_to codegraph-context-reader
@requires fresh_cbm_index

## Vector Summary

Turn planner-initiated Context Packet evidence into one active CoderPacket prompt that is both the
spec and task. The user describes the desired outcome; the user does not prompt a prompt.

## Procedure

1. Start from user chat and current `PLAN.md`.
2. Pull ThinkGraph, relevant SkillGraph memory, fresh CBM/CodeGraph evidence, and relevant KnowGraph
   context.
3. Create one bounded active CoderPacket prompt.
4. Include requirements, scope, code anchors, proof, blockers, and stop conditions.
5. Present it for user review before Go.

## Guardrails

@guardrail id=graph-context-prompt-writer.user-does-not-prompt-a-prompt
@guardrail id=graph-context-prompt-writer.one-active-prompt
@guardrail id=graph-context-prompt-writer.no-spec-or-task-files
@guardrail id=graph-context-prompt-writer.no-invented-context

## Query Patterns

@query id=graph-context-prompt-writer.code-evidence "refresh CBM, retrieve relevant skills, and direct-read code anchors before creating the active CoderPacket prompt"

