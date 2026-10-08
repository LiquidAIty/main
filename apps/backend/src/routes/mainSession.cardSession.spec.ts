import { describe, expect, it } from 'vitest';

import type { AgentCardInstance, DeckDocument } from '../types';
import type { HermesGatewayClient } from '../services/hermesGateway';
import {
  cardSession,
  type AddressableCard,
  type SharedChatAuthority,
} from './mainSession.routes';

const mainCard: AgentCardInstance = {
  id: 'card_main_chat',
  templateId: 'main',
  title: 'Main',
  role: '',
  prompt: '# Main\nShared configured behavior.',
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

function target(id: string, profile: string): AgentCardInstance {
  return {
    id,
    templateId: 'assistant',
    title: profile,
    role: '',
    prompt: `# ${profile}`,
    runtime: { kind: 'hermes', mode: 'delegate', profile },
    runtimeOptions: {},
    position: { x: 1, y: 1 },
  };
}

function authority(projectMarker: string, rosterTarget: AgentCardInstance): SharedChatAuthority {
  const deck: DeckDocument = {
    id: 'deck_builder',
    name: `Deck ${projectMarker}`,
    workspaceRoot: '',
    version: 1,
    promptTemplates: [],
    nodes: [mainCard, rosterTarget],
    edges: [{
      id: `edge-${projectMarker}`,
      source: mainCard.id,
      target: rosterTarget.id,
      edgeType: 'flow',
    }],
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

describe('shared Card profile with isolated Project sessions', () => {
  it('reuses one profile while two users and Projects retain separate session authority', async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    let sequence = 0;
    const client = {
      async request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
        calls.push({ method, params: structuredClone(params) });
        if (method === 'profiles.describe') {
          return {
            name: 'main',
            soul: mainCard.prompt,
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
              orchestrator_enabled: false, enabled: false,
            },
            task_mode: null,
            learned_state_marker: 'shared-agent-learning',
          } as T;
        }
        if (method === 'session.list') return { sessions: [] } as T;
        if (method === 'session.create') {
          sequence += 1;
          return {
            session_id: `live-${sequence}`,
            stored_session_id: `stored-${sequence}`,
            info: {},
          } as T;
        }
        throw new Error(`unexpected:${method}`);
      },
    } as unknown as HermesGatewayClient;

    const projectA = authority('project-a', target('builder', 'builder'));
    const projectB = authority('project-b', target('card_knowgraph', 'knowgraph'));
    const [first, second] = await Promise.all([
      cardSession(client, projectA, projectA.main, {
        userId: 'user-a', projectId: 'project-a', deckId: 'deck_builder',
        conversationId: 'conversation-a',
      }),
      cardSession(client, projectB, projectB.main, {
        userId: 'user-b', projectId: 'project-b', deckId: 'deck_builder',
        conversationId: 'conversation-b',
      }),
    ]);

    expect(first.sessionId).not.toBe(second.sessionId);
    const profileCalls = calls.filter(({ method }) => method.startsWith('profiles.'));
    expect(profileCalls).toHaveLength(2);
    expect(profileCalls.every(({ method, params }) => (
      method === 'profiles.describe'
      && JSON.stringify(params) === JSON.stringify({ name: 'main' })
    ))).toBe(true);
    expect(calls.some(({ method }) => method === 'profiles.configure')).toBe(false);

    const created = calls.filter(({ method }) => method === 'session.create').map(({ params }) => params);
    expect(created).toHaveLength(2);
    expect(created.map((params) => params.profile)).toEqual(['main', 'main']);
    expect(created.map((params) => params.bot_mode_roster)).toEqual([['builder'], ['knowgraph']]);
    expect(new Set(created.map((params) => params.title)).size).toBe(2);
    expect(new Set(created.map((params) => params.cwd)).size).toBe(2);
    for (const params of created) {
      expect(params).not.toHaveProperty('userId');
      expect(params).not.toHaveProperty('projectId');
      expect(params).not.toHaveProperty('deckId');
      expect(params).not.toHaveProperty('credentials');
      expect(params).not.toHaveProperty('runHistory');
    }
    expect(calls.every(({ method }) => !method.startsWith('run.'))).toBe(true);
  });
});
