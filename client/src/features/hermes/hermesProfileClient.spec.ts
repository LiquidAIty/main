// Entity: Card Profiles
// Relationship: Verifies public profile and Webapp request/readback mapping against mocked Hermes responses without claiming loaded profile writes.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const host = vi.hoisted(() => ({
  fetchJSON: vi.fn(),
  request: vi.fn(),
  applicationFetch: vi.fn(),
}));
vi.mock('../../lib/applicationApi', () => ({ applicationFetch: host.applicationFetch }));

vi.mock('./hermesHost', () => ({
  hermesWebappHost: () => ({ fetchJSON: host.fetchJSON }),
  hermesRequest: host.request,
}));

import {
  configureHermesBotRoster,
  configureHermesProfile,
  connectHermesApplicationTools,
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
        provider: 'holographic',
        memory_enabled: false,
        user_profile_enabled: false,
      },
      auxiliary: { background_review: { enabled: true } },
      curator: { enabled: false },
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
      transport: 'http', url: 'http://127.0.0.1:8765/mcp',
      tools: { include: ['engraphis_get_memory'] },
    }];
    host.request.mockImplementation(async (_profile: string, method: string, params: Record<string, any>) => {
      if (method === 'profiles.describe') {
        if (!params.name) throw new Error('name required');
        return structuredClone(described);
      }
      if (method === 'mcp.servers.test') return { ok: true, tools: [{ name: 'trading.get_state' }] };
      if (method === 'profiles.configure') {
        if (!params.name) throw new Error('name required');
        if (Array.isArray(params.disabled_skills)) {
          const disabled = new Set(params.disabled_skills);
          described.skills = described.skills.map((skill: Record<string, any>) => ({
            ...skill,
            enabled: skill.name === 'hermes-agent' || !disabled.has(skill.name),
          }));
        }
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
        if (Array.isArray(params.enabled_mcp_servers)) {
          servers = servers.map((server) => ({
            ...server,
            enabled: params.enabled_mcp_servers.includes(server.name),
          }));
        }
        if (params.delegation && typeof params.delegation === 'object') {
          described.delegation = structuredClone(params.delegation);
        }
        return {
          ok: true,
          applied: {
            skills: true,
            mcp_servers: Array.isArray(params.enabled_mcp_servers),
            bot_mode_roster: Array.isArray(params.bot_mode_roster),
          },
        };
      }
      throw new Error(`Unexpected Hermes method: ${method}`);
    });
    host.fetchJSON.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith('/api/env') && init?.method === 'PUT') return { success: true };
      if (path.startsWith('/api/mcp/servers')) return { servers: structuredClone(servers) };
      if (path.startsWith('/api/config') && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body || '{}')).config || {};
        if (body.agent) config.agent = { ...(config.agent || {}), ...body.agent };
        if (body.delegation) config.delegation = { ...(config.delegation || {}), ...body.delegation };
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
          const existing = servers.find((server) => server.name === 'liquidaity');
          if (existing) Object.assign(existing, body.mcp_servers.liquidaity, { tools: { include } });
          else servers.push({ name: 'liquidaity', enabled: true, transport: 'http', ...body.mcp_servers.liquidaity });
          config.mcp_servers = {
            ...config.mcp_servers,
            liquidaity: { ...config.mcp_servers?.liquidaity,
              ...body.mcp_servers.liquidaity, tools: { include } },
          };
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
    config.memory = { provider: '', memory_enabled: true, user_profile_enabled: true };
    config.curator.enabled = true;
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

  it('publishes parent effort and a selected one-level child without changing MCP grants or Bot wires', async () => {
    described.toolsets.push({ name: 'delegation', enabled: false });
    described.bot_mode_roster = ['builder'];
    config.delegation = { model: 'old', max_spawn_depth: 4, orchestrator_enabled: true };
    const result = await configureHermesProfile({
      profile: 'knowgraph', model: 'gpt-6.1-terra', provider: 'openai-codex',
      reasoningEffort: 'low', subagentType: 'leaf',
      subagentModel: { provider: 'openai-codex', model: 'gpt-6.1-terra', reasoningEffort: 'low' },
    });
    expect(config.agent.reasoning_effort).toBe('low');
    expect(config.delegation).toMatchObject({
      provider: 'openai-codex', model: 'gpt-6.1-terra', reasoning_effort: 'low',
      max_spawn_depth: 1, orchestrator_enabled: false,
    });
    expect(result.subagentType).toBe('leaf');
    expect(result.reasoningEffort).toBe('low');
    expect(result.subagentModel.reasoningEffort).toBe('low');
    expect(result.botModeRoster).toEqual(['builder']);
    expect(result.applicationTools).toEqual(['engraphis_get_memory']);
  });

  it('None removes only native delegation and an unrelated save preserves leaf configuration', async () => {
    described.toolsets.push({ name: 'delegation', enabled: true });
    config.agent = { reasoning_effort: 'low' };
    config.delegation = { model: 'gpt-6-luna', reasoning_effort: 'low', max_spawn_depth: 1, orchestrator_enabled: false };
    await configureHermesProfile({ profile: 'trading', soul: 'Updated prose.' });
    expect(config.delegation.model).toBe('gpt-6-luna');
    expect(config.agent.reasoning_effort).toBe('low');
    expect(described.toolsets.find((toolset: any) => toolset.name === 'delegation').enabled).toBe(true);
    const result = await configureHermesProfile({ profile: 'trading', subagentType: 'none' });
    expect(result.subagentType).toBe('none');
    expect(result.toolsets.filter((toolset) => toolset.enabled).map((toolset) => toolset.name)).toEqual(['web']);
    expect(result.applicationTools).toEqual(['engraphis_get_memory']);
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
            mcp_servers: {
              liquidaity: { include_execution_context: true, tools: { include: ['graphiti.search_nodes'] } },
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
      backgroundReviewEnabled: true,
      curatorEnabled: false,
    });
    expect(profile.skills.find((skill) => skill.name === 'trading')?.enabled).toBe(true);
  });

  it.each([true, false])('preserves native background review %s through an ordinary Card save', async (enabled) => {
    config.auxiliary.background_review = {
      enabled, max_input_tokens: 48000, provider: 'auto', model: 'auto',
    };
    const before = structuredClone(config.auxiliary);
    const profile = await configureHermesProfile({ profile: 'trading', soul: 'Updated role.' });
    expect(config.auxiliary).toEqual(before);
    expect(profile.memory.backgroundReviewEnabled).toBe(enabled);
    const write = host.fetchJSON.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(JSON.parse(String(write?.[1]?.body)).config).not.toHaveProperty('auxiliary');
    expect(profile.memory.provider).toBe('holographic');
    expect(profile.memory.memoryEnabled).toBe(false);
    expect(profile.memory.curatorEnabled).toBe(false);
  });

  it('preserves Trader built-in learning without reactivating external memory on a tool edit', async () => {
    config.memory = { provider: '', memory_enabled: true, user_profile_enabled: false, nudge_interval: 1 };
    config.auxiliary.background_review = { enabled: true, max_input_tokens: 48000 };
    const before = structuredClone(config.memory);
    const profile = await configureHermesProfile({ profile: 'trading', applicationTools: ['trading.get_state'] });
    expect(config.memory).toEqual(before);
    expect(profile.memory).toEqual({ provider: '', memoryEnabled: true, userProfileEnabled: false,
      backgroundReviewEnabled: true, curatorEnabled: false });
    const write = host.fetchJSON.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(JSON.parse(String(write?.[1]?.body)).config).not.toHaveProperty('memory');
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

  it('saves a new research-only Card without manufacturing an MCP connection', async () => {
    servers = [];
    delete config.mcp_servers;
    const profile = await configureHermesProfile({
      profile: 'predictor', applicationTools: [], enabledMcpServers: [],
      enabledToolsets: ['web'], subagentType: 'none',
    });
    expect(profile.enabledMcpServers).toEqual([]);
    expect(profile.applicationTools).toEqual([]);
    expect(config.mcp_servers).toBeUndefined();
    expect(profile.toolsets.filter((toolset) => toolset.enabled).map((toolset) => toolset.name))
      .toEqual(['web']);
  });

  it('saves requested app grants without creating an unauthenticated transport stub', async () => {
    servers = [];
    delete config.mcp_servers;
    const profile = await configureHermesProfile({ profile: 'trading',
      applicationTools: ['trading.get_state'], enabledMcpServers: ['liquidaity'] });
    expect(config.mcp_servers).toBeUndefined();
    expect(profile.applicationConnectionConfigured).toBe(false);
    expect(profile.applicationTools).toEqual([]);
    expect(host.applicationFetch).not.toHaveBeenCalled();
  });

  function mockSetup(profile = 'trading') {
    const receipt = { ok: true, cardId: 'trading-card', cardRevisionId: 'revision', profile,
      serverName: 'liquidaity', url: 'http://127.0.0.1:8765/mcp',
      bearerToken: 'test-card-token', tools: ['trading.get_state'] };
    host.applicationFetch.mockImplementation(async (path: string) => new Response(JSON.stringify(
      path.endsWith('/app-tools') ? receipt : {
        deck: { nodes: [{ id: 'trading-card', _cardRevisionId: 'revision', runtime: { profile: 'trading' } }] },
      }), { status: 200 }));
    return receipt;
  }

  const setupInput = { projectId: 'p', deckId: 'd', cardId: 'trading-card', profile: 'trading' };

  it('connects only on an explicit action through owned Card and native Hermes credential APIs', async () => {
    servers = [];
    delete config.mcp_servers;
    const receipt = mockSetup();
    const result = await connectHermesApplicationTools(setupInput);
    expect(host.applicationFetch).toHaveBeenCalledWith('/api/projects/p/decks/d/cards/trading-card/app-tools', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedCardRevisionId: 'revision' }),
    });
    expect(host.fetchJSON).toHaveBeenCalledWith('/api/env?profile=trading', expect.objectContaining({
      body: JSON.stringify({ key: 'MCP_LIQUIDAITY_API_KEY', value: receipt.bearerToken }),
    }));
    expect(JSON.stringify(config)).not.toContain(receipt.bearerToken);
    expect(config.mcp_servers.liquidaity.headers).toEqual({
      Authorization: 'Bearer ${MCP_LIQUIDAITY_API_KEY}', 'X-LiquidAIty-Hermes-Profile': 'trading',
    });
    expect(host.request).toHaveBeenCalledWith('trading', 'mcp.servers.test', { name: 'liquidaity' });
    expect(result.applicationConnectionConfigured).toBe(true);
    expect(result.applicationTools).toEqual(['trading.get_state']);
  });

  it('rejects a credential for another profile before writing any secret', async () => {
    mockSetup('main');
    await expect(connectHermesApplicationTools(setupInput)).rejects.toThrow('mismatched saved identity');
    expect(host.fetchJSON.mock.calls.some(([path]) => path.startsWith('/api/env'))).toBe(false);
  });

  it('does not report a failed native probe as a working connection', async () => {
    mockSetup();
    const original = host.request.getMockImplementation()!;
    host.request.mockImplementation(async (...args) => args[1] === 'mcp.servers.test'
      ? { ok: false, error: 'unauthorized' } : original(...args));
    await expect(connectHermesApplicationTools(setupInput)).rejects.toThrow('tool-access test failed');
  });

  it('clears an existing connection selection without removing its credentials or re-enabling it', async () => {
    config.mcp_servers.liquidaity.url = 'http://127.0.0.1:8765/mcp';
    const profile = await configureHermesProfile({
      profile: 'trading', applicationTools: [], enabledMcpServers: [],
    });
    expect(profile.enabledMcpServers).toEqual([]);
    expect(profile.applicationTools).toEqual([]);
    expect(config.mcp_servers.liquidaity).toMatchObject({
      url: 'http://127.0.0.1:8765/mcp',
      headers: { Authorization: 'Bearer ${MCP_LIQUIDAITY_API_KEY}' },
      tools: { include: [] },
    });
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
    expect(profile.memory.backgroundReviewEnabled).toBe(false);
    expect(host.fetchJSON).toHaveBeenCalledWith('/api/config?profile=new-specialist', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: {
        memory: { provider: 'holographic', memory_enabled: false, user_profile_enabled: false },
        auxiliary: { background_review: { enabled: false } },
        curator: { enabled: false },
      } }),
    });
  });
});
