import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { DeckCard, DeckDocument } from '../types';
import type { HermesGatewayClient } from './hermesGateway';
import {
  cardSession,
} from './hermesCardSession';
import type { AddressableCard, SharedChatAuthority } from './savedCardAuthority';

const mocks = vi.hoisted(() => ({ getDeck: vi.fn() }));
vi.mock('../decks/deckDomainClient', () => ({
  BUILDER_CARD_ID: 'builder',
  getDeckDocument: mocks.getDeck,
}));

const builderCodeRoots: string[] = [];
const decksByProject = new Map<string, DeckDocument>();
const originalBuilderCodeRoot = process.env.BUILDER_PROJECT_CODE_ROOT;
mocks.getDeck.mockImplementation(async (projectId: string) => ({
  deck: decksByProject.get(projectId) || null,
}));

function useTemporaryBuilderCodeRoot(): string {
  const root = mkdtempSync(path.join(
    process.env.LOCALAPPDATA || os.homedir(),
    'builder-session-test-',
  ));
  builderCodeRoots.push(root);
  process.env.BUILDER_PROJECT_CODE_ROOT = root;
  return realpathSync(root);
}

afterEach(() => {
  if (originalBuilderCodeRoot === undefined) delete process.env.BUILDER_PROJECT_CODE_ROOT;
  else process.env.BUILDER_PROJECT_CODE_ROOT = originalBuilderCodeRoot;
  while (builderCodeRoots.length > 0) {
    rmSync(builderCodeRoots.pop()!, { recursive: true, force: true });
  }
  decksByProject.clear();
});

const mainCard: DeckCard = {
  id: 'card_main_chat',
  _cardRevisionId: 'revision-main',
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

function target(id: string, profile: string): DeckCard {
  return {
    id,
    _cardRevisionId: `revision-${id}`,
    templateId: 'assistant',
    title: profile,
    role: '',
    prompt: `# ${profile}`,
    runtime: { kind: 'hermes', mode: 'delegate', profile },
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
    position: { x: 1, y: 1 },
  };
}

function authority(projectId: string, rosterTarget: DeckCard): SharedChatAuthority {
  const deck: DeckDocument = {
    id: 'deck_builder',
    name: `Deck ${projectId}`,
    projectCodeFolder: '',
    version: 1,
    promptTemplates: [],
    nodes: [mainCard, rosterTarget],
    edges: [{
      id: `edge-${projectId}`,
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
  decksByProject.set(projectId, deck);
  return { deck, main: addressable, cards: [addressable] };
}

describe('shared Card profile with isolated Project sessions', () => {
  it('refuses a stale selected revision before touching the shared profile', async () => {
    const calls: string[] = [];
    const client = {
      async request<T>(method: string): Promise<T> {
        calls.push(method);
        throw new Error(`unexpected:${method}`);
      },
    } as unknown as HermesGatewayClient;
    const project = authority('stale-project', target('builder', 'builder'));
    project.main.cardRevisionId = 'revision-stale';

    await expect(cardSession(client, project.main, {
      userId: 'user-a', projectId: 'stale-project', deckId: 'deck_builder',
      conversationId: 'conversation-a',
    })).rejects.toThrow('card_revision_changed');

    expect(calls).toEqual([]);
  });

  it('creates one Hermes session for simultaneous first turns in the same conversation', async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    let storedSessionId = '';
    const client = {
      async request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
        calls.push({ method, params: structuredClone(params) });
        if (method === 'profiles.describe') {
          return {
            name: 'main', soul: mainCard.prompt,
            capability_fingerprint: '0123456789ab',
            model: {
              provider: 'openai-codex', default: 'gpt-parent',
              openai_runtime: 'codex_app_server',
            },
            skills: [{ name: 'hermes-agent', enabled: true }],
            toolsets: [], mcp_servers: [],
            delegation: {
              provider: '', model: '', max_spawn_depth: 1,
              orchestrator_enabled: false, enabled: false,
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
            session_id: 'live-main', stored_session_id: storedSessionId, info: {},
          } as T;
        }
        if (method === 'session.resume') {
          return {
            session_id: 'live-main', stored_session_id: storedSessionId, info: {},
          } as T;
        }
        throw new Error(`unexpected:${method}`);
      },
    } as unknown as HermesGatewayClient;
    const project = authority('same-project', target('builder', 'builder'));
    const owner = {
      userId: 'same-user', projectId: 'same-project', deckId: 'deck_builder',
      conversationId: 'same-conversation',
    };

    const [first, second] = await Promise.all([
      cardSession(client, project.main, owner),
      cardSession(client, project.main, owner),
    ]);

    expect(first.storedSessionId).toBe('stored-main');
    expect(second.storedSessionId).toBe('stored-main');
    expect(calls.filter(({ method }) => method === 'session.create')).toHaveLength(1);
    expect(calls.filter(({ method }) => method === 'session.resume')).toHaveLength(1);
  });

  it('reuses one profile while two users and Projects retain separate session authority', async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    let sequence = 0;
    const client = {
      async request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
        calls.push({ method, params: structuredClone(params) });
        if (method === 'profiles.describe') {
          return {
            name: 'main',
            capability_fingerprint: '0123456789ab',
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
      cardSession(client, projectA.main, {
        userId: 'user-a', projectId: 'project-a', deckId: 'deck_builder',
        conversationId: 'conversation-a',
      }),
      cardSession(client, projectB.main, {
        userId: 'user-b', projectId: 'project-b', deckId: 'deck_builder',
        conversationId: 'conversation-b',
      }),
    ]);

    expect(first.sessionId).not.toBe(second.sessionId);
    const profileCalls = calls.filter(({ method }) => method.startsWith('profiles.'));
    expect(profileCalls).toHaveLength(2);
    expect(profileCalls.map(({ method, params }) => ({ method, params }))).toEqual([
      { method: 'profiles.describe', params: { name: 'main', bot_mode_roster: ['builder'] } },
      { method: 'profiles.describe', params: { name: 'main', bot_mode_roster: ['knowgraph'] } },
    ]);
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

  it('uses the saved Project code folder only for the Builder session', async () => {
    const codeRoot = useTemporaryBuilderCodeRoot();
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const client = {
      async request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
        calls.push({ method, params: structuredClone(params) });
        if (method === 'profiles.describe') {
          return {
            name: 'builder',
            capability_fingerprint: '0123456789ab',
            soul: '# builder',
            model: {
              provider: 'openai-codex',
              default: 'gpt-parent',
              openai_runtime: 'codex_app_server',
            },
            skills: [], toolsets: [], mcp_servers: [],
            delegation: { provider: '', model: '', max_spawn_depth: 1, enabled: false },
            task_mode: null,
          } as T;
        }
        if (method === 'session.list') return { sessions: [] } as T;
        if (method === 'session.create') {
          return {
            session_id: 'live-builder', stored_session_id: 'stored-builder',
            info: {},
          } as T;
        }
        throw new Error(`unexpected:${method}`);
      },
    } as unknown as HermesGatewayClient;
    const builderCard = target('builder', 'builder');
    const project = authority('project-a', builderCard);
    project.deck.projectCodeFolder = 'worker-agent-ui';
    const addressableBuilder: AddressableCard = {
      card: builderCard,
      cardRevisionId: 'revision-builder',
      profile: 'builder',
      title: 'Builder',
      address: 'Builder',
      aliases: ['builder'],
    };

    await cardSession(client, addressableBuilder, {
      userId: 'user-a', projectId: 'project-a', deckId: 'deck_builder',
      conversationId: 'conversation-a',
    });

    const create = calls.find(({ method }) => method === 'session.create');
    expect(create?.params.cwd).toBe(path.join(codeRoot, 'project-a', 'worker-agent-ui'));
    expect(create?.params.profile).toBe('builder');
  });

  it('fails honestly before session creation for an absolute host folder', async () => {
    useTemporaryBuilderCodeRoot();
    const calls: string[] = [];
    const client = {
      async request<T>(method: string): Promise<T> {
        calls.push(method);
        if (method === 'profiles.describe') {
          return {
            name: 'builder', soul: '# builder',
            capability_fingerprint: '0123456789ab',
            model: {
              provider: 'openai-codex',
              default: 'gpt-parent',
              openai_runtime: 'codex_app_server',
            },
            skills: [], toolsets: [], mcp_servers: [],
            delegation: { provider: '', model: '', max_spawn_depth: 1, enabled: false },
            task_mode: null,
          } as T;
        }
        if (method === 'session.list') return { sessions: [] } as T;
        throw new Error(`unexpected:${method}`);
      },
    } as unknown as HermesGatewayClient;
    const builderCard = target('builder', 'builder');
    const project = authority('project-a', builderCard);
    project.deck.projectCodeFolder = 'C:\\outside';
    const addressableBuilder: AddressableCard = {
      card: builderCard,
      cardRevisionId: 'revision-builder',
      profile: 'builder',
      title: 'Builder',
      address: 'Builder',
      aliases: ['builder'],
    };

    await expect(cardSession(client, addressableBuilder, {
      userId: 'user-a', projectId: 'project-a', deckId: 'deck_builder',
      conversationId: 'conversation-a',
    })).rejects.toThrow('builder_project_code_folder_invalid');
    expect(calls).not.toContain('session.create');
  });

  it('re-homes an existing Builder conversation before resuming it', async () => {
    const codeRoot = useTemporaryBuilderCodeRoot();
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const desiredCwd = path.join(codeRoot, 'project-a', 'worker-agent-ui');
    const client = {
      async request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
        calls.push({ method, params: structuredClone(params) });
        if (method === 'profiles.describe') {
          return {
            name: 'builder', soul: '# builder',
            capability_fingerprint: '0123456789ab',
            model: {
              provider: 'openai-codex',
              default: 'gpt-parent',
              openai_runtime: 'codex_app_server',
            },
            skills: [], toolsets: [], mcp_servers: [], task_mode: null,
          } as T;
        }
        if (method === 'session.list') {
          return {
            sessions: [{ id: 'stored-builder', resolved_id: 'stored-builder', cwd: 'C:\\old-workspace' }],
          } as T;
        }
        if (method === 'session.workspace.move') {
          return { cwd: desiredCwd, branch: null, git_repo_root: desiredCwd } as T;
        }
        if (method === 'session.resume') {
          return {
            session_id: 'live-builder',
            stored_session_id: 'stored-builder',
            info: { cwd: desiredCwd },
          } as T;
        }
        throw new Error(`unexpected:${method}`);
      },
    } as unknown as HermesGatewayClient;
    const builderCard = target('builder', 'builder');
    const project = authority('project-a', builderCard);
    project.deck.projectCodeFolder = 'worker-agent-ui';
    const addressableBuilder: AddressableCard = {
      card: builderCard,
      cardRevisionId: 'revision-builder',
      profile: 'builder',
      title: 'Builder',
      address: 'Builder',
      aliases: ['builder'],
    };

    await cardSession(client, addressableBuilder, {
      userId: 'user-a', projectId: 'project-a', deckId: 'deck_builder',
      conversationId: 'conversation-a',
    });

    const moved = calls.find(({ method }) => method === 'session.workspace.move');
    expect(moved?.params).toEqual({
      session_key: 'stored-builder',
      profile: 'builder',
      cwd: desiredCwd,
    });
    expect(calls.findIndex(({ method }) => method === 'session.workspace.move'))
      .toBeLessThan(calls.findIndex(({ method }) => method === 'session.resume'));
  });
});
