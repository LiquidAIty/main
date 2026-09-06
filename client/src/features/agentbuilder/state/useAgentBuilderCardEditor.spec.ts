// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DeckDocument } from '../../../types/agentgraph';
import { INITIAL_DECK } from '../deck/newProjectDeck';
import useAgentBuilderCardEditor from './useAgentBuilderCardEditor';

describe('Card delegation setting and saved wires', () => {
  it('uses one canonical save and does not replace local settings when persistence fails', async () => {
    const deck = structuredClone(INITIAL_DECK);
    const setDeck = vi.fn();
    const persistDeck = vi.fn(async () => { throw new Error('deck_conflict'); });
    const { result } = renderHook(() => useAgentBuilderCardEditor({
      deck, selectedCardId: 'card_main_chat', setDeck, persistDeck, recordDeckWriteReason: vi.fn(),
    }));
    const config = { ...result.current.selectedCardConfig!, prompt_template: 'Changed instructions' };
    await expect(result.current.handleSaveSelectedCardConfig(config)).rejects.toThrow('deck_conflict');
    expect(persistDeck).toHaveBeenCalledOnce();
    expect(persistDeck.mock.calls[0][0].nodes.find(card => card.id === 'card_main_chat')?.prompt)
      .toBe('Changed instructions');
    expect(setDeck).not.toHaveBeenCalled();
    expect(result.current.selectedCardConfig?.prompt_template).not.toBe('Changed instructions');
  });

  it('removes only outgoing orange wires when delegation is saved off', async () => {
    const deck = structuredClone(INITIAL_DECK);
    const main = deck.nodes.find(card => card.id === 'card_main_chat')!;
    deck.edges.push({ id: 'incoming', source: 'card_agent_builder', target: main.id, edgeType: 'flow' });
    let saved = deck;
    const setDeck = vi.fn((update: React.SetStateAction<DeckDocument>) => {
      saved = typeof update === 'function' ? update(saved) : update;
    });
    const { result } = renderHook(() => useAgentBuilderCardEditor({
      deck, selectedCardId: main.id, setDeck, recordDeckWriteReason: vi.fn(), persistDeck: vi.fn(async () => undefined),
    }));
    const config = result.current.selectedCardConfig!;
    await act(async () => { await result.current.handleSaveSelectedCardConfig({
      ...config, runtime_options: { ...config.runtime_options, delegationRole: 'off' },
    }); });
    expect(saved.edges).toEqual(deck.edges.filter(edge => edge.edgeType !== 'flow' || edge.source !== main.id));
    expect(saved.edges).toContainEqual(deck.edges.find(edge => edge.id === 'incoming'));
    expect(saved.nodes.filter(card => card.id !== main.id)).toEqual(deck.nodes.filter(card => card.id !== main.id));
    const after = saved.nodes.find(card => card.id === main.id)!;
    expect(after.runtimeOptions?.delegationRole).toBe('off');
    expect(after.runtime).toEqual(main.runtime);
    expect(after.prompt).toBe(main.prompt);
    expect(after.position).toEqual(main.position);
    expect(after.runtimeOptions?.tools).toEqual(main.runtimeOptions?.tools);
  });
});
