// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DeckDocument } from '../../../types/agentgraph';
import { INITIAL_DECK } from '../deck/newProjectDeck';
import useAgentBuilderCardEditor from './useAgentBuilderCardEditor';

describe('Card delegation setting and saved wires', () => {
  it('removes only outgoing orange wires when delegation is saved off', () => {
    const deck = structuredClone(INITIAL_DECK);
    const main = deck.nodes.find(card => card.id === 'card_main_chat')!;
    deck.edges.push({ id: 'incoming', source: 'card_agent_builder', target: main.id, edgeType: 'flow' });
    let saved = deck;
    const setDeck = vi.fn((update: React.SetStateAction<DeckDocument>) => {
      saved = typeof update === 'function' ? update(saved) : update;
    });
    const { result } = renderHook(() => useAgentBuilderCardEditor({
      deck, selectedCardId: main.id, setDeck, recordDeckWriteReason: vi.fn(),
    }));
    const config = result.current.selectedCardConfig!;
    act(() => result.current.handleSaveSelectedCardConfig({
      ...config, runtime_options: { ...config.runtime_options, profileDelegationEnabled: false },
    }));
    expect(saved.edges).toEqual(deck.edges.filter(edge => edge.edgeType !== 'flow' || edge.source !== main.id));
    expect(saved.edges).toContainEqual(deck.edges.find(edge => edge.id === 'incoming'));
    expect(saved.nodes.filter(card => card.id !== main.id)).toEqual(deck.nodes.filter(card => card.id !== main.id));
    const after = saved.nodes.find(card => card.id === main.id)!;
    expect(after.runtimeOptions?.profileDelegationEnabled).toBe(false);
    expect(after.runtime).toEqual(main.runtime);
    expect(after.prompt).toBe(main.prompt);
    expect(after.position).toEqual(main.position);
    expect(after.runtimeOptions?.tools).toEqual(main.runtimeOptions?.tools);
  });
});
