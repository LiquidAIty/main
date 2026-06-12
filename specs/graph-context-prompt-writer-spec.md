# Graph Context Prompt Writer Spec

> Transition policy: this is a legacy/source implementation document. Current product law lives
> in `PLAN.md`, `AGENTS.md`, and the active CoderPacket/spec-as-prompt.

## Current Product Role

The useful part of the existing prompt-writer work is deterministic packet composition. In the
current product model, that work supports the Context Packet and the active CoderPacket.

The user is not prompting a prompt. The user chats normally. Magentic-One/Sol initiates context
gathering and creates one bounded, reviewable CoderPacket from:

* user input
* PlanFlow state
* `PLAN.md`
* ThinkGraph reasoning/events/proof/blockers
* fresh CodeGraph/CBM evidence
* relevant SkillGraph/Neo4j skills
* KnowGraph when relevant

## Existing Implementation Evidence

`services/knowgraph/skill_ingest.py` contains a deterministic handoff renderer and validated packet
composition patterns. Those patterns remain useful source evidence for future Context Packet and
CoderPacket composition.

They are not product permission to make users author prompt templates, create permanent specs for
ordinary work, or build a prompt-maker surface before the active coding loop.

## CoderPacket Output

The target output is one temporary spec-as-prompt / active job contract with:

* purpose and bounded task
* current context and code anchors
* allowed scope and forbidden boundaries
* requirements
* proof rules
* stop conditions
* CoderReport return contract

It is shown in PlanFlow while active, can be reviewed/edited by the user, and is sent through a
coder adapter after Go. It is not saved as a durable spec by default.

## Guardrails

* Deterministic packet composition must not invent context.
* Missing/stale CBM evidence is a blocker.
* UI copy/export cannot manufacture planning or runtime state.
* Do not expose a spec library or prompt-template workflow as the core product.
* No fake planner output, hidden success, or silent fallback.
