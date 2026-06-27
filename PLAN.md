# LiquidAIty PLAN.md

## Product Identity

LiquidAIty is a **user-owned agent workbench for serious, long-lived work**.

It is not a chat app, a dashboard generator, fake workflow theater, or a pile of markdown task files.

It gives a user a durable space in which plans, evidence, decisions, skills, code context, agents, artifacts, and reviews can remain connected over time and be remixed into new work.

Projects remain useful, but they are **lenses and working contexts inside one user space**, not hard silos that own all knowledge forever.

```txt
User Space
├─ conversations and branches
├─ ThinkGraph: decisions, intent, outcomes, constraints
├─ KnowGraph: grounded sources, claims, evidence
├─ SkillsGraph: reusable proven procedures
├─ CodeGraph / CBM: repository structure and edit boundaries
└─ projects / workspaces
   ├─ plans
   ├─ repositories
   ├─ artifacts
   └─ active working context
```

A source, skill, decision pattern, artifact, or evidence record may be relevant across more than one project. Reuse must be explicit, scoped, and traceable.

LiquidAIty must always distinguish:

```txt
what the user requested
what the system proposed
what the user approved
what an agent actually did
what evidence exists
what remains unknown
```

## Product Objects

### One Plan

There is one user-facing **Plan**.

While being created or revised, it is awaiting user approval. The current internal persistence field may remain named `planDraft` for compatibility, but user-facing UI, prompts, and documentation call it **Plan**.

```txt
drafting
→ awaiting approval
→ approved
→ executing
→ needs review
→ reviewed

meaningful revision
→ awaiting approval again
```

The user approval transition is the handoff from planning to execution.

```txt
Plan creation or revision
→ no execution

User approves the current Plan revision
→ it becomes the active executable intent

Agents run bounded approved steps
→ results, evidence, artifacts, and reviews attach to those steps

A meaningful Plan revision
→ becomes a new revision awaiting approval
```

A Plan is not automatically accepted project truth merely because a model wrote it. Until approval, ThinkGraph may link the proposal to the request and open questions, but it must not promote its contents as accepted decisions.

### Plan Canvas

The Plan canvas is the durable, editable work surface.

Canvas cards stay compact:

```txt
step number
short title
one short summary
state
```

The Inspector owns full details:

```txt
objective
detail
expected outcome
acceptance criteria
constraints
dependencies
open questions
source request
approval state
runs
artifacts
evidence
review verdict
next decision
provenance
```

The chat steers. The Plan holds durable executable intent. The Inspector explains. The graph links. The skills compound.

### Conversation History

Conversation is durable user-visible history.

Users can reload, scroll, reply to an earlier message, and branch from that point. Old messages are retired from ordinary active prompt context; they are not deleted.

```txt
saved message graph
≠
full model prompt
≠
automatic graph memory
```

A conversation can link to plans, plan steps, runs, evidence, artifacts, and reviews. Raw transcript text is not automatically copied into ThinkGraph or KnowGraph.

## Graph Model

### User Scope, Project Lenses

ThinkGraph and KnowGraph are scoped to the **user**.

Projects provide context, permissions, organization, and an active working lens. They do not make the graph unable to traverse or reuse connected data across a user’s lifetime.

Every graph record must preserve:

```txt
owner/user scope
source or creation provenance
created and updated times
optional project/workspace references
optional plan/step/run/review references
confidence or status where relevant
```

Graph retrieval starts with the active Plan/step and project lens, then may traverse user-owned linked records when relevance and provenance justify it. It must never dump the entire user graph into a prompt.

### ThinkGraph

ThinkGraph is the user’s durable project-reasoning and operational-truth graph.

It stores references and curated facts such as:

```txt
approved Plan revisions
requested outcomes
accepted decisions
superseded/rejected decisions
constraints
open questions
Plan and step references
conversation references
runs
artifacts
Outcome Reviews
blockers
next decisions
```

ThinkGraph does not store raw chat as memory. It does not turn a model suggestion into accepted truth automatically.

### KnowGraph

KnowGraph is the user’s grounded knowledge and evidence graph.

It stores:

```txt
source records
source metadata
publication / observation / retrieval times
document chunks
entities
source-backed claims
evidence links
confidence
contradictions or competing claims
citation/provenance
```

A source-backed claim can be reused across projects, but each project or Plan step carries its own explicit link, question, interpretation, or review.

No model statement becomes KnowGraph fact without source provenance.

### SkillsGraph

`skills/*.md` are the human-readable durable procedures.

SkillsGraph is the retrieval layer connecting skills to systems, files, tasks, proof commands, known traps, successful use, and failure patterns.

A skill is created or updated only after real work has produced proof worth preserving.

### CodeGraph / CBM

CodeGraph / CBM provides repository structure, symbols, boundaries, and scoped edit context.

It is a code-discovery and edit-boundary capability, not the top-level product surface. Stale code context blocks code-edit work; it does not authorize guessing.

## Context Policy

The Context Pack is the controlled input to a model or agent.

A normal turn receives only the relevant bounded slice:

```txt
active conversation branch tail
selected reply anchor/path when relevant
active Plan and selected Plan step
scoped ThinkGraph records
scoped KnowGraph evidence
scoped CodeGraph/CBM context when code matters
relevant skills
linked prior runs, artifacts, and Outcome Reviews
```

Each included item needs source, reference, timestamp when available, and relevance reason.

Excluded by default:

```txt
entire chat history
retired unrelated messages
entire user graph
raw hidden reasoning
raw tool payloads
secrets
unverified model claims
unrelated skills
whole repositories
```

The system must state honest emptiness when grounded context is unavailable.

## Runtime Roles

### Harness

Harness is the fast, persistent, interactive front door.

It owns:

```txt
normal conversation
Plan creation and revision
questions that require user judgment
bounded context assembly
fast tool use
ordinary single-agent work
native worker/subagent calls
review and evaluator calls
```

Harness is the default interactive runtime.

### Python Tools

Python remains a first-class implementation and capability layer.

Proven Python evidence/data capabilities should be callable through narrow, auditable bridges without forcing a full multi-agent team run.

This is especially important for trading, research, documents, and graph tooling.

### Mag One / Agent Fabric

Mag One remains a valued specialist team fabric.

It is not the default route for ordinary chat or quick work. It is deferred until the graph/context/worker foundation is proven and then used when genuine multi-agent structure is worth the cost:

```txt
multi-specialist research
visible team collaboration
graph/data/simulation work
deliberate team planning
complex long-running missions
```

The Mag One bus must ultimately distinguish:

```txt
installed/resident
eligible on a bus
selected for a mission
actively running
watching on a later trigger
```

Connected does not mean forced into every request.

## The Core Controlled Loop

The target loop is:

```txt
user request or selected Plan step
→ bounded Context Pack
→ Plan creation/revision or approved-step mission
→ agent work
→ real artifacts/evidence
→ separate evaluator checks requested outcome against actual evidence
→ Outcome Review: matched | partial | contradicted | unknown
→ ThinkGraph / KnowGraph / Plan links update
→ concise chat pointer
→ next decision or bounded next step
```

The generator never grades itself. The evaluator does not accept prose as proof.

```txt
generator output
≠
verified result
```

The first repair loop is bounded:

```txt
one worker attempt
→ evaluator
→ at most one concrete repair attempt
→ evaluator again
→ stop for human review
```

No infinite retry. No silent boundary escalation. No auto-merge, auto-deploy, or automatic real trading.

## First Vertical: Trading Research and Decision Support

Trading is the first complete proof vertical, while the core architecture remains domain-neutral.

The first usable trading loop is:

```txt
thesis/request
→ Plan awaiting approval
→ approved research steps
→ source-backed SEC / market / KnowGraph evidence
→ bounded Harness research work using proven Python tools
→ evidence evaluation
→ Outcome Review
→ bull/base/bear or directional-uncertainty thesis
→ paper/simulated proposal only
→ explicit human approval before any future real-order pathway
```

Every trading record needs time:

```txt
sourcePublishedAt
observedAt
asOf
retrievedAt
staleness policy
```

Every output separates:

```txt
supported by current evidence
supported by older evidence
contradicted / competing evidence
unknown
model interpretation
```

The system must never present generated market opinion as verified fact.

## Round-Robin Delivery Method

LiquidAIty is built top-to-bottom, one real capability at a time.

```txt
one capability
→ make it work in isolation
→ prove it with real data/runtime behavior
→ connect it to already-proven capabilities
→ prove the integrated path
→ refactor only when proof exposes a seam failure
→ move to the next capability
```

No giant rewrite. No fake architecture proof. No subsystem is considered complete because code exists.

Every implementation stage requires:

```txt
current real seams
smallest working scope
authoritative store
read/write flow
user-visible behavior
isolation proof
integration proof
failure/refactor trigger
explicit deferred work
```

## Near-Term Route

### Batch A — Graph Truth and Context

1. Audit and freeze a real baseline.
2. Wire user-scoped ThinkGraph records for Plan/revision references, requested outcomes, constraints, open questions, and later run/review links.
3. Wire user-scoped KnowGraph source-backed evidence retrieval and explicit Plan-step links.
4. Feed scoped ThinkGraph + KnowGraph retrieval into the live Harness Context Pack.
5. Prove a fresh Harness turn can use real graph context without receiving full chat history.

### Batch B — Contextual Capabilities

1. Add CodeGraph / CBM scoped retrieval for code steps.
2. Add deliberate SkillsGraph retrieval.
3. Extend Context Pack with code and skills only when relevant.
4. Prove stale CBM blocks code-edit context rather than guessing.

### Batch C — Bounded Harness Work and Review

1. Define minimal agent contracts.
2. Run one approved Plan step through a fast Harness worker.
3. Land real artifacts/evidence and Run records.
4. Run a separate evaluator.
5. Persist Outcome Review and attach it to Plan/ThinkGraph/KnowGraph.
6. Prove one paper-only trading research loop.

### Batch D — Mag One Reassessment

Only after Batches A–C work:

1. Compare native Magentic-One, a thin LiquidAIty adapter, and the full bus/card setup.
2. Measure streaming, participant selection, Task Ledger/PlanFlow overhead, and quality gain.
3. Define escalation rules.
4. Keep Mag One for work where team structure demonstrably adds value.

## Hard Product Law

Do not fake AI work, graph truth, evidence, execution, or success.

Forbidden:

```txt
fake plans
fake task/run cards
fake artifacts
fake completed statuses
backend/frontend-authored pretend AI answers
chat text silently converted into executable work
raw model output silently promoted to graph truth
raw model opinion stored as KnowGraph fact
deterministic keyword routers
regex intent classifiers
sanitizer/rewrite logic pretending to be planning
mocked success on live routes
hidden prompt spaghetti
whole-graph or whole-repo context dumps
```

Allowed:

```txt
real user-approved Plans
real bounded agent work
real source-backed evidence
real artifacts
real test/proof results
real missing-state reporting
real evaluator verdicts
real graph links and provenance
real skills created after proof
```

If proof is missing, say proof is missing.
If evidence is unavailable, say unknown.
If a route is unwired, fail closed.
If the user has not approved the Plan revision, do not execute it.

## Documentation Law

Durable repository documents remain minimal:

```txt
AGENTS.md
PLAN.md
skills/*.md
repo-intake/*.md only when explicitly needed
```

`PLAN.md` is current product law and route.

`AGENTS.md` is execution law.

`skills/*.md` are reusable proven procedures.

Temporary implementation prompts are not permanent specs unless explicitly promoted.

## Final Rule

LiquidAIty should show real work and real knowledge relationships, not status theater.

```txt
The user owns the intent.
The Plan holds approved direction.
The chat steers.
The graph connects and remembers.
The evidence grounds.
The workers act within bounds.
The evaluator can say no.
The Inspector explains.
The skills snowball.
```
