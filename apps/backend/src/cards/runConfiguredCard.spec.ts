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
  beginAgentAssignmentOnPython: vi.fn(),
  finishAgentAssignmentOnPython: vi.fn(),
  orchestrateWithAutoGen: vi.fn(),
  runSingleCardWithAutoGen: vi.fn(),
}));
vi.mock('../routes/hermesKanban.routes', () => ({
  runHermesKanbanCardTask: vi.fn(),
}));
vi.mock('../hermes/mainAdapter', () => ({
  deriveHermesSessionKey: vi.fn((projectId, conversationId, cardId) =>
    `hermes:${projectId}:${conversationId}:${cardId}`,
  ),
  providerForHermes: vi.fn((provider: string) => provider === 'openai' ? 'openai-codex' : provider),
  resolveDirectHermesSubagents: vi.fn((parentCardId: string, nodes: any[], edges: any[]) => edges
    .filter((edge: any) => edge.source === parentCardId && edge.edgeType === 'flow')
    .map((edge: any) => nodes.find((node: any) => node.id === edge.target))
    .filter(Boolean)
    .map((node: any) => ({
      cardId: node.id,
      title: node.title,
      runtimeBinding: node.runtimeBinding,
    }))),
  resolveHermesCardRuntimeConfig: vi.fn((card: any, directSubagents: any[] = []) => ({
    ...(card.runtimeOptions?.modelKey
      ? {}
      : (() => { throw new Error(`card_model_config_missing: cardId=${card.id}`); })()),
    ...(card.runtimeOptions?.modelKey === 'retired-openai-model'
      ? (() => { throw new Error('Unknown model key: retired-openai-model'); })()
      : {}),
    cardId: card.id,
    title: card.title,
    prompt: card.prompt,
    profile: card.id,
    provider: 'openai',
    modelKey: 'gpt-5.6-luna',
    providerModelId: 'gpt-5.6-luna',
    executionMode: card.runtimeOptions?.executionMode || 'single',
    tools: card.runtimeOptions?.tools || [],
    nativeTools: card.runtimeOptions?.nativeTools || [],
    skills: card.runtimeOptions?.skills || [],
    toolsets: card.runtimeOptions?.toolsets || [],
    mcpConnectionIds: card.runtimeOptions?.mcpConnectionIds || [],
    coderCardIds: directSubagents
      .filter((child: any) => child.runtimeBinding === 'local_coder')
      .map((child: any) => child.cardId),
    directSubagents,
  })),
  startHermesTurn: vi.fn(),
}));

import { getDeckDocument } from '../decks/store';
import {
  beginAgentAssignmentOnPython,
  finishAgentAssignmentOnPython,
  runSingleCardWithAutoGen,
} from '../services/autogen/autogenOrchestratorClient';
import { startHermesTurn } from '../hermes/mainAdapter';
import { runHermesKanbanCardTask } from '../routes/hermesKanban.routes';
import { runConfiguredCard } from './runtime';

const mockGetDeck = getDeckDocument as unknown as ReturnType<typeof vi.fn>;
const mockRunCard = runSingleCardWithAutoGen as unknown as ReturnType<typeof vi.fn>;
const mockBeginAssignment = beginAgentAssignmentOnPython as unknown as ReturnType<typeof vi.fn>;
const mockFinishAssignment = finishAgentAssignmentOnPython as unknown as ReturnType<typeof vi.fn>;
const mockStartHermes = startHermesTurn as unknown as ReturnType<typeof vi.fn>;
const mockRunHermesKanban = runHermesKanbanCardTask as unknown as ReturnType<typeof vi.fn>;

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
  mockBeginAssignment.mockReset();
  mockFinishAssignment.mockReset();
  mockStartHermes.mockReset();
  mockRunHermesKanban.mockReset();
  mockStartHermes.mockResolvedValue({
    done: Promise.resolve({ finalText: 'real Hermes output', usage: {} }),
    cancel: vi.fn(),
    answer: vi.fn(),
  });
  mockBeginAssignment.mockResolvedValue({
    ok: true,
    assignmentId: 'assignment:corr-123',
    instructionId: 'instruction:corr-123',
    correlationId: 'corr-123',
    claimToken: 'claim:corr-123',
    state: 'running',
  });
  mockFinishAssignment.mockResolvedValue({ resultId: 'agentresult:corr-123' });
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

  it('runs the saved Hermes card through persistent ACP, never the generic AutoGen runner', async () => {
    const hermesCard = {
      ...AGENT_CARD,
      id: 'card_hermes_steward',
      title: 'Hermes',
      runtimeBinding: 'hermes_steward',
      runtimeOptions: {
        provider: 'openai',
        modelKey: 'gpt-5.6-luna',
        profile: 'default',
        executionMode: 'single',
        tools: ['graphiti.search_nodes'],
      },
    };
    const worldSignalsChild = {
      ...AGENT_CARD,
      id: 'card_worldsignals_agent',
      title: 'WorldSignals',
      runtimeBinding: 'worldsignals_agent',
    };
    mockGetDeck.mockResolvedValue(deckWith(
      [hermesCard, worldSignalsChild],
      [{ source: hermesCard.id, target: worldSignalsChild.id, edgeType: 'flow' }],
    ));
    mockStartHermes.mockResolvedValue({
      done: Promise.resolve({ finalText: 'real Hermes result', usage: {} }),
      cancel: vi.fn(),
      answer: vi.fn(),
    });

    const result = await runConfiguredCard({
      ...ARGS,
      cardId: hermesCard.id,
      conversationId: 'conversation-7',
    });

    expect(result).toMatchObject({
      status: 'completed',
      output: 'real Hermes result',
      tools: ['graphiti.search_nodes'],
    });
    expect(mockStartHermes).toHaveBeenCalledWith(
      expect.objectContaining({
        cardId: hermesCard.id,
        sessionKey: 'hermes:proj-1:conversation-7:card_hermes_steward',
        message: ARGS.input,
        directSubagents: [{
          cardId: worldSignalsChild.id,
          title: worldSignalsChild.title,
          runtimeBinding: worldSignalsChild.runtimeBinding,
        }],
      }),
      expect.any(Function),
    );
    expect(mockRunCard).not.toHaveBeenCalled();
  });

  it('submits auto-kanban through the native Hermes task boundary without AutoGen or ACP', async () => {
    const kanbanCard = {
      ...AGENT_CARD,
      id: 'card_hermes_steward',
      runtimeBinding: 'hermes_steward',
      runtimeOptions: {
        provider: 'openai',
        modelKey: 'gpt-5.6-luna',
        executionMode: 'auto-kanban',
        tools: [],
      },
    };
    mockGetDeck.mockResolvedValue(deckWith([kanbanCard]));
    const snapshot = {
      task: {
        id: 't_native123',
        status: 'ready',
        result: null,
      },
      latest_summary: null,
      parents: [],
      children: [],
      comments: [],
      events: [],
      runs: [],
    };
    mockRunHermesKanban.mockResolvedValue({
      taskId: 't_native123',
      runId: null,
      snapshot,
    });

    const result = await runConfiguredCard({ ...ARGS, cardId: kanbanCard.id });

    expect(result).toMatchObject({
      status: 'submitted',
      output: '',
      hermesKanban: {
        taskId: 't_native123',
        runId: null,
        snapshot,
      },
    });
    expect(mockRunHermesKanban).toHaveBeenCalledWith({
      projectId: ARGS.projectId,
      deckId: ARGS.deckId,
      correlationId: ARGS.correlationId,
      cardId: kanbanCard.id,
      title: kanbanCard.title,
      prompt: kanbanCard.prompt,
      profile: kanbanCard.id,
      provider: 'openai-codex',
      providerModelId: 'gpt-5.6-luna',
      skills: [],
      input: ARGS.input,
    });
    expect(mockStartHermes).not.toHaveBeenCalled();
    expect(mockRunCard).not.toHaveBeenCalled();
  });

  it('returns a fixed transport failure without leaking native stderr or secrets', async () => {
    const kanbanCard = {
      ...AGENT_CARD,
      id: 'card_hermes_steward',
      runtimeBinding: 'hermes_steward',
      runtimeOptions: {
        provider: 'openai',
        modelKey: 'gpt-5.6-luna',
        executionMode: 'auto-kanban',
        tools: [],
      },
    };
    mockGetDeck.mockResolvedValue(deckWith([kanbanCard]));
    mockRunHermesKanban.mockRejectedValue(new Error('hermes_kanban_card_create_failed'));

    const result = await runConfiguredCard({ ...ARGS, cardId: kanbanCard.id });

    expect(result).toMatchObject({
      status: 'failed',
      error: 'hermes_kanban_card_create_failed',
      hermesKanban: null,
    });
    expect(JSON.stringify(result)).not.toContain('sk-secret-value');
    expect(mockStartHermes).not.toHaveBeenCalled();
    expect(mockRunCard).not.toHaveBeenCalled();
  });

  it('returns the real result when an idempotent native Hermes task is already done', async () => {
    const kanbanCard = {
      ...AGENT_CARD,
      id: 'card_hermes_steward',
      runtimeBinding: 'hermes_steward',
      runtimeOptions: {
        provider: 'openai',
        modelKey: 'gpt-5.6-luna',
        executionMode: 'auto-kanban',
        tools: [],
      },
    };
    mockGetDeck.mockResolvedValue(deckWith([kanbanCard]));
    mockRunHermesKanban.mockResolvedValue({
      taskId: 't_native123',
      runId: 6,
      snapshot: {
        task: { id: 't_native123', status: 'done', result: 'native final result' },
        runs: [{ id: 6, status: 'done', outcome: 'completed' }],
      },
    });

    const result = await runConfiguredCard({ ...ARGS, cardId: kanbanCard.id });

    expect(result).toMatchObject({
      status: 'completed',
      output: 'native final result',
      hermesKanban: {
        taskId: 't_native123',
        runId: 6,
        snapshot: {
          task: { status: 'done', result: 'native final result' },
        },
      },
    });
    expect(mockStartHermes).not.toHaveBeenCalled();
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

  it('passes an unknown saved tool to Hermes and returns the native capability rejection', async () => {
    mockGetDeck.mockResolvedValue(deckWith([{ ...AGENT_CARD, runtimeOptions: { modelKey: 'gpt-5.6-luna', tools: ['not_a_real_tool'] } }]));
    mockStartHermes.mockRejectedValue(new Error('hermes_saved_tool_unknown:not_a_real_tool'));
    const result = await runConfiguredCard(ARGS);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('hermes_saved_tool_unknown');
    expect(mockStartHermes).toHaveBeenCalledOnce();
    expect(mockRunCard).not.toHaveBeenCalled();
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

  it('ordinary completed run resolves the saved card into Hermes, not an AutoGen single agent', async () => {
    mockGetDeck.mockResolvedValue(deckWith([AGENT_CARD]));

    const result = await runConfiguredCard(ARGS);
    expect(result.status).toBe('completed');
    expect(result.output).toBe('real Hermes output');
    expect(result.correlationId).toBe('corr-123');
    expect(result.runtimeType).toBe('assistant_agent');

    expect(mockRunCard).not.toHaveBeenCalled();
    expect(mockStartHermes).toHaveBeenCalledOnce();
    const payload = mockStartHermes.mock.calls[0][0];
    expect(payload.cardId).toBe('card_saved_worker');
    expect(payload.prompt).toBe('You are the ThinkGraph agent.');
    expect(payload.message).toBe(ARGS.input);
    expect(result.assignmentResult).toEqual({
      assignmentId: 'assignment:corr-123',
      instructionId: 'instruction:corr-123',
      resultId: 'agentresult:corr-123',
    });
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
    mockStartHermes
      .mockResolvedValueOnce({ done: Promise.resolve({ finalText: 'connected standalone' }) })
      .mockResolvedValueOnce({ done: Promise.resolve({ finalText: 'disconnected standalone' }) });

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
    expect(mockRunCard).not.toHaveBeenCalled();
    expect(mockStartHermes.mock.calls.map(([payload]) => payload.cardId))
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
    mockStartHermes.mockResolvedValue({ done: Promise.resolve({ finalText: 'target result' }) });

    const result = await runConfiguredCard({ ...ARGS, cardId: target.id });

    expect(result.status).toBe('completed');
    expect(result.tools).toEqual(['current_datetime']);
    expect(mockStartHermes.mock.calls[0][0].tools)
      .toEqual(['current_datetime']);
  });

  it('preserves the real conversation and parent run on the Hermes session', async () => {
    mockGetDeck.mockResolvedValue(deckWith([AGENT_CARD]));
    await runConfiguredCard({
      ...ARGS,
      conversationId: 'conv-7',
      instructionId: 'instruction:one',
      senderCardId: 'card_main_chat',
      parentRunId: 'assignment:parent',
    });

    const payload = mockStartHermes.mock.calls[0][0];
    expect(payload.conversationId).toBe('conv-7');
    expect(payload.parentRunId).toBe('assignment:parent');
    expect(mockBeginAssignment).toHaveBeenCalledWith(expect.objectContaining({
      instructionId: 'instruction:one',
      senderCardId: 'card_main_chat',
      parentRunId: 'assignment:parent',
    }));
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

  it('threads the canonical assignment identity back for the native AutoGen Coder exception', async () => {
    mockGetDeck.mockResolvedValue(deckWith([LOCAL_CODER_CARD]));
    mockRunCard.mockResolvedValue({
      ok: true,
      finalResponseText: 'ok',
      assignmentId: 'assignment:corr-123',
    });
    const result = await runConfiguredCard({ ...ARGS, cardId: LOCAL_CODER_CARD.id });
    expect(result.assignmentResult).toEqual({
      assignmentId: 'assignment:corr-123',
    });
  });

  it('propagates an honest Python failure for the native AutoGen Coder exception without retry or fallback', async () => {
    mockGetDeck.mockResolvedValue(deckWith([LOCAL_CODER_CARD]));
    mockRunCard.mockResolvedValue({ ok: false, error: 'single_card_run_failed: provider_down' });
    const result = await runConfiguredCard({ ...ARGS, cardId: LOCAL_CODER_CARD.id });
    expect(result.status).toBe('failed');
    expect(result.error).toContain('provider_down');
    expect(mockRunCard).toHaveBeenCalledTimes(1); // exactly once — no retry loop
  });

  it('propagates a Coder transport failure honestly (rails unavailable)', async () => {
    mockGetDeck.mockResolvedValue(deckWith([LOCAL_CODER_CARD]));
    mockRunCard.mockRejectedValue(new Error('PYTHON_AUTOGEN_RAILS_UNAVAILABLE: checkedEndpoints=x'));
    const result = await runConfiguredCard({ ...ARGS, cardId: LOCAL_CODER_CARD.id });
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
