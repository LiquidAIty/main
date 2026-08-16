import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../decks/store', () => ({
  BUILDER_DECK_ID: 'deck_builder',
  getDeckDocument: vi.fn(),
}));

import { getDeckDocument } from '../decks/store';
import {
  resolveHermesCardRuntimeConfig,
  resolveHermesCardRuntimeHome,
  resolveMainHermesRuntimeConfig,
} from './mainAdapter';

const mockGetDeck = getDeckDocument as unknown as ReturnType<typeof vi.fn>;

const main = {
  id: 'card_main_chat',
  kind: 'agent',
  title: 'Main Chat',
  prompt: 'Saved Main prompt.',
  runtimeBinding: 'main_chat',
  runtimeType: 'assistant_agent',
  runtimeOptions: {
    provider: 'openai',
    accessMode: 'chatgpt-account',
    modelKey: 'gpt-5.6-luna',
    executionMode: 'single',
    tools: ['engraphis.recall', 'web_search'],
    nativeTools: ['memory'],
    skills: ['conversation'],
    toolsets: ['skills'],
    mcpConnectionIds: ['github'],
  },
};

beforeEach(() => mockGetDeck.mockReset());

describe('Hermes saved-card runtime resolution', () => {
  it('resolves Main from the saved deck, filters ordinary web, and grants its direct Coder and Kanban helper', async () => {
    const coder = {
      id: 'card_local_coder',
      kind: 'agent',
      runtimeBinding: 'local_coder',
      runtimeType: 'assistant_agent',
      runtimeOptions: { enabled: true },
    };
    const unrelated = {
      id: 'card_other',
      kind: 'agent',
      runtimeBinding: 'worldsignals_agent',
      runtimeType: 'assistant_agent',
    };
    const kanban = {
      id: 'card_hermes_steward',
      kind: 'agent',
      title: 'Kanban',
      runtimeBinding: 'hermes_steward',
      runtimeType: 'assistant_agent',
    };
    mockGetDeck.mockResolvedValue({
      deck: {
        nodes: [main, coder, kanban, unrelated],
        edges: [
          { source: main.id, target: coder.id, edgeType: 'flow' },
          { source: main.id, target: kanban.id, edgeType: 'flow' },
          { source: main.id, target: unrelated.id, edgeType: 'flow' },
        ],
      },
    });

    const config = await resolveMainHermesRuntimeConfig('project-1');

    expect(config).toMatchObject({
      cardId: main.id,
      profile: main.id,
      runtimeBinding: 'main_chat',
      provider: 'openai',
      modelKey: 'gpt-5.6-luna',
      executionMode: 'single',
      coderCardIds: [coder.id],
      directSubagents: [
        { cardId: coder.id, title: coder.id, runtimeBinding: 'local_coder' },
        { cardId: kanban.id, title: 'Kanban', runtimeBinding: 'hermes_steward' },
        { cardId: unrelated.id, title: unrelated.id, runtimeBinding: 'worldsignals_agent' },
      ],
    });
    expect(config?.tools).toEqual(['engraphis.recall', 'card.run_assistant_agent']);
    expect(config?.nativeTools).toEqual(['memory']);
    expect(config?.skills).toEqual(['conversation']);
    expect(config?.toolsets).toEqual(['skills']);
    expect(config?.mcpConnectionIds).toEqual(['github']);
    expect(config?.prompt).toContain('Saved Main prompt.');
    expect(config?.prompt).toContain(coder.id);
    expect(config?.prompt).toContain(kanban.id);
  });

  it('resolves the separate Kanban card through the same saved-card contract', () => {
    const config = resolveHermesCardRuntimeConfig({
      ...main,
      id: 'card_hermes_steward',
      title: 'Kanban',
      runtimeBinding: 'hermes_steward',
      runtimeOptions: {
        provider: 'openai',
        accessMode: 'chatgpt-account',
        modelKey: 'gpt-5.6-luna',
        profile: 'kanban-research',
        executionMode: 'auto-kanban',
        tools: ['graphiti.search_nodes'],
      },
    });

    expect(config).toMatchObject({
      cardId: 'card_hermes_steward',
      profile: 'kanban-research',
      runtimeBinding: 'hermes_steward',
      executionMode: 'auto-kanban',
      tools: ['graphiti.search_nodes'],
    });
  });

  it('uses the explicit persisted Hermes profile identity', () => {
    const config = resolveHermesCardRuntimeConfig({
      ...main,
      id: 'card_luna',
      runtimeOptions: {
        ...main.runtimeOptions,
        profile: 'shared-selector-is-not-authority',
      },
    });

    expect(config.profile).toBe('shared-selector-is-not-authority');
  });

  it('does not reinterpret native profile status placeholders as provider configuration', () => {
    const config = resolveHermesCardRuntimeConfig({
      ...main,
      runtimeOptions: {
        ...main.runtimeOptions,
        profile: 'default',
        profileSnapshot: { name: 'default', model: '—', gateway: 'stopped' },
      },
    });

    expect(config.profileSnapshot).toEqual({ name: 'default', model: '', gateway: '' });
    expect(config.profileConflicts).toEqual([]);
    expect(config.providerModelId).toBe('gpt-5.6-luna');
  });

  it('uses a persisted Hermes profile model by default while retaining the saved Card snapshot', () => {
    const config = resolveHermesCardRuntimeConfig({
      ...main,
      runtimeOptions: {
        ...main.runtimeOptions,
        profile: 'research',
        profileSnapshot: { name: 'research', model: 'gpt-5.6-sol', gateway: 'openai' },
      },
    });
    expect(config.providerModelId).toBe('gpt-5.6-sol');
    expect(config.profileConflictResolution).toBe('hermes');
    expect(config.profileConflicts).toEqual([
      'profile_model_conflict:gpt-5.6-sol:gpt-5.6-luna',
    ]);
    expect(config.savedCardRuntime.providerModelId).toBe('gpt-5.6-luna');
  });

  it('persists an explicit Card override for a visible Hermes model conflict', () => {
    const config = resolveHermesCardRuntimeConfig({
      ...main,
      runtimeOptions: {
        ...main.runtimeOptions,
        profile: 'research',
        profileSnapshot: { name: 'research', model: 'gpt-5.6-sol', gateway: 'openai' },
        profileConflictResolution: 'card',
      },
    });
    expect(config.providerModelId).toBe('gpt-5.6-luna');
    expect(config.profileConflictResolution).toBe('card');
  });

  it('rejects auto-kanban on Main at the runtime boundary', () => {
    expect(() => resolveHermesCardRuntimeConfig({
      ...main,
      runtimeOptions: {
        ...main.runtimeOptions,
        executionMode: 'auto-kanban',
      },
    })).toThrow('main_execution_mode_must_be_single');
  });

  it('confines coder OAuth to the saved LocalCoder runtime binding', () => {
    expect(() => resolveHermesCardRuntimeConfig({
      ...main,
      runtimeOptions: { ...main.runtimeOptions, accessMode: 'coder-oauth' },
    })).toThrow('card_coder_oauth_requires_local_coder');

    const coder = resolveHermesCardRuntimeConfig({
      ...main,
      id: 'card_local_coder',
      runtimeBinding: 'local_coder',
      runtimeOptions: { ...main.runtimeOptions, accessMode: 'coder-oauth' },
    });
    expect(coder.accessMode).toBe('coder-oauth');
  });

  it('isolates runtime homes by stable card id, not mutable card configuration', () => {
    const root = 'C:\\runtime';
    const mainHome = resolveHermesCardRuntimeHome(root, 'card_main_chat');
    const kanbanHome = resolveHermesCardRuntimeHome(root, 'card_hermes_steward');
    const lunaHome = resolveHermesCardRuntimeHome(root, 'card_luna');

    expect(mainHome).not.toBe(kanbanHome);
    expect(mainHome).not.toContain(`${root}\\.hermes\\profiles\\default`);
    expect(
      resolveHermesCardRuntimeHome(root, 'card_main_chat'),
    ).toBe(mainHome);

    const renamedAndReconfigured = resolveHermesCardRuntimeConfig({
      ...main,
      id: 'card_luna',
      runtimeBinding: 'assist',
      title: 'Renamed Luna',
      prompt: 'Changed instructions',
      runtimeOptions: {
        ...main.runtimeOptions,
        modelKey: 'gpt-5.6-terra',
        tools: ['canvas.inspect'],
        nativeTools: ['memory'],
        skills: ['planning'],
        toolsets: ['skills'],
        mcpConnectionIds: ['github'],
        executionMode: 'auto-kanban',
      },
    });
    expect(
      resolveHermesCardRuntimeHome(root, renamedAndReconfigured.cardId),
    ).toBe(lunaHome);
    expect(renamedAndReconfigured).toMatchObject({
      nativeTools: ['memory'],
      skills: ['planning'],
      toolsets: ['skills'],
      mcpConnectionIds: ['github'],
    });
  });
});
