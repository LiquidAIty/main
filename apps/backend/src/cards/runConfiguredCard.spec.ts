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
import {
  isSingleAssistRunDocument,
  runConfiguredCard,
  runSingleAssistCardAsDeckRun,
  toAgentRunResult,
} from './runtime';

const mockGetDeck = getDeckDocument as unknown as ReturnType<typeof vi.fn>;
const mockRunCard = runSingleCardWithAutoGen as unknown as ReturnType<typeof vi.fn>;

const AGENT_CARD = {
  id: 'card_thinkgraph_agent',
  kind: 'agent',
  title: 'ThinkGraph Agent',
  runtimeType: 'assistant_agent',
  runtimeBinding: 'thinkgraph_agent',
  prompt: 'You are the ThinkGraph agent.',
  runtimeOptions: { modelKey: 'gpt-5-nano', tools: [] },
};

const LOCAL_CODER_CARD = {
  id: 'card_local_coder',
  kind: 'agent',
  title: 'Local Coder',
  runtimeType: 'local_coder',
  runtimeBinding: 'local_coder',
  prompt: 'You are the Local Coder controller.',
  runtimeOptions: { provider: 'openai', modelKey: 'gpt-5.1-chat-latest', tools: ['run_local_coder'] },
};

const STALE_LOCAL_CODER_CARD = {
  ...LOCAL_CODER_CARD,
  runtimeOptions: { provider: 'openai', modelKey: 'gpt-5-mini', tools: ['run_local_coder'] },
};

function deckWith(nodes: any[]) {
  return { deck: { id: 'deck_builder', nodes, edges: [] }, latestRun: null, runs: [], meta: { deckRevision: null, deckSavedAt: null } };
}

const ARGS = {
  projectId: 'proj-1',
  deckId: 'deck_builder',
  cardId: 'card_thinkgraph_agent',
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

  it('fails honestly when the card has no configured model — no fallback model is chosen', async () => {
    mockGetDeck.mockResolvedValue(deckWith([{ ...AGENT_CARD, runtimeOptions: { tools: [] } }]));
    const result = await runConfiguredCard(ARGS);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('card_model_config_missing');
    expect(mockRunCard).not.toHaveBeenCalled();
  });

  it('fails honestly on an unknown configured tool — tool list is never silently filtered', async () => {
    mockGetDeck.mockResolvedValue(deckWith([{ ...AGENT_CARD, runtimeOptions: { modelKey: 'gpt-5-nano', tools: ['not_a_real_tool'] } }]));
    const result = await runConfiguredCard(ARGS);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('card_tool_unknown');
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
    expect(payload.cardRuntime.participants[0].cardId).toBe('card_thinkgraph_agent');
    expect(payload.cardRuntime.privateParticipants[0].prompt).toBe('You are the ThinkGraph agent.');
    // The configured card's model — resolved server-side, never caller-supplied.
    expect(payload.session.modelKey).toBe('gpt-5-nano');
    // No Task Ledger / task-state fields ride this path.
    const raw = JSON.stringify(payload);
    expect(raw).not.toContain('taskIds');
    expect(raw).not.toContain('taskLedger');
  });

  it('runs the saved Local Coder card through the same single-card doorway with its configured model and tool', async () => {
    mockGetDeck.mockResolvedValue(deckWith([LOCAL_CODER_CARD]));
    mockRunCard.mockResolvedValue({ ok: true, finalResponseText: '{"status":"succeeded"}' });

    const result = await runConfiguredCard({
      ...ARGS,
      cardId: 'card_local_coder',
      input: 'write the bounded plan file',
    });

    expect(result.status).toBe('completed');
    expect(result.runtimeType).toBe('local_coder');
    expect(result.tools).toEqual(['run_local_coder']);
    const payload = mockRunCard.mock.calls[0][0];
    expect(payload.session.modelProvider).toBe('openrouter');
    expect(payload.session.modelKey).toBe('z-ai/glm-5.2');
    expect(payload.session.providerModelId).toBe('z-ai/glm-5.2');
    expect(payload.cardRuntime.runtimeType).toBe('assistant_agent');
    expect(payload.cardRuntime.participants[0].runtimeBinding).toBe('local_coder');
    expect(payload.cardRuntime.participants[0].tools).toEqual(['run_local_coder']);
    expect(payload.cardRuntime.privateParticipants[0].prompt).toBe('You are the Local Coder controller.');
  });

  it('upgrades the broken mini Local Coder controller model before dispatch', async () => {
    mockGetDeck.mockResolvedValue(deckWith([STALE_LOCAL_CODER_CARD]));
    mockRunCard.mockResolvedValue({ ok: true, finalResponseText: '{"status":"succeeded"}' });

    const result = await runConfiguredCard({
      ...ARGS,
      cardId: 'card_local_coder',
      input: 'write the bounded plan file',
    });

    expect(result.status).toBe('completed');
    const payload = mockRunCard.mock.calls[0][0];
    expect(payload.session.modelKey).toBe('z-ai/glm-5.2');
    expect(payload.session.providerModelId).toBe('z-ai/glm-5.2');
    expect(payload.cardRuntime.participants[0].providerModelId).toBe('z-ai/glm-5.2');
    expect(payload.cardRuntime.privateParticipants[0].providerModelId).toBe('z-ai/glm-5.2');
  });

  it('assigns a standalone run a returns folder under the default coder-workspace, and threads returned files back', async () => {
    mockGetDeck.mockResolvedValue(deckWith([AGENT_CARD]));
    mockRunCard.mockResolvedValue({
      ok: true,
      finalResponseText: 'ok',
      returnsDir: 'returns/corr-123/card_thinkgraph_agent/',
      returnedFiles: ['returns/corr-123/card_thinkgraph_agent/report.md'],
      returnStatus: 'return_files_created',
    });
    const result = await runConfiguredCard(ARGS);
    const payload = mockRunCard.mock.calls[0][0];
    // Result root is the default owned Coder workspace, not the repo root, and it is
    // NOT a Mag One handoff.
    expect(payload.resultFolder.runId).toBe('corr-123');
    expect(payload.resultFolder.workspaceRoot).toContain('coder-workspace');
    expect(payload.jobHandoff).toBeUndefined();
    // Real created files threaded back to the caller for read_model_results.
    expect(result.returnFolder).toEqual({
      returnsDir: 'returns/corr-123/card_thinkgraph_agent/',
      returnedFiles: ['returns/corr-123/card_thinkgraph_agent/report.md'],
      returnStatus: 'return_files_created',
    });
  });

  it('reports an empty standalone returns folder honestly (no fake report.md)', async () => {
    mockGetDeck.mockResolvedValue(deckWith([AGENT_CARD]));
    mockRunCard.mockResolvedValue({
      ok: true,
      finalResponseText: 'text only',
      returnsDir: 'returns/corr-123/',
      returnedFiles: [],
      returnStatus: 'no_return_files_created',
    });
    const result = await runConfiguredCard(ARGS);
    expect(result.output).toBe('text only');
    expect(result.returnFolder?.returnStatus).toBe('no_return_files_created');
    expect(JSON.stringify(result)).not.toContain('report.md');
    expect(JSON.stringify(result)).not.toContain('result.md');
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

  it('mints truthful thinkgraph_card_run authority in the ONE executor for a thinkgraph-bound card with a real conversation', async () => {
    mockGetDeck.mockResolvedValue(deckWith([AGENT_CARD]));
    mockRunCard.mockResolvedValue({ ok: true, finalResponseText: 'ok' });
    await runConfiguredCard({ ...ARGS, conversationId: 'conv-7' });
    const payload = mockRunCard.mock.calls[0][0];
    // Exactly the four trusted runtime values — no deckId, no message-pair identity.
    expect(payload.cardRuntime.runtimeScope).toEqual({
      kind: 'thinkgraph_card_run',
      projectId: 'proj-1',
      cardId: 'card_thinkgraph_agent',
      correlationId: 'corr-123',
      conversationId: 'conv-7',
    });
    // No fake message-pair identity is ever fabricated for a live run.
    expect(payload.cardRuntime.runtimeScope.userMessageId).toBeUndefined();
    expect(payload.cardRuntime.runtimeScope.assistantMessageId).toBeUndefined();
  });

  it('mints NO authority without a real conversation — a Task-tab test run fabricates nothing', async () => {
    mockGetDeck.mockResolvedValue(deckWith([AGENT_CARD]));
    mockRunCard.mockResolvedValue({ ok: true, finalResponseText: 'ok' });
    await runConfiguredCard(ARGS);
    const payload = mockRunCard.mock.calls[0][0];
    expect(payload.cardRuntime.runtimeScope).toBeUndefined();
  });

  it('mints the same scoped authority for the Hermes steward card — same canonical write path, never a second one', async () => {
    const HERMES_CARD = {
      ...AGENT_CARD,
      id: 'card_hermes_steward',
      title: 'Hermes Steward',
      runtimeBinding: 'hermes_steward',
    };
    mockGetDeck.mockResolvedValue(deckWith([HERMES_CARD]));
    mockRunCard.mockResolvedValue({ ok: true, finalResponseText: 'ok' });
    await runConfiguredCard({ ...ARGS, cardId: 'card_hermes_steward', conversationId: 'conv-7' });
    const payload = mockRunCard.mock.calls[0][0];
    expect(payload.cardRuntime.runtimeScope).toEqual({
      kind: 'thinkgraph_card_run',
      projectId: 'proj-1',
      cardId: 'card_hermes_steward',
      correlationId: 'corr-123',
      conversationId: 'conv-7',
    });
  });

  it('never mints thinkgraph authority for a non-thinkgraph card, conversation or not', async () => {
    mockGetDeck.mockResolvedValue(
      deckWith([{ ...AGENT_CARD, id: 'card_research_agent', runtimeBinding: 'research_agent' }]),
    );
    mockRunCard.mockResolvedValue({ ok: true, finalResponseText: 'ok' });
    await runConfiguredCard({ ...ARGS, cardId: 'card_research_agent', conversationId: 'conv-7' });
    const payload = mockRunCard.mock.calls[0][0];
    expect(payload.cardRuntime.runtimeScope).toBeUndefined();
  });

  it('an explicit caller runAuthority always wins untouched (never overwritten by the minted default)', async () => {
    mockGetDeck.mockResolvedValue(deckWith([AGENT_CARD]));
    mockRunCard.mockResolvedValue({ ok: true, finalResponseText: 'ok' });
    const explicitAuthority = {
      kind: 'thinkgraph_card_run',
      projectId: 'proj-1',
      cardId: 'card_thinkgraph_agent',
      correlationId: 'corr-123',
      conversationId: 'conv-7',
    };
    await runConfiguredCard({ ...ARGS, conversationId: 'conv-OTHER', runAuthority: explicitAuthority });
    const payload = mockRunCard.mock.calls[0][0];
    expect(payload.cardRuntime.runtimeScope).toEqual(explicitAuthority);
  });
});

describe('toAgentRunResult — one normalized report for every invocation surface', () => {
  const BASE = {
    correlationId: 'corr-9',
    cardId: 'card_x',
    runtimeType: 'assistant_agent',
    tools: ['current_datetime'],
    output: 'done',
    error: null,
    startedAt: 't0',
    endedAt: 't1',
    toolCallCount: 2,
  };

  it('maps completed → succeeded and preserves identity/tool facts', () => {
    const result = toAgentRunResult({ ...BASE, status: 'completed' } as any, 'single_assist');
    expect(result).toEqual({
      runId: 'corr-9',
      cardId: 'card_x',
      invocation: 'single_assist',
      status: 'succeeded',
      summary: 'done',
      error: null,
      tools: ['current_datetime'],
      toolCallCount: 2,
      startedAt: 't0',
      endedAt: 't1',
    });
  });

  it.each(['failed', 'disabled', 'not_found', 'not_runnable'] as const)(
    'maps %s → failed with the exact reason preserved',
    (status) => {
      const result = toAgentRunResult(
        { ...BASE, status, output: '', error: `card_${status}` } as any,
        'mag_one_orchestrated',
      );
      expect(result.status).toBe('failed');
      expect(result.error).toBe(`card_${status}`);
      expect(result.summary).toBe('');
    },
  );
});

describe('isSingleAssistRunDocument — structural detection only', () => {
  it('accepts exactly one top-level agent card', () => {
    expect(isSingleAssistRunDocument({ nodes: [AGENT_CARD] })).toEqual({
      ok: true,
      cardId: 'card_thinkgraph_agent',
    });
  });

  it('rejects any selection containing a Mag One orchestrator (team runtime owns it)', () => {
    expect(
      isSingleAssistRunDocument({
        nodes: [{ ...AGENT_CARD, id: 'card_bus', runtimeType: 'magentic_one' }, AGENT_CARD],
      }),
    ).toEqual({ ok: false });
  });

  it('rejects multi-card selections without an orchestrator', () => {
    expect(
      isSingleAssistRunDocument({ nodes: [AGENT_CARD, { ...AGENT_CARD, id: 'card_two' }] }),
    ).toEqual({ ok: false });
  });

  it('ignores subgraph children when counting top-level cards', () => {
    expect(
      isSingleAssistRunDocument({
        nodes: [AGENT_CARD, { ...AGENT_CARD, id: 'card_child', parentGraphId: 'card_thinkgraph_agent' }],
      }),
    ).toEqual({ ok: true, cardId: 'card_thinkgraph_agent' });
  });

  it('rejects an empty selection', () => {
    expect(isSingleAssistRunDocument({ nodes: [] })).toEqual({ ok: false });
  });
});

describe('runSingleAssistCardAsDeckRun — Task-tab surface over the one executor', () => {
  it('reports a completed run as a success deck-run step carrying the AgentRunResult', async () => {
    mockGetDeck.mockResolvedValue(deckWith([AGENT_CARD]));
    mockRunCard.mockResolvedValue({ ok: true, finalResponseText: 'assist output' });

    const run = await runSingleAssistCardAsDeckRun({
      projectId: 'proj-1',
      deckId: 'deck_builder',
      cardId: 'card_thinkgraph_agent',
      input: 'do the thing',
    });

    expect(run.status).toBe('success');
    expect(run.finalOutput).toBe('assist output');
    expect(run.steps).toHaveLength(1);
    const step = (run.steps as any[])[0];
    expect(step.cardId).toBe('card_thinkgraph_agent');
    expect(step.status).toBe('success');
    expect(step.output).toBe('assist output');
    expect(step.agentRunResult.status).toBe('succeeded');
    expect(step.agentRunResult.invocation).toBe('single_assist');
    expect(step.agentRunResult.runId).toMatch(/^assist_/);
    // Same one executor underneath — the Python rails single-card transport.
    expect(mockRunCard).toHaveBeenCalledTimes(1);
  });

  it('reports an honest failure (unknown card) without a fake success shape', async () => {
    mockGetDeck.mockResolvedValue(deckWith([]));

    const run = await runSingleAssistCardAsDeckRun({
      projectId: 'proj-1',
      deckId: 'deck_builder',
      cardId: 'card_missing',
      input: 'do the thing',
    });

    expect(run.status).toBe('error');
    expect(run.error).toContain('card_not_found');
    const step = (run.steps as any[])[0];
    expect(step.status).toBe('error');
    expect(step.agentRunResult.status).toBe('failed');
    expect(mockRunCard).not.toHaveBeenCalled();
  });
});
