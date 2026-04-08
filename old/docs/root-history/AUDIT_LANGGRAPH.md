# LangGraph Integration Audit for LiquidAIty

This document provides a detailed audit of the current codebase in the LiquidAIty project, focusing on the integration potential for LangGraph. The audit covers route inventory, chat path tracing, LangGraph presence, agent configuration, MCP and n8n status, and identifies gaps and integration options.

## A. Route Map

| METHOD | PATH                              | FILE                                      | HANDLER EXPORT          |
|--------|-----------------------------------|-------------------------------------------|-------------------------|
| GET    | /                                 | main.ts                                   | N/A (inline)            |
| GET    | /health                           | main.ts                                   | N/A (inline)            |
| POST   | /api/sol/run                      | sol.routes.ts                             | default (router)        |
| GET    | /api/sol/why                      | sol.debug.routes.ts                       | default (router)        |
| POST   | /api/agent/boss                   | agent.routes.ts                           | agentRoutes             |
| POST   | /artifacts/execute                | artifacts.routes.ts                       | default (router)        |
| GET    | /artifacts/                       | artifacts.routes.ts                       | default (router)        |
| POST   | /artifacts/                       | artifacts.routes.ts                       | default (router)        |
| POST   | /auth/start                       | auth.routes.ts                            | default (router)        |
| GET    | /auth/me                          | auth.routes.ts                            | default (router)        |
| POST   | /auth/logout                      | auth.routes.ts                            | default (router)        |
| GET    | /cache/                           | cache.routes.ts                           | default (router)        |
| GET    | /db/                              | db.routes.ts                              | default (router)        |
| POST   | /dispatch/                        | dispatch.routes.ts                        | default (router)        |
| GET    | /health/                          | health.routes.ts                          | default (router)        |
| GET    | /health/tools                     | health.routes.ts                          | default (router)        |
| GET    | /mcp/available-tools              | mcp-tools.routes.ts                       | default (router)        |
| GET    | /mcp/installed-tools              | mcp-tools.routes.ts                       | default (router)        |
| POST   | /mcp/install-tool                 | mcp-tools.routes.ts                       | default (router)        |
| POST   | /mcp/uninstall-tool               | mcp-tools.routes.ts                       | default (router)        |
| POST   | /mcp/collect-youtube              | mcp-tools.routes.ts                       | default (router)        |
| POST   | /mcp/collect-news                 | mcp-tools.routes.ts                       | default (router)        |
| GET    | /mcp/knowledge-graph              | mcp-tools.routes.ts                       | default (router)        |
| POST   | /mcp/build-knowledge-graph        | mcp-tools.routes.ts                       | default (router)        |
| POST   | /mcp/check-hallucination          | mcp-tools.routes.ts                       | default (router)        |
| GET    | /mcp/catalog                      | mcp.catalog.routes.ts                     | default (router)        |
| GET    | /mcp/catalog/:category            | mcp.catalog.routes.ts                     | default (router)        |
| GET    | /mcp/catalog/find                 | mcp.catalog.routes.ts                     | default (router)        |
| POST   | /tools/:name                      | tools.routes.ts                           | default (router)        |
| GET    | /tools/try/:name                  | tools.routes.ts                           | default (router)        |
| POST   | /webhook/execute                  | webhook.routes.ts                         | webhookRouter           |
| POST   | /tools/openai                     | openai.routes.ts                          | default (router)        |

## B. Chat Path Trace

### Endpoint: POST /api/sol/run (sol.routes.ts)
- **Request Body Shape**: `{ goal: string, agentMode: 'orchestrator'|'specialized'|'simple', agentType?: 'code'|'marketing'|'research' }`
- **Response Shape**: `{ ok: boolean, text: string, decision: string }`
- **Call Graph to Model Call**:
  - If `agentMode` is 'orchestrator' or 'specialized', it uses `createDeptAgent` from `agentFactory.ts` to create an agent with a specific persona.
  - The agent’s `run` method invokes a LangGraph workflow using `ChatOpenAI` from `@langchain/openai`.
  - The model call happens in `callModel` function within `agentFactory.ts`, using `bound.invoke(messages)`.
- **Helpers Called**: `createDeptAgent`, `solRun` (for simple mode).
- **Error Handling**: Errors are caught and converted to a JSON response with status 400 or 502, including error messages as text.

### Endpoint: POST /api/agent/boss (agent.routes.ts)
- **Request Body Shape**: `{ projectId: string, goal: string, domain: string }`
- **Response Shape**: `{ ok: boolean, projectId: string, domain: string, result: { final: string } }`
- **Call Graph to Model Call**: Currently a stub with no actual model call; returns a placeholder response.
- **Helpers Called**: None.
- **Error Handling**: Not applicable as it’s a stub.

## C. LangGraph Modules

- **File: agents/lang/agentFactory.ts**
  - **Exports**: `createDeptAgent`
  - **State Schema**: Uses `MessagesAnnotation` from `@langchain/langgraph`.
  - **Nodes**: `agent` (calls model), `tools` (handles tool calls).
  - **Edges**: `__start__` to `agent`, `tools` to `agent`, conditional from `agent` to `tools` or `__end__`.
  - **Invocation**: Invoked in `sol.routes.ts` via `createDeptAgent().run()`.

- **File: agents/orchestrator/agent0.graph.ts**
  - **Exports**: `buildAgent0`
  - **State Schema**: Custom `Agent0State` with `q`, `depts`, `results`.
  - **Nodes**: `plan`, `run`, `reduce`.
  - **Edges**: `__start__` to `plan`, `plan` to `run`, `run` to `reduce`, `reduce` to `END`.
  - **Invocation**: Not currently invoked; appears to be a prepared but unused graph.

- **File: agents/tools/openai.agent.ts**
  - **Exports**: `openaiAgentTool`
  - **State Schema**: Uses `MessagesAnnotation` from `@langchain/langgraph`.
  - **Nodes**: `agent` (calls model), `tools` (handles tool calls).
  - **Edges**: `__start__` to `agent`, `tools` to `agent`, conditional from `agent` to `tools` or `__end__`.
  - **Invocation**: Can be invoked via tool registry in `dispatch.routes.ts` or directly in routes.

## D. Agent Config Flow

- **Storage/Reading**: 
  - Agent metadata (ids, types, prompts) are hardcoded in `agentFactory.ts` as `DeptAgentSpec` objects with `id`, `name`, `defaultPersona`, and `matchKeywords`.
  - Additional configuration like model and provider can be passed dynamically via `run` parameters in `agentFactory.ts` and `openai.agent.ts`.
  - `jsonStore.ts` provides storage for agent data, configs, etc., scoped by user ID for isolation.
- **Graph Indicator**: There’s no explicit flag like `type: 'graph'`, but the use of `createDeptAgent` and LangGraph’s `StateGraph` in `agentFactory.ts` indicates graph-based agent orchestration.

## E. MCP & n8n Endpoints

- **MCP Endpoints**:
  - `/mcp/available-tools` (mcp-tools.routes.ts) - Real, uses `MCPController`.
  - `/mcp/installed-tools` (mcp-tools.routes.ts) - Real, uses `MCPToolRegistry`.
  - `/mcp/install-tool`, `/mcp/uninstall-tool`, `/mcp/collect-youtube`, `/mcp/collect-news`, `/mcp/knowledge-graph`, `/mcp/build-knowledge-graph`, `/mcp/check-hallucination` (mcp-tools.routes.ts) - Real implementations.
  - `/mcp/catalog`, `/mcp/catalog/:category`, `/mcp/catalog/find` (mcp.catalog.routes.ts) - Real, uses MCP server listing functions.
- **n8n Endpoints**: 
  - No direct n8n endpoints mounted, but `n8nCallWebhook` function in `connectors/n8n.ts` suggests real SDK usage for triggering workflows via webhooks, accessible as a tool in agent graphs.

## F. Gaps & Risks

- **Limited Direct Chat Endpoint**: Only `/api/sol/run` fully integrates with LangGraph; `/api/agent/boss` is a stub and lacks model integration.
- **Unused Graph Module**: `agent0.graph.ts` defines a comprehensive orchestration graph but is not invoked anywhere, representing untapped potential.
- **Hardcoded Configurations**: Agent personas and configurations are hardcoded in `agentFactory.ts` and `sol.ts`, limiting dynamic customization.
- **Scalability Concern**: Current JSON file-based storage in `jsonStore.ts` may not scale with multiple users or large data volumes.
- **Error Handling**: While errors are converted to text responses, there’s a risk of exposing sensitive information in error messages if not sanitized.

## G. Minimal Integration Options

1. **Enhance Existing /api/sol/run Endpoint**:
   - Leverage the already integrated `createDeptAgent` in `sol.routes.ts` to fully utilize LangGraph’s capabilities for all agent modes.
   - Update `solRun` to use dynamic agent selection based on `routeQuery` from `sol.ts` for better routing.
2. **Activate agent0.graph.ts for Orchestration**:
   - Integrate `buildAgent0` from `agent0.graph.ts` into a new or existing endpoint (e.g., enhance `/api/agent/boss`) to handle multi-step orchestration.
   - Map the `plan`, `run`, and `reduce` nodes to execute department-specific agents in parallel.
3. **Extend Tool-Based Invocation**:
   - Use `openaiAgentTool` from `openai.agent.ts` as a model for creating additional LangGraph-based tools invocable via `/tools/:name`, ensuring modularity.

## APPROACH I WILL IMPLEMENT

**Selected Option**: Activate `agent0.graph.ts` for Orchestration via enhancing `/api/agent/boss` endpoint.

**Rationale**: This approach utilizes an existing but unused LangGraph module designed for multi-department orchestration, aligning with the project’s goal of a comprehensive agent system without requiring new stubs or significant UI changes.

**Step-by-Step Diffs**:
1. **Update `agent.routes.ts` to Use `buildAgent0`**:
   - File: `apps/backend/src/routes/agent.routes.ts`
   - Change: Replace stub in `agentRoutes.post('/boss', ...)` with a call to `buildAgent0().invoke({ q: goal })` from `agent0.graph.ts`.
   - Purpose: Activates the orchestration graph for real agent coordination.
2. **Ensure Tool Registry Integration**:
   - File: `apps/backend/src/agents/registry.ts`
   - Change: Verify all department agents (code, marketing, research) are registered and accessible via `getTool()` for `runParallel` in `agent0.graph.ts`.
   - Purpose: Ensures the graph can invoke necessary department agents.
3. **Enhance Error Handling in Graph Execution**:
   - File: `apps/backend/src/agents/orchestrator/agent0.graph.ts`
   - Change: Add try-catch blocks in `runParallel` to handle individual department failures gracefully, ensuring `reduce` still processes partial results.
   - Purpose: Prevents full orchestration failure if one department agent fails.
4. **Return Structured Response from Orchestration**:
   - File: `apps/backend/src/routes/agent.routes.ts`
   - Change: Format the response in `/boss` to return `{ ok: true, result: { final: results.__final__, departments: results } }`.
   - Purpose: Provides a comprehensive response combining all department outputs.

This plan ensures LangGraph is fully integrated into the existing backend, leveraging `agent0.graph.ts` for orchestration without altering the UI or introducing new dependencies.
