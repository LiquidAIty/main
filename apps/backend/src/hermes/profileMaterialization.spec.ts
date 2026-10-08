import { describe, expect, it, vi } from 'vitest';

import type { DeckCard, DeckDocument } from '../types';
import {
  materializeBuilderTerminalPolicy,
  materializeSavedCardProfile,
  savedCardBotRoster,
} from './profileMaterialization';

const main: DeckCard = {
  id: 'card_main', templateId: 'main', title: 'Main', role: '', prompt: '# Main\nSaved prompt',
  runtime: { kind: 'hermes', mode: 'main', profile: 'main' },
  runtimeOptions: {
    provider: 'openai', accessMode: 'chatgpt-account', modelKey: 'gpt-parent',
    providerModelId: 'gpt-parent', openaiRuntime: 'codex_app_server',
    skills: ['grounded-citations'], toolsets: ['web'], mcpConnectionIds: ['graphiti'],
    subagentType: 'leaf',
    subagentModel: {
      provider: 'openai', accessMode: 'chatgpt-account', modelKey: 'gpt-child',
      providerModelId: 'gpt-child',
    },
  },
  position: { x: 0, y: 0 },
};

const worker: DeckCard = {
  id: 'card_worker', templateId: 'worker', title: 'Worker', role: '', prompt: '# Worker',
  runtime: { kind: 'hermes', mode: 'delegate', profile: 'worker' },
  runtimeOptions: { provider: 'openai', accessMode: 'chatgpt-account', modelKey: 'gpt-child' },
  position: { x: 1, y: 1 },
};

const deck: DeckDocument = {
  id: 'deck', name: 'Deck', projectCodeFolder: '', version: 1, promptTemplates: [],
  nodes: [main, worker],
  edges: [{ id: 'flow', source: 'card_main', target: 'card_worker', edgeType: 'flow' }],
};

function profileState() {
  return {
    name: 'main', description: 'learned description', soul: '# Old',
    model: { provider: 'openai', default: 'old', openai_runtime: 'auto' },
    skills: [
      { name: 'hermes-agent', enabled: true },
      { name: 'grounded-citations', enabled: false },
      { name: 'unselected-skill', enabled: true },
    ],
    toolsets: [
      { name: 'web', enabled: false },
      { name: 'delegation', enabled: false },
      { name: 'terminal', enabled: true },
    ],
    mcp_servers: [
      { name: 'graphiti', enabled: false },
      { name: 'other', enabled: true },
    ],
    delegation: {
      provider: 'openai', model: 'old-child', max_spawn_depth: 2,
      orchestrator_enabled: true, enabled: true,
    },
    task_mode: null,
    learned_state_marker: 'preserve-me',
    project_topology_marker: ['legacy-project-edge'],
  };
}

describe('saved Card to Hermes profile materialization', () => {
  it('projects only Card-owned profile sections and preserves Hermes-owned state', async () => {
    let state = profileState();
    const request = vi.fn(async <T>(
      method: string,
      params: Record<string, unknown> = {},
    ): Promise<T> => {
      if (method === 'profiles.describe') return structuredClone(state) as T;
      if (method !== 'profiles.configure') throw new Error(`unexpected:${method}`);
      const source = params as Record<string, any>;
      state = {
        ...state,
        soul: source.soul ?? state.soul,
        model: source.model ? {
          provider: source.provider,
          default: source.model,
          openai_runtime: source.openai_runtime,
        } : state.model,
        skills: state.skills.map((skill) => ({
          ...skill,
          enabled: !(source.disabled_skills || []).includes(skill.name),
        })),
        toolsets: state.toolsets.map((toolset) => ({
          ...toolset,
          enabled: (source.enabled_toolsets || []).includes(toolset.name),
        })),
        mcp_servers: state.mcp_servers.map((server) => ({
          ...server,
          enabled: (source.enabled_mcp_servers || []).includes(server.name),
        })),
        delegation: source.delegation,
        task_mode: source.task_mode,
      };
      return { ok: true, applied: Object.fromEntries(
        Object.keys(source).filter((key) => key !== 'name').map((key) => [
          ({ disabled_skills: 'skills', enabled_toolsets: 'toolsets',
            enabled_mcp_servers: 'mcp_servers' } as Record<string, string>)[key] || key,
          true,
        ]),
      ) } as T;
    });

    const result = await materializeSavedCardProfile(
      request as unknown as Parameters<typeof materializeSavedCardProfile>[0],
      main,
    );

    expect(request).toHaveBeenCalledTimes(3);
    const configured = request.mock.calls[1][1] as Record<string, unknown>;
    expect(configured).toMatchObject({
      name: 'main', soul: '# Main\nSaved prompt', provider: 'openai-codex',
      model: 'gpt-parent', openai_runtime: 'codex_app_server',
      disabled_skills: ['unselected-skill'],
      enabled_toolsets: ['web', 'delegation'],
      enabled_mcp_servers: ['graphiti'],
      delegation: {
        provider: 'openai-codex', model: 'gpt-child', max_spawn_depth: 1,
        orchestrator_enabled: false, enabled: true,
      },
    });
    expect(configured).not.toHaveProperty('learning');
    expect(configured).not.toHaveProperty('memory');
    expect(configured).not.toHaveProperty('bot_mode_roster');
    expect(configured).not.toHaveProperty('project_topology_marker');
    expect((result as unknown as Record<string, unknown>).learned_state_marker).toBe('preserve-me');
    expect((result as unknown as Record<string, unknown>).project_topology_marker)
      .toEqual(['legacy-project-edge']);
  });

  it('derives only outbound enabled orange targets', () => {
    const withNoise: DeckDocument = {
      ...deck,
      edges: [
        ...deck.edges,
        { id: 'reverse', source: 'card_worker', target: 'card_main', edgeType: 'flow' },
        { id: 'blue', source: 'card_main', target: 'card_worker', edgeType: 'magentic_option' },
        { id: 'disabled', source: 'card_main', target: 'card_worker', edgeType: 'flow', enabled: false },
      ],
    };
    expect(savedCardBotRoster(withNoise, main)).toEqual(['worker']);
    expect(savedCardBotRoster(withNoise, worker)).toEqual([]);
  });

  it('materializes Builder onto Hermes Docker with only its Project folder mount', async () => {
    const builder: DeckCard = {
      ...worker,
      id: 'builder',
      title: 'Builder',
      runtime: { kind: 'hermes', mode: 'delegate', profile: 'builder' },
    };
    const terminal: Record<string, unknown> = {
      backend: 'local',
      docker_mount_cwd_to_workspace: false,
      container_persistent: true,
      docker_volumes: ['C:/Projects/LiquidAIty/main:/app'],
      docker_extra_args: ['--privileged'],
      docker_forward_env: ['GITHUB_TOKEN'],
      docker_env: { HOST_SECRET: 'not-allowed' },
    };
    const request = vi.fn(async <T>(
      method: string,
      params: Record<string, unknown> = {},
    ): Promise<T> => {
      if (method === 'config.get') return { config: { terminal: structuredClone(terminal) } } as T;
      if (method !== 'config.set') throw new Error(`unexpected:${method}`);
      const field = String(params.key).replace(/^terminal\./, '');
      terminal[field] = structuredClone(params.value);
      return { key: params.key, value: params.value } as T;
    });

    await materializeBuilderTerminalPolicy(
      request as unknown as Parameters<typeof materializeBuilderTerminalPolicy>[0],
      builder,
    );

    expect(terminal).toMatchObject({
      backend: 'docker',
      docker_mount_cwd_to_workspace: true,
      container_persistent: false,
      docker_volumes: [],
      docker_extra_args: [],
      docker_forward_env: [],
      docker_env: {},
    });
    expect(request.mock.calls.filter(([method]) => method === 'config.set')).toHaveLength(7);
    expect(request.mock.calls.filter(([method]) => method === 'config.get')).toHaveLength(2);

    request.mockClear();
    await materializeBuilderTerminalPolicy(
      request as unknown as Parameters<typeof materializeBuilderTerminalPolicy>[0],
      worker,
    );
    expect(request).not.toHaveBeenCalled();
  });
});
