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
2. If an explicit feature manifest was selected (wiki/*.md), read its declared
   file + simple-symbol anchors first. Use them as the starting point for graph
   exploration.
3. Search graph structure for relevant files, symbols, routes, tests, and call paths.
4. Direct-read resolved files.
5. Include queries used, evidence, and warnings in the Context Packet.
6. Block active-prompt creation when required code evidence is missing or stale.
7. Mark unresolved or ambiguous anchors honestly — do not silently choose one
   when multiple same-name symbols exist. Prefer exact file path matching.

## Guardrails

@guardrail id=codegraph-context-reader.cbm-tools-only
@guardrail id=codegraph-context-reader.missing-code-evidence-blocks
@guardrail id=codegraph-context-reader.no-copied-code-in-skills
@guardrail id=codegraph-context-reader.no-fake-cbm-access

## Query Patterns

@query id=codegraph-context-reader.compose "refresh CBM, search graph for the user request and active prompt, direct-read resolved files, then fill Context Packet code evidence"

