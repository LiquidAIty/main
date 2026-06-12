# Code-Based Memory Skill Spec

> Transition policy: this is a legacy/source document, not the default planning memory or active
> job contract. `PLAN.md`, `AGENTS.md`, and the current CoderPacket/spec-as-prompt are authoritative.

## Purpose

Define the reusable Code-Based Memory skill used by LiquidAIty agents to navigate code
structurally, scope tasks, avoid stale assumptions, and record graph-backed task results.

## User Intent

New agents should not rediscover how to use CBM every time. They read
`skills/codebasedmemory.md`, refresh CBM, query graph nodes, edges, and files, direct-read files
before claims or edits, use focused grep only for exact string proof, and write graph/code deltas
back into tasks.

## Requirements

* Require a fresh index and proven-ready status for every task and SkillExample query.
* Explain all fourteen current CBM tools, why to use them, and when not to use them.
* Prefer graph navigation before broad text search.
* Use focused grep/rg only after graph narrowing or for exact literal checks.
* Require direct file reads before claims or edits.
* Require fresh CBM after changes.
* Write actual graph/code delta into the task result.
* Include a query-ready SkillExample pattern and a real example from this task.
* Do not store raw git diff as durable memory.
* Do not use stale cached paths as truth.
* Do not require routine git status, diff, or diff-stat.
* Attach every real implementation attempt to a matching one-file skill or the smallest useful new
  skill stub.
* Fold reusable attempt metadata and query behavior into `skills/codebasedmemory.md`.
* Use graphable OWL-ish Markdown lines instead of a separate graph JSON file.
* Require skill-graph search before creating a real implementation attempt.
* Require every successful code task to create or update a graphable skill.
* Append bounded attempts to matching skills.
* Require the exact no-matching-skill statement when no skill matches.
* Connect skills to specs, source tasks, touched nodes, changed files/symbols, proof claims,
  validation commands, and related skills.

## Attempt Write-Back Format

Bounded skill attempts record CBM before, relevant graph nodes/edges/files/symbols, intended delta,
work, proof, CBM after, actual graph/code delta, and the success or failure update.

## Completed Task To Skill Example

A reusable completed task is compactly folded into the matching single-file skill as a SkillExample
containing source prompt, scout interpretation, source task/spec, graph-before and graph-after
queries, touched nodes/edges, changed files/symbols, proof claims, validation commands, code example
query, and minimal how-to text.

Required relationships:

* Skill `HAS_EXAMPLE` SkillExample
* SkillExample `CAME_FROM_TASK` Task
* SkillExample `USED_SPEC` Spec
* SkillExample `TOUCHED_NODE` CodeGraphNode
* SkillExample `CHANGED_FILE` File
* SkillExample `CHANGED_SYMBOL` Symbol
* SkillExample `PROVED` Claim
* SkillExample `VALIDATED_BY` Validation
* SkillExample `PRODUCED` SemanticReport

Raw diffs are not SkillExamples.

## Skill Graph Compounding

Skill search inputs are the user prompt, referenced specs, fresh CBM graph nodes/files/symbols,
touched subsystem, known guardrails, and related skills.

If matching skills exist, append the bounded attempt there and successful completion adds a new
graphable example, proof claim, guardrail, smoke test, query pattern, or related-skill edge.

If no matching skill exists, create the smallest useful one-file skill stub and record:

`No matching skill found; successful completion must create a new skill.`

Every successful code task creates or updates a graphable skill.

## Query-Ready Examples

Every example query begins with fresh CBM, locates the skill and best matching example, resolves
current graph nodes/files/symbols, and returns small current snippets, proof claims, validations,
and reusable how-to text. It does not return raw diff by default.

## Tool Naming Compatibility

The current MCP exposes `trace_path`. Some planning language calls this capability
`trace_call_path`. Agents must call the live `trace_path` tool and may describe it as call-path
tracing. Do not invent a `trace_call_path` invocation.

## Non-Goals

* Do not implement or modify a CBM server or runtime.
* Do not build UI for skill queries.
* Do not create ThinkGraph ingestion.
* Do not store raw patch or diff piles in Markdown.

## Acceptance Criteria

* `skills/codebasedmemory.md` exists.
* It explains the fourteen current CBM tools.
* It includes the standard CBM task workflow.
* It includes a query-ready SkillExample shape.
* It includes a real example based on this docs/task normalization work.
* completed task metadata, graphable lines, and query-ready behavior exist in that one file.
* no `skills/codebasedmemory/` subfolder or separate graph JSON/example/query files remain.
* `PLAN.md` identifies Code-Based Memory as the first foundational reusable skill.
