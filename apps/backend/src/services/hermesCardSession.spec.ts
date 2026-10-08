import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { DeckCard, DeckDocument } from '../types';
import type { HermesGatewayClient } from './hermesGateway';
import {
  cardSession,
} from './hermesCardSession';
import type { AddressableCard, SharedChatAuthority } from './savedCardAuthority';

const builderCodeRoots: string[] = [];
const originalBuilderCodeRoot = process.env.BUILDER_PROJECT_CODE_ROOT;

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
});

const mainCard: DeckCard = {
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

function target(id: string, profile: string): DeckCard {
  return {
    id,
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

function authority(projectMarker: string, rosterTarget: DeckCard): SharedChatAuthority {
  const deck: DeckDocument = {
    id: 'deck_builder',
    name: `Deck ${projectMarker}`,
    projectCodeFolder: '',
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

  it('uses the saved Project code folder only for the Builder session', async () => {
    const codeRoot = useTemporaryBuilderCodeRoot();
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const client = {
      async request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
        calls.push({ method, params: structuredClone(params) });
        if (method === 'profiles.describe') {
          return {
            name: 'builder',
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
        if (method === 'config.get') {
          return { config: { terminal: {
            backend: 'docker', docker_mount_cwd_to_workspace: true,
            container_persistent: false, docker_volumes: [], docker_extra_args: [],
            docker_forward_env: [], docker_env: {},
          } } } as T;
        }
        if (method === 'session.list') return { sessions: [] } as T;
        if (method === 'session.create') {
          return {
            session_id: 'live-builder', stored_session_id: 'stored-builder',
            info: { terminal_backend: 'docker' },
          } as T;
        }
        throw new Error(`unexpected:${method}`);
      },
    } as unknown as HermesGatewayClient;
    const builderCard = target('builder', 'builder');
    const project = authority('builder-project', builderCard);
    project.deck.projectCodeFolder = 'worker-agent-ui';
    const addressableBuilder: AddressableCard = {
      card: builderCard,
      cardRevisionId: 'revision-builder',
      profile: 'builder',
      title: 'Builder',
      address: 'Builder',
      aliases: ['builder'],
    };

    await cardSession(client, project, addressableBuilder, {
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
        if (method === 'config.get') {
          return { config: { terminal: {
            backend: 'docker', docker_mount_cwd_to_workspace: true,
            container_persistent: false, docker_volumes: [], docker_extra_args: [],
            docker_forward_env: [], docker_env: {},
          } } } as T;
        }
        if (method === 'session.list') return { sessions: [] } as T;
        throw new Error(`unexpected:${method}`);
      },
    } as unknown as HermesGatewayClient;
    const builderCard = target('builder', 'builder');
    const project = authority('builder-project', builderCard);
    project.deck.projectCodeFolder = 'C:\\outside';
    const addressableBuilder: AddressableCard = {
      card: builderCard,
      cardRevisionId: 'revision-builder',
      profile: 'builder',
      title: 'Builder',
      address: 'Builder',
      aliases: ['builder'],
    };

    await expect(cardSession(client, project, addressableBuilder, {
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
            model: {
              provider: 'openai-codex',
              default: 'gpt-parent',
              openai_runtime: 'codex_app_server',
            },
            skills: [], toolsets: [], mcp_servers: [], task_mode: null,
          } as T;
        }
        if (method === 'config.get') {
          return { config: { terminal: {
            backend: 'docker', docker_mount_cwd_to_workspace: true,
            container_persistent: false, docker_volumes: [], docker_extra_args: [],
            docker_forward_env: [], docker_env: {},
          } } } as T;
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
            info: { cwd: desiredCwd, terminal_backend: 'docker' },
          } as T;
        }
        throw new Error(`unexpected:${method}`);
      },
    } as unknown as HermesGatewayClient;
    const builderCard = target('builder', 'builder');
    const project = authority('builder-project', builderCard);
    project.deck.projectCodeFolder = 'worker-agent-ui';
    const addressableBuilder: AddressableCard = {
      card: builderCard,
      cardRevisionId: 'revision-builder',
      profile: 'builder',
      title: 'Builder',
      address: 'Builder',
      aliases: ['builder'],
    };

    await cardSession(client, project, addressableBuilder, {
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
