# LANGGRAPH_REPORT

## Overview of current LangGraph code
- `apps/backend/src/agents/lang/agentFactory.ts` builds "department" LangGraph graphs on demand using `ChatOpenAI`, `StateGraph`, and `ToolNode`. It binds toolkits (memory, KG, RAG) per agent persona and invokes the compiled graph for each run.@apps/backend/src/agents/lang/agentFactory.ts#1-485
- `apps/backend/src/agents/lang/tools/agentFactoryTools.ts` defines the actual tool set (memory_op, knowledge_graph, kg_neighborhood, rag_search). Some tools rely on external services (Neo4j, `/api/kg/neighborhood`, `/api/rag/search`).@apps/backend/src/agents/lang/tools/agentFactoryTools.ts#1-145
- `apps/backend/src/agents/lang/orchestratorGraph.ts` declares a more complex LangGraph (planner/code/approval loop) that tries to mix local knowledge-graph tools with dynamic MCP tools and hard-coded OpenAI settings.@apps/backend/src/agents/lang/orchestratorGraph.ts#1-108
- `apps/backend/src/agents/orchestrator/agent0.graph.ts` contains another StateGraph ("Agent-0") that chains ingestion, KG building, gap analysis, forecasting, and legacy fallback routing. It depends on several connectors (Graphlit, InfraNodus, ESN, Neo4j) that are not wired up today.@apps/backend/src/agents/orchestrator/agent0.graph.ts#1-305
- `apps/backend/src/routes/agent.routes.ts` exposes POST `/api/agents/boss` and invokes `buildAgent0(mode)` but does not guard the route with auth and assumes all downstream connectors exist.@apps/backend/src/routes/agent.routes.ts#1-35

## What's broken or half-done (initial scan)
- Multiple overlapping LangGraph implementations (`agentFactory`, `orchestratorGraph`, `agent0.graph`) compete for the "boss" role without a single working path.
- Tooling relies on services that are either mocked (knowledgeGraphTool) or offline (Neo4j driver defaults to localhost with hard-coded credentials).
- `orchestratorGraph` hardcodes `model: "gpt-4o-mini"` instead of reusing Sol's env-based configuration, and it auto-loads MCP tools that may fail at runtime.
- `/api/agents/boss` currently instantiates `buildAgent0('full' | 'legacy')`, but the "full" graph uses connectors and services that are missing, so requests fail.
- There is no documentation describing which LangGraph path is considered canonical or how to run it, and no working smoke route that uses the new OpenAI plumbing from `/api/sol/run`.

## Proposed minimal working target
- **Graph**: Reuse the `createDeptAgent` path to instantiate a single LangGraph (e.g., `sol-orchestrator`) that only runs ChatOpenAI with memory + optional RAG tool. Remove or disable MCP/Neo4j dependencies for the first milestone.
- **Route**: Keep POST `/api/agents/boss` but simplify the handler to call a new `runBossAgent(goal: string)` helper that wraps the selected LangGraph. Request body: `{ goal: string }`; response: `{ ok: true, result: string }`.
- **OpenAI config**: Share the same environment-driven settings as `/api/sol/run` (`OPENAI_API_KEY`, `OPENAI_MODEL` defaulting to `gpt-5.1-chat-latest`).
- **Tools**: Enable only the RAG tool if `/api/rag/search` is reachable; otherwise disable tools entirely and document the limitation. Knowledge-graph and MCP integrations will remain TODOs with clear notes in this report.
- **Report cadence**: Update this file as changes land, documenting findings, code adjustments, how to run, and remaining limitations.
