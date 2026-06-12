# Skill: Magentic-One Runtime

@skill id=magentic-one-runtime
@type Skill
@status active
@related_to context-packet
@related_to spec-as-prompt
@requires fresh_cbm_index

## Vector Summary

Edit the Sol/Magentic-One runtime safely: preserve the real Microsoft AutoGen v0.4.4 runtime,
selected tools only, loud failures, and no fake outputs.

## Procedure

1. Read `PLAN.md`, `AGENTS.md`, and the active CoderPacket prompt.
2. Refresh CBM and direct-read relevant runtime files.
3. Preserve the ReactFlow/TypeScript control plane, Node backend, and Python sidecar boundary.
4. Resolve only selected, enabled, schema-complete tools.
5. Run focused runtime tests and real smoke proof when execution behavior changes.
6. Return a structured CoderReport against the active prompt.

## Guardrails

@guardrail id=magentic-one-runtime.locked-v044-line
@guardrail id=magentic-one-runtime.no-banned-frameworks
@guardrail id=magentic-one-runtime.no-fake-runtime-success
@guardrail id=magentic-one-runtime.runtime-is-not-plan-authority
@guardrail id=magentic-one-runtime.selected-tools-only

## Query Patterns

@query id=magentic-one-runtime.code-evidence "refresh CBM, search_graph for Magentic-One runtime, worker, and tool-registry symbols, then direct-read resolved files"
@query id=magentic-one-runtime.proof "run focused Python runtime tests, backend runtime tests, compile, and real smoke when execution behavior changes"

