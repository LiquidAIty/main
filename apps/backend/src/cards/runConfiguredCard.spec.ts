// Focused single-card runtime coverage (SPEC: SINGLE_CONFIGURED_CARD_RUNTIME).
// Mocks ONLY at the DB (deck store) and network (Python rails transport) boundaries.
// Proves: server-trusted resolution from the canonical deck source, honest
// not_found/disabled/not_runnable/config failures, override rejection, exact
// configured tool pass-through, no fallback, no Task Ledger fields, and
// correlation identity preservation.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../decks/store', () => ({
  getDeckDocument: vi.fn(),
}));
vi.mock('../services/autogen/autogenOrchestratorClient', () => ({
  orchestrateWithAutoGen: vi.fn(),
  runSingleCardWithAutoGen: vi.fn(),
}));

import { getDeckDocument } from '../decks/store';
import { runSingleCardWithAutoGen } from '../services/autogen/autogenOrchestratorClient';
import { runConfiguredCard } from './runtime';

const mockGetDeck = getDeckDocument as unknown as ReturnType<typeof vi.fn>;
const mockRunCard = runSingleCardWithAutoGen as unknown as ReturnType<typeof vi.fn>;

const AGENT_CARD = {
  id: 'card_saved_worker',
  kind: 'agent',
  title: 'ThinkGraph Agent',
  runtimeType: 'assistant_agent',
  runtimeBinding: 'thinkgraph_agent',
  prompt: 'You are the ThinkGraph agent.',
  runtimeOptions: { modelKey: 'gpt-5.6-luna', tools: [] },
};

const LOCAL_CODER_CARD = {
  id: 'card_local_coder',
  kind: 'agent',
  title: 'Local Coder',
  runtimeType: 'assistant_agent',
  runtimeBinding: 'local_coder',
  prompt: 'You are the Local Coder controller.',
  runtimeOptions: {
    provider: 'openai',
    modelKey: 'gpt-5.6-luna',
    tools: [
      'run_local_coder',
      'cbm.index_repository',
      'cbm.search_graph',
      'cbm.query_graph',
      'cbm.trace_path',
      'cbm.get_code_snippet',
      'cbm.get_graph_schema',
      'cbm.get_architecture',
      'cbm.search_code',
      'cbm.list_projects',
      'cbm.delete_project',
      'cbm.index_status',
      'cbm.detect_changes',
      'cbm.manage_adr',
      'cbm.ingest_traces',
    ],
  },
};

function deckWith(nodes: any[], edges: any[] = []) {
  return { deck: { id: 'deck_builder', nodes, edges }, latestRun: null, runs: [], meta: { deckRevision: null, deckSavedAt: null } };
}

const ARGS = {
  projectId: 'proj-1',
  deckId: 'deck_builder',
  cardId: 'card_saved_worker',
  correlationId: 'corr-123',
  input: 'summarize the completed pair',
};

beforeEach(() => {
  mockGetDeck.mockReset();
  mockRunCard.mockReset();
});

describe('runConfiguredCard — server-trusted single-card runtime', () => {
  it('returns not_found for a nonexistent card', async () => {
    mockGetDeck.mockResolvedValue(deckWith([]));
    const result = await runConfiguredCard(ARGS);
    expect(result.status).toBe('not_found');
    expect(result.correlationId).toBe('corr-123');
    expect(mockRunCard).not.toHaveBeenCalled();
  });

  it('returns disabled for an explicitly disabled card', async () => {
    mockGetDeck.mockResolvedValue(deckWith([{ ...AGENT_CARD, enabled: false }]));
    const result = await runConfiguredCard(ARGS);
    expect(result.status).toBe('disabled');
    expect(mockRunCard).not.toHaveBeenCalled();
  });

  it('returns not_runnable for a magentic_one card (Mag One is not runnable through this path)', async () => {
    mockGetDeck.mockResolvedValue(deckWith([{ ...AGENT_CARD, runtimeType: 'magentic_one' }]));
    const result = await runConfiguredCard(ARGS);
    expect(result.status).toBe('not_runnable');
    expect(result.error).toContain('single_card_runtime_not_supported');
    expect(mockRunCard).not.toHaveBeenCalled();
  });

  it('rejects Main before the generic assistant runner reaches Python', async () => {
    mockGetDeck.mockResolvedValue(deckWith([{
      ...AGENT_CARD,
      id: 'card_main_chat',
      runtimeBinding: 'main_chat',
    }]));
    const result = await runConfiguredCard({ ...ARGS, cardId: 'card_main_chat' });
    expect(result.status).toBe('not_runnable');
    expect(result.error).toContain('single_card_main_chat_not_runnable');
    expect(mockRunCard).not.toHaveBeenCalled();
  });

  it('rejects a workspace-only Trading card before instruction creation or billing', async () => {
    mockGetDeck.mockResolvedValue(deckWith([{
      ...AGENT_CARD,
      id: 'card_trading_workbench',
      runtimeBinding: 'trading_agent',
      parentGraphId: 'workbench_trading',
    }]));
    const result = await runConfiguredCard({ ...ARGS, cardId: 'card_trading_workbench' });
    expect(result.status).toBe('not_runnable');
    expect(result.error).toContain('single_card_workspace_card_not_runnable');
    expect(mockRunCard).not.toHaveBeenCalled();
  });

  it('fails honestly when the card has no configured model — no fallback model is chosen', async () => {
    mockGetDeck.mockResolvedValue(deckWith([{ ...AGENT_CARD, runtimeOptions: { tools: [] } }]));
    const result = await runConfiguredCard(ARGS);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('card_model_config_missing');
    expect(mockRunCard).not.toHaveBeenCalled();
  });

  it('transports an unknown configured tool to Python and returns its canonical rejection', async () => {
    mockGetDeck.mockResolvedValue(deckWith([{ ...AGENT_CARD, runtimeOptions: { modelKey: 'gpt-5.6-luna', tools: ['not_a_real_tool'] } }]));
    mockRunCard.mockRejectedValue(new Error('card_tool_unknown: not_a_real_tool'));
    const result = await runConfiguredCard(ARGS);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('card_tool_unknown');
    expect(mockRunCard).toHaveBeenCalledOnce();
    expect(mockRunCard.mock.calls[0][0].cardRuntime.participants[0].tools).toEqual(['not_a_real_tool']);
  });

  it('rejects caller-supplied runtime overrides instead of applying or ignoring them', async () => {
    mockGetDeck.mockResolvedValue(deckWith([AGENT_CARD]));
    const result = await runConfiguredCard({ ...ARGS, modelKey: 'attacker-model', prompt: 'evil' } as any);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('card_run_overrides_rejected');
    expect(result.error).toContain('modelKey');
    expect(mockGetDeck).not.toHaveBeenCalled();
    expect(mockRunCard).not.toHaveBeenCalled();
  });

  it('completed run: resolves config server-side, preserves correlation, sends exactly one participant, no Task Ledger fields', async () => {
    mockGetDeck.mockResolvedValue(deckWith([AGENT_CARD]));
    mockRunCard.mockResolvedValue({ ok: true, finalResponseText: 'real agent output' });

    const result = await runConfiguredCard(ARGS);
    expect(result.status).toBe('completed');
    expect(result.output).toBe('real agent output');
    expect(result.correlationId).toBe('corr-123');
    expect(result.runtimeType).toBe('assistant_agent');

    expect(mockRunCard).toHaveBeenCalledTimes(1);
    const payload = mockRunCard.mock.calls[0][0];
    expect(payload.session.orchestrator).toBe('assistant_agent');
    expect(payload.session.turnId).toBe('corr-123');
    expect(payload.session.route).toBe('single_card');
    expect(payload.cardRuntime.runtimeType).toBe('assistant_agent');
    expect(payload.cardRuntime.participants).toHaveLength(1);
    expect(payload.cardRuntime.participants[0].cardId).toBe('card_saved_worker');
    expect(payload.cardRuntime.participants[0].prompt).toBe('You are the ThinkGraph agent.');
    expect(payload.cardRuntime).not.toHaveProperty('privateParticipants');
    // The configured card's model — resolved server-side, never caller-supplied.
    expect(payload.session.modelKey).toBe('gpt-5.6-luna');
    // No Task Ledger / task-state fields ride this path.
    const raw = JSON.stringify(payload);
    expect(raw).not.toContain('taskIds');
    expect(raw).not.toContain('taskLedger');
  });

  it('runs connected and disconnected saved cards through the same standalone path without consulting bus edges', async () => {
    const connected = {
      ...AGENT_CARD,
      id: 'card_research_agent',
      title: 'Search Agent',
      runtimeBinding: 'research_agent',
    };
    const disconnected = {
      ...AGENT_CARD,
      id: 'card_worldsignals_agent',
      title: 'WorldSignals Agent',
      runtimeBinding: 'worldsignals_agent',
    };
    mockGetDeck.mockResolvedValue(
      deckWith(
        [connected, disconnected, { id: 'card_magentic', kind: 'agent', runtimeType: 'magentic_one' }],
        [{
          id: 'edge-search-mag',
          source: connected.id,
          target: 'card_magentic',
          edgeType: 'magentic_option',
        }],
      ),
    );
    mockRunCard
      .mockResolvedValueOnce({ ok: true, finalResponseText: 'connected standalone' })
      .mockResolvedValueOnce({ ok: true, finalResponseText: 'disconnected standalone' });

    const connectedResult = await runConfiguredCard({
      ...ARGS,
      cardId: connected.id,
      correlationId: 'connected-standalone',
    });
    const disconnectedResult = await runConfiguredCard({
      ...ARGS,
      cardId: disconnected.id,
      correlationId: 'disconnected-standalone',
    });

    expect(connectedResult.output).toBe('connected standalone');
    expect(disconnectedResult.output).toBe('disconnected standalone');
    expect(mockRunCard).toHaveBeenCalledTimes(2);
    expect(mockRunCard.mock.calls.map(([payload]) => payload.cardRuntime.participants[0].cardId))
      .toEqual([connected.id, disconnected.id]);
  });

  it('gives the selected target only that card own saved tools', async () => {
    const first = {
      ...AGENT_CARD,
      id: 'card_first',
      runtimeOptions: { modelKey: 'gpt-5.6-luna', tools: ['calculator'] },
    };
    const target = {
      ...AGENT_CARD,
      id: 'card_target',
      runtimeOptions: { modelKey: 'gpt-5.6-luna', tools: ['current_datetime'] },
    };
    mockGetDeck.mockResolvedValue(deckWith([first, target]));
    mockRunCard.mockResolvedValue({ ok: true, finalResponseText: 'target result' });

    const result = await runConfiguredCard({ ...ARGS, cardId: target.id });

    expect(result.status).toBe('completed');
    expect(result.tools).toEqual(['current_datetime']);
    expect(mockRunCard.mock.calls[0][0].cardRuntime.participants[0].tools)
      .toEqual(['current_datetime']);
  });

  it('transports an AgentGraph instruction identity and conversation to Python without resolving graph content in TypeScript', async () => {
    mockGetDeck.mockResolvedValue(deckWith([AGENT_CARD]));
    mockRunCard.mockResolvedValue({ ok: true, finalResponseText: 'used stored handoff' });

    await runConfiguredCard({
      ...ARGS,
      conversationId: 'conv-7',
      instructionId: 'instruction:one',
      senderCardId: 'card_main_chat',
    });

    const payload = mockRunCard.mock.calls[0][0];
    expect(payload.conversationId).toBe('conv-7');
    expect(payload.agentAssignment).toEqual({
      instructionId: 'instruction:one',
      senderCardId: 'card_main_chat',
      receiverCardId: 'card_saved_worker',
    });
    expect(JSON.stringify(payload)).not.toContain('stored Markdown');
  });

  it('runs the saved Local Coder card through the normal single-card doorway and its real tool', async () => {
    mockGetDeck.mockResolvedValue(deckWith([LOCAL_CODER_CARD]));
    mockRunCard.mockResolvedValue({ ok: true, finalResponseText: '{"status":"succeeded"}' });

    const result = await runConfiguredCard({
      ...ARGS,
      cardId: 'card_local_coder',
      input: 'write the bounded plan file',
    });

    expect(result.status).toBe('completed');
    expect(result.runtimeType).toBe('assistant_agent');
    expect(result.tools).toEqual(['run_local_coder']);
    expect(LOCAL_CODER_CARD.runtimeOptions.tools.filter((tool) => tool.startsWith('cbm.'))).toHaveLength(14);
    const payload = mockRunCard.mock.calls[0][0];
    expect(payload.session.modelProvider).toBe('openai');
    expect(payload.session.modelKey).toBe('gpt-5.6-luna');
    expect(payload.session.providerModelId).toBe('gpt-5.6-luna');
    expect(payload.cardRuntime.runtimeType).toBe('assistant_agent');
    expect(payload.cardRuntime.participants[0].runtimeType).toBe('assistant_agent');
    expect(payload.cardRuntime.participants[0].runtimeBinding).toBe('local_coder');
    expect(payload.cardRuntime.participants[0].tools).toEqual(['run_local_coder']);
    expect(payload.cardRuntime.participants[0].innerMcpTools).toEqual(
      LOCAL_CODER_CARD.runtimeOptions.tools.filter((tool) => tool.startsWith('cbm.')),
    );
    expect(payload.cardRuntime.participants[0].prompt).toBe('You are the Local Coder controller.');
  });

  it('preserves an unavailable model as a configuration failure — never a forced substitute', async () => {
    // A removed/discontinued key is an unknown key at resolution: the card fails
    // honestly and no replacement model is ever substituted.
    const unavailableAgentCard = {
      ...AGENT_CARD,
      runtimeOptions: { modelKey: 'retired-openai-model' },
    };
    mockGetDeck.mockResolvedValue(deckWith([unavailableAgentCard]));

    const result = await runConfiguredCard({
      ...ARGS,
      cardId: 'card_saved_worker',
      input: 'run',
    });

    expect(result.status).toBe('failed');
    expect(mockRunCard).not.toHaveBeenCalled();
    expect(String(result.error || '')).toContain('Unknown model key');
  });

  it('threads the canonical assignment identity back', async () => {
    mockGetDeck.mockResolvedValue(deckWith([AGENT_CARD]));
    mockRunCard.mockResolvedValue({
      ok: true,
      finalResponseText: 'ok',
      assignmentId: 'assignment:corr-123',
    });
    const result = await runConfiguredCard(ARGS);
    expect(result.assignmentResult).toEqual({
      assignmentId: 'assignment:corr-123',
    });
  });

  it('propagates an honest Python failure without retry or fallback', async () => {
    mockGetDeck.mockResolvedValue(deckWith([AGENT_CARD]));
    mockRunCard.mockResolvedValue({ ok: false, error: 'single_card_run_failed: provider_down' });
    const result = await runConfiguredCard(ARGS);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('provider_down');
    expect(mockRunCard).toHaveBeenCalledTimes(1); // exactly once — no retry loop
  });

  it('propagates a transport failure honestly (rails unavailable)', async () => {
    mockGetDeck.mockResolvedValue(deckWith([AGENT_CARD]));
    mockRunCard.mockRejectedValue(new Error('PYTHON_AUTOGEN_RAILS_UNAVAILABLE: checkedEndpoints=x'));
    const result = await runConfiguredCard(ARGS);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('PYTHON_AUTOGEN_RAILS_UNAVAILABLE');
  });

  it('rejects caller-supplied runAuthority as a runtime override', async () => {
    mockGetDeck.mockResolvedValue(deckWith([AGENT_CARD]));
    mockRunCard.mockResolvedValue({ ok: true, finalResponseText: 'ok' });
    const explicitAuthority = {
      kind: 'hidden_scope',
      projectId: 'proj-1',
      cardId: 'card_saved_worker',
      correlationId: 'corr-123',
      conversationId: 'conv-7',
    };
    const result = await runConfiguredCard({
      ...ARGS,
      conversationId: 'conv-OTHER',
      runAuthority: explicitAuthority,
    } as any);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('card_run_overrides_rejected: runAuthority');
    expect(mockRunCard).not.toHaveBeenCalled();
  });
});
