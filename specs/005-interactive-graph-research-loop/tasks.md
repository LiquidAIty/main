# Task Breakdown: Interactive Graph Research Loop

## Phase 1: Magentic-One Refinement
- `[x]` Magentic-One lightweight chat/router response implemented
- `[x]` Remove heavy graph-output pressure from Magentic-One
- `[x]` Generic prompt does not invent graph data

## Phase 2: Graph Agent & Research Pack
- `[ ]` Graph Agent reads chat pairs downstream.
- `[ ]` Graph Agent builds Research Pack data structure.
- `[ ]` Graph Agent populates shared graph ThinkGraph layer.

## Phase 3: PlanFlow & Search Swarm Plan
- `[ ]` PlanFlow receives Research Pack from Graph Agent.
- `[ ]` PlanFlow creates editable Search Swarm Plan UI.
- `[ ]` Expose `swarm_count` visibly in UI.
- `[ ]` Enforce PlanFlow manual approval gate.

## Phase 4: Research Agent Execution
- `[ ]` Research Agent executes approved swarm.
- `[ ]` Worker status/countdown visible in UI.
- `[ ]` Swarm emits source-backed evidence objects.

## Phase 5: KnowGraph Ingestion
- `[ ]` KnowGraph Neo4j/Python ingestion pipeline receives evidence as it arrives.
- `[ ]` Shared graph KnowGraph layer populates dynamically.
- `[ ]` Support/weakens/contradicts/gap relationships visually represented.

## Phase 6: Dual Graph Context
- `[ ]` Magentic-One answers from dual graph context (ThinkGraph + KnowGraph).
- `[ ]` Shared graph shows active traversal/highlights if safe.
