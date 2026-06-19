# Skill: Unified Canvas Wiring Discipline

@skill id=canvas-wiring-discipline
@type Skill
@status active
@related_to task-ledger-real-autogen
@related_to planflow-no-deterministic-projection
@related_to magentic-one-runtime

## When To Use It

Before touching how task / plan nodes, the Task Ledger Artifact, the Mag One bus,
or agent cards are wired together on the unified project canvas (`BuilderCanvas` +
the `taskCanvasOverlay` in `agentbuilder.tsx` + `buildTaskLedgerArtifactGraph` in
`planMissionModel.ts`). Use it whenever the canvas starts to look like a hairball or
when adding any new canvas edge.

## Core Model: Task Graph Upstream Of The Bus

There is ONE project canvas with distinct connection families:

* Task / plan nodes are **upstream** work objects.
* Agent cards are **downstream** tools plugged into the Mag One bus.

Correct flow: `Task Ledger Artifact → task graph → selected/approved task → Run
Agents → Mag One bus → connected agent cards → result/proof back to task`.

Task nodes are NOT permanently wired into the bus like agents. They feed the bus
only when selected / approved / running.

## Bus Topology (physical layout)

The Mag One bus has directional meaning. Use vertical zones:

```txt
TOP / UPSTREAM   : Task Ledger Artifact + plan spine + task sequence/parallel nodes
CENTER           : Mag One bus spine
LEFT/RIGHT       : agent cards plugged into the bus sides
BOTTOM/DOWNSTREAM: run results / proof / CoderReports / blockers / next_needed
```

* The **plan spine** comes from the task graph ABOVE the bus into the TOP of the
  Mag One bus (`plan_spine` / `task_spine` edge kind). It is NOT an agent wire and
  is contextual — only the selected/approved/running task feeds it.
* **Agent cards plug into the bus SIDES** (`agent_bus_connection`) — these stay as
  the deck's own edges (or the bus node's visual docking); never reposition them
  into the task zone.
* **Results/proof flow BELOW** the bus/agents (`run_trace` / `task_result` /
  `proof_result`) — only drawn when a real run/result/proof artifact exists. Until
  then the bottom zone is reserved (empty), not faked.
* Implementation: the `taskCanvasOverlay` memo offsets the task cluster to sit
  ABOVE the Magentic-One card (`offsetY = busY - GAP - taskRowY`); the contextual
  `plan_spine` edge goes selected-task → bus, gated by
  `CONTEXTUAL_BUS_ROUTE_EDGE_KINDS` in `shouldRenderCanvasEdge`.

## Typed Edges (the only ones that may render in V0)

* `ledger_to_task` — Task Ledger Artifact produced this task. Connect the artifact
  to **root tasks only** (tasks with no incoming sequence/dependency edge) so wires
  stay local; never fan one giant wire to every task across the board.
* `task_sequence` — A → B → C from the explicit `stepNumber` order. Render only when
  there is a clear ordered task set and no explicit dependsOn graph.
* `task_parallel_group` — independent tasks shown as readable branches, not tangled
  long lines.
* `task_dependency` — from explicit `dependsOn` ONLY. Never infer from prose or title.
* `task_routes_to_bus` — CONTEXTUAL: only the currently selected / active / running
  task routes to the Mag One bus / Magentic-One card. Never a permanent per-task wire.
* `agent_bus_connection` — agent card plugged into the bus. Allowed as a persistent
  deck wire (owned by `toFlowEdges`, left untouched).

## Forbidden In V0

* `task_assigned_agent` as canvas wires — proposed/assigned agents are **inspector
  chips/text** (`assignedAgentIds` + `routeThrough`), not permanent spaghetti.
* Untyped edges (no `data.edgeKind`) — never render.
* Unknown edge kinds — never render.
* Edges whose source/target node is missing — never render.
* Permanent task → bus wires for every task (the hairball).
* `run_trace` / `task_result` / `proof_result` until a real run artifact exists.

## How It Is Enforced

`shouldRenderCanvasEdge(edge, { nodeIds, activeTaskId })` in `planMissionModel.ts`:
drops untyped/unknown edges, drops edges with missing endpoints, and drops
`task_routes_to_bus` unless its source is the active task. The `taskCanvasOverlay`
memo filters all overlay edges through it before they reach `BuilderCanvas`. Agent
(`agent_bus_connection`) deck edges are not overlay edges and are not filtered.

Sequence vs parallel vs dependency: dependency wins (explicit `dependsOn`); else
sequence by `stepNumber`; parallel = multiple roots / branches, laid out cleanly.

## Known Traps

* Adding one edge per data item (task → bus for every task) instantly creates a
  hairball — route only the selected task.
* Overlay nodes/edges must stay non-persisted: tag `data.__overlay`; the BuilderCanvas
  merge guards (`node.type !== 'mission'`, `!edge.data.__overlay`) keep the deck clean
  so no phantom agent cards are ever written. See [[task-ledger-real-autogen]].
* Never parse prose/titles into dependency edges. Dependencies come only from the
  model's explicit `dependsOn`.

## Proof

@proof id=canvas-wiring-discipline.client-compile npx tsc -p client/tsconfig.json --noEmit
@proof id=canvas-wiring-discipline.browser one ReactFlow scene; agent cards plugged into the bus; task graph upstream; no permanent task→bus hairball; ledger_to_task local; dependency edges only where dependsOn exists; task_routes_to_bus only for the selected task.
@proof id=canvas-wiring-discipline.no-untyped rg untyped/unknown overlay edges do not render (every overlay edge carries data.edgeKind).
