# AGENTS.md

## Product Law

LiquidAIty is an agentic engineering workbench. The first launch wedge automates the coding loop:
user chat -> planner context pull -> one bounded CoderPacket -> coder -> structured CoderReport ->
comparison, proof, memory, and next job.

`PLAN.md` is the durable living plan and current route. Keep it concise and current.

PlanFlow is Magentic-One/Sol's visible thinking and control surface. It shows the living plan,
active job, active spec-as-prompt, report/run status, blockers, proof summary, and next step. It is
not a doc map, spec library, skill library, markdown graph, road-sign display, fake planner
summary, or fake execution preview.

## Execution Contract

The default execution spec is the current **CoderPacket**, also called the spec-as-prompt, active
job contract, or temporary execution spec.

When coding:

1. Read `AGENTS.md` and `PLAN.md`.
2. Read the current CoderPacket when one exists.
3. Refresh Codebase Memory MCP and record ready status, nodes, and edges.
4. Use graph tools before focused text search for code discovery.
5. Direct-read relevant files before claims or edits.
6. Break the spec-as-prompt into bounded tasks and execute scoped work only.
7. Prove the work with tests, compile, direct reads, or real smoke evidence.
8. Compare actual work against every CoderPacket requirement.
9. Return a structured CoderReport.
10. Refresh or prove fresh CBM after code changes.
11. Update skills only when the learning is reusable.

Do not broaden scope or start the next job without instruction.

## CoderPacket

A CoderPacket is one bounded part of `PLAN.md`, created from the Context Packet, living plan,
relevant skills, and fresh code anchors. It is reviewable and temporary. It is not saved as a
durable `spec.md` by default.

Durable spec files are allowed only when explicitly exported/saved by the user or for a rare stable
long-term contract. Existing `specs/*.md` files are legacy/source documents during transition and
do not override `PLAN.md`, `AGENTS.md`, or the active CoderPacket.

## CoderReport

Every coding job returns a structured CoderReport containing:

* verdict
* comparison against CoderPacket
* completed, incomplete, and changed requirements
* files changed
* proof commands and proof results
* blockers and assumptions
* chosen approach and rejected alternatives
* reusable skill updates
* next recommended task

Never return vague done or hide incomplete proof.

## Context And Memory

* Magentic-One/Sol initiates Context Packet assembly before creating the next job.
* Context Packet combines user input, PlanFlow state, `PLAN.md`, ThinkGraph, fresh CBM/CodeGraph,
  relevant SkillGraph/Neo4j skills, and KnowGraph only when relevant.
* Codebase Memory / CodeGraph is the structural map. Direct reads and proof win on disagreement.
* ThinkGraph stores structured reasoning, events, jobs, reports, proof, blockers, and next steps.
* `skills/*.md` store reusable learning and are indexed through SkillGraph / Neo4j.
* Skills are not PlanFlow nodes and are updated only for reusable procedures, guardrails, failed
  attempts, proof rules, or adapter lessons.

## Documentation Policy

Markdown is an execution layer, but avoid documentation sprawl:

* `PLAN.md` is the living product and route.
* `AGENTS.md` is execution law.
* `skills/*.md` are reusable learning.
* CoderPacket is the default temporary spec-as-prompt.
* Existing `specs/*.md` are legacy/source docs during transition.
* Do not create a new durable spec or task file for ordinary work.
* Do not create random notes, progress files, evidence files, handoff files, or completed-task
  piles.

## Hard Guardrails

* No commit or push unless the user explicitly requests it.
* No stubs or placeholder implementations.
* No fake fallback, silent fallback, provider/model fallback, or invented tool.
* No hidden success, fake final output, mocked success, or vague done claim.
* No deterministic fake planning or fake Magentic-One/Sol provenance.
* No Run Preview pretending to be execution.
* No road-sign UI as product law.
* No spec sprawl.
* No destructive git operations without explicit instruction.
* Preserve the real ReactFlow/TypeScript control plane, Node backend, Python sidecar, and
  Microsoft AutoGen v0.4.4 / Magentic-One runtime unless explicitly changed by the user.

## Editing And Proof

Use existing repo patterns and keep edits scoped. Use `apply_patch` for manual edits. Never revert
unrelated user changes. Tests scale with risk. Report blockers honestly and do not fake proof.

For serious runs report verdict, files read, CBM before/after, work done, CoderPacket comparison,
proof, actual graph/code delta, reusable skill updates, risks, and next state. Do not include
routine git output or patch dumps.
