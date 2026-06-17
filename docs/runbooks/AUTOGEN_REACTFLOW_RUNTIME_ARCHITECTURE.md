# AutoGen + ReactFlow Runtime Architecture

## Overview

This runbook defines the accepted runtime architecture for LiquidAIty's source-run AutoGen sidecar and its relationship to the visible ReactFlow control surface.

## Runtime Primitives

* **Mag One / `MagenticOneGroupChat`** is the main orchestrator, main chat channel, and bus bar.
  * The Python sidecar builds a `MagenticOneGroupChat` instance from the active ReactFlow graph and drives real model calls through it.
* **`AssistantAgent` with tools** is the base pattern for every custom agent card.
  * A card's role, instructions, model config, available tools, and runtime behavior become an `AssistantAgent` that can participate in `MagenticOneGroupChat`.
* **`Swarm`** is configured per card in the agent card editor.
  * It is used only when a single card/agent needs to fan out across many similar jobs in parallel.
  * `Swarm` is **not** the main orchestrator and does **not** replace `MagenticOneGroupChat`.
* **`SocietyOfMindAgent`** wraps a nested sequence or subworkflow into one outside-facing agent/card.
  * Use it when a multi-step workflow should appear as a single participant on the Mag One bus.
* **`UserProxyAgent`** wires user/app prompts, approvals, clarifications, and other human-in-the-loop input into agents or teams.
  * It is **not** the main router/orchestrator.

## Source of Truth

* **ReactFlow graph** is the source of truth for nodes/cards, edges, and connections.
* **Nodes/cards** define agents, tools, canvases, plans, runtime objects, and participant/model configuration.
* **Edges/connections** define allowed routing and dependencies, and determine whether work is sequential, parallel, or mixed.
* **`MissionSpec`** is where Mag One plans the mission/run.
  * `MissionSpec` is **not** the source of truth for graph connections.
  * `MissionSpec` must respect the ReactFlow graph structure and plan inside the constraints it defines.

## Physical Stack

* **Backend:** host Node source (`apps/backend`).
* **Python AutoGen sidecar:** host Python source (`apps/python-models` / `autogen-main` submodule), installed editable from the in-repo `autogen-main` source.
* **ThinkGraph:** sim-pg / Apache AGE Docker database.
* **KnowGraph:** neo4j Docker database.
* **Redis:** not part of AutoGen, Mag One, ThinkGraph, or KnowGraph runtime.
* **python-models Docker:** not the accepted dev runtime for the AutoGen/Mag One path.

## Fable Handoff

When the implementation phase begins, Fable will:

1. Receive one ReactFlow graph payload and one user goal.
2. Build real `AssistantAgent`-with-tools participants from the graph nodes/cards.
3. Connect them through a real `MagenticOneGroupChat` instance.
4. Use `Swarm` only when a card explicitly needs per-card fan-out.
5. Use `SocietyOfMindAgent` only for nested sequence/subworkflow wrapper cases.
6. Use `UserProxyAgent` only for user/app input into the run.
7. Return real non-empty output from genuine model calls.

## Forbidden in Runtime Implementation

* Docker `python-models` as the AutoGen dev runtime.
* Redis / RQ for AutoGen.
* Microsoft Agent Framework.
* Semantic Kernel.
* AutoGen Studio product runtime.
* `RoundRobinGroupChat` as the product runtime.
* `SelectorGroupChat` as the product runtime.
* Ledger/tutorial examples as the product architecture.
* Mocked transcripts or `fake_finalOutput`.
* Provider/model defaults or fallbacks (`providerModelId="default"`).
