# Spec 007 Implementation Plan

## Preserve

- ReactFlow graph ownership of nodes, cards, settings, edges, and connections
- strict card-owned model resolution
- required participant `provider` and `providerModelId`
- real-error propagation and non-empty output checks
- host-source backend and Python startup
- database-only Compose
- vendored/subrepo exclusion boundary

## Fable Runtime Work

1. Accept and validate the strict ReactFlow graph and `MissionSpec` payload.
2. Preserve nodes, edges, sequence, branch, join, loop exit rules, and card settings.
3. Build tool-enabled `AssistantAgent` workers from plain agent cards.
4. Build card-level `Swarm` fan-out only when the card setting enables it.
5. Build `SocietyOfMindAgent` wrappers only for cards with connected child-agent subgraphs.
6. Compile runnable ReactFlow cards and edges with `DiGraphBuilder`, `DiGraphNode`, `DiGraphEdge`, and `DiGraph`.
7. Execute ReactFlow-derived edge paths through `GraphFlow`.
8. Connect outside-facing participants through `MagenticOneGroupChat`.
9. Keep `MissionSpec` planning inside ReactFlow graph constraints.
10. Keep `UserProxyAgent` reserved for later.
11. Return real non-empty output without defaults, fallbacks, mocks, or fake transcript data.
12. Run and prove the persisted real source-run runtime smoke.

## Stop Gate

Do not begin Spec 012 until the real host-source backend-to-Python smoke completes with real non-empty output.
