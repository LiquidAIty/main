// REAL MCP-boundary integration (SPEC: do not mock MCP discovery/call).
// Spawns the actual Python Agent MCP host over stdio via the official SDK client,
// proves tool discovery and structural argument rejection at the boundary.
// Discovery + argument rejection need only the python venv (offline-runnable).
import { describe, expect, it } from 'vitest';

import { callPythonAgentMcpTool, listPythonAgentMcpTools } from './pythonAgentMcpClient';

describe('Python Agent MCP host — real stdio discovery + calls', () => {
  it('federates the three complete native catalogs with the LiquidAIty control surface', async () => {
    const names = await listPythonAgentMcpTools();
    expect(new Set(names).size).toBe(names.length);
    expect(names.filter((name) => name.startsWith('cbm.'))).toHaveLength(14);
    expect(names.filter((name) => name.startsWith('engraphis.'))).toHaveLength(31);
    expect(names.filter((name) => name.startsWith('graphiti.'))).toHaveLength(13);
    expect(names).toEqual(expect.arrayContaining([
      'agentgraph.inspect',
      'canvas.inspect',
      'canvas.upsert_wire',
      'card.run_assistant_agent',
      'card.update_configuration',
      'coder.status',
      'cbm.search_graph',
      'cbm.index_status',
      'engraphis.recall',
      'engraphis.stats',
      'graphiti.search_nodes',
      'graphiti.get_status',
      'mag_one.describe_connected_agents',
      'main.context',
      'run_coder_subagent',
      'run_mag_one',
      'web_search',
      'write_mag_one_instructions',
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
    expect(names).toContain('engraphis.check_update');
    expect(names).toContain('engraphis.context_savings');
    expect(names).toContain('engraphis.answer');
  }, 30_000);

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
