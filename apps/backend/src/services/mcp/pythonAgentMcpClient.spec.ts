// REAL MCP-boundary integration (SPEC: do not mock MCP discovery/call).
// Spawns the actual Python Agent MCP host over stdio via the official SDK client,
// proves tool discovery, structural argument rejection, and the live bridge chain
// (host → backend mcp-bridge → post-chat runner) returning honest structural failures.
// Requires: the python venv + the backend dev server on :4000 (real dev topology).
import { describe, expect, it } from 'vitest';

import { callPythonAgentMcpTool, listPythonAgentMcpTools } from './pythonAgentMcpClient';

describe('Python Agent MCP host — real stdio discovery + calls', () => {
  it('exposes exactly the migrated tools, the ThinkGraph post-chat runner, and the Harness control surface', async () => {
    const names = await listPythonAgentMcpTools();
    expect(names).toEqual([
      'canvas.inspect',
      'canvas.upsert_wire',
      'card.assign_data_binding',
      'card.assign_runtime_skill',
      'card.run_assistant_agent',
      'card.update_configuration',
      'describe_agent_fabric',
      'execute_visible_flow',
      'thinkgraph.get_graph_slice',
      'thinkgraph.process_conversation_pair',
    ]);
  }, 30_000);

  it('rejects smuggled prompt/model/patch arguments at the MCP boundary', async () => {
    const result = await callPythonAgentMcpTool('thinkgraph.process_conversation_pair', {
      projectId: 'p',
      conversationId: 'c',
      userMessageId: 'u',
      assistantMessageId: 'a',
      correlationId: 'x',
      prompt: 'evil',
      modelKey: 'evil-model',
      patch: { resources: [] },
    });
    expect(result.ok).toBe(false);
    expect(String(result.error)).toContain('tool_arguments_rejected');
    expect(String(result.error)).toContain('prompt');
    expect(String(result.error)).toContain('modelKey');
    expect(String(result.error)).toContain('patch');
  }, 30_000);

  it('valid structural refs flow through the real bridge and fail honestly on a missing pair', async () => {
    const result = await callPythonAgentMcpTool('thinkgraph.process_conversation_pair', {
      projectId: '20ac92da-01fd-4cf6-97cc-0672421e751a',
      deckId: 'deck_builder',
      conversationId: 'main',
      userMessageId: 'msg_does_not_exist',
      assistantMessageId: 'msg_also_missing',
      correlationId: `tg:mcp-spec-${Date.now()}`,
    });
    expect(result.ok).toBe(false);
    const inner = (result as any).result ?? result;
    expect(String(inner.error || result.error)).toContain('pair_user_message_not_found');
  }, 30_000);
});
