# Spec 012: First Real Research-Graph Loop

**Status**: Gated - implementation must not start until Spec 007 T005 passes.
**Depends on**: Spec 007 T005 real two-card deck smoke.
**Extends**: The smallest integrated proof slice of Specs 008 and 009.
**Does not replace**: The broader ThinkGraph, PlanFlow, Research Agent, KnowGraph, dual-context, or UI work in Specs 008-011.

## Purpose

Prove the first honest downstream memory and research-planning loop from a real completed
AutoGen deck run:

```text
persisted two-card deck
-> Magentic-One plus one assistant_agent through magentic_option
-> strict card-owned model configuration
-> Python AutoGen sidecar
-> non-empty real final output
-> completed chat pair
-> separate ThinkGraph extraction
-> project-scoped Apache AGE memory
-> read-only Research Pack candidate derived from real graph gaps
```

This is the first hard integration job after the execution spine works. Fable should work through
the existing plan and tasks instead of redesigning the feature or writing a new spec.

## Entry Gate

Spec 007 T005 must first produce a real successful run through:

`POST /api/projects/:projectId/decks/:deckId/run`

The run must include a `magentic_one` card, one `assistant_agent` connected by a
`magentic_option` edge, explicit `runtimeOptions.modelKey` on both cards, and a non-empty real
`run.finalOutput`.

The known T005 blocker at spec creation time is in
`apps/python-models/app/python_models/autogen_orchestrator.py`:
`_build_card_team_participants` directly reads `participant.title` even when the selected object
is a `CardRuntimePrivateParticipant`, whose strict contract has no `title` field. This must be
fixed and covered by regression tests before Spec 012 begins.

## Scope

- Capture a completed chat pair only after a real deck run returns `status: "success"` with a
  non-empty final output.
- Preserve project, deck, run, turn, and source provenance for the pair.
- Trigger a separate strict Python ThinkGraph extraction pass from that completed pair.
- Validate extraction output before persistence.
- Persist only validated, project-scoped provisional ThinkGraph records to the existing Apache AGE
  graph `graph_liq`.
- Derive a read-only Research Pack candidate only from persisted open questions, evidence gaps, or
  evidence-needed relationships.
- Expose honest downstream state and a read-only candidate retrieval route.
- Add an end-to-end smoke proving the complete bounded loop.

## Out Of Scope

- Full web research execution or Research Agent workers.
- PlanFlow approval UI or editable research plans.
- KnowGraph ingestion or sourced evidence writes.
- Graph context injection into future Magentic-One turns.
- Trading, broker integrations, orders, or portfolio automation.
- UI work or ReactFlow canvas changes.
- Prisma, schema migrations, Docker changes, or env-file changes.
- Reusing heuristic extraction, chunk fallback, fake graph writes, sample output, or invented
  entities as product truth.

## User Stories

### User Story 1 - Capture a real completed chat pair

As a project user, when my real two-card deck run succeeds, the system records the exact user input
and real AutoGen final output with enough provenance to drive downstream memory.

**Acceptance scenarios**:

1. A successful run with non-empty output creates one completed chat pair linked to its project,
   deck, run, and turn.
2. A failed run or empty output creates no completed chat pair and triggers no extraction.
3. Reprocessing the same run does not create duplicate chat-pair memory.

### User Story 2 - Persist strict provisional ThinkGraph memory

As a project user, I want useful entities, assumptions, relationships, risks, and open questions
from the completed pair stored as provisional project memory without invented facts.

**Acceptance scenarios**:

1. A meaningful completed pair produces validated ThinkGraph records scoped by `project_id`.
2. Minimal or meaningless input may validly produce zero records.
3. Invalid extraction output is rejected and surfaced as a downstream failure without changing the
   successful deck-run result.
4. A project cannot read records belonging to another project.

### User Story 3 - Retrieve a real Research Pack candidate

As a project user, I want a read-only research candidate derived from unresolved graph gaps so I can
see what could be researched next without automatically running research.

**Acceptance scenarios**:

1. Persisted open questions and evidence gaps produce candidate questions with graph-record
   provenance.
2. No graph gaps produces an empty candidate, not invented questions.
3. Candidate retrieval never launches research and never writes KnowGraph data.

## Functional Requirements

- **FR-001**: Deck success remains defined by the existing real runtime result. Downstream
  extraction must never convert an error into success or a success into fake output.
- **FR-002**: A completed chat pair must contain `projectId`, `deckId`, `runId`, `turnId`,
  `userText`, `assistantText`, source metadata, and timestamps.
- **FR-003**: `assistantText` must come from the non-empty real deck final output.
- **FR-004**: ThinkGraph extraction must be a separate downstream Python service or endpoint. It
  must not be folded into Magentic-One orchestration.
- **FR-005**: The extraction request and response must be strict typed contracts shared at the
  HTTP boundary.
- **FR-006**: The extraction response may contain zero records and must not use heuristic or model
  fallback output.
- **FR-007**: Backend validation must use the existing semantic-record validation rail before any
  ThinkGraph write.
- **FR-008**: ThinkGraph records must be persisted to Apache AGE graph `graph_liq`, scoped by
  `project_id`, and carry `turn_id`, `run_id`, provisional graph identity, and chat source
  provenance.
- **FR-009**: Writes must be idempotent for a repeated run/record combination.
- **FR-010**: Downstream status must distinguish pending, complete, empty, and failed. Failure
  details must be visible and must not be swallowed.
- **FR-011**: A Research Pack candidate must be derived only from persisted real graph gaps and
  include source ThinkGraph record IDs.
- **FR-012**: The read route must be project-scoped and read-only. It must not launch research.
- **FR-013**: No model, provider, graph record, research question, or output may be supplied by a
  default or fallback path.

## Key Entities

- **CompletedChatPair**: The exact user input and real assistant output from one successful deck
  run, with project/deck/run/turn provenance.
- **ThinkGraphExtraction**: Strict request, response, and status for the separate downstream
  extraction pass.
- **ThinkGraphMemoryRecord**: A validated provisional semantic record persisted in `graph_liq`.
- **ResearchPackCandidate**: A read-only set of potential research questions derived from persisted
  gaps; it is not an approved plan and cannot start research.
- **ResearchGraphTurnStatus**: Honest downstream state for one completed chat pair.

## Existing Rails To Reuse

- Real run route: `apps/backend/src/routes/decks.routes.ts`
- Runtime result: `apps/backend/src/decks/deckRuntime.ts`
- Deck-run persistence: `apps/backend/src/decks/store.ts`
- Message persistence: `apps/backend/src/messages/store.ts`
- Python route registration: `apps/python-models/app/main.py`
- Python runtime contracts: `apps/python-models/app/python_models/orchestration_contracts.py`
- Semantic validation: `apps/backend/src/graph/semanticLanguage.ts`
- Apache AGE execution: `apps/backend/src/services/graphService.ts`
- Existing ThinkGraph graph name and project-scoped reads:
  `apps/backend/src/services/graphContext/graphContextBuilder.ts`
- Route mounting: `apps/backend/src/routes/index.ts`

## Guardrails

- No default model, fallback model, fallback provider, OpenAI fallback, OpenRouter fallback,
  `providerModelId="default"`, or optional participant model fields.
- No fake final output, fake graph writes, heuristic fallback extraction, sample records presented
  as real, or invented Research Pack questions.
- No automatic research execution.
- No reuse of the fallback and auto-research behavior currently mixed into
  `apps/backend/src/routes/kg.routes.ts`.
- No Neo4j implementation for this slice. Current active ThinkGraph persistence is Apache AGE in
  Postgres.
- ThinkGraph extraction failure is an honest downstream failure and does not rewrite the already
  verified deck-run result.

## Success Criteria

1. Spec 007 T005 passes first with a real non-empty AutoGen result.
2. One real successful deck run produces one completed chat pair with full provenance.
3. A separate real Python extraction call returns strict output that passes backend validation.
4. Valid records are queryable from `graph_liq` only under the correct project.
5. A read-only route returns a Research Pack candidate derived from persisted real gaps.
6. Empty/minimal input produces empty/minimal honest output without invented content.
7. Failed extraction or persistence is surfaced as failed downstream status.
8. Automated contract tests plus an end-to-end smoke prove the bounded loop.

