// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DeckDocument } from '../../../types/agentgraph';
import { INITIAL_DECK } from '../deck/newProjectDeck';
import useAgentBuilderCardEditor from './useAgentBuilderCardEditor';

describe('Card settings and saved Bot wires', () => {
  it('uses one canonical save and does not replace local settings when persistence fails', async () => {
    const deck = structuredClone(INITIAL_DECK);
    const setDeck = vi.fn();
    const persistDeck = vi.fn(async (_document: DeckDocument) => { throw new Error('deck_conflict'); });
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

  it('preserves orange Bot connections when an unrelated Card setting changes', async () => {
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
    expect(saved.edges).toEqual(deck.edges);
    expect(saved.edges).toContainEqual(deck.edges.find(edge => edge.id === 'incoming'));
    expect(saved.nodes.filter(card => card.id !== main.id)).toEqual(deck.nodes.filter(card => card.id !== main.id));
    const after = saved.nodes.find(card => card.id === main.id)!;
    expect(after.runtimeOptions?.delegationRole).toBe('off');
    expect(after.runtime).toEqual(main.runtime);
    expect(after.prompt).toBe(main.prompt);
    expect(after.position).toEqual(main.position);
    expect(after.runtimeOptions?.tools).toEqual(main.runtimeOptions?.tools);
  });

  it('round-trips each saved capability category without changing unrelated Card authority', async () => {
    const deck = structuredClone(INITIAL_DECK);
    const card = deck.nodes.find(node => node.id === 'card_worldsignals_agent')!;
    card.runtimeOptions = {
      ...card.runtimeOptions,
      tools: ['graphiti.search_nodes'],
      nativeTools: ['memory', 'terminal'],
      skills: ['research'],
      toolsets: ['browser'],
      mcpConnectionIds: ['project-research'],
    };
    let saved = deck;
    const setDeck = vi.fn((update: React.SetStateAction<DeckDocument>) => {
      saved = typeof update === 'function' ? update(saved) : update;
    });
    const persistDeck = vi.fn(async (document: DeckDocument) => { saved = document; });
    const { result } = renderHook(() => useAgentBuilderCardEditor({
      deck,
      selectedCardId: card.id,
      setDeck,
      persistDeck,
      recordDeckWriteReason: vi.fn(),
    }));

    expect(result.current.selectedCardConfig).toMatchObject({
      tools: ['graphiti.search_nodes'],
      native_tools: ['memory', 'terminal'],
      skills: ['research'],
      toolsets: ['browser'],
      mcp_connection_ids: ['project-research'],
    });

    await act(async () => {
      await result.current.handleSaveSelectedCardConfig(result.current.selectedCardConfig!);
    });

    const after = saved.nodes.find(node => node.id === card.id)!;
    expect(after.runtimeOptions).toMatchObject({
      tools: ['graphiti.search_nodes'],
      nativeTools: ['memory', 'terminal'],
      skills: ['research'],
      toolsets: ['browser'],
      mcpConnectionIds: ['project-research'],
    });
    expect(after.prompt).toBe(card.prompt);
    expect(after.runtime).toEqual(card.runtime);
    expect(after.position).toEqual(card.position);
    expect(saved.edges).toEqual(deck.edges);
  });
});
