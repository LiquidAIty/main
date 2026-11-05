# LiquidAIty

LiquidAIty is a durable agent system for work that develops over time.

Instead of treating every conversation as a disposable chat, LiquidAIty organizes work inside a
**Project**. A Project preserves its saved agents, instructions, tools, relationships, and provider-owned
knowledge, while Hermes preserves profiles, sessions, chat history, delivery, and execution.

## Durable Projects

Each Project brings together:

- **saved Cards** with stable identities, prompts, models, tools, and runtime profiles;
- **Main**, the human-facing conversation and bounded orchestrator;
- **Builder**, the construction agent for prompts, Cards, applications, interfaces, code, and artifacts;
- **specialized Cards** for work such as research, analysis, trading, world intelligence, or modeling;
- **explicit connections** that determine which saved agents may communicate or participate in coordinated work;
- **provider-owned knowledge** that remains attributable to its real source and storage authority;
- **Hermes sessions and task receipts** that report what actually ran without a copied runtime ledger.

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
TypeScript = LiquidAIty pixels and typed transport projection
Python rails = deterministic application operations and graph/data adapters
models = semantic reasoning
saved Cards and graph topology = identity and authority
Hermes = profiles, sessions, delivery, tools, taskgraphs, PTY, telemetry, and lifecycle
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
| `apps/backend/` | Authenticated LiquidAIty Product APIs and saved Project access; no Hermes chat transport |
| `apps/python-models/` | Python rails, graph adapters, MCP publication, and deterministic operations |
| `apps/hermes-liquidaity-plugin/` | Native Hermes hooks/tools plus the LiquidAIty web-dashboard manifest/API/bundle |
| `services/knowgraph/` | KnowGraph ingestion and Graphiti integration |
| `agent-products/` | Specialized product applications and controlled imports |
| `HermesLatest/`, `GraphitiLatest/`, `EngraphisLatest/` | Controlled upstream forks with bounded local divergences |

The canonical documents have distinct jobs:

| Document | Purpose |
| --- | --- |
| [plugin.md](plugin.md) | Canonical Hermes web-plugin integration and runtime ownership contract |
| [CODEGRAPH.md](CODEGRAPH.md) | CodeGraph product, source-pair, module-cohesion, and repository-ingestion contract |
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
