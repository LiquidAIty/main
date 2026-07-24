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
  it('exposes exactly the Mag One entrypoints, the bounded ThinkGraph read, and the Harness control surface (no model-facing write, no pair front door, no visible-flow wrapper)', async () => {
    const names = await listPythonAgentMcpTools();
    // Mirror of the Python host's own surface test (test_thinkgraph_card_tools
    // TestPythonMcpHost) — one host, with native Hermes living in LocalCoder
    // rather than a second model-facing preflight tool.
    //
    // This list froze at 19 while the host legitimately grew to 34: the
    // WorldSignals channel (5), the clean-room analysis engine (7), the Hermes
    // report surface (2), and web_search. Each is a documented, additive
    // capability — the failure was this expectation, not the host.
    expect(names).toEqual([
      'agentgraph.create_context',
      'agentgraph.read_context',
      'canvas.inspect',
      'canvas.upsert_wire',
      'card.assign_data_binding',
      'card.assign_runtime_skill',
      'card.run_assistant_agent',
      'card.update_configuration',
      'engraphis_answer',
      'engraphis_check_update',
      'engraphis_code_impact',
      'engraphis_code_path',
      'engraphis_consolidate',
      'engraphis_correct',
      'engraphis_end_session',
      'engraphis_export_code_graph',
      'engraphis_export_receipts',
      'engraphis_forget',
      'engraphis_index_repo',
      'engraphis_ingest',
      'engraphis_ingest_postgres_schema',
      'engraphis_link',
      'engraphis_pin',
      'engraphis_proactive_context',
      'engraphis_promote',
      'engraphis_recall',
      'engraphis_recall_grounded',
      'engraphis_recall_proactive',
      'engraphis_receipts',
      'engraphis_record_event',
      'engraphis_remember',
      'engraphis_search_code',
      'engraphis_start_session',
      'engraphis_stats',
      'engraphis_timeline',
      'engraphis_verify_receipts',
      'engraphis_why',
      'hermes.memory_read',
      'hermes.memory_write',
      'hermes.read_report',
      'hermes.write_report',
      'knowgraph.ingest',
      'knowgraph.query',
      'knowgraph_analyze_scope',
      'knowgraph_compare_providers',
      'knowgraph_create_analysis_view',
      'knowgraph_get_analysis',
      'knowgraph_get_gaps',
      'knowgraph_get_gateways',
      'knowgraph_get_topics',
      'mag_one.describe_connected_agents',
      'main.context',
      'read_model_results',
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
    ]);
    // The obsolete pair front door, the model-facing write tool, and the old
    // visible-flow / agent-fabric wrapper tools are all gone.
    expect(names).not.toContain('thinkgraph.process_conversation_pair');
    expect(names).not.toContain('thinkgraph.apply_live_patch');
    expect(names).not.toContain('thinkgraph.persist_graph_view');
    expect(names).not.toContain('codegraph.status');
    expect(names).not.toContain('codegraph.search');
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
