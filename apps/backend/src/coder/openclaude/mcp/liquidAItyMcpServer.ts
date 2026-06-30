// @graph entity: LiquidAItyMcpServer
// @graph role: mcp-boundary
// @graph relates_to: LiquidAItyAgentFlow, OpenClaudeQueryEngine(downstream consumer)
//
// The ONE LiquidAIty-owned MCP service that sits below the OpenClaude QueryEngine
// session. It is NOT a parallel tool framework and NOT a second chat: it exposes
// one resource and two tools, wrapping the downstream handlers.
//
//   Resource: project_context     (bounded authoritative deck/plan summary)
//   Tool:     describe_agent_fabric (real capability profile of the visible flow,
//                                    so the session writes executable steps)
//   Tool:     execute_visible_flow  (run the selected visible flow as a mission;
//                                    NO runApproved; needs_input when not runnable;
//                                    task updates keyed to existing plan task IDs)
//
// Transport: Streamable HTTP (stateful), hosted by the existing backend (single
// authoritative owner of deck state + Python transport). The QueryEngine connects
// to it as one `http` MCP client. No stdio second process / duplicate authority.

import { randomUUID } from 'node:crypto';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  buildAgentFabricProfile,
  buildProjectContext,
  executeVisibleFlow,
  type AgentFlowDeps,
  type ExecuteVisibleFlowInput,
} from './liquidAItyAgentFlow';
import { registerHarnessGraphTools } from './harnessGraphTools';

export const LIQUIDAITY_MCP_SERVER_NAME = 'liquidaity';

const describeFabricShape = {
  projectId: z.string().min(1),
  deckId: z.string().min(1),
  selectedCardId: z.string().optional(),
};

const missionPacketShape = z.object({
  objective: z.string().min(1),
  selectedTaskSteps: z
    .array(
      z.object({
        id: z.string(),
        shortTitle: z.string().optional(),
        detail: z.string().optional(),
        expectedArtifact: z.string().optional(),
      }),
    )
    .default([]),
  connectedAgentCapabilitySummary: z.string().optional(),
  neededInputs: z.array(z.string()).default([]),
  constraints: z.array(z.string()).default([]),
  expectedArtifacts: z.array(z.string()).default([]),
  acceptanceCriteria: z.array(z.string()).default([]),
  graphReadScope: z.array(z.string()).default([]),
  noDirectGraphWrite: z.boolean().default(true),
});

const executeVisibleFlowShape = {
  projectId: z.string().min(1),
  deckId: z.string().min(1),
  taskIds: z.array(z.string()).default([]),
  selectedCardId: z.string().optional(),
  missionPacket: missionPacketShape,
};

/**
 * Build the LiquidAIty MCP server (transport-agnostic). `deps` is injectable so
 * tests can drive it over an in-memory transport without the deck store / Python
 * rails. In production the defaults read authoritative deck state and reuse the
 * existing AutoGen transport.
 */
export function createLiquidAItyMcpServer(deps: AgentFlowDeps = {}): McpServer {
  const server = new McpServer(
    { name: LIQUIDAITY_MCP_SERVER_NAME, version: '0.1.0' },
    {
      capabilities: { resources: {}, tools: {} },
      // MCP server instructions (protocol-standard capability channel, surfaced to the model
      // by compliant clients). The authoritative, fuller capability is the project_context
      // resource (active ThinkGraph card + skills/thinkgraph.md) — kept thin here, not a prompt.
      instructions:
        'LiquidAIty project graphs. ThinkGraph (Apache AGE) = the user-visible directional ' +
        'reasoning map: read with thinkgraph_* tools; write ONLY via thinkgraph_apply_delta (the ' +
        'one durable writer) when a useful question/hypothesis/decision/constraint/query-seed/' +
        'rejected-path/unresolved-entity/relationship emerges — not every turn, concise visible ' +
        'notes only, never a transcript dump. KnowGraph (Neo4j, source-backed evidence) is ' +
        'READ-ONLY here (knowgraph_* tools) — never write it. Use graph_focus/graph_highlight/' +
        'graph_clear_highlight to navigate the existing canvas. Read the project_context resource ' +
        'and skills/thinkgraph.md + skills/knowgraph.md for the full operating rules.',
    },
  );

  server.registerResource(
    'project_context',
    new ResourceTemplate('liquidaity://project-context/{projectId}/{deckId}', { list: undefined }),
    {
      title: 'Project context',
      description:
        'Bounded authoritative selected-card / deck-flow / active-plan summary for a LiquidAIty project deck. Optional ?selectedCardId=... query selects a card.',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const projectId = String((variables as Record<string, unknown>).projectId || '');
      // A custom-scheme URI's trailing query is captured into the last template
      // variable, so strip it off deckId and parse selectedCardId from it.
      let deckId = String((variables as Record<string, unknown>).deckId || '');
      let selectedCardId: string | undefined;
      const queryIndex = deckId.indexOf('?');
      if (queryIndex >= 0) {
        const query = deckId.slice(queryIndex + 1);
        deckId = deckId.slice(0, queryIndex);
        const match = /(?:^|&)selectedCardId=([^&]*)/.exec(query);
        if (match) selectedCardId = decodeURIComponent(match[1]);
      }
      const context = await buildProjectContext({ projectId, deckId, selectedCardId }, deps);
      return {
        contents: [
          { uri: uri.href, mimeType: 'application/json', text: JSON.stringify(context, null, 2) },
        ],
      };
    },
  );

  server.registerTool(
    'describe_agent_fabric',
    {
      title: 'Describe agent fabric',
      description:
        'Inspect the REAL downstream Agent Fabric before writing an executable plan step: the visible flow catalog, runnable/connected state, and (for the selected flow) connected agents + roles, tools, models, expected artifacts, needs-input conditions, and graph-write policy. Do not invent agents, tools, data, or outputs — use this profile to write executable tasks.',
      inputSchema: describeFabricShape,
    },
    async ({ projectId, deckId, selectedCardId }) => {
      const profile = await buildAgentFabricProfile({ projectId, deckId, selectedCardId }, deps);
      return { content: [{ type: 'text' as const, text: JSON.stringify(profile, null, 2) }] };
    },
  );

  server.registerTool(
    'execute_visible_flow',
    {
      title: 'Execute visible flow',
      description:
        'Run the selected visible Agent Builder flow as a mission via the LiquidAIty Python AutoGen / Mag One runner. There is NO approval boolean — calling this is the execution command. Returns runId, task updates keyed to the provided plan task IDs, artifacts, evidence, progress, needs_input (when the flow is not runnable / lacks required context), failure, provenance, and PlanFlow-compatible updates. Mag One does not write the graph directly.',
      inputSchema: executeVisibleFlowShape,
    },
    async (input) => {
      const result = await executeVisibleFlow(input as ExecuteVisibleFlowInput, deps);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        isError: result.status === 'failed',
      };
    },
  );

  // Harness-only graph surface: read/write ThinkGraph, read-only KnowGraph, ephemeral
  // canvas navigation. There is deliberately NO KnowGraph write tool here.
  registerHarnessGraphTools(server);

  return server;
}

/**
 * Express handler for the Streamable HTTP MCP transport. The QueryEngine connects
 * to this as ONE `http` MCP client; the backend stays the single authoritative
 * owner of deck state + the Python transport. Stateful (session-mapped) so a
 * persistent client keeps its initialized session across requests — the standard
 * SDK pattern. Returns one handler bound to GET/POST/DELETE.
 */
export function createLiquidAItyMcpHttpHandler(deps: AgentFlowDeps = {}) {
  const transports = new Map<string, StreamableHTTPServerTransport>();

  return async (req: Request, res: Response): Promise<void> => {
    try {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;

      if (sessionId && transports.has(sessionId)) {
        await transports.get(sessionId)!.handleRequest(req, res, req.body);
        return;
      }

      if (!sessionId && req.method === 'POST' && isInitializeRequest(req.body)) {
        const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id: string) => {
            transports.set(id, transport);
          },
        });
        transport.onclose = () => {
          if (transport.sessionId) transports.delete(transport.sessionId);
        };
        const server = createLiquidAItyMcpServer(deps);
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      }

      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'mcp_session_required: send an initialize request first' },
        id: null,
      });
    } catch (error) {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: error instanceof Error ? error.message : 'mcp_internal_error' },
          id: null,
        });
      }
    }
  };
}
