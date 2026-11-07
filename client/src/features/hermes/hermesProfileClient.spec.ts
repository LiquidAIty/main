// Entity: Card Profiles
// Relationship: Verifies public profile and Webapp request/readback mapping against mocked Hermes responses without claiming loaded profile writes.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const host = vi.hoisted(() => ({
  fetchJSON: vi.fn(),
  request: vi.fn(),
}));

vi.mock('./hermesHost', () => ({
  hermesWebappHost: () => ({ fetchJSON: host.fetchJSON }),
  hermesRequest: host.request,
}));

import {
  configureHermesBotRoster,
  configureHermesProfile,
  createHermesProfile,
  createHermesSkill,
  loadHermesProfile,
  saveHermesSkill,
} from './hermesProfileClient';

describe('Hermes profile skill binding', () => {
  let config: Record<string, any>;
  let described: Record<string, any>;
  let servers: Array<Record<string, any>>;

  beforeEach(() => {
    vi.clearAllMocks();
    config = {
      mcp_servers: { liquidaity: { headers: { Authorization: 'Bearer ${MCP_LIQUIDAITY_API_KEY}' } } },
      skills: { auto_load: ['research'] },
      memory: {
        provider: '',
        memory_enabled: true,
        user_profile_enabled: true,
      },
      auxiliary: { background_review: { enabled: true } },
      curator: { enabled: true },
      web: { search_backend: 'native' },
      kanban: { task_mode: '' },
      plugins: {
        enabled: ['existing-plugin'],
        entries: { liquidaity: { settings: { card_script: {} } } },
      },
    };
    described = {
      name: 'trading',
      description: 'Category: specialist. Trading.',
      soul: 'Trade carefully.',
      model: { provider: 'openai-codex', default: 'gpt-5.6-sol' },
      skills: [
        { name: 'research', enabled: true },
        { name: 'trading', enabled: true },
      ],
      toolsets: [{ name: 'web', enabled: true }],
      bot_mode_roster: [],
    };
    servers = [{
      name: 'liquidaity',
      enabled: true,
      tools: { include: ['engraphis_get_memory'] },
    }];
    host.request.mockImplementation(async (_profile: string, method: string, params: Record<string, any>) => {
      if (method === 'profiles.describe') {
        if (!params.name) throw new Error('name required');
        return structuredClone(described);
      }
      if (method === 'profiles.configure') {
        if (!params.name) throw new Error('name required');
        const disabled = new Set(params.disabled_skills || []);
        described.skills = described.skills.map((skill: Record<string, any>) => ({
          ...skill,
          enabled: skill.name === 'hermes-agent' || !disabled.has(skill.name),
        }));
        if (typeof params.soul === 'string') described.soul = params.soul;
        if (typeof params.description === 'string') described.description = params.description;
        if (typeof params.model === 'string') {
          described.model = {
            provider: String(params.provider || described.model.provider || ''),
            default: params.model,
          };
        }
        if (Array.isArray(params.bot_mode_roster)) {
          described.bot_mode_roster = [...params.bot_mode_roster];
        }
        if (params.delegation && typeof params.delegation === 'object') {
          described.delegation = structuredClone(params.delegation);
        }
        return {
          ok: true,
          applied: {
            skills: true,
            bot_mode_roster: Array.isArray(params.bot_mode_roster),
          },
        };
      }
      throw new Error(`Unexpected Hermes method: ${method}`);
    });
    host.fetchJSON.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith('/api/mcp/servers')) return { servers: structuredClone(servers) };
      if (path.startsWith('/api/config') && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body || '{}')).config || {};
        if (body.skills) config.skills = { ...(config.skills || {}), ...body.skills };
        if (body.memory) config.memory = { ...(config.memory || {}), ...body.memory };
        if (body.auxiliary) config.auxiliary = {
          ...(config.auxiliary || {}),
          ...body.auxiliary,
        };
        if (body.curator) config.curator = { ...(config.curator || {}), ...body.curator };
        if (body.web) config.web = { ...(config.web || {}), ...body.web };
        if (body.kanban) config.kanban = { ...(config.kanban || {}), ...body.kanban };
        if (body.platform_toolsets) {
          config.platform_toolsets = {
            ...(config.platform_toolsets || {}),
            ...body.platform_toolsets,
          };
          const selected = new Set(body.platform_toolsets.cli || []);
          described.toolsets = described.toolsets.map((toolset: Record<string, any>) => ({
            ...toolset,
            enabled: selected.has(toolset.name),
          }));
        }
        if (body.plugins) config.plugins = {
          ...(config.plugins || {}),
          ...body.plugins,
          entries: {
            ...(config.plugins?.entries || {}),
            ...(body.plugins.entries || {}),
          },
        };
        const include = body.mcp_servers?.liquidaity?.tools?.include;
        if (body.mcp_servers?.liquidaity?.headers) {
          config.mcp_servers = {
            ...config.mcp_servers,
            liquidaity: {
              ...config.mcp_servers?.liquidaity,
              headers: {
                ...config.mcp_servers?.liquidaity?.headers,
                ...body.mcp_servers.liquidaity.headers,
              },
            },
          };
        }
        if (Array.isArray(include)) {
          servers = servers.map((server) => server.name === 'liquidaity'
            ? { ...server, tools: { include } }
            : server);
        }
        return { ok: true };
      }
      if (path.startsWith('/api/config')) return structuredClone(config);
      if (path === '/api/skills' && init?.method === 'POST') return { success: true };
      if (path === '/api/skills/content' && init?.method === 'PUT') return { success: true };
      throw new Error(`Unexpected Hermes HTTP request: ${path}`);
    });
  });

  it('reads profile-scoped skill auto-load from Hermes config', async () => {
    const profile = await loadHermesProfile('trading');
    expect(profile.autoLoadSkills).toEqual(['research']);
    expect(profile.skills).toEqual([
      { name: 'research', enabled: true },
      { name: 'trading', enabled: true },
    ]);
    expect(profile.memory).toEqual({
      provider: '',
      memoryEnabled: true,
      userProfileEnabled: true,
      backgroundReviewEnabled: true,
      curatorEnabled: true,
    });
    expect(profile.webSearchBackend).toBe('native');
    expect(profile.taskMode).toBe('');
    expect(profile.model).toEqual({
      provider: 'openai-codex',
      default: 'gpt-5.6-sol',
    });
  });

  it('publishes and reads back Bot Mode roster without loading tools, MCP, or skills', async () => {
    const roster = await configureHermesBotRoster('main', [
      'builder', 'thinkgraph', 'knowgraph', 'builder',
    ]);

    expect(host.request).toHaveBeenNthCalledWith(1, 'main', 'profiles.configure', {
      name: 'main',
      bot_mode_roster: ['builder', 'thinkgraph', 'knowgraph'],
    });
    expect(host.request).toHaveBeenNthCalledWith(2, 'main', 'profiles.describe', {
      name: 'main',
    });
    expect(host.fetchJSON).not.toHaveBeenCalled();
    expect(roster).toEqual(['builder', 'thinkgraph', 'knowgraph']);
  });

  it('publishes the profile-named custom skill as enabled and auto-loaded with readback', async () => {
    const profile = await configureHermesProfile({
      profile: 'trading',
      enabledSkills: ['trading'],
      autoLoadSkills: ['trading'],
      applicationTools: ['graphiti.search_nodes'],
      cardScript: { version: 1, compiled_hash: 'a'.repeat(64) },
    });

    expect(host.request).toHaveBeenCalledWith('trading', 'profiles.configure', expect.objectContaining({
      name: 'trading',
      disabled_skills: ['research'],
    }));
    expect(host.fetchJSON).toHaveBeenCalledWith(
      '/api/config?profile=trading',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          config: {
            memory: {
              provider: 'holographic',
              memory_enabled: false,
              user_profile_enabled: false,
            },
            auxiliary: { background_review: { enabled: false } },
            curator: { enabled: false },
            mcp_servers: {
              liquidaity: { tools: { include: ['graphiti.search_nodes'] } },
            },
            skills: { auto_load: ['trading'] },
            plugins: {
              enabled: ['existing-plugin', 'liquidaity'],
              entries: {
                liquidaity: {
                  mcp_allowlist: ['liquidaity'],
                  settings: {
                    card_script: { version: 1, compiled_hash: 'a'.repeat(64) },
                  },
                },
              },
            },
          },
        }),
      }),
    );
    expect(profile.autoLoadSkills).toEqual(['trading']);
    expect(profile.applicationTools).toEqual(['graphiti.search_nodes']);
    expect(profile.cardScript).toEqual({ version: 1, compiled_hash: 'a'.repeat(64) });
    expect(profile.enabledPlugins).toEqual(['existing-plugin', 'liquidaity']);
    expect(profile.memory).toEqual({
      provider: 'holographic',
      memoryEnabled: false,
      userProfileEnabled: false,
      backgroundReviewEnabled: false,
      curatorEnabled: false,
    });
    expect(profile.skills.find((skill) => skill.name === 'trading')?.enabled).toBe(true);
  });

  it('pins KnowGraph search and extraction to Hermes Firecrawl with readback', async () => {
    const profile = await configureHermesProfile({
      profile: 'knowgraph',
      enabledToolsets: ['web'],
    });

    expect(host.fetchJSON).toHaveBeenCalledWith(
      '/api/config?profile=knowgraph',
      expect.objectContaining({
        method: 'PUT',
        body: expect.stringContaining('"web":{"search_backend":"firecrawl","extract_backend":"firecrawl"}'),
      }),
    );
    expect(profile.webSearchBackend).toBe('firecrawl');
    expect(profile.webExtractBackend).toBe('firecrawl');
  });

  it('preserves Hermes required core skill without changing selected auto-load skills', async () => {
    described.skills = [
      { name: 'hermes-agent', enabled: true },
      { name: 'knowgraph', enabled: true },
      { name: 'grounded-citations', enabled: true },
      { name: 'unselected', enabled: true },
    ];
    const profile = await configureHermesProfile({
      profile: 'knowgraph',
      enabledSkills: ['knowgraph', 'grounded-citations'],
      autoLoadSkills: ['knowgraph', 'grounded-citations'],
    });
    expect(host.request).toHaveBeenCalledWith('knowgraph', 'profiles.configure', expect.objectContaining({
      name: 'knowgraph', disabled_skills: ['unselected'],
    }));
    expect(profile.skills.filter(skill => skill.enabled).map(skill => skill.name))
      .toEqual(['hermes-agent', 'knowgraph', 'grounded-citations']);
    expect(profile.autoLoadSkills).toEqual(['knowgraph', 'grounded-citations']);
  });

  it('still rejects a requested skill missing from Hermes readback', async () => {
    described.skills = [{ name: 'hermes-agent', enabled: true }];
    await expect(configureHermesProfile({
      profile: 'knowgraph', enabledSkills: ['grounded-citations'],
    })).rejects.toThrow('Hermes enabled-skill readback mismatch.');
  });

  it('preserves an explicit empty Hermes toolset selection instead of restoring defaults', async () => {
    const profile = await configureHermesProfile({
      profile: 'trading',
      enabledToolsets: [],
    });

    expect(host.fetchJSON).toHaveBeenCalledWith(
      '/api/config?profile=trading',
      expect.objectContaining({
        method: 'PUT',
        body: expect.stringContaining('"platform_toolsets":{"cli":[]}'),
      }),
    );
    expect(profile.toolsets.filter((toolset) => toolset.enabled)).toEqual([]);
  });

  it('materializes structural Team mode and the saved parent model without a UI controller', async () => {
    const profile = await configureHermesProfile({
      profile: 'team',
      description: 'Category: team. Automatic same-profile decomposition and synthesis.',
      model: 'gpt-5.6-terra',
      provider: 'openai-codex',
      taskMode: 'team',
      botModeRoster: ['builder'],
    });

    expect(host.request).toHaveBeenCalledWith('team', 'profiles.configure', expect.objectContaining({
      name: 'team',
      description: 'Category: team. Automatic same-profile decomposition and synthesis.',
      model: 'gpt-5.6-terra',
      provider: 'openai-codex',
      bot_mode_roster: ['builder'],
    }));
    expect(profile.model).toEqual({
      provider: 'openai-codex',
      default: 'gpt-5.6-terra',
    });
    expect(profile.taskMode).toBe('team');
    expect(profile.pluginTaskMode).toBe('team');
  });

  it('uses Hermes skill create and content-update endpoints with profile scope', async () => {
    const content = '---\nname: trading\ndescription: Trading procedures.\n---\n\n# Trading\n\nWork carefully.\n';
    await createHermesSkill('trading', 'trading', content);
    await saveHermesSkill('trading', 'trading', content.replace('carefully', 'precisely'));

    expect(host.fetchJSON).toHaveBeenCalledWith('/api/skills', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ name: 'trading', content, profile: 'trading' }),
    }));
    expect(host.fetchJSON).toHaveBeenCalledWith('/api/skills/content', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({
        name: 'trading',
        content: content.replace('carefully', 'precisely'),
        profile: 'trading',
      }),
    }));
  });

  it('uses Hermes profiles.create as the only new-Bot maker', async () => {
    host.request.mockImplementation(async (_profile: string, method: string, params: Record<string, any>) => {
      if (method === 'profiles.create') {
        expect(_profile).toBe('main');
        expect(params).toMatchObject({
          name: 'new-specialist',
          description: 'Category: specialist. New Specialist.',
          soul: 'Work precisely.',
          model: 'gpt-5.6-luna',
          provider: 'openai-codex',
          mirror_credentials: true,
        });
        described = {
          ...described,
          name: 'new-specialist',
          description: params.description,
          soul: params.soul,
          model: { provider: params.provider, default: params.model },
        };
        return {
          ok: true,
          name: 'new-specialist',
          path: 'profiles/new-specialist',
          soul_written: true,
          model_set: true,
          mirrored: { env: true, auth: true, model_inherited: false, voice: false },
        };
      }
      if (method === 'profiles.describe') return structuredClone(described);
      throw new Error(`Unexpected Hermes method: ${method}`);
    });

    const profile = await createHermesProfile({
      profile: 'new-specialist',
      description: 'Category: specialist. New Specialist.',
      soul: 'Work precisely.',
      model: 'gpt-5.6-luna',
      provider: 'openai-codex',
    });

    expect(profile.name).toBe('new-specialist');
    expect(profile.model).toEqual({
      provider: 'openai-codex',
      default: 'gpt-5.6-luna',
    });
  });
});
