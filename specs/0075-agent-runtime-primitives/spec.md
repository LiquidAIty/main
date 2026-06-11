# Spec 007.5: Agent Runtime Primitives

**Status**: Ready for atomic implementation, beginning with Task 001 only  
**Depends on**: Spec 007 complete, including the real host-source AutoGen v0.4.4 runtime smoke  
**Purpose**: Define stable runtime contracts before ThinkGraph ingestion, GraphSkills, richer tools,
scheduler expansion, memory retrieval, telemetry, or auto-learning.

## Intent

LiquidAIty needs a small set of permanent graph-native runtime primitives so later features can
extend the proven runtime without repeatedly changing its core card, tool, planning, context, and
execution-evidence contracts.

This spec defines contracts and boundaries only. It does not implement the contracts, change
runtime behavior, start Spec 012, or create a skills marketplace.

## Current Truth And Migration Boundary

- The proven runtime already preserves explicit participant model configuration, card tool IDs,
  fan-out settings, Society-of-Mind settings, ReactFlow nodes, and ReactFlow edges.
- Python currently resolves a small fixed tool-name registry and fails on unknown tool names.
- Existing backend tool registries and MCP registries are not the canonical runtime `ToolRegistry`.
- Existing `PlanDraft` and `PlanMissionGraph` types are partial planning surfaces. They are not yet
  the canonical `PlanGraphDraft` defined here.
- Existing runtime event, graph context, and skill-shaped values must not be treated as these new
  contracts until they satisfy this spec and its acceptance tests.

## Hard Boundaries

- No default or fallback model, provider, tool, graph connection, context, or success result.
- Python must never invent a tool that the card did not select.
- Unknown, disabled, or schema-less tools fail loudly before execution.
- The agent card Tools tab is the source of allowed tool IDs and settings.
- `AgentGraph` remains the durable card, tool, subgraph, and connection graph.
- `PlanGraph` is a mission-specific proposed execution plan and never silently changes
  `AgentGraph`.
- `RuntimeTrajectoryEvent` records execution truth; it must not pretend planned work occurred.
- `GraphContextSlice` limits context. Whole-project graph and random whole-history injection are
  forbidden.
- Graph skills come only from successful, traceable, validated runtime evidence.
- Markdown is a generated GraphSkill documentation view, never the skill source of truth.

## User Scenarios

### US1: Run A Card With Explicit Tools

A card owner selects tools in the card Tools tab. The runtime preserves those selections and
settings, resolves only those tools through a typed registry, and fails before execution when a
selection is unknown, disabled, or missing a schema.

**Acceptance scenarios**

1. A valid enabled tool with input and output schemas resolves to its declared runtime adapter.
2. An unknown tool ID fails with a stable error and no substitute tool.
3. A disabled or schema-less tool fails with a stable error.
4. A tool not selected by the card cannot be invoked by the Python runtime.

### US2: Preserve A Runnable Card Contract

A runnable card reaches the runtime as one canonical `AgentCardRuntimeSpec` containing its
identity, instructions, explicit model configuration, selected tools, execution settings,
subgraph reference, output contract, and optional memory/context policies.

**Acceptance scenarios**

1. Tool selections, explicit model configuration, fan-out, and Society-of-Mind settings survive
   the backend-to-sidecar boundary.
2. Missing required identity or explicit model configuration fails loudly.
3. A Society-of-Mind card references its child graph without embedding an unrelated graph.

### US3: Review Mag One's Proposed Plan

Mag One planning produces a `PlanGraphDraft` for the current mission. The user can later inspect,
edit, approve, and run that ReactFlow-visible overlay without confusing it with the durable
`AgentGraph`.

**Acceptance scenarios**

1. Every plan node maps to an allowed card, tool, subgraph, or GraphSkill.
2. Every plan edge declares execution intent such as order, dependency, branch, join, loop, or
   parallel structure.
3. The draft cannot invent resources or connections forbidden by the durable `AgentGraph`.

### US4: Inspect What Actually Happened

A runtime run emits compact typed `RuntimeTrajectoryEvent` records for meaningful execution
transitions and failures. These events are execution truth and can later feed ThinkGraph.

**Acceptance scenarios**

1. Events distinguish planned intent from actual dispatch, edge traversal, tool calls, loop
   behavior, worker exchange, ledger activity, final output, and failure.
2. Events use compact summaries and payload references rather than duplicating huge transcripts.
3. Failures include stable error fields and are never reported as successful events.

### US5: Give Each Card Only Relevant Context

Each dispatched card receives a `GraphContextSlice` selected from its graph position, role,
mission, tools, upstream outputs, constraints, and relevant graph facts.

**Acceptance scenarios**

1. The slice identifies the run and card and includes only declared context categories.
2. Allowed tools and required output contract agree with the card runtime contract.
3. Missing future memory retrieval does not cause whole-project or whole-history injection.

### US6: Promote Proven Graph Skills

A successful run or validated graph slice may produce a `GraphSkillCandidate`. A candidate becomes
an active `GraphSkill` only after validation, approval, and evidence that it is reliable.

**Acceptance scenarios**

1. Failed or unproven runs cannot produce promotable candidates.
2. Every candidate and skill is traceable to runtime evidence and validation results.
3. A replacement candidate cannot replace a proven active skill unless it fixes a demonstrated
   defect or outperforms it under comparable validation.

## Canonical Contracts

### ToolSpec

| Field | Requirement |
|---|---|
| `toolId` | Stable non-empty identifier selected by cards |
| `name` | Human-readable name |
| `description` | Concise purpose and usage boundary |
| `inputSchema` | Required typed input schema |
| `outputSchema` | Required typed output schema |
| `permissions` | Declared capabilities or access requirements |
| `sideEffects` | Declared external or persistent effects |
| `requiresApproval` | Whether execution requires approval |
| `timeoutMs` | Positive bounded timeout |
| `costHint` | Optional compact cost classification or estimate |
| `runtimeAdapter` | Explicit adapter identity resolved by Python |
| `enabled` | Explicit availability state |

### ToolRegistry

The canonical `ToolRegistry` maps card-selected tool IDs to validated `ToolSpec` records and Python
callable/runtime adapters. It rejects unknown tools, disabled tools, and tools missing either
schema. It never substitutes, guesses, auto-selects, or invents tools. Later implementations will
emit tool-call trajectory events.

### AgentCardRuntimeSpec

| Field | Requirement |
|---|---|
| `cardId` | Stable non-empty card identity |
| `cardKind` | Declared card kind |
| `title` | Human-readable card name |
| `role` | Runtime role |
| `instructions` | Card-owned instructions |
| `modelConfig` | Required explicit provider and provider model configuration |
| `toolRefs` | Card Tools tab selections with settings |
| `fanOut` | Card-level fan-out/Swarm setting |
| `isSocietyOfMind` | Explicit Society-of-Mind state |
| `childGraphRef` | Child-agent subgraph reference when applicable |
| `outputContract` | Optional required output shape |
| `memoryPolicy` | Optional declared memory policy |
| `contextPolicy` | Optional declared context-selection policy |

### PlanGraphDraft

`MissionSpec` is where Mag One plans the run. Its planning result is a `PlanGraphDraft`, a
ReactFlow-visible mission planning overlay that remains proposed until approved.

| Field | Requirement |
|---|---|
| `planGraphId` | Stable draft identity |
| `missionRunId` | Mission run that owns the draft |
| `sourceMissionSpecId` | MissionSpec source identity |
| `generatedBy` | Planner identity |
| `planNodes` | Ordered or graph-connected `PlanNode` records |
| `planEdges` | `PlanEdge` execution-intent records |
| `rationale` | Compact planning rationale |
| `constraintsUsed` | AgentGraph and user constraints applied |
| `approvalStatus` | Draft, approved, rejected, running, complete, or failed |

#### PlanNode

Required fields: `planNodeId`, exactly one applicable reference among `cardId`, `toolId`,
`subgraphId`, or `graphSkillId`, `title`, `plannedAction`, `expectedInput`, `expectedOutput`, and
`status`.

#### PlanEdge

Required fields: `planEdgeId`, `sourcePlanNodeId`, `targetPlanNodeId`, `relation`, `condition`,
`loopRule`, and `joinPolicy`. Relations include order, dependency, branch, join, loop, and
parallel intent.

### RuntimeTrajectoryEvent

| Field | Requirement |
|---|---|
| `eventId` | Stable event identity |
| `eventType` | Typed execution transition |
| `timestamp` | Event occurrence time |
| `runId` | Owning runtime run |
| `deckId` | Owning deck when applicable |
| `cardId` | Relevant card when applicable |
| `nodeId` | Relevant runtime node when applicable |
| `edgeId` | Relevant runtime edge when applicable |
| `parentCardId` | Parent card for nested execution when applicable |
| `toolId` | Tool identity for tool events |
| `iteration` | Loop/fan-out iteration when applicable |
| `exitReason` | Explicit completion or exit reason |
| `summary` | Compact human-readable event summary |
| `payloadRef` | Reference to larger payload or transcript content |
| `errorCode` | Stable failure code |
| `errorMessage` | Concise failure detail |

Required event categories include graph compile, node dispatch, edge taken, loop iteration, loop
exit, worker request, worker reply, tool call, fan-out, Society-of-Mind subgraph, Task Ledger,
Progress Ledger, final output, and failure.

### GraphContextSlice

| Field | Requirement |
|---|---|
| `sliceId` | Stable slice identity |
| `runId` | Owning run |
| `cardId` | Receiving card |
| `allowedTools` | Tools allowed for this dispatch |
| `upstreamOutputs` | Relevant upstream results |
| `neighboringCards` | Relevant graph-position context |
| `relevantThinkGraphFacts` | Selected provisional reasoning facts |
| `relevantKnowGraphFacts` | Selected sourced knowledge facts |
| `knownFailureModes` | Relevant known hazards |
| `activeUserConstraints` | Current user constraints |
| `requiredOutputContract` | Output shape the card must satisfy |

This contract defines the future runtime-memory interface. Full retrieval and ranking are outside
this spec.

### GraphSkillCandidate

| Field | Requirement |
|---|---|
| `candidateId` | Stable candidate identity |
| `sourceRunIds` | Successful proven source runs |
| `sourceTrajectoryEventIds` | Evidence events |
| `graphSlice` | Reusable executable graph slice |
| `inputSchema` | Required typed input schema |
| `outputSchema` | Required typed output schema |
| `requiredTools` | Required ToolSpec references |
| `modelPolicy` | Explicit model-selection constraints |
| `validationStatus` | Current validation state |
| `benchmarkResults` | Comparable validation evidence |
| `promotionRecommendation` | Evidence-backed recommendation |
| `docsSummary` | Generated concise documentation summary |

### GraphSkill

| Field | Requirement |
|---|---|
| `skillId` | Stable skill identity |
| `version` | Immutable version identity |
| `status` | Candidate, validated, approved, active, deprecated, or quarantined |
| `graphSlice` | Executable source of truth |
| `inputSchema` | Required typed input schema |
| `outputSchema` | Required typed output schema |
| `requiredTools` | Required ToolSpec references |
| `modelPolicy` | Explicit model-selection constraints |
| `validationTests` | Repeatable validation definitions |
| `provenanceRuns` | Successful evidence runs |
| `reliabilityStats` | Measured reliability evidence |
| `replacementPolicy` | Evidence required for replacement |
| `docsView` | Generated documentation view |

## AgentGraph Versus PlanGraph

| AgentGraph | PlanGraph |
|---|---|
| Durable product graph | Mission-specific proposed execution plan |
| Owns cards, tools, subgraphs, settings, and allowed connections | Maps planned steps onto allowed AgentGraph resources |
| Persists independently of one mission run | Belongs to a mission run and approval lifecycle |
| Constrains runtime possibilities | Expresses intended execution within those constraints |
| Changes only through explicit graph editing | May be generated, edited, approved, rejected, or discarded |

Approval of a PlanGraph authorizes the proposed run. It does not silently mutate the AgentGraph.

## GraphSkill Lifecycle And Replacement

Valid lifecycle states are `candidate`, `validated`, `approved`, `active`, `deprecated`, and
`quarantined`.

- Candidate creation requires successful proven runtime evidence.
- Validation requires repeatable tests and traceable benchmark results.
- Approval is explicit; candidates are never active by default.
- Active skills remain unchanged when a candidate fails or lacks comparable evidence.
- Replacement requires evidence that the candidate fixes a demonstrated defect or outperforms the
  proven skill under comparable inputs, constraints, tools, and model policy.
- Deprecated skills remain traceable. Quarantined skills cannot execute.

## Out Of Scope

- Runtime implementation or migration
- UI implementation
- Prisma or persistence schema changes
- Full ThinkGraph or KnowGraph retrieval
- Automatic skill activation or self-modifying runtime
- Skill marketplace, billing, discovery ranking, or random skill Markdown generation
- Spec 012 or Spec 013 implementation

## Success Criteria

1. All eight primitives have unambiguous fields, ownership, rejection rules, and boundaries.
2. An implementation agent can implement ToolSpec/ToolRegistry as one atomic task without
   inventing missing product behavior.
3. AgentGraph and PlanGraph cannot be reasonably confused after reading the spec.
4. Planned intent, execution truth, and future memory context have distinct contracts.
5. No candidate can become or replace an active GraphSkill without successful runtime evidence and
   validation.

