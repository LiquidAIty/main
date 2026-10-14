import { describe, expect, it } from 'vitest';

import type { DeckCard, DeckDocument } from '../types';
import type { HermesGatewayClient } from '../services/hermesGateway';
import { cardSession } from './mainSession.routes';
import type {
  AddressableCard,
  SharedChatAuthority,
} from '../services/savedCardAuthority';

const mainCard: DeckCard = {
  id: 'card_main_chat',
  _cardRevisionId: 'revision-main',
  templateId: 'main',
  title: 'Main',
  role: '',
  prompt: '# Main\nCanonical saved behavior.',
  runtime: { kind: 'hermes', mode: 'main', profile: 'main' },
  runtimeOptions: {
    provider: 'openai',
    accessMode: 'chatgpt-account',
    modelKey: 'gpt-parent',
    providerModelId: 'gpt-parent',
    openaiRuntime: 'codex_app_server',
    skills: [],
    toolsets: [],
    mcpConnectionIds: [],
  },
  position: { x: 0, y: 0 },
};

function authority(): SharedChatAuthority {
  const builder: DeckCard = {
    ...mainCard,
    id: 'builder',
    _cardRevisionId: 'revision-builder',
    title: 'Builder',
    prompt: '# Builder',
    runtime: { kind: 'hermes', mode: 'delegate', profile: 'builder' },
  };
  const deck: DeckDocument = {
    id: 'deck_builder',
    name: 'Deck',
    workspaceRoot: '',
    version: 1,
    promptTemplates: [],
    nodes: [mainCard, builder],
    edges: [{ id: 'main-builder', source: mainCard.id, target: builder.id, edgeType: 'flow' }],
  };
  const addressable: AddressableCard = {
    card: mainCard,
    cardRevisionId: 'revision-main',
    profile: 'main',
    title: 'Main',
    address: 'Main',
    aliases: ['card_main_chat', 'main'],
  };
  return { deck, main: addressable, cards: [addressable] };
}

describe('Main canonical Hermes session', () => {
  it('single-flights first access and always resolves the exact hidden Bot Chat registry', async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    let storedSessionId = '';
    const client = {
      async request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
        calls.push({ method, params: structuredClone(params) });
        if (method === 'profiles.describe') {
          return {
            name: 'main',
            soul: mainCard.prompt,
            capability_fingerprint: '0123456789ab',
            model: {
              provider: 'openai-codex',
              default: 'gpt-parent',
              openai_runtime: 'codex_app_server',
            },
            skills: [{ name: 'hermes-agent', enabled: true }],
            toolsets: [],
            mcp_servers: [],
            delegation: {
              provider: '', model: '', max_spawn_depth: 1,
              orchestrator_enabled: true, enabled: true,
            },
            task_mode: null,
          } as T;
        }
        if (method === 'session.list') {
          return { sessions: storedSessionId ? [{
            id: storedSessionId,
            resolved_id: storedSessionId,
          }] : [] } as T;
        }
        if (method === 'session.create') {
          storedSessionId = 'stored-main';
          return {
            session_id: 'live-main',
            stored_session_id: storedSessionId,
            info: {},
          } as T;
        }
        if (method === 'session.resume') {
          return {
            session_id: 'live-main',
            stored_session_id: storedSessionId,
            info: {},
          } as T;
        }
        throw new Error(`unexpected:${method}`);
      },
    } as unknown as HermesGatewayClient;
    const saved = authority();

    const [first, second] = await Promise.all([
      cardSession(client, saved, saved.main, {
        userId: 'owner', projectId: 'project-a', deckId: 'deck_builder', conversationId: 'main',
      }),
      cardSession(client, saved, saved.main, {
        userId: 'owner', projectId: 'project-b', deckId: 'deck_builder', conversationId: 'another-view',
      }),
    ]);

    expect(first.storedSessionId).toBe('stored-main');
    expect(second.storedSessionId).toBe('stored-main');
    expect(calls.filter(({ method }) => method === 'session.create')).toHaveLength(1);
    expect(calls.filter(({ method }) => method === 'session.resume')).toHaveLength(1);
    expect(calls.filter(({ method }) => method === 'session.list').map(({ params }) => params))
      .toEqual([
        { profile: 'main', title: 'Bot Chat', include_hidden: true, limit: 200 },
        { profile: 'main', title: 'Bot Chat', include_hidden: true, limit: 200 },
      ]);
    expect(calls.find(({ method }) => method === 'session.create')?.params)
      .toMatchObject({ profile: 'main', title: 'Bot Chat', hidden: true });
    expect(calls.every(({ params }) => !('storedSessionId' in params))).toBe(true);
  });
});
