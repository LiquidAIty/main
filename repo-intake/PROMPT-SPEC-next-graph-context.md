# PROMPT-SPEC — Batch A: User-Scoped Graph Truth and Live Context

## Status

**Next implementation batch.**

This is a bounded round-robin graph/context task. It follows the current `PLAN.md`.

Do not begin later worker, evaluator, trading-execution, Mag One optimization, agent-market, or scheduler work in this batch.

Do not commit or push.

## Goal

Make one live Harness turn genuinely grounded by user-scoped graph context.

The completed path is:

```txt
saved conversation branch
→ selected user-facing Plan / selected Plan step
→ scoped ThinkGraph project truth
→ scoped KnowGraph source-backed evidence
→ bounded live Context Pack
→ Harness response with safe provenance
```

The proof must show that the system can retrieve relevant persistent graph context without replaying full chat history or dumping an entire user graph.

## Product Law for This Batch

### One Plan, Approval Before Execution

There is one user-facing **Plan**.

The current internal field may remain `deck.planDraft` for compatibility, but no user-facing UI, prompt, or document added by this batch may call it “Plan Draft.”

A Plan revision is:

```txt
drafting | awaiting_approval | approved | superseded
```

For this batch:

```txt
- Add the minimal durable approval state needed for Plan truth.
- Newly created or materially revised Plans default to awaiting_approval.
- User approval marks the current revision approved.
- Approval does NOT launch an agent, coder, terminal, Mag One, tool action, or execution run yet.
- A revision after approval returns the revised Plan to awaiting_approval.
```

No agent execution is part of this batch.

### User Scope, Not Project Silo

ThinkGraph and KnowGraph are owned/scoped by the user.

Projects remain active working lenses and may filter retrieval, but they do not hard-partition a user’s lifetime graph.

Rules:

```txt
- Every record must resolve to an owner/user scope.
- projectId/deckId/planStepId are optional contextual links or retrieval lenses.
- Source-backed KnowGraph evidence may be reused across projects for the same user.
- Project-specific interpretations, requested outcomes, and Plan links are separate from reusable source evidence.
- No record may cross users.
- No fallback to broad/global records when a user scope cannot be resolved.
```

### Ownership Model (overrides any implication of an immediate projectId → userId migration)

LiquidAIty uses this model:

```txt
User space
→ the durable owner-scoped graph universe.

Projects
→ flexible long-lived lenses/workspaces over connected user-owned
  work, knowledge, plans, artifacts, and evidence.
```

A project is **not** the hard lifetime boundary of ThinkGraph or KnowGraph.

The intended relation is:

```txt
user owns graph universe
project lenses graph universe
Plan belongs to a project lens
evidence may be reusable
project interpretation/decision remains project-linked
```

This section explicitly overrides any reading of this spec that implies every store must immediately migrate from `projectId` to `userId`. The goal for Batch A is the **smallest** ownership model that lets ThinkGraph and KnowGraph later traverse across multiple projects belonging to the same user — not a schema replacement.

For Batch A, in order:

```txt
1. First audit the actual authenticated owner identity path.
2. Establish an authoritative owner/user namespace resolution for every project.
3. Enforce ownership at all graph read/write boundaries.
4. Keep existing working physical project storage where appropriate during this batch:
   - conversation records may remain stored on the project row;
   - Plan may remain stored on the project/deck;
   - projectId remains a useful lens/filter/reference.
5. Do not duplicate all graph records per project.
6. Do not create a parallel new user graph store.
7. Add the smallest user ownership / namespace fields and query constraints needed
   so ThinkGraph and KnowGraph can later traverse across multiple projects
   belonging to the same user.
8. Cross-project traversal must remain owner-scoped and permission-scoped.
9. A project-specific decision, Plan, run, or review must retain its project
   reference even when the underlying evidence/source may be reusable across that
   user’s other projects.
```

Do not start migration or broad schema replacement unless the Phase 0 audit proves the current stores cannot support this incrementally.

Phase 0 must report: the discovered owner identity path, the smallest ownership model added, and any store that cannot safely participate without a later migration.

## Preserve

Preserve all existing working behavior:

```txt
- persistent branching Harness conversations
- reply-from-here
- tabRuntimeId session isolation
- live Harness SSE streaming
- current Plan canvas and Inspector behavior
- current `deck.planDraft` persistence field and CAS behavior
- Context Pack message-tail and branch-anchor logic
- Code Console separation
- Mag One / Python Agent Fabric untouched
- existing KnowGraph Python tests and stores
- existing ThinkGraph AGE graph `thinkgraph_liq`
```

Do not:
- reset/revert/stash/discard current work;
- redesign canvas layout;
- rename frozen vendored runtime code;
- modify Mag One routing or Python Agent Fabric;
- add workers, evaluators, run-step controls, schedules, agent registry, CodeGraph retrieval, SkillsGraph retrieval, or trading execution;
- create a new graph store;
- create a new task ledger;
- copy raw chat transcript into a graph;
- reintroduce deterministic intent routers, regex classifiers, sanitizers, or fake state.

## Phase 0 — Baseline and Current-Seam Probe

Before implementation, inspect actual source and live stores.

Create no permanent source changes in this phase.

Report:

```txt
- current owner/user identity path for BuilderChat/project records;
- current Postgres authoritative project/deck/conversation paths;
- current AGE ThinkGraph `thinkgraph_liq` write/read path;
- current Neo4j KnowGraph source/assertion/retrieval path;
- current Plan internal field and revision/CAS behavior;
- current Context Pack graph-retriever call site;
- current related tests and their true baseline status.
```

Use actual source names and paths. Do not invent APIs or schemas.

Run only targeted existing tests or read-only probes necessary to establish a baseline. Clearly separate pre-existing failures from introduced failures.

## Phase 1 — Plan Identity and Approval State

Implement the smallest backwards-compatible Plan identity/approval contract.

### Requirements

Retain the internal `deck.planDraft` field for compatibility.

Add a minimal Plan envelope or fields equivalent to:

```txt
planId
revisionId
approvalState: drafting | awaiting_approval | approved | superseded
revisionNumber
createdAt
updatedAt
approvedAt optional
approvedByUserId optional
supersedesRevisionId optional
```

Rules:

```txt
- Plan creation from Harness writes awaiting_approval by default.
- A meaningful Plan modification creates/increments a revision and returns to awaiting_approval.
- Approving the current revision is explicit and durable.
- Older approved revisions become superseded when an approved replacement exists.
- No approval action may execute work in this batch.
- The Plan root/Inspector must say Plan and show its approval state.
- Do not show Plan Draft in user-facing UI.
```

Add a compact existing-Inspector control for plan approval only when a current revision is awaiting approval.

```txt
Approve Plan
```

After click, it may show:

```txt
Approved — ready for bounded execution when that capability is wired.
```

It must not show a fake Run button or imply execution occurred.

### Proof

```txt
- Create a Plan through normal Harness chat.
- It persists as awaiting approval.
- Reload and confirm the state remains.
- Approve it in the existing Inspector.
- Reload and confirm approved state remains.
- Modify/rewrite the Plan through the existing path.
- Confirm the new revision returns to awaiting approval.
- Confirm no Python/Mag One/coder/tool execution was started.
```

## Phase 2 — User-Scoped ThinkGraph Project Truth Slice

Extend the existing **working** AGE graph `thinkgraph_liq`. Do not create a new store and do not use the known-bad `graph_liq` catalog.

### Scope

Implement only the minimum curated records needed for Plan/context grounding:

```txt
PlanRef
PlanStepRef
RequestedOutcome
Constraint
OpenQuestion
PlanApprovalRef
ConversationRef
```

Use references and concise curated summaries. Do not write raw message bodies.

Each record must carry enough metadata to support user ownership and scoped traversal:

```txt
userId
recordId
kind
title / short summary
createdAt
updatedAt
source provenance
projectId optional
deckId optional
planId optional
revisionId optional
planStepId optional
conversationId optional
messageId optional
```

Required links may be equivalent to:

```txt
USER_OWNS
RELATES_TO_PROJECT
HAS_PLAN
HAS_PLAN_STEP
HAS_REQUESTED_OUTCOME
HAS_CONSTRAINT
HAS_OPEN_QUESTION
ORIGINATED_FROM_MESSAGE
APPROVED_REVISION
SUPERSEDES_REVISION
```

Do not automatically create `Decision` nodes from every Plan line.

On Plan approval, record only the approved Plan revision / approved intent reference. Do not promote every proposed detail into accepted durable truth.

### Read API / Adapter

Implement a small real scoped reader equivalent to:

```txt
readUserProjectTruth({
  userId,
  projectId optional,
  planId optional,
  revisionId optional,
  planStepId optional,
  limit,
})
```

Retrieval order:

```txt
1. selected Plan step
2. current Plan/revision
3. active project lens
4. explicitly connected user-owned references
```

Never retrieve another user’s nodes.
Never return broad unlinked graph content just because it belongs to the user.

### ThinkGraph Proof

```txt
- Write a PlanRef/PlanStepRef from a real saved Plan.
- Link it to the source conversation message by ID, not raw text.
- Write one requested outcome, constraint, and open question.
- Read the records back after a process restart/read-only reload.
- Prove a known unrelated user-owned graph row is excluded from a selected-step retrieval.
- Prove no raw chat content was persisted.
```

## Phase 3 — User-Scoped KnowGraph Evidence Link and Scoped Retrieval

Use the existing Neo4j KnowGraph / existing proven Python evidence substrate.

Do not replace it with a new graph or fabricated evidence system.

### Scope

Keep source evidence reusable at user scope.

Add only the missing links and adapter necessary to use existing source-backed evidence from a Plan step:

```txt
user scope
↔ source/assertion/evidence record
↔ Plan / Plan step link
```

Use existing actual labels/types when they exist. Inspect first.

Required evidence response must be source-backed and equivalent to:

```txt
assertionId
subject
predicate
object / claim text
confidence
source references
sourcePublishedAt
observedAt optional
retrievedAt
contradicts[]
userId
relatedPlanIds[]
relatedPlanStepIds[]
```

No claim without a source.
No generated prose promoted to evidence.
No project duplication of a reusable source record.

### Retrieval Adapter

Add a thin backend adapter over the existing proven KnowGraph retrieval path.

It must accept a scoped request equivalent to:

```txt
retrieveGroundedEvidence({
  userId,
  projectId optional,
  planId optional,
  planStepId optional,
  query,
  limit,
  asOf optional,
})
```

Retrieval behavior:

```txt
- Prefer explicit Plan-step / entity / source links.
- Then use the active project lens.
- Then traverse only relevant user-owned connected evidence.
- Return honest empty/unknown when no grounded result exists.
- Preserve source/citation/time provenance.
- Do not return a generic market answer or model summary.
```

For this batch, use one existing safe seeded/known trading evidence case already supported by the repository’s tests. Do not add live trading execution or new external data ingest.

### KnowGraph Proof

```txt
- Retrieve a real source-backed evidence item through the new backend adapter.
- Link it to a selected Plan step.
- Render a compact evidence/provenance section in the existing Inspector.
- Show source title/ref and timestamp fields.
- Prove a known irrelevant evidence row is excluded.
- Prove the same user-owned source can be linked to a second project/Plan context without duplication.
- Prove a different user cannot retrieve it.
```

## Phase 4A — Wire Real ThinkGraph + KnowGraph into Live Context Pack

This is the integration payoff.

The existing Context Pack has optional graph-retriever seams. Wire real adapters into the live Harness route.

Do not add CodeGraph/CBM or SkillsGraph retrieval in this batch. Those are a later focused batch and must not block trading/evidence grounding.

### Context Inputs for This Batch

A live Harness turn may include only:

```txt
active conversation branch tail
selected reply anchor/path where relevant
current Plan/revision and selected step
scoped ThinkGraph truth
scoped KnowGraph source-backed evidence
linked prior Plan/message references when relevant
```

Per item require:

```txt
source
record reference
relevance reason
timestamp when available
```

Exclude:

```txt
full saved transcript
retired unrelated messages
full user graph
unlinked projects
unlinked evidence
raw hidden reasoning
raw tool payloads
secrets
model-generated unsupported claims
CodeGraph/CBM
SkillsGraph
```

Use bounded per-source budgets and preserve existing Context Pack character-budget rules. If data is absent, preserve honest empty behavior.

### Safe User Visibility

Do not reveal private chain-of-thought.

Retain or extend only safe context provenance in the existing `context_pack` SSE/debug record:

```txt
included source category
safe reference
why included
count / bounded size
```

A compact user-visible disclosure is acceptable only if it does not clutter chat. Do not create a dashboard.

### Context Pack Proof

```txt
- Create/approve a real Plan with a selected step.
- Add/read real ThinkGraph requested outcome/constraint/open question records.
- Link/read a real source-backed KnowGraph evidence record.
- Start a fresh Harness session/tab.
- Send a bounded follow-up relevant to that step.
- Prove the live Context Pack SSE event includes scoped ThinkGraph and KnowGraph items with provenance.
- Prove a retired unrelated chat message is absent.
- Prove known unrelated graph/evidence rows are absent.
- Prove full transcript was not replayed.
- Prove the Harness response can refer to the grounded Plan/evidence context without pretending unsupported facts are known.
```

## Test and Proof Requirements

Run:

```txt
- targeted TypeScript unit tests for Plan approval, ThinkGraph reader/writer, KnowGraph adapter, Context Pack
- existing relevant conversation/Plan tests
- existing KnowGraph Python evidence tests that cover the reused retrieval path
- browser proof in Agent Builder
- direct store readback proof for Postgres/AGE/Neo4j
```

Do not demand unrelated pre-existing suites become green. Report baseline failures separately and prove this batch introduces no new failures.

## Explicit Deferrals

Do not implement:

```txt
CodeGraph / CBM Context Pack integration
SkillsGraph Context Pack integration
agent contracts/agent registry
Harness worker execution
run-plan-step MCP tool
Evaluator Worker
OutcomeReview verdict logic
repair loops
paper-trade proposal
real order placement
Mag One routing/bus changes
Mag One performance work
cron/event scheduling
agent marketplace
new graph visualizer/dashboard
```

## Refactor Rules

Refactor only with proof.

```txt
If Plan state cannot survive reload
→ repair only the authoritative Plan persistence/read path.

If an approved revision cannot be distinguished from an awaiting revision
→ repair only revision/approval contract.

If ThinkGraph returns cross-user or unrelated records
→ repair reader scope/edge/query; do not create another graph.

If a claim lacks source/timestamp provenance
→ reject it from KnowGraph retrieval; repair source/evidence adapter.

If Context Pack exceeds budget or injects irrelevant items
→ tune scope/budgets; do not dump more context.

If a store cannot represent an explicit Plan/evidence/user link
→ extend the existing store schema/edge model narrowly.
```

## Return Format

Return only:

```txt
BASELINE:
current user identity path:
current Plan persistence:
ThinkGraph path:
KnowGraph path:
Context Pack call site:
baseline tests/probes:

OWNERSHIP:
discovered owner identity path:
owner/user namespace resolution per project:
smallest ownership model added:
read/write boundary enforcement:
stores kept as-is (project-physical) this batch:
stores needing a later migration:

PLAN APPROVAL:
internal compatibility preserved:
user-facing Plan behavior:
revision behavior:
approval persistence proof:
no execution proof:

THINKGRAPH:
node/edge contracts:
user scope:
write/read path:
isolation proof:
reload proof:

KNOWGRAPH:
existing substrate reused:
source/evidence contract:
user scope:
Plan-step link:
retrieval path:
isolation/reuse proof:

LIVE CONTEXT:
retrievers wired:
included context:
excluded context:
budget/provenance:
fresh-session proof:

NO REGRESSION:
conversation branches:
canvas/Inspector:
Code Console:
Python/Mag One untouched:
tests:
files changed:
commit/push:
```
