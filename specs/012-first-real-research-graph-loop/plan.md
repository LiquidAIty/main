# Plan: First Real Research-Graph Loop

**Spec**: `specs/012-first-real-research-graph-loop/spec.md`

**Implementation owner**: Fable, after Spec 007 T005 passes.

**Gate**: Do not begin T001 until the real source-run AutoGen ReactFlow graph runtime smoke returns real non-empty output.

## Required Runtime Truth

Before this plan begins, Spec 007 must prove:

- ReactFlow nodes, edges, edge relationships, and card settings survive the backend-to-Python payload.
- Real AutoGen graph execution runs from host source.
- `GraphFlow` executes ReactFlow-derived edge paths.
- Outside-facing participants coordinate through real `MagenticOneGroupChat`.
- The run returns real non-empty output with no defaults, fallbacks, mocks, or fake transcript.
- A real completed chat/run pair can be captured from the verified result.

Health checks and historical smoke reports do not satisfy this gate.

## Architecture Boundary

Keep the verified deck run and downstream research-graph loop as separate truth domains:

```text
real deck route
-> verified real non-empty runtime result
-> persisted deck run
-> idempotent completed chat/run pair
-> separate strict ThinkGraph extraction
-> validated project-scoped graph_liq persistence
-> read-only Research Pack candidate from persisted gaps
```

The deck response reports only real deck truth. Downstream extraction status is separately observable. Downstream failure must not be swallowed and must not rewrite or fake the deck result.

## Ordered Work

1. Select and prove the exact post-success completed-pair capture boundary.
2. Implement idempotent completed-pair capture with graph/card provenance.
3. Define strict Python and backend ThinkGraph extraction contracts that allow an honest empty result.
4. Implement the separate minimal Python extraction endpoint.
5. Validate and persist project-scoped, provenance-bearing, idempotent records to Apache AGE `graph_liq`.
6. Derive a read-only Research Pack candidate only from persisted real gaps.
7. Add project-scoped read-only status/candidate routes.
8. Prove the bounded loop with a real end-to-end smoke.

## Hard Problems Reserved for Fable

1. Preserve deck truth while introducing a separate idempotent downstream lifecycle.
2. Design a strict cross-runtime extraction contract that maps cleanly into semantic validation and permits honest empty output.
3. Implement project-scoped idempotent AGE persistence with provenance and observable downstream status.
4. Derive a Research Pack candidate only from persisted real gaps without invoking or imitating the broader Research system.
5. Prove the entire bounded loop without mocks, fake output, fallback records, or cross-project leakage.

## Do Not Use

- fake transcript, fake final output, mocked AutoGen success, or historical smoke claims
- Docker `python-models` or Redis for AutoGen
- MissionSpec as the graph connection source
- RoundRobin, Selector, Ledger, Microsoft Agent Framework, Semantic Kernel, or AutoGen Studio as product runtime
- default/fallback provider or model
- UI, Prisma, env-file, KnowGraph, trading, or broad Research-system changes
- vendored/subrepo paths as architecture evidence

## Validation Strategy

After the Spec 007 gate passes, run focused contract and service tests after each task. The final live validation must:

1. Run a real deck through the host-source backend and Python sidecar.
2. Verify real non-empty final output and preserved graph/card constraints.
3. Verify one idempotent completed chat/run pair.
4. Verify the separate strict Python extraction endpoint.
5. Query `graph_liq` and verify only project-scoped validated records.
6. Verify a read-only candidate references persisted gap records.
7. Prove honest empty and failed downstream cases.

## Stop Gates

- Stop before T001 if Spec 007 T005 has not passed.
- Stop before graph writes if strict extraction contracts and validation tests do not pass.
- Stop before candidate derivation if project-scoped idempotent AGE persistence is not proven.
- Stop before completion unless the real end-to-end smoke passes without mocks, defaults, fallbacks, fake graph writes, or fake research output.
