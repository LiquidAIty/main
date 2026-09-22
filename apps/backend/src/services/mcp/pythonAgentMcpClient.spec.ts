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
  it('keeps the idle catalog application-owned and free of native external providers', async () => {
    const names = await listPythonAgentMcpTools();
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(expect.arrayContaining([
      'canvas.inspect',
      'canvas.upsert_wire',
      'card.create',
      'card.load_graph_references',
      'card.update_configuration',
      'engraphis_recall_context',
      'engraphis_get_memory',
      'engraphis_remember',
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
    expect(names).not.toContain('card.run_assistant_agent');
    expect(names).not.toContain('card.run_agent');
    expect(names.some((name) => name.startsWith('cbm.'))).toBe(false);
    expect(names.some((name) => name.startsWith('graphiti.'))).toBe(false);
  }, 30_000);

  it('late-binds only the native family granted to an authorized Builder turn', async () => {
    const catalog = await listPythonAgentMcpCatalog({
      kind: 'card-runtime',
      projectId: 'project-one',
      deckId: 'deck_builder',
      conversationId: 'conversation-one',
      parentRunId: 'run-one',
      callerCardId: 'builder',
      callerRuntimeKind: 'hermes',
      callerRuntimeMode: 'delegate',
      grantedTools: ['cbm.search_graph'],
      presentedTools: ['cbm.search_graph'],
    });
    const search = catalog.find((tool) => tool.name === 'cbm.search_graph');
    expect(search).toMatchObject({
      sourceId: 'cbm',
      namespace: 'cbm',
      nativeName: 'search_graph',
      connectionKind: 'external-mcp',
      inputSchema: expect.any(Object),
    });
    expect(search).not.toHaveProperty('capability');
    expect(catalog.some((tool) => tool.name.startsWith('graphiti.'))).toBe(false);
  }, 60_000);

  it('rejects smuggled prompt/model/tool arguments at the MCP boundary', async () => {
    const result = await callPythonAgentMcpTool('run_mag_one', {
      projectId: 'p',
      deckId: 'deck_builder',
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
