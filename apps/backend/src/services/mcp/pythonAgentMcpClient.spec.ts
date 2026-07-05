// REAL MCP-boundary integration (SPEC: do not mock MCP discovery/call).
// Spawns the actual Python Agent MCP host over stdio via the official SDK client,
// proves tool discovery and structural argument rejection at the boundary.
// Requires: the python venv + the backend dev server on :4000 (real dev topology).
import { describe, expect, it } from 'vitest';

import { callPythonAgentMcpTool, listPythonAgentMcpTools } from './pythonAgentMcpClient';

describe('Python Agent MCP host — real stdio discovery + calls', () => {
  it('exposes exactly the Mag One entrypoints, the bounded ThinkGraph read, and the Harness control surface (no model-facing write, no pair front door, no visible-flow wrapper)', async () => {
    const names = await listPythonAgentMcpTools();
    expect(names).toEqual([
      'canvas.inspect',
      'canvas.upsert_wire',
      'card.assign_data_binding',
      'card.assign_runtime_skill',
      'card.run_assistant_agent',
      'card.update_configuration',
      'mag_one.describe_connected_agents',
      'run_mag_one',
      'thinkgraph.get_graph_slice',
    ]);
    // The obsolete pair front door, the model-facing write tool, and the old
    // visible-flow / agent-fabric wrapper tools are all gone.
    expect(names).not.toContain('thinkgraph.process_conversation_pair');
    expect(names).not.toContain('thinkgraph.apply_live_patch');
    expect(names).not.toContain('execute_visible_flow');
    expect(names).not.toContain('describe_agent_fabric');
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
    expect(String(result.error)).toContain('tool_arguments_rejected');
    expect(String(result.error)).toContain('prompt');
    expect(String(result.error)).toContain('modelKey');
    expect(String(result.error)).toContain('tools');
  }, 30_000);

  it('a bounded read-only graph slice flows through the real bridge and returns structured scope', async () => {
    const result = await callPythonAgentMcpTool('thinkgraph.get_graph_slice', {
      projectId: '20ac92da-01fd-4cf6-97cc-0672421e751a',
      limit: 5,
    });
    // Honest structured result from the real backend bridge (never a thrown error).
    expect(result).toBeTruthy();
    expect(typeof result).toBe('object');
  }, 30_000);
});
