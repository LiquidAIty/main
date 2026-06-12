# Skill: CodeGraph Context Reader

@skill id=codegraph-context-reader
@type Skill
@status active
@related_to codebasedmemory
@related_to context-packet
@requires fresh_cbm_index

## Vector Summary

Compose compact current code evidence from fresh CBM/CodeGraph lookups for the Context Packet and
active CoderPacket prompt.

## Procedure

1. Refresh CBM and record readiness, nodes, and edges.
2. Search graph structure for relevant files, symbols, routes, tests, and call paths.
3. Direct-read resolved files.
4. Include queries used, evidence, and warnings in the Context Packet.
5. Block active-prompt creation when required code evidence is missing or stale.

## Guardrails

@guardrail id=codegraph-context-reader.cbm-tools-only
@guardrail id=codegraph-context-reader.missing-code-evidence-blocks
@guardrail id=codegraph-context-reader.no-copied-code-in-skills
@guardrail id=codegraph-context-reader.no-fake-cbm-access

## Query Patterns

@query id=codegraph-context-reader.compose "refresh CBM, search graph for the user request and active prompt, direct-read resolved files, then fill Context Packet code evidence"

