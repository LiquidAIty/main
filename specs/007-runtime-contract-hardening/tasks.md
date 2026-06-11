# Spec 007 Tasks

**Gate**: Do not begin Specs 008-012 implementation until the final runtime smoke passes.

- T001: COMPLETE - enforce card-owned explicit model configuration.
- T002: COMPLETE - prove strict backend runtime contracts.
- T003: COMPLETE - remove runtime defaults, fallbacks, swallowed errors, and fake-success paths.
- T004: COMPLETE - prove strict Python participant payload contracts.
- T005: PENDING - Prove real source-run AutoGen ReactFlow graph runtime smoke.

## T005 Requirements

1. Run the backend and Python sidecar from host source; do not use Docker `python-models` or Redis.
2. Call the real backend deck/mission route and real Python sidecar.
3. Send a strict ReactFlow graph and `MissionSpec` payload.
4. Preserve graph nodes and graph edges.
5. Preserve edge relationships for sequence, branch, join, and loop with an explicit exit rule.
6. Preserve card settings for fan-out / `Swarm`, `isSocietyOfMind`, tools, explicit model config, instructions, and role.
7. Build real tool-enabled `AssistantAgent` participants from plain agent cards.
8. Build `Swarm` fan-out only for a fan-out-enabled card.
9. Build a `SocietyOfMindAgent` only for a card with a connected child-agent subgraph.
10. Compile ReactFlow execution structure with `DiGraphBuilder`, `DiGraphNode`, `DiGraphEdge`, and `DiGraph`.
11. Execute every ReactFlow edge-defined path through `GraphFlow`.
12. Connect outside-facing participants through real `MagenticOneGroupChat`.
13. Keep `MissionSpec` planning inside graph constraints.
14. Keep `UserProxyAgent` reserved and out of the first runtime unless explicitly required.
15. Require explicit participant `provider` and `providerModelId`.
16. Reject missing/falsy provider or model configuration; never use defaults, fallbacks, or `providerModelId="default"`.
17. Return real non-empty output; never use fake final output, mocked transcript, mocked sidecar success, or swallowed failure.
18. Exclude every vendored/subrepo path listed in `docs/runbooks/VENDORED_ROOTS_AND_SUBREPOS.md` from implementation assumptions.

Current explicit blocker: `standard_autogen_graph_runtime_not_implemented`.
