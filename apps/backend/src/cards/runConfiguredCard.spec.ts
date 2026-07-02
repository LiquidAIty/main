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
  id: 'card_thinkgraph_agent',
  kind: 'agent',
  title: 'ThinkGraph Agent',
  runtimeType: 'assistant_agent',
  runtimeBinding: 'thinkgraph_agent',
  prompt: 'You are the ThinkGraph agent.',
  runtimeOptions: { modelKey: 'gpt-5-nano', tools: [] },
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
});
