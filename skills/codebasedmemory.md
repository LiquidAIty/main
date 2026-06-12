# Skill: Code-Based Memory

@skill id=codebasedmemory
@type Skill
@status active
@requires fresh_cbm_index

## Vector Summary

Use fresh Code-Based Memory to navigate current code before planning or editing. Direct reads and
real proof win when graph memory disagrees.

## Procedure

1. Read `AGENTS.md`, `PLAN.md`, and the active CoderPacket prompt.
2. Refresh or prove fresh CBM and record status, nodes, and edges.
3. Search graph nodes, paths, files, and symbols before focused text search.
4. Direct-read resolved files before claims or edits.
5. Keep work bounded by the active prompt.
6. Run tests, compile, or real smoke proof.
7. Refresh or prove fresh CBM after code changes.
8. Return graph/code delta in the CoderReport.
9. Update skills only when learning is reusable.

## Guardrails

@guardrail id=codebasedmemory.fresh-before-edits
@guardrail id=codebasedmemory.direct-read-before-claim
@guardrail id=codebasedmemory.no-fake-code-understanding
@guardrail id=codebasedmemory.active-prompt-is-task

## Query Patterns

@query id=codebasedmemory.current-code "refresh CBM, search_graph for relevant symbols, trace paths when needed, then direct-read resolved files"
@query id=codebasedmemory.skill-match "search skills using user intent, active CoderPacket prompt, fresh CBM nodes/files/symbols, subsystem, and guardrails"

