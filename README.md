# LiquidAIty

LiquidAIty is a durable agent system for work that develops over time.

Instead of treating every conversation as a disposable chat, LiquidAIty organizes work inside a
**Project**. A Project preserves its agents, instructions, tools, relationships, conversation,
knowledge, runs, and artifacts so the system can continue from an established state rather than
reconstructing itself on every turn.

## Durable Projects

Each Project brings together:

- **saved Cards** with stable identities, prompts, models, tools, and runtime profiles;
- **Main**, the human-facing conversation and bounded orchestrator;
- **Builder**, the construction agent for prompts, Cards, applications, interfaces, code, and artifacts;
- **specialized Cards** for work such as research, analysis, trading, world intelligence, or modeling;
- **explicit connections** that determine which saved agents may communicate or participate in coordinated work;
- **provider-owned knowledge** that remains attributable to its real source and storage authority;
- **Runs and artifacts** that preserve what was actually invoked and produced.

A Card is not a temporary role invented for one answer. It is a saved agent with its own durable
configuration and runtime identity. Connecting Cards makes collaboration explicit without merging their
prompts, tools, histories, or responsibilities.

## One workbench, separate authorities

LiquidAIty keeps four different kinds of graph information separate:

| Graph | What it represents | Authority |
| --- | --- | --- |
| **ThinkGraph** | How Project reasoning, decisions, and ideas develop | Engraphis |
| **KnowGraph** | Sourced observations, evidence, and provenance | Graphiti / Neo4j |
| **CodeGraph** | Repository files, symbols, callers, imports, tests, and dependencies | Codebase Memory |
| **AgentGraph** | Saved Card relationships and truthful Run observations | Apache AGE / PostgreSQL |

The interface may present related information together, but presentation does not create another graph or
another writer. Reasoning is not evidence, source code is not Project memory, and visible agent connections
do not by themselves prove that work executed.

## How people use it

The normal entry point is Main. A person can reason with the Project, consult a connected specialist, ask
Builder to turn established context into something concrete, inspect the supporting knowledge, and review the
result without replacing the saved agents or their authority.

The same durable Project model can support different domains. Trading, world intelligence, and building-energy
modeling are specialized applications of the system; they do not redefine the core agent, graph, or runtime
contracts.

## Engineering model

LiquidAIty follows a deliberately small ownership rule:

```text
TypeScript = transport and pixels
Python rails = runtime preparation and deterministic computation
models = semantic reasoning
saved Cards and graph topology = identity and authority
```

The repository also uses a source-owned CodeGraph overlay:

```text
Entity = the Feature category a file belongs to
Relationship = what that exact file contributes
CBM = the independently derived structural graph
```

Source annotations explain meaning; Codebase Memory supplies structure. They join on the repository-relative
file path without copying either authority into the other.

## Repository guide

| Path | Purpose |
| --- | --- |
| `client/` | React workbench and visual surfaces |
| `apps/backend/` | Authenticated HTTP/SSE transport and saved Project access |
| `apps/python-models/` | Python rails, Card/Run preparation, graph adapters, and deterministic operations |
| `services/knowgraph/` | KnowGraph ingestion and Graphiti integration |
| `agent-products/` | Specialized product applications and controlled imports |
| `HermesLatest/`, `GraphitiLatest/`, `EngraphisLatest/` | Controlled upstream forks with bounded local divergences |

The canonical documents have distinct jobs:

| Document | Purpose |
| --- | --- |
| [PLAN.md](PLAN.md) | Current status, evidence, gaps, and next accepted boundary |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Current technical owners, contracts, and controlled divergences |
| [RUNTIME.md](RUNTIME.md) | Product runtime and acceptance contract |
| [AGENTS.md](AGENTS.md) | Repository execution law for coding agents |
| [DONT.md](DONT.md) | Prohibitions and known failure patterns |
| [FUTURE.md](FUTURE.md) | Deferred possibilities, not current behavior or permission |

Current source and real runtime evidence remain authoritative when a historical report or stale description
disagrees.

## Local development

The canonical full-stack launcher is:

```powershell
npm run dev:fresh
```

It owns the supported local application tree. Do not start duplicate component processes to work around a
failed owner. See [PLAN.md](PLAN.md) for the current proof boundary and unresolved prerequisites.
