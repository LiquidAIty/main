import { describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createLiquidAItyMcpServer } from './liquidAItyMcpServer';
import type { AgentFlowDeps } from './liquidAItyAgentFlow';

const DECK = {
  id: 'deck_builder',
  name: 'Builder Deck',
  nodes: [
    { id: 'card_magentic', kind: 'agent', runtimeType: 'magentic_one', title: 'Mag One' },
    {
      id: 'card_research',
      kind: 'agent',
      runtimeType: 'assistant_agent',
      title: 'Research Agent',
      runtimeOptions: { modelKey: 'gpt-5.1', provider: 'openai', tools: ['current_datetime'] },
    },
  ],
  edges: [{ id: 'e1', source: 'card_magentic', target: 'card_research', edgeType: 'magentic_option' }],
};
const ROUTING = {
  projectId: 'project-1',
  deckId: 'deck_builder',
  eligibleBusConnectedAgents: [{ id: 'card_research', title: 'Research Agent', role: 'research', reason: '' }],
  selectedExecutionPath: [],
  ignoredEligibleAgents: [],
  disconnectedAgentsIgnored: [],
  missingRequiredAgents: [],
  blockedReason: null,
};

const MISSION = {
  projectId: 'project-1',
  deckId: 'deck_builder',
  taskIds: ['t1', 't2'],
  missionPacket: { objective: 'Research RDW catalysts', selectedTaskSteps: [{ id: 't1' }] },
};

async function connectedClient(deps: AgentFlowDeps) {
  const server = createLiquidAItyMcpServer(deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(clientTransport);
  return client;
}

function baseDeps(over: Partial<AgentFlowDeps> = {}): AgentFlowDeps {
  return {
    loadDeck: vi.fn(async () => ({ deck: DECK, latestRun: null, runs: [], meta: {} })) as any,
    buildRouting: vi.fn(() => ROUTING) as any,
    runCard: vi.fn() as any,
    ...over,
  };
}

describe('LiquidAIty MCP server', () => {
  it('exposes the agent-flow tools, the Harness graph tools, and the project_context template (no execute_agent_flow)', async () => {
    const client = await connectedClient(baseDeps());
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual([
      'describe_agent_fabric',
      'execute_visible_flow',
      'graph_clear_highlight',
      'graph_focus',
      'graph_highlight',
      'knowgraph_get_slice',
      'knowgraph_get_source_context',
      'knowgraph_inspect_evidence',
      'knowgraph_search',
      'thinkgraph_apply_delta',
      'thinkgraph_get_decisions',
      'thinkgraph_get_open_questions',
      'thinkgraph_get_query_seeds',
      'thinkgraph_get_rejected_paths',
      'thinkgraph_get_slice',
      'thinkgraph_search',
    ]);
    const templates = await client.listResourceTemplates();
    expect(templates.resourceTemplates.map((t) => t.name)).toContain('project_context');
  });

  it('enforces the graph boundary: ThinkGraph is writable, KnowGraph is read-only', async () => {
    const client = await connectedClient(baseDeps());
    const tools = (await client.listTools()).tools.map((t) => t.name);
    // ThinkGraph has exactly one writer.
    expect(tools).toContain('thinkgraph_apply_delta');
    // KnowGraph has NO write/apply tool of any kind on the Harness surface.
    expect(tools.filter((n) => n.startsWith('knowgraph_'))).toEqual([
      'knowgraph_get_slice',
      'knowgraph_search',
      'knowgraph_inspect_evidence',
      'knowgraph_get_source_context',
    ]);
    expect(tools.some((n) => /^knowgraph_(apply|write|delta|upsert|merge)/.test(n))).toBe(false);
  });

  it('describe_agent_fabric returns the real capability profile over MCP', async () => {
    const client = await connectedClient(baseDeps());
    const res: any = await client.callTool({
      name: 'describe_agent_fabric',
      arguments: { projectId: 'project-1', deckId: 'deck_builder' },
    });
    const profile = JSON.parse(res.content[0].text);
    expect(profile.visibleFlows[0]).toMatchObject({ flowId: 'card_magentic', runnable: true });
    expect(profile.selectedFlowProfile.connectedAgents[0].id).toBe('card_research');
    expect(profile.selectedFlowProfile.graphWritePolicy).toBe('no_direct_graph_write');
  });

  it('execute_visible_flow runs the mission and keys updates to plan task IDs (no runApproved)', async () => {
    const runCard = vi.fn(async () => ({
      output: 'Mission complete.',
      status: 'success',
      magenticTrace: {
        plan: { taskLedgerArtifact: { source: 'autogen_0_7_5_magentic_one', planFlowTaskObjects: [{ id: 't1' }] } },
        ledgerTrace: { source: 'python_magone' },
      },
    }));
    const client = await connectedClient(baseDeps({ runCard: runCard as any }));
    const res: any = await client.callTool({ name: 'execute_visible_flow', arguments: MISSION });

    const ctxArg = runCard.mock.calls[0][3] as Record<string, unknown>;
    expect('runApproved' in ctxArg).toBe(false);

    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.status).toBe('completed');
    expect(parsed.taskUpdates.map((u: any) => u.taskId)).toEqual(['t1', 't2']);
    expect(parsed.planFlowUpdates).toEqual([{ id: 't1' }]);
  });

  it('execute_visible_flow returns needs_input when the flow is not runnable', async () => {
    const runCard = vi.fn();
    const client = await connectedClient(
      baseDeps({
        buildRouting: vi.fn(() => ({ ...ROUTING, eligibleBusConnectedAgents: [] })) as any,
        runCard: runCard as any,
      }),
    );
    const res: any = await client.callTool({ name: 'execute_visible_flow', arguments: MISSION });
    expect(runCard).not.toHaveBeenCalled();
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.status).toBe('needs_input');
    expect(parsed.needsInput[0].reason).toMatch(/no connected agents/);
  });
});
