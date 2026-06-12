# LiquidAIty Living Plan

## What LiquidAIty Is

LiquidAIty is an agentic engineering workbench. It automates the manual vibe-coding loop:

user chats with planning AI -> planning AI understands the repo/project -> planning AI creates one
bounded coding job -> user sends the job to a coder -> coder returns a structured report ->
planning AI compares the report against the job -> the system remembers proof, blockers, and
lessons -> the next job is prepared.

The user describes what they want done. The user is not asked to prompt a prompt.

## First Launch Wedge

LiquidAIty first launches as an agentic engineering / vibe-coding workbench.

The first user value is:

plan the job -> gather project context -> create a bounded spec-as-prompt -> send it to a coder ->
read a structured report -> compare report versus job -> remember proof and lessons -> prepare the
next job.

Research remains part of the product, but recursive research, research swarms, broader KnowGraph
ingestion, and the research-to-chat loop are deferred until the coding loop is useful.

## Product Loop

1. **User chat**: the user describes the desired outcome normally.
2. **Magentic-One / Sol**: the planner initiates context gathering, reasons over the project, and
   proposes the next bounded job.
3. **Context Packet**: the planner receives current user input, PlanFlow state, this living plan,
   ThinkGraph memory, fresh CodeGraph/CBM evidence, relevant SkillGraph memory, and KnowGraph
   research only when relevant.
4. **CoderPacket**: the planner creates one reviewable active job contract, shaped like a temporary
   execution spec.
5. **User Go**: after review or edits, the user sends the CoderPacket through a coder adapter.
6. **CoderReport**: the coder returns structured results and proof, not a vague done message.
7. **Comparison**: PlanFlow compares CoderReport against CoderPacket and exposes matches, misses,
   changes, blockers, proof, and next step.
8. **Memory**: ThinkGraph records the job and outcome; reusable learning updates skills; the next
   job is prepared.

## Product Parts

### User Chat

User chat is the front door. The user describes goals, changes, problems, and constraints in normal
language. Chat starts planning; it is not a prompt-template editor.

### Magentic-One / Sol

Magentic-One/Sol is the planner and thinking agent. It starts from user chat, initiates the Context
Packet pull, and uses current plan state, reasoning memory, relevant skills, fresh code evidence,
and user input to choose the next bounded job. It must not fake repository understanding,
planning, execution, or success.

### PlanFlow

PlanFlow is Magentic-One/Sol's visible thinking and control surface.

PlanFlow shows the living plan, current active job prompt when one exists,
run/report status, blockers, proof summary, and next step. It may expose selected supporting
evidence on demand.

PlanFlow is not a document map, spec library, skill library, markdown graph, set of road signs,
fake planner summary, or fake execution preview. It does not show every spec, skill, or document.

### PLAN.md

This file is the durable repo-backed living plan. It is always present and can change often through
PlanFlow. It holds product identity, launch wedge, current route, active work, code/context anchors,
blockers, next step, durable decisions, and concise status/proof notes.

`PLAN.md` is not decoration, old prompt storage, a spec library, or a completed-task archive.

### Context Packet

The Context Packet is graph and code context initiated by Magentic-One/Sol before it creates the
next active job. It is assembled from:

* user input
* current PlanFlow state
* `PLAN.md`
* ThinkGraph reasoning, events, proof, and blockers
* fresh Codebase Memory / CodeGraph evidence
* relevant skills indexed through SkillGraph / Neo4j
* KnowGraph research when relevant

Its purpose is to help the planner understand the project before creating a CoderPacket. Missing or
stale code evidence is a blocker, not permission to guess.

### Codebase Memory / CodeGraph

Fresh code evidence is core. Magentic-One/Sol uses CBM/CodeGraph to create code anchors and bound
the active job. The coder also uses Codebase Memory directly while working. CBM is a structural map;
direct reads, tests, compile output, and real smoke results win when they disagree.

### SkillGraph / Neo4j / skills/*.md

`skills/*.md` are durable reusable learning indexed and retrieved through SkillGraph / Neo4j.
Skills teach future agents how work is broken down, proof rules, failed attempts, guardrails,
no-stub/no-fallback laws, CoderReport expectations, adapter lessons, and reusable procedures.

Skills are not PlanFlow canvas nodes and are updated only when learning is reusable.

### Active Prompt / CoderPacket

The active CoderPacket prompt is both the spec and the task. There is no separate spec file, task
file, spec folder, or task ledger.

Use the terms **spec-as-prompt**, **task-as-prompt**, **active CoderPacket**, and **active job
contract**.

A CoderPacket:

* is the complete bounded spec and task for one part of `PLAN.md`
* is created from Context Packet, `PLAN.md`, relevant skills, and fresh CBM/code anchors
* is shown in PlanFlow only while active
* can be reviewed and edited by the user
* is sent to a coder when the user clicks Go
* is never converted into a spec file or task file

The repository does not keep a `specs/` folder or task files. Durable product direction belongs in
`PLAN.md`; reusable learning belongs in `skills/*.md`; current execution requirements belong only
in the active CoderPacket prompt.

### CoderReport

CoderReport is the structured response to a CoderPacket. It includes:

* verdict
* comparison against CoderPacket
* completed, incomplete, and changed requirements
* files changed
* proof commands and proof results
* blockers and assumptions
* chosen approach and rejected alternatives
* reusable skill updates
* next recommended task

PlanFlow compares CoderReport against the active CoderPacket. Hidden success and vague done claims
are forbidden.

### ThinkGraph

ThinkGraph stores structured reasoning and event memory: why the plan changed, context used, job
created, coder response, matches and misses, proof, failures, blockers, and recommended next step.
ThinkGraph is not markdown sprawl and does not invent planning or success.

### Coder Adapters

Coder adapters follow one rule: **CoderPacket in, CoderReport out**.

Planned adapters:

* LocalCoder / RepoCoder adapter wrapping the already-tested local coder
* manual adapter for copying CoderPacket out and pasting CoderReport back
* CLI/headless adapter for external coding tools
* MCP adapter for agent tools where available

There is no vendor lock-in. Adapters are product direction only in the current documentation pass.

## Current Route

1. Make this living plan and `AGENTS.md` the clear product and execution law.
2. Use one active CoderPacket prompt as both the current spec and task; keep no spec or task files.
3. Wire PlanFlow around the living plan, one active CoderPacket, CoderReport comparison, blockers,
   proof, and next step.
4. Have Magentic-One/Sol initiate Context Packet assembly from ThinkGraph, SkillGraph/Neo4j,
   CodeGraph/CBM, and relevant KnowGraph context.
5. Add coder adapters behind the CoderPacket-in/CoderReport-out contract.
6. After the coding loop is useful, build the deferred research loop.

## Active Work

The spec/task-file model has been removed. The root planning spec/task trees and Spec-Kit scaffold
are gone, SkillGraph handoff treats the active CoderPacket prompt as both spec and task, and
PlanFlow's repository projection now reads only the living `PLAN.md`.

## Code And Context Anchors

* `AGENTS.md`: execution law
* `PLAN.md`: living product route
* `skills/*.md`: reusable learning
* Codebase Memory MCP / CodeGraph: fresh code structure and anchors
* SkillGraph / Neo4j: reusable skill retrieval
* ThinkGraph: structured plan/job/report/proof memory
* PlanFlow: visible active planning and control surface

## Durable Decisions

* The active CoderPacket prompt is both spec and task; spec and task files do not exist.
* PlanFlow shows active planning state, not document or skill libraries.
* CoderPacket in, CoderReport out is the adapter boundary.
* Fresh CBM is required before code edits.
* No stubs, fake fallbacks, silent fallbacks, hidden success, fake planning, or fake execution.
* Research is deferred, not deleted.

## Blockers

* The active CoderPacket/CoderReport comparison loop is not wired yet.
* Coder adapters are not wired yet.

## Next Step

Wire PlanFlow active job loop: dynamic `PLAN.md` visible/editable, Magentic-One/Sol context pull
from ThinkGraph + SkillGraph/Neo4j + CodeGraph/CBM, one active CoderPacket/spec-as-prompt, then
LocalCoder/RepoCoder wrapper receives CoderPacket and returns CoderReport.
