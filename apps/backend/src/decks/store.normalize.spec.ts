import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../db/pool', () => ({
  pool: { query: dbMocks.query },
}));

import {
  getDeckDocument,
  saveDeckDocument,
} from './store';

beforeEach(() => {
  dbMocks.query.mockReset();
});

describe('deck store edge persistence', () => {
  it('forces Main to single while preserving another card auto-kanban mode and identity', async () => {
    let persisted: Record<string, unknown> = {
      v3_state: { decks: {}, meta: { decks: {} } },
    };
    dbMocks.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (String(sql).includes('SELECT agent_io_schema')) {
        return { rows: [{ agent_io_schema: persisted }] };
      }
      persisted = JSON.parse(String(params[params.length - 2]));
      return { rows: [{ agent_io_schema: persisted }] };
    });
    const deck = {
      id: 'deck_builder',
      name: 'Execution Modes',
      version: 1,
      promptTemplates: [],
      nodes: [
        {
          id: 'card_main_chat',
          runtimeBinding: 'main_chat',
          runtimeType: 'assistant_agent',
          runtimeOptions: { executionMode: 'auto-kanban' },
        },
        {
          id: 'card_luna',
          runtimeBinding: 'assist',
          runtimeType: 'assistant_agent',
          runtimeOptions: { executionMode: 'auto-kanban' },
        },
      ],
      edges: [],
    };

    const saved = await saveDeckDocument('project-one', 'deck_builder', deck as any);

    expect(saved.deck.nodes.map((card) => card.id)).toEqual(['card_main_chat', 'card_luna']);
    expect(saved.deck.nodes[0].runtimeOptions?.executionMode).toBe('single');
    expect(saved.deck.nodes[1].runtimeOptions?.executionMode).toBe('auto-kanban');
  });

  it('round-trips card skills and MCP references without serializing credentials', async () => {
    let persisted: Record<string, unknown> = {
      v3_state: { decks: {}, meta: { decks: {} } },
    };
    dbMocks.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (String(sql).includes('SELECT agent_io_schema')) {
        return { rows: [{ agent_io_schema: persisted }] };
      }
      const nextSchema = JSON.parse(String(params[params.length - 2]));
      persisted = nextSchema;
      return { rows: [{ agent_io_schema: persisted }] };
    });
    const deck = {
      id: 'deck_builder',
      name: 'Unified Card Deck',
      version: 1,
      promptTemplates: [],
      nodes: [{
        id: 'card_research',
        kind: 'agent' as const,
        templateId: 'template_assist',
        title: 'Research',
        runtimeType: 'assistant_agent' as const,
        runtimeOptions: {
          provider: 'openai' as const,
          modelKey: 'gpt-5.6-luna',
          skills: ['research', 'citations'],
          toolsets: ['web-research'],
          mcpConnectionIds: ['github', 'research-service'],
        },
        position: { x: 1, y: 2 },
      }],
      edges: [],
    };

    const saved = await saveDeckDocument('project-one', 'deck_builder', deck);
    const loaded = await getDeckDocument('project-one', 'deck_builder');

    expect(saved.deck.nodes[0].runtimeOptions).toMatchObject({
      skills: ['research', 'citations'],
      toolsets: ['web-research'],
      mcpConnectionIds: ['github', 'research-service'],
    });
    expect(loaded.deck).toEqual(saved.deck);
    expect(JSON.stringify(saved.deck)).not.toMatch(
      /api.?key|access.?token|refresh.?token|client.?secret/i,
    );
  });

  it('does not inject Main, prompt templates, or control edges into saved state', async () => {
    const deck = {
      id: 'deck_builder',
      name: 'Saved Minimal Deck',
      version: 9,
      promptTemplates: [],
      nodes: [{
        id: 'saved-card',
        kind: 'agent',
        templateId: 'saved-template',
        title: 'Saved Card',
        runtimeBinding: 'research_agent',
        runtimeType: 'assistant_agent',
        runtimeOptions: { provider: 'openrouter', modelKey: 'saved/model', tools: ['saved.tool'] },
        position: { x: 1, y: 2 },
      }],
      edges: [],
    };
    dbMocks.query.mockResolvedValueOnce({
      rows: [{
        agent_io_schema: {
          v3_state: {
            decks: { deck_builder: deck },
            meta: { decks: {} },
          },
        },
      }],
    });

    const result = await getDeckDocument('project-one', 'deck_builder');

    expect(result.deck?.nodes).toHaveLength(1);
    expect(result.deck?.nodes[0]).toMatchObject({
      id: 'saved-card',
      runtimeBinding: 'research_agent',
      runtimeType: 'assistant_agent',
      runtimeOptions: { provider: 'openrouter', modelKey: 'saved/model', tools: ['saved.tool'] },
    });
    expect(result.deck?.promptTemplates).toEqual([]);
    expect(result.deck?.edges).toEqual([]);
  });

  it('preserves a directed Main-to-Hermes flow edge exactly as saved', async () => {
    const deck = {
      id: 'deck_builder',
      name: 'Builder',
      version: 1,
      promptTemplates: [],
      nodes: [
        {
          id: 'card_main_chat',
          kind: 'agent',
          title: 'Main',
          runtimeBinding: 'main_chat',
          runtimeType: 'assistant_agent',
          position: { x: 0, y: 0 },
        },
        {
          id: 'custom-hermes-card',
          kind: 'agent',
          title: 'Hermes',
          runtimeBinding: 'hermes_steward',
          runtimeType: 'assistant_agent',
          position: { x: 100, y: 0 },
        },
        {
          id: 'worker',
          kind: 'agent',
          title: 'Worker',
          runtimeBinding: 'research_agent',
          runtimeType: 'assistant_agent',
          position: { x: 200, y: 0 },
        },
        {
          id: 'card_magentic',
          kind: 'agent',
          title: 'Bus',
          runtimeType: 'magentic_one',
          position: { x: 300, y: 0 },
        },
      ],
      edges: [
        {
          id: 'main-hermes-flow',
          source: 'card_main_chat',
          sourceHandle: 'out-a',
          target: 'custom-hermes-card',
          targetHandle: 'in-a',
          edgeType: 'flow',
        },
        {
          id: 'reversed',
          source: 'custom-hermes-card',
          target: 'card_main_chat',
          edgeType: 'flow',
        },
        {
          id: 'invalid',
          source: 'card_main_chat',
          target: 'custom-hermes-card',
          edgeType: 'unknown_authority',
        },
        {
          id: 'unrelated',
          source: 'card_main_chat',
          target: 'worker',
          edgeType: 'flow',
        },
        {
          id: 'control',
          source: 'card_main_chat',
          target: 'card_magentic',
          edgeType: 'magentic_control',
        },
      ],
    };
    dbMocks.query.mockResolvedValueOnce({
      rows: [{
        agent_io_schema: {
          v3_state: {
            decks: { deck_builder: deck },
            meta: { decks: {} },
          },
        },
      }],
    });

    const result = await getDeckDocument('project-one', 'deck_builder');
    const edges = result.deck!.edges;
    expect(edges.find((edge) => edge.id === 'main-hermes-flow')).toEqual(expect.objectContaining({
      source: 'card_main_chat',
      sourceHandle: 'out-a',
      target: 'custom-hermes-card',
      targetHandle: 'in-a',
      edgeType: 'flow',
    }));
    expect(edges.find((edge) => edge.id === 'reversed')?.edgeType).toBe('flow');
    expect(edges.find((edge) => edge.id === 'invalid')?.edgeType).toBe('unknown_authority');
    expect(edges.find((edge) => edge.id === 'unrelated')?.edgeType).toBe('flow');
  });

  it('preserves provider, model, tools, and unknown values byte-for-byte as JSON', async () => {
    const deck = {
      id: 'deck_builder',
      name: 'Exact Saved Deck',
      version: 1,
      promptTemplates: [],
      nodes: [{
        id: 'saved-card',
        runtimeBinding: 'future_binding',
        runtimeType: 'future_runtime',
        runtimeOptions: {
          provider: 'future_provider',
          modelKey: '  exact-model-key  ',
          tools: ['  exact.tool  ', '', 42],
        },
      }],
      edges: [],
    };
    dbMocks.query.mockResolvedValueOnce({
      rows: [{ agent_io_schema: { v3_state: { decks: { deck_builder: deck }, meta: { decks: {} } } } }],
    });

    const result = await getDeckDocument('project-one', 'deck_builder');

    expect(result.deck).toEqual(deck);
  });
});
