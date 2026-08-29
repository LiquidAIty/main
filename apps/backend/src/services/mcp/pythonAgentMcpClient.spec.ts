// REAL MCP-boundary integration (SPEC: do not mock MCP discovery/call).
// Connects to the already-supervised official HTTP MCP host through the SDK.
// It is intentionally conditional because this test must never spawn a second host.
import { afterAll, describe, expect, it } from 'vitest';

import {
  callPythonAgentMcpTool,
  closePythonAgentMcpClient,
  listPythonAgentMcpCatalog,
  listPythonAgentMcpTools,
} from './pythonAgentMcpClient';

afterAll(async () => {
  await closePythonAgentMcpClient();
});

const canonicalHostAvailable = Boolean(
  process.env.LIQUIDAITY_INTERNAL_MCP_SECRET
  && process.env.LIQUIDAITY_INTERNAL_MCP_URL,
);

describe.runIf(canonicalHostAvailable)('Python Agent MCP host — authenticated HTTP discovery + calls', () => {
  it('publishes bounded Constellation tools with the native CBM and Graphiti catalogs', async () => {
    const names = await listPythonAgentMcpTools();
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(expect.arrayContaining([
      'canvas.inspect',
      'canvas.upsert_wire',
      'card.create',
      'card.load_graph_references',
      'card.run_assistant_agent',
      'card.update_configuration',
      'cbm.search_graph',
      'cbm.index_status',
      'constellation.context',
      'constellation.inspect',
      'constellation.remember',
      'graphiti.search_nodes',
      'graphiti.get_status',
      'agentgraph.inspect',
      'mag_one.describe_connected_agents',
      'main.context',
      'run_mag_one',
      'write_mag_one_instructions',
      'web_search',
    ]));
    // Obsolete model-facing graph and agent-fabric wrappers are all gone.
    expect(names).not.toContain('thinkgraph.process_conversation_pair');
    expect(names).not.toContain('thinkgraph.apply_live_patch');
    expect(names).not.toContain('execute_visible_flow');
    expect(names).not.toContain('describe_agent_fabric');
    expect(names).not.toContain('knowgraph.query');
    expect(names).not.toContain('knowgraph.ingest');
    expect(names).not.toContain('codegraph.search');
    expect(names).not.toContain('codegraph.status');
    expect(names).not.toContain('coder.inspect');
    expect(names).not.toContain('coder.effective_tools');
    expect(names).not.toContain('coder.account');
    expect(names).not.toContain('coder.stop');
    expect(names).not.toContain('coder.steer');
    expect(names).not.toContain('coder.status');
  // A cold host initializes two native catalogs; slower backup/development
  // machines can cross 30s even when the real catalog completes successfully.
  }, 60_000);

  it('returns factual native contracts without runtime capability classifiers', async () => {
    const catalog = await listPythonAgentMcpCatalog();
    const search = catalog.find((tool) => tool.name === 'cbm.search_graph');
    expect(search).toMatchObject({
      sourceId: 'cbm',
      namespace: 'cbm',
      nativeName: 'search_graph',
      connectionKind: 'external-mcp',
      inputSchema: expect.any(Object),
    });
    expect(search).not.toHaveProperty('capability');
  }, 60_000);

  it('rejects smuggled prompt/model/tool arguments at the MCP boundary', async () => {
    const result = await callPythonAgentMcpTool('card.run_assistant_agent', {
      projectId: 'p',
      deckId: 'deck_builder',
      cardId: 'c',
      correlationId: 'x',
      input: 'hi',
      prompt: 'evil',
      modelKey: 'evil-model',
      tools: ['shell'],
    });
    expect(result.ok).toBe(false);
    expect(String(result.error)).toContain('Input validation error');
    expect(String(result.error)).toContain('prompt');
    expect(String(result.error)).toContain('modelKey');
    expect(String(result.error)).toContain('tools');
  }, 30_000);
});
