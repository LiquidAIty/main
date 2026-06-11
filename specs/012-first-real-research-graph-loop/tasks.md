# Tasks: First Real Research-Graph Loop

**Spec**: `specs/012-first-real-research-graph-loop/spec.md`
**Plan**: `specs/012-first-real-research-graph-loop/plan.md`
**Gate**: Spec 007 T005 must pass before T001 begins.
**Owner**: Fable should execute these tasks in order.

## Global Guardrails

- No default/fallback model or provider.
- No optional participant `provider` or `providerModelId`.
- No fake deck success, output, graph write, or research question.
- No heuristic ThinkGraph fallback and no automatic research execution.
- No UI, Prisma, Docker, env-file, KnowGraph, trading, or broad Research-system changes.

## Phase 1 - Establish Real Chat-Pair Truth

- [ ] T001 [US1] Verify the successful T005 output shape and select the exact post-success chat-pair capture boundary in `apps/backend/src/routes/decks.routes.ts`, `apps/backend/src/decks/deckRuntime.ts`, `apps/backend/src/decks/store.ts`, and `apps/backend/src/messages/store.ts`.
  - **Required proof**: Document in the implementation report the exact source of `projectId`, `deckId`, `runId`, `turnId`, user text, real assistant text, and the idempotency key.
  - **Stop condition**: A focused failing test proves failed or empty-output runs cannot enter the capture path.
  - **Do not touch**: Python extraction, graph writes, candidate derivation, UI, or Research execution.

- [ ] T002 [US1] Implement idempotent completed chat-pair capture after a verified real deck success, with focused tests in the closest backend service/route test files.
  - **Required behavior**: Persist the exact user input and non-empty real final output with shared project/deck/run/turn provenance; trigger no downstream work for failed or empty runs.
  - **Stop condition**: Tests prove one successful run creates one pair, repeated handling does not duplicate it, and failures create none.
  - **Do not touch**: ThinkGraph extraction logic, graph persistence, Research services, UI, Prisma, Docker, or env files.

## Phase 2 - Strict ThinkGraph Extraction

- [ ] T003 [US2] Define strict ThinkGraph extraction request/response and downstream-status contracts in `apps/python-models/app/python_models/orchestration_contracts.py` and the narrow matching backend contract location.
  - **Required behavior**: Contracts carry completed-pair provenance, allow an honest empty record set, and reject missing or malformed required fields.
  - **Stop condition**: Python and backend contract tests pass, including missing-field, malformed-record, and empty-result cases.
  - **Do not touch**: Magentic-One output generation, model defaults/fallbacks, graph writes, Research execution, or UI.

- [ ] T004 [US2] Implement a dedicated minimal Python ThinkGraph extraction service and FastAPI endpoint in `apps/python-models/app/python_models/thinkgraph_agent.py` and `apps/python-models/app/main.py`, plus focused tests.
  - **Required behavior**: Extract only from the completed chat pair, return strict records or an honest empty result, and fail loudly on model/service errors.
  - **Stop condition**: Real sidecar endpoint tests prove meaningful input produces valid contract output, minimal input may produce empty output, and errors are not replaced with fallback records.
  - **Do not touch**: `_orchestrate_card_runtime_context` beyond the completed T005 fix, graph persistence, Research execution, KnowGraph, UI, Prisma, Docker, or env files.

## Phase 3 - Persist Real Provisional Memory

- [ ] T005 [US2] Add the backend extraction client and idempotent project-scoped ThinkGraph AGE persistence using `apps/backend/src/services/graphService.ts`, `apps/backend/src/graph/semanticLanguage.ts`, and focused new services/tests under `apps/backend/src/services/thinkgraph/`.
  - **Required behavior**: Validate before write; persist to `graph_liq` with `project_id`, `turn_id`, `run_id`, stable record ID, provisional identity, and chat provenance; expose pending/complete/empty/failed downstream state.
  - **Stop condition**: Tests prove invalid records are rejected, repeated writes are idempotent, extraction failure is visible, and cross-project reads return no records.
  - **Do not touch**: Existing fallback/auto-research behavior in `apps/backend/src/routes/kg.routes.ts`, Neo4j, Research execution, KnowGraph, UI, Prisma, Docker, or env files.

## Phase 4 - Derive A Candidate, Never Run Research

- [ ] T006 [US3] Implement Research Pack candidate derivation from persisted real ThinkGraph gaps in a focused backend service under `apps/backend/src/services/researchGraph/`, with focused tests.
  - **Required behavior**: Candidate questions come only from persisted open questions/evidence gaps and reference their source graph-record IDs; no gaps returns an empty candidate.
  - **Stop condition**: Tests prove no question is invented and no Research service is invoked.
  - **Do not touch**: Full Research Pack approval, web research, Research Agent workers, KnowGraph, UI, trading, Prisma, Docker, or env files.

- [ ] T007 [US3] Add and mount a project-scoped read-only downstream-status and Research Pack candidate route in `apps/backend/src/routes/researchGraph.routes.ts` and `apps/backend/src/routes/index.ts`, with route tests.
  - **Required behavior**: Route reads by project and turn/run provenance, returns honest empty/failed/complete state, and cannot launch research or write graph data.
  - **Stop condition**: Route tests prove project isolation, read-only behavior, source-record provenance, and honest failure output.
  - **Do not touch**: UI, approval flow, Research execution, KnowGraph, trading, Prisma, Docker, or env files.

## Phase 5 - Prove The Bounded Loop

- [ ] T008 [US1] [US2] [US3] Add and run one real end-to-end smoke covering deck run -> completed chat pair -> strict Python extraction -> validated project-scoped AGE memory -> read-only Research Pack candidate.
  - **Required behavior**: Use the real backend route, real Python sidecar, real AutoGen deck execution, and real `graph_liq`; verify non-empty real deck output and candidate provenance; also verify honest empty and failed downstream cases.
  - **Stop condition**: The smoke and all focused contract/unit tests pass without mocks, defaults, fallbacks, fake graph writes, fake research output, or cross-project leakage.
  - **Do not touch**: Spec 013/trading, full Research execution, KnowGraph, graph-context injection, UI, Prisma, Docker, or env files.

## Dependencies

```text
Spec 007 T005
-> T001
-> T002
-> T003
-> T004
-> T005
-> T006
-> T007
-> T008
```

## Completion Gate

Spec 012 is complete only when T001-T008 pass and the real end-to-end smoke proves the bounded loop.
Do not begin Spec 013 or broader Specs 008-011 work before this gate.
