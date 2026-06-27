// LiquidAIty MCP host — a SEPARATE Node process that hosts the one LiquidAIty
// MCP service for the OpenClaude QueryEngine. It runs OUTSIDE the Nx backend
// serve graph on purpose: the MCP SDK loads cleanly under plain node (verified),
// but the Nx `@nx/js` serve pipeline drops when the SDK enters its graph.
//
// It owns NO state: every tool/resource call bridges over HTTP to the existing
// backend's SDK-free /api/coder/mcp-bridge/* endpoints, which run the proven
// handlers where the backend already owns deck state + the Python transport.
// Single authority; no duplicated control plane.
//
// Transport: stdio — the gRPC QueryEngine loads this as ONE `stdio` MCP client
// (it spawns `node liquidAItyMcpHost.mjs`). Not a user-facing app or page.

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BACKEND = (process.env.LIQUIDAITY_BACKEND_URL || 'http://127.0.0.1:4000').replace(/\/+$/, '');

async function bridge(path, body) {
  const res = await fetch(`${BACKEND}/api/coder/mcp-bridge/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const json = await res.json().catch(() => ({}));
  return { httpStatus: res.status, json };
}

const server = new McpServer(
  { name: 'liquidaity', version: '0.1.0' },
  { capabilities: { resources: {}, tools: {} } },
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
    const projectId = String(variables.projectId || '');
    let deckId = String(variables.deckId || '');
    let selectedCardId;
    const qi = deckId.indexOf('?');
    if (qi >= 0) {
      const query = deckId.slice(qi + 1);
      deckId = deckId.slice(0, qi);
      const m = /(?:^|&)selectedCardId=([^&]*)/.exec(query);
      if (m) selectedCardId = decodeURIComponent(m[1]);
    }
    const { json } = await bridge('project_context', { projectId, deckId, selectedCardId });
    return {
      contents: [
        { uri: uri.href, mimeType: 'application/json', text: JSON.stringify(json.projectContext ?? json, null, 2) },
      ],
    };
  },
);

server.registerTool(
  'describe_agent_fabric',
  {
    title: 'Describe agent fabric',
    description:
      'Inspect the REAL downstream Agent Fabric before writing an executable plan step: visible flow catalog, runnable/connected state, and (for the selected flow) connected agents + roles, tools, models, expected artifacts, needs-input conditions, and graph-write policy. Do not invent agents, tools, data, or outputs.',
    inputSchema: { projectId: z.string().min(1), deckId: z.string().min(1), selectedCardId: z.string().optional() },
  },
  async (args) => {
    const { json } = await bridge('describe_agent_fabric', args);
    return { content: [{ type: 'text', text: JSON.stringify(json.agentFabricProfile ?? json, null, 2) }] };
  },
);

server.registerTool(
  'execute_visible_flow',
  {
    title: 'Execute visible flow',
    description:
      'Run the selected visible Agent Builder flow as a mission via the LiquidAIty Python AutoGen / Mag One runner. No approval boolean — calling this is the execution command. Returns runId, task updates keyed to the provided plan task IDs, artifacts, evidence, progress, needs_input (when the flow is not runnable), failure, provenance, and PlanFlow-compatible updates.',
    inputSchema: {
      projectId: z.string().min(1),
      deckId: z.string().min(1),
      taskIds: z.array(z.string()).default([]),
      selectedCardId: z.string().optional(),
      missionPacket: z.object({
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
      }),
    },
  },
  async (args) => {
    const { json } = await bridge('execute_visible_flow', args);
    const result = json.result ?? json;
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      isError: result?.status === 'failed',
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
// eslint-disable-next-line no-console
console.error('[liquidaity-mcp-host] stdio MCP server connected; backend=' + BACKEND);
