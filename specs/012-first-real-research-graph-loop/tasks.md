# Tasks: First Real Research-Graph Loop

**Spec**: `specs/012-first-real-research-graph-loop/spec.md`

**Plan**: `specs/012-first-real-research-graph-loop/plan.md`

**Gate**: Spec 007 T005 must pass before T001 begins.

**Status**: All tasks pending.

## Global Guardrails

- Start only from a verified real source-run AutoGen result with real non-empty output.
- Preserve graph constraints and card settings from the verified run payload.
- No default/fallback model or provider and no optional participant model fields.
- No fake transcript, fake deck success, fake output, fake graph write, or invented research question.
- No mocked AutoGen success, heuristic ThinkGraph fallback, or automatic research execution.
- No Docker `python-models`, Redis for AutoGen, UI, Prisma, env-file, KnowGraph, trading, or broad Research-system changes.
- `MissionSpec` does not own graph connections.
- Vendored/subrepo paths are excluded from active implementation assumptions.

## Phase 1 - Establish Real Chat/Run-Pair Truth

- [ ] T001 Verify the successful Spec 007 output shape and select the exact post-success completed-pair capture boundary.
  - Required proof: identify the exact sources of project, deck, run, turn, user text, real assistant text, graph/card provenance, and idempotency key.
  - Stop condition: focused tests prove failed or empty-output runs cannot enter the capture path.

- [ ] T002 Implement idempotent completed chat/run-pair capture after verified real deck success.
  - Required behavior: persist exact input and real non-empty output with shared provenance; trigger no downstream work for failed or empty runs.
  - Stop condition: tests prove one successful run creates one pair, repeated handling does not duplicate it, and failures create none.

## Phase 2 - Strict ThinkGraph Extraction

- [ ] T003 Define strict ThinkGraph extraction request/response and downstream-status contracts.
  - Required behavior: carry completed-pair provenance, allow an honest empty record set, and reject missing or malformed required fields.
  - Stop condition: Python and backend contract tests pass for required, malformed, and empty-result cases.

- [ ] T004 Implement a separate minimal Python ThinkGraph extraction service and endpoint.
  - Required behavior: extract only from the completed pair, return strict records or an honest empty result, and fail loudly.
  - Stop condition: real sidecar endpoint tests prove valid, empty, and failure cases without fallback records.

## Phase 3 - Persist Real Provisional Memory

- [ ] T005 Add the backend extraction client and idempotent project-scoped Apache AGE persistence.
  - Required behavior: validate before write; persist to `graph_liq` with project/run/turn/source provenance; expose pending/complete/empty/failed state.
  - Stop condition: tests prove invalid rejection, idempotency, visible failure, and project isolation.

## Phase 4 - Derive a Candidate, Never Run Research

- [ ] T006 Derive a read-only Research Pack candidate from persisted real ThinkGraph gaps.
  - Required behavior: questions come only from persisted gaps and reference source record IDs; no gaps returns an empty candidate.
  - Stop condition: tests prove no question is invented and no Research service is invoked.

- [ ] T007 Add project-scoped read-only downstream-status and candidate routes.
  - Required behavior: return honest empty/failed/complete state and never launch research or write graph data.
  - Stop condition: route tests prove project isolation, read-only behavior, provenance, and honest failures.

## Phase 5 - Prove the Bounded Loop

- [ ] T008 Run one real end-to-end smoke: verified deck run -> completed pair -> strict Python extraction -> validated project-scoped AGE memory -> read-only Research Pack candidate.
  - Required behavior: use real host-source backend, Python sidecar, AutoGen deck execution, and `graph_liq`; verify real output, preserved graph/card constraints, candidate provenance, honest empty result, and honest failure.
  - Stop condition: smoke and focused tests pass without mocks, defaults, fallbacks, fake graph writes, fake research output, or cross-project leakage.

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

Spec 012 remains pending until all tasks and the real end-to-end smoke pass. Do not begin Spec 013/trading.
