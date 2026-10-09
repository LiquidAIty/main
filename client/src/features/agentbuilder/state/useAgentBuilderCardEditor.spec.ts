// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DeckDocument } from '../../../types/agentgraph';
import { INITIAL_DECK } from '../deck/newProjectDeck';
import { projectDeckForPersistence } from './useAgentBuilderAutosave';
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
      ...config, skills: ['research'],
    }); });
    expect(saved.edges).toEqual(deck.edges);
    expect(saved.edges).toContainEqual(deck.edges.find(edge => edge.id === 'incoming'));
    expect(saved.nodes.filter(card => card.id !== main.id)).toEqual(deck.nodes.filter(card => card.id !== main.id));
    const after = saved.nodes.find(card => card.id === main.id)!;
    expect(after.runtimeOptions?.skills).toEqual(['research']);
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
      tools: ['graphiti.search_nodes', 'canvas.inspect', 'card.update_configuration'],
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
      tools: ['graphiti.search_nodes', 'canvas.inspect', 'card.update_configuration'],
      skills: ['research'],
      toolsets: ['browser'],
      mcp_connection_ids: ['project-research'],
    });

    await act(async () => {
      await result.current.handleSaveSelectedCardConfig(result.current.selectedCardConfig!);
    });

    const after = saved.nodes.find(node => node.id === card.id)!;
    expect(after.runtimeOptions).toMatchObject({
      tools: ['graphiti.search_nodes', 'canvas.inspect', 'card.update_configuration'],
      skills: ['research'],
      toolsets: ['browser'],
      mcpConnectionIds: ['project-research'],
    });
    expect(after.prompt).toBe(card.prompt);
    expect(after.runtime).toEqual(card.runtime);
    expect(after.position).toEqual(card.position);
    expect(saved.edges).toEqual(deck.edges);
  });

  it('keeps presentation role metadata separate from prompt authority and clears migrated outputContract', async () => {
    const deck = structuredClone(INITIAL_DECK);
    const card = deck.nodes.find(node => node.id === 'card_main_chat')!;
    card.role = 'Saved presentation role';
    card.outputContract = 'Legacy output';
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

    await act(async () => {
      await result.current.handleSaveSelectedCardConfig({
        ...result.current.selectedCardConfig!,
        role: 'Attempted prompt-driven replacement',
        prompt_template: '[ROLE]\nRuntime instructions',
        output_contract: undefined,
      });
    });

    const after = saved.nodes.find(node => node.id === card.id)!;
    expect(after.role).toBe('Saved presentation role');
    expect(after.prompt).toBe('[ROLE]\nRuntime instructions');
    expect(after.outputContract).toBeUndefined();
  });

  it('promotes only the explicitly saved New Agent while other drafts stay transient', async () => {
    const deck = structuredClone(INITIAL_DECK);
    const template = deck.nodes.find((node) => node.id === 'builder')!;
    const firstDraft = {
      ...structuredClone(template),
      id: 'card_assist_first_draft',
      title: 'First Draft',
      runtime: { kind: 'hermes' as const, mode: 'delegate' as const, profile: 'agent-first-draft' },
    };
    const secondDraft = {
      ...structuredClone(template),
      id: 'card_assist_second_draft',
      title: 'Second Draft',
      runtime: { kind: 'hermes' as const, mode: 'delegate' as const, profile: 'agent-second-draft' },
    };
    for (const draft of [firstDraft, secondDraft]) {
      delete draft._cardRevisionId;
      delete draft._cardRevision;
      delete draft._cardRevisionSha256;
    }
    deck.nodes.push(firstDraft, secondDraft);
    deck.edges.push({
      id: 'edge-second-draft',
      source: deck.nodes[0].id,
      target: secondDraft.id,
      edgeType: 'flow',
    });
    const transientIds = new Set([firstDraft.id, secondDraft.id]);
    const persistDeck = vi.fn(async (_document: DeckDocument) => undefined);
    const onCardPersisted = vi.fn();
    const { result } = renderHook(() => useAgentBuilderCardEditor({
      deck,
      selectedCardId: firstDraft.id,
      setDeck: vi.fn(),
      persistDeck,
      recordDeckWriteReason: vi.fn(),
      prepareDeckForCardSave: (document, cardId) => projectDeckForPersistence(
        document,
        transientIds,
        new Set([cardId]),
      ),
      onCardPersisted,
    }));

    await act(async () => {
      await result.current.handleSaveSelectedCardConfig({
        ...result.current.selectedCardConfig!,
        prompt_template: 'Explicit first Card save',
      });
    });

    const saved = persistDeck.mock.calls[0][0];
    expect(saved.nodes.some((node) => node.id === firstDraft.id)).toBe(true);
    expect(saved.nodes.some((node) => node.id === secondDraft.id)).toBe(false);
    expect(saved.edges.some((edge) => edge.id === 'edge-second-draft')).toBe(false);
    expect(onCardPersisted).toHaveBeenCalledWith(firstDraft.id);
  });

});
