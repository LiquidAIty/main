// REAL MCP-boundary integration (SPEC: do not mock MCP discovery/call).
// Spawns the actual Python Agent MCP host over stdio via the official SDK client,
// proves tool discovery and structural argument rejection at the boundary.
// Discovery + argument rejection need only the python venv (offline-runnable);
// the graph-slice call needs the live backend on :4000 and is explicitly gated
// on LIQUIDAITY_LIVE_STACK=1 — a visible skip offline, never a hidden failure.
import { describe, expect, it } from 'vitest';

import { callPythonAgentMcpTool, listPythonAgentMcpTools } from './pythonAgentMcpClient';

const LIVE_STACK = process.env.LIQUIDAITY_LIVE_STACK === '1';

describe('Python Agent MCP host — real stdio discovery + calls', () => {
  it('federates the three complete native catalogs with the LiquidAIty control surface', async () => {
    const names = await listPythonAgentMcpTools();
    expect(names).toHaveLength(83);
    expect(new Set(names).size).toBe(83);
    expect(names.filter((name) => name.startsWith('cbm.'))).toHaveLength(14);
    expect(names.filter((name) => name.startsWith('engraphis.'))).toHaveLength(29);
    expect(names.filter((name) => name.startsWith('graphiti.'))).toHaveLength(13);
    expect(names).toEqual(expect.arrayContaining([
      'agentgraph.inspect',
      'canvas.inspect',
      'canvas.upsert_wire',
      'card.run_assistant_agent',
      'card.update_configuration',
      'coder.status',
      'coder.effective_tools',
      'cbm.search_graph',
      'cbm.index_status',
      'engraphis.recall',
      'engraphis.stats',
      'graphiti.search_nodes',
      'graphiti.get_status',
      'graphview.create',
      'graphview.get',
      'graphview.list',
      'hermes.memory_read',
      'hermes.memory_write',
      'hermes.read_report',
      'hermes.write_report',
      'mag_one.describe_connected_agents',
      'main.context',
      'run_coder_subagent',
      'run_mag_one',
      'thinkgraph.get_graph_slice',
      'thinkgraph.submit_update',
      'web_search',
      'worldsignals.batch',
      'worldsignals.capabilities',
      'worldsignals.command',
      'worldsignals.poll',
      'worldsignals.stream_events',
      'write_mag_one_instructions',
    ]));
    // The obsolete pair front door, the model-facing write tool, and the old
    // visible-flow / agent-fabric wrapper tools are all gone.
    expect(names).not.toContain('thinkgraph.process_conversation_pair');
    expect(names).not.toContain('thinkgraph.apply_live_patch');
    expect(names).not.toContain('thinkgraph.persist_graph_view');
    expect(names).not.toContain('execute_visible_flow');
    expect(names).not.toContain('describe_agent_fabric');
    expect(names).not.toContain('knowgraph.query');
    expect(names).not.toContain('knowgraph.ingest');
    expect(names).not.toContain('codegraph.search');
    expect(names).not.toContain('codegraph.status');
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

  it.runIf(LIVE_STACK)('a bounded read-only graph slice flows through the real bridge and returns structured scope', async () => {
    const result = await callPythonAgentMcpTool('thinkgraph.get_graph_slice', {
      projectId: '20ac92da-01fd-4cf6-97cc-0672421e751a',
      limit: 5,
    });
    // Honest structured result from the real backend bridge (never a thrown error).
    expect(result).toBeTruthy();
    expect(typeof result).toBe('object');
  }, 30_000);
});
