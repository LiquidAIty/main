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
      [{ id: 'agentA', runtimeType: 'assistant_agent' }],
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
      [{ id: 'agentA', runtimeType: 'assistant_agent' }],
      '2026'
    );
    expect(payload.cardRuntime.runtimeOptions.maxTokens).toBeUndefined();
  });

  it('Python payload compatibility matches expected shape', () => {
    const cardM = { id: 'mag1', kind: 'agent', runtimeType: 'magentic_one', prompt: 'test system prompt' };
    const cardA = { id: 'agentA', kind: 'agent', runtimeType: 'assistant_agent' };
    const context = { deckId: 'deck1', allCards: [cardM, cardA], allEdges: [] };

    const payload = buildPythonAutoGenCardRuntimePayload(cardM, {}, 'hello', context, [cardA], '2026');
    
    expect(payload.session.orchestrator).toBe('magentic_one');
    expect(payload.systemPrompt).toBe('test system prompt');
    expect(payload.cardRuntime.runtimeScope?.pythonWorkerIds).toContain('agentA');
    // Ensure task_ledger, progress_ledger are completely absent
    expect((payload as any).task_ledger).toBeUndefined();
    expect((payload as any).progress_ledger).toBeUndefined();
  });
});
