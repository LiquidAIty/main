import { describe, it, expect } from 'vitest';
import { resolvedMagenticOptions, buildPythonAutoGenCardRuntimePayload, runCardWithContract } from './runtime';

describe('Canonical Cards Runtime', () => {
  it('No Magentic options throws clear locked runtime error', async () => {
    const card = { id: 'mag1', kind: 'agent', runtimeType: 'magentic_one' };
    await expect(runCardWithContract(card, {}, 'test', { allCards: [card], allEdges: [] }))
      .rejects.toThrow(/No valid locked research runtime path resolved/);
  });

  it('magentic_option direction-agnostic', () => {
    const cardM = { id: 'mag1', kind: 'agent', runtimeType: 'magentic_one' };
    const cardA = { id: 'agentA', kind: 'agent', runtimeType: 'assistant_agent' };
    const cardB = { id: 'agentB', kind: 'agent', runtimeType: 'assistant_agent' };

    const edges = [
      { id: 'e1', source: cardA.id, target: cardM.id, edgeType: 'magentic_option' }, // incoming
      { id: 'e2', source: cardM.id, target: cardB.id, edgeType: 'magentic_option' }, // outgoing
    ];

    const resolved = resolvedMagenticOptions(cardM.id, [cardM, cardA, cardB], edges);
    expect(resolved.length).toBe(2);
    expect(resolved.map(r => r.id)).toEqual(expect.arrayContaining(['agentA', 'agentB']));
  });

  it('flow-only edge does not imply Magentic option', () => {
    const cardM = { id: 'mag1', kind: 'agent', runtimeType: 'magentic_one' };
    const cardA = { id: 'agentA', kind: 'agent', runtimeType: 'assistant_agent' };
    const edges = [{ id: 'e1', source: cardM.id, target: cardA.id, edgeType: 'flow' }];

    const resolved = resolvedMagenticOptions(cardM.id, [cardM, cardA], edges);
    expect(resolved.length).toBe(0);
  });

  it('generic prompt strips prior assistant text', () => {
    const payload = buildPythonAutoGenCardRuntimePayload(
      { id: 'mag1' },
      {},
      'test',
      { previousOutput: 'Some Apollo 11 text' },
      {},
      [{ id: 'agentA', runtimeType: 'assistant_agent', runtimeOptions: { modelKey: 'gpt-5-nano' } }],
      '2026'
    );
    expect(payload.priorAssistantText).toBe('');
  });

  it('maxTokens 0 or invalid is omitted/normalized', () => {
    const payload = buildPythonAutoGenCardRuntimePayload(
      { id: 'mag1', runtimeOptions: { maxTokens: 0 } },
      {},
      'test input',
      {},
      {},
      [{ id: 'agentA', runtimeType: 'assistant_agent', runtimeOptions: { modelKey: 'gpt-5-nano' } }],
      '2026'
    );
    expect(payload.cardRuntime.runtimeOptions.maxTokens).toBeUndefined();
  });

  it('Python payload compatibility matches expected shape', () => {
    const cardM = { id: 'mag1', kind: 'agent', runtimeType: 'magentic_one', prompt: 'test system prompt' };
    const cardA = { id: 'agentA', kind: 'agent', runtimeType: 'assistant_agent', runtimeOptions: { modelKey: 'gpt-5-nano' } };
    const context = { deckId: 'deck1', allCards: [cardM, cardA], allEdges: [] };

    const payload = buildPythonAutoGenCardRuntimePayload(cardM, {}, 'hello', context, {}, [cardA], '2026');

    expect(payload.session.orchestrator).toBe('magentic_one');
    expect(payload.systemPrompt).toBe('test system prompt');
    expect(payload.cardRuntime.runtimeScope?.pythonWorkerIds).toContain('agentA');
    // Ensure task_ledger, progress_ledger are completely absent
    expect((payload as any).task_ledger).toBeUndefined();
    expect((payload as any).progress_ledger).toBeUndefined();
  });

  it('disconnected cards do not appear in model-visible workspace context or payload participants', () => {
    const cardM = { id: 'mag1', kind: 'agent', runtimeType: 'magentic_one' };
    const cardConnected = { id: 'conn1', kind: 'agent', runtimeType: 'assistant_agent', runtimeOptions: { modelKey: 'gpt-5-nano' } };
    const cardDisconnected = { id: 'disc1', kind: 'agent', runtimeType: 'assistant_agent' };

    // cardConnected is connected, cardDisconnected is not.
    const context = {
      deckId: 'deck1',
      allCards: [cardM, cardConnected, cardDisconnected],
      allEdges: [{ id: 'e1', source: cardM.id, target: cardConnected.id, edgeType: 'magentic_option' }]
    };

    const callableHeads = resolvedMagenticOptions(cardM.id, context.allCards, context.allEdges);

    const payload = buildPythonAutoGenCardRuntimePayload(
      cardM, {}, 'hello', context, {}, callableHeads, '2026'
    );

    // disconnected cards should not be in participants
    expect(payload.cardRuntime.participants.map(p => p.cardId)).not.toContain('disc1');
    expect(payload.cardRuntime.participants.map(p => p.cardId)).toContain('conn1');

    // disconnected cards should not be in visibleNodeIds
    expect(payload.cardRuntime.runtimeScope?.visibleNodeIds).not.toContain('disc1');
    expect(payload.cardRuntime.runtimeScope?.visibleNodeIds).toContain('conn1');

    // excludedAgentIds should be completely empty to prevent leakage
    expect(payload.cardRuntime.runtimeScope?.excludedAgentIds).toEqual([]);

    // workspaceObjectContext should be completely undefined to prevent global leak
    expect(payload.workspaceObjectContext).toBeUndefined();
  });

  it('flow-only cards do not become callable participants', () => {
    const cardM = { id: 'mag1', kind: 'agent', runtimeType: 'magentic_one' };
    const cardFlow = { id: 'flow1', kind: 'agent', runtimeType: 'assistant_agent' };

    const context = {
      deckId: 'deck1',
      allCards: [cardM, cardFlow],
      allEdges: [{ id: 'e1', source: cardM.id, target: cardFlow.id, edgeType: 'flow' }]
    };

    const callableHeads = resolvedMagenticOptions(cardM.id, context.allCards, context.allEdges);

    const payload = buildPythonAutoGenCardRuntimePayload(
      cardM, {}, 'hello', context, {}, callableHeads, '2026'
    );

    expect(payload.cardRuntime.participants.map(p => p.cardId)).not.toContain('flow1');
    expect(payload.cardRuntime.runtimeScope?.visibleNodeIds).not.toContain('flow1');
  });

  // T002 — Failing tests: card-selected model config must propagate to payload exactly.
  // These tests must fail before T003 is applied (current code hardcodes 'openrouter'/'default').

  it('privateParticipants carry the participant card selected provider and providerModelId', () => {
    const selectedModelKey = 'gpt-5.1-chat-latest';         // real MODEL_REGISTRY key — fixture only, not a default
    const selectedProvider = 'openai';                        // MODEL_REGISTRY[selectedModelKey].provider
    const selectedProviderModelId = 'gpt-5.1-chat-latest';  // MODEL_REGISTRY[selectedModelKey].id

    const cardM = { id: 'mag1', kind: 'agent', runtimeType: 'magentic_one' };
    const cardA = {
      id: 'agentA', kind: 'agent', runtimeType: 'assistant_agent',
      runtimeOptions: { modelKey: selectedModelKey },
    };

    const payload = buildPythonAutoGenCardRuntimePayload(
      cardM, {}, 'test', {}, {}, [cardA], '2026',
    );

    const priv = payload.cardRuntime.privateParticipants?.[0];
    expect(priv).toBeDefined();
    expect(priv?.provider).toBe(selectedProvider);
    expect(priv?.providerModelId).toBe(selectedProviderModelId);
    expect(priv?.providerModelId).not.toBe('default');
    expect(priv?.providerModelId).not.toBe('');
  });

  it('participants[] carry the same card-selected provider and providerModelId', () => {
    const selectedModelKey = 'gpt-5.1-chat-latest';
    const selectedProvider = 'openai';
    const selectedProviderModelId = 'gpt-5.1-chat-latest';

    const cardM = { id: 'mag1', kind: 'agent', runtimeType: 'magentic_one' };
    const cardA = {
      id: 'agentA', kind: 'agent', runtimeType: 'assistant_agent',
      runtimeOptions: { modelKey: selectedModelKey },
    };

    const payload = buildPythonAutoGenCardRuntimePayload(
      cardM, {}, 'test', {}, {}, [cardA], '2026',
    );

    const pub = payload.cardRuntime.participants?.[0];
    expect(pub).toBeDefined();
    expect(pub?.provider).toBe(selectedProvider);
    expect(pub?.providerModelId).toBe(selectedProviderModelId);
  });

  it('throws card_model_config_missing when participant card has no runtimeOptions.modelKey', () => {
    const cardM = { id: 'mag1', kind: 'agent', runtimeType: 'magentic_one' };
    const cardA = { id: 'agentA', kind: 'agent', runtimeType: 'assistant_agent' };

    expect(() =>
      buildPythonAutoGenCardRuntimePayload(cardM, {}, 'test', {}, {}, [cardA], '2026'),
    ).toThrow('card_model_config_missing');
  });

  it('throws card_model_config_mismatch when runtimeOptions.provider conflicts with registry provider', () => {
    const cardM = { id: 'mag1', kind: 'agent', runtimeType: 'magentic_one' };
    const cardA = {
      id: 'agentA', kind: 'agent', runtimeType: 'assistant_agent',
      runtimeOptions: {
        modelKey: 'gpt-5-nano',   // registry provider = 'openai'
        provider: 'openrouter',    // conflicts → mismatch
      },
    };

    expect(() =>
      buildPythonAutoGenCardRuntimePayload(cardM, {}, 'test', {}, {}, [cardA], '2026'),
    ).toThrow('card_model_config_mismatch');
  });

  it('providerModelId is never default or empty string in any participant payload', () => {
    const selectedModelKey = 'gpt-5-nano';  // fixture — not a default

    const cardM = { id: 'mag1', kind: 'agent', runtimeType: 'magentic_one' };
    const cardA = {
      id: 'agentA', kind: 'agent', runtimeType: 'assistant_agent',
      runtimeOptions: { modelKey: selectedModelKey },
    };

    const payload = buildPythonAutoGenCardRuntimePayload(
      cardM, {}, 'test', {}, {}, [cardA], '2026',
    );

    const priv = payload.cardRuntime.privateParticipants?.[0];
    const pub = payload.cardRuntime.participants?.[0];
    expect(priv?.providerModelId).not.toBe('default');
    expect(priv?.providerModelId).not.toBe('');
    expect(pub?.providerModelId).not.toBe('default');
    expect(pub?.providerModelId).not.toBe('');
  });
});
