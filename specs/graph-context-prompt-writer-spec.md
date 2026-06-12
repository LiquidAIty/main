# Graph Context Prompt Writer Spec

## Purpose

Define the prompt writer as a core product surface: the system writes better starting prompts
from graph context, then sends bounded work to coder agents. This is useful standalone — a
graph-backed prompt writer for AI work — and the full app uses it to reach coder execution
quickly.

## Inputs

The prompt writer consumes:

* Task Prompt
* Source Spec
* Skill Memory Packet (`specs/skill-packet-fable-handoff-spec.md`)
* Code Evidence Packet (`specs/codegraph-context-reader-spec.md`)
* later: ThinkGraph Context Packet (`specs/thinkgraph-planning-memory-spec.md`)
* later: KnowGraph Research Packet

## Output

A bounded Fable/Codex handoff. The generated handoff is not just text; it is graph-backed
context. The UI should eventually let the user inspect and edit the generated handoff before
execution.

## Handoff Anatomy

The standardized anatomy of a generated handoff:

1. Purpose
2. Task
3. Context
4. Effort
5. Boundaries
6. Verification Rules
7. Stop Conditions
8. Output Format

## Mapping From The Existing Five-Section Fable Handoff

The implemented five-section handoff (`skill_ingest.py handoff`) maps into the anatomy:

| Existing section | Anatomy slots |
| --- | --- |
| Task Prompt | Purpose, Task |
| Source Spec | Context |
| Skill Memory Packet | Context, Boundaries (guardrails), Verification (proof claims, validations) |
| Code Evidence Packet | Context, Verification (refs, proof commands) |
| Required Behavior / Proof | Boundaries, Verification Rules, Stop Conditions, Output Format |

The five-section renderer is the working MVP of this spec; the anatomy is the target shape future
iterations grow into. Do not rewrite the working renderer to chase the anatomy; extend it when a
bounded pass needs a missing slot.

## Current Repo Evidence

* `services/knowgraph/skill_ingest.py` implements `handoff` with Task Prompt, Source Spec, Skill
  Memory Packet, Code Evidence Packet, and Required Behavior sections, deterministic output, and
  loud validation of attached packets.
* Packet retrieval and code-evidence embedding are tested
  (`services/knowgraph/test_skill_retrieve.py`).

## Product Direction

* Prompt writing is a first-class surface, not a side effect of execution.
* The UI should eventually render the generated handoff for inspection/editing before execution.
* Each packet keeps its own contract and source-of-truth graph; the prompt writer composes, it
  does not merge storage.

## Not Included Yet

* UI implementation
* ThinkGraph/KnowGraph packet implementation
* model routing
* LLM-rewritten handoffs (the writer stays deterministic until a spec changes that)

## Acceptance

* The prompt writer's inputs, output, and anatomy are explicit.
* The existing five-section handoff is mapped into the anatomy without rewriting working code.
* Future packet types join through the prompt writer, not through direct graph coupling.
