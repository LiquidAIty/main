import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  HERMES_RETIRED_SYSTEM_CARD_PLUGINS_SCRIPT,
  materializeHermesApplicationMcpServers,
  materializeHermesCardToolsPlugin,
  materializeHermesExternalMcpTools,
  removeHermesApplicationMcpServers,
  requireHermesCardToolsReadback,
  type HermesCardTools,
} from './cardToolsPlugin';

const temporaryRoots: string[] = [];
const execFileAsync = promisify(execFile);
const hermesRoot = resolve(__dirname, '../../../../Hermes');
const hermesPython = [
  join(hermesRoot, 'venv', 'Scripts', 'python.exe'),
  join(hermesRoot, 'venv', 'bin', 'python'),
].find(existsSync);

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true,
  })));
});

async function materializationFixture(profile: string) {
  const repoRoot = await mkdtemp(join(tmpdir(), 'hermes-card-tools-'));
  temporaryRoots.push(repoRoot);
  const sourceRoot = join(repoRoot, 'packages', 'hermes-card-tools');
  await mkdir(sourceRoot, { recursive: true });
  const realSourceRoot = resolve(__dirname, '../../../../packages/hermes-card-tools');
  for (const name of ['__init__.py', 'plugin.yaml']) {
    await copyFile(join(realSourceRoot, name), join(sourceRoot, name));
  }
  const executable = join(repoRoot, 'Hermes', 'venv', 'Scripts', 'python.exe');
  await mkdir(resolve(executable, '..'), { recursive: true });
  await writeFile(executable, '', 'utf8');
  const profileHome = join(repoRoot, 'Hermes', '.hermes', 'profiles', profile);
  await mkdir(join(profileHome, 'plugins', 'card-bot-dm'), { recursive: true });
  await writeFile(join(profileHome, 'plugins', 'card-bot-dm', 'plugin.yaml'), 'name: card-bot-dm\n');
  await writeFile(join(profileHome, 'config.yaml'), 'plugins: {}\n');
  return { repoRoot, profileHome };
}

function configuration(overrides: Partial<HermesCardTools> = {}): HermesCardTools {
  return {
    projectId: 'project-one',
    deckId: 'deck-one',
    cardId: 'builder',
    cardRevisionId: 'revision-one',
    cardRevisionSha256: 'a'.repeat(64),
    runtime: { kind: 'hermes', mode: 'delegate', profile: 'builder' },
    enabledTools: ['card.create'],
    unavailableTools: [],
    unavailableToolReasons: {},
    presentedTools: ['card.create'],
    nativeTools: ['memory'],
    toolsets: [],
    mcpConnectionIds: [],
    pluginTools: [{
      canonicalName: 'card.create',
      hermesName: 'card__card_create',
      description: 'Create one saved Card.',
      inputSchema: { type: 'object', properties: {} },
    }],
    externalMcpTools: [],
    externalToolCatalogState: 'available',
    configurationFingerprint: 'b'.repeat(64),
    ...overrides,
  };
}

describe('materializeHermesCardToolsPlugin retired profile residue', () => {
  it.each(['liquidaity-main', 'builder', 'thinkgraph', 'knowgraph', 'signal-analyst'])(
    'reconciles only after card-tools enable proof for saved profile %s',
    async (profile) => {
      const fixture = await materializationFixture(profile);
      const order: string[] = [];
      const runCli = vi.fn(async (_executable: string, args: string[]) => {
        if (args[0] === '-m') {
          order.push('enable');
          expect(await readFile(
            join(fixture.profileHome, 'plugins', 'card-tools', 'plugin.yaml'),
            'utf8',
          )).toContain('name: card-tools');
          return;
        }
        order.push('reconcile');
        expect(args).toEqual(['-X', 'utf8', '-c', HERMES_RETIRED_SYSTEM_CARD_PLUGINS_SCRIPT]);
        await expect(stat(join(fixture.profileHome, 'plugins', 'card-bot-dm')))
          .resolves.toBeTruthy();
      });

      await materializeHermesCardToolsPlugin(
        fixture.profileHome,
        configuration({ runtime: { kind: 'hermes', mode: 'delegate', profile } }),
        { repoRoot: fixture.repoRoot, runCli },
      );

      expect(order).toEqual(['enable', 'reconcile']);
      await expect(stat(join(fixture.profileHome, 'plugins', 'card-bot-dm')))
        .rejects.toMatchObject({ code: 'ENOENT' });
    },
  );

  it('rejects a mismatched managed profile before staging or enabling anything', async () => {
    const fixture = await materializationFixture('not-builder');
    const runCli = vi.fn(async () => undefined);

    await expect(materializeHermesCardToolsPlugin(
      fixture.profileHome,
      configuration(),
      { repoRoot: fixture.repoRoot, runCli },
    )).rejects.toThrow('hermes_retired_plugin_profile_home_mismatch:builder');

    expect(runCli).not.toHaveBeenCalled();
    await expect(stat(join(fixture.profileHome, 'plugins', 'card-tools')))
      .rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(join(fixture.profileHome, 'plugins', 'card-bot-dm')))
      .resolves.toBeTruthy();
  });

  it('is idempotent when the retired profile-local directory is already absent', async () => {
    const fixture = await materializationFixture('builder');
    const runCli = vi.fn(async () => undefined);

    await materializeHermesCardToolsPlugin(
      fixture.profileHome,
      configuration(),
      { repoRoot: fixture.repoRoot, runCli },
    );
    await materializeHermesCardToolsPlugin(
      fixture.profileHome,
      configuration(),
      { repoRoot: fixture.repoRoot, runCli },
    );

    expect(runCli).toHaveBeenCalledTimes(4);
    await expect(stat(join(fixture.profileHome, 'plugins', 'card-bot-dm')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not remove an unsafe non-directory retired-plugin target', async () => {
    const fixture = await materializationFixture('builder');
    await rm(join(fixture.profileHome, 'plugins', 'card-bot-dm'), { recursive: true });
    await writeFile(join(fixture.profileHome, 'plugins', 'card-bot-dm'), 'not a directory');

    await expect(materializeHermesCardToolsPlugin(
      fixture.profileHome,
      configuration(),
      { repoRoot: fixture.repoRoot, runCli: vi.fn(async () => undefined) },
    )).rejects.toThrow('hermes_retired_plugin_destination_invalid');
    await expect(readFile(join(fixture.profileHome, 'plugins', 'card-bot-dm'), 'utf8'))
      .resolves.toBe('not a directory');
  });

  it('refuses a retired-plugin symlink without touching its external target', async () => {
    const fixture = await materializationFixture('builder');
    const target = join(fixture.profileHome, 'plugins', 'card-bot-dm');
    const external = join(fixture.repoRoot, 'external-plugin-data');
    await rm(target, { recursive: true });
    await mkdir(external, { recursive: true });
    await writeFile(join(external, 'keep.txt'), 'preserved');
    await symlink(external, target, process.platform === 'win32' ? 'junction' : 'dir');

    await expect(materializeHermesCardToolsPlugin(
      fixture.profileHome,
      configuration(),
      { repoRoot: fixture.repoRoot, runCli: vi.fn(async () => undefined) },
    )).rejects.toThrow('hermes_retired_plugin_destination_invalid');
    await expect(readFile(join(external, 'keep.txt'), 'utf8')).resolves.toBe('preserved');
  });

  it('leaves retired residue intact when replacement enable or reconciliation fails', async () => {
    const enableFailure = await materializationFixture('builder');
    const enableRun = vi.fn(async () => {
      throw new Error('enable failed');
    });
    await expect(materializeHermesCardToolsPlugin(
      enableFailure.profileHome,
      configuration(),
      { repoRoot: enableFailure.repoRoot, runCli: enableRun },
    )).rejects.toThrow('enable failed');
    expect(enableRun).toHaveBeenCalledOnce();
    await expect(stat(join(enableFailure.profileHome, 'plugins', 'card-bot-dm')))
      .resolves.toBeTruthy();

    const reconcileFailure = await materializationFixture('builder');
    const reconcileRun = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('readback failed'));
    await expect(materializeHermesCardToolsPlugin(
      reconcileFailure.profileHome,
      configuration(),
      { repoRoot: reconcileFailure.repoRoot, runCli: reconcileRun },
    )).rejects.toThrow('readback failed');
    expect(reconcileRun).toHaveBeenCalledTimes(2);
    await expect(stat(join(reconcileFailure.profileHome, 'plugins', 'card-bot-dm')))
      .resolves.toBeTruthy();
  });

  it('uses native config ownership, preserves unrelated plugin data, and verifies exact residue absence', () => {
    expect(HERMES_RETIRED_SYSTEM_CARD_PLUGINS_SCRIPT).toContain(
      'from hermes_cli.config import load_config, save_config',
    );
    expect(HERMES_RETIRED_SYSTEM_CARD_PLUGINS_SCRIPT).toContain('plugins = dict(raw_plugins)');
    expect(HERMES_RETIRED_SYSTEM_CARD_PLUGINS_SCRIPT).toContain(
      'next_enabled = [name for name in enabled if name not in retired]',
    );
    expect(HERMES_RETIRED_SYSTEM_CARD_PLUGINS_SCRIPT).toContain(
      'next_entries = {name: value for name, value in entries.items() if name not in retired}',
    );
    expect(HERMES_RETIRED_SYSTEM_CARD_PLUGINS_SCRIPT).toContain('save_config(cfg)');
    expect(HERMES_RETIRED_SYSTEM_CARD_PLUGINS_SCRIPT).toContain('readback = load_config() or {}');
    expect(HERMES_RETIRED_SYSTEM_CARD_PLUGINS_SCRIPT).toContain('replacement not in actual_enabled');
    expect(HERMES_RETIRED_SYSTEM_CARD_PLUGINS_SCRIPT).toContain(
      'any(name in actual_entries for name in retired)',
    );
    expect(HERMES_RETIRED_SYSTEM_CARD_PLUGINS_SCRIPT).toContain(
      'retired = ["card-bot-dm","liquidaity-card-mcp"]',
    );
  });

  it.skipIf(!hermesPython)(
    'preserves unrelated native config values through the real Hermes load/save owner',
    async () => {
      const profileHome = await mkdtemp(join(tmpdir(), 'hermes-plugin-config-'));
      temporaryRoots.push(profileHome);
      await writeFile(join(profileHome, 'config.yaml'), [
        'plugins:',
        '  custom-plugin:',
        '    setting: keep-me',
        '  enabled:',
        '    - card-bot-dm',
        '    - card-tools',
        '    - liquidaity-card-mcp',
        '    - custom-plugin',
        '  disabled:',
        '    - disabled-plugin',
        '    - card-bot-dm',
        '    - liquidaity-card-mcp',
        '  entries:',
        '    card-bot-dm:',
        '      allow_tool_override: false',
        '    liquidaity-card-mcp:',
        '      allow_tool_override: false',
        '    card-tools:',
        '      allow_tool_override: false',
        '    custom-plugin:',
        '      allow_tool_override: true',
        'unrelated:',
        '  nested: keep-me-too',
        '',
      ].join('\n'), 'utf8');
      const env = {
        ...process.env,
        HERMES_HOME: profileHome,
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
      };

      await execFileAsync(
        hermesPython!,
        ['-X', 'utf8', '-c', HERMES_RETIRED_SYSTEM_CARD_PLUGINS_SCRIPT],
        { cwd: hermesRoot, env, windowsHide: true },
      );
      const readback = await execFileAsync(
        hermesPython!,
        ['-X', 'utf8', '-c', [
          'import json',
          'from hermes_cli.config import load_config',
          'print(json.dumps(load_config()))',
        ].join('\n')],
        { cwd: hermesRoot, env, windowsHide: true },
      );
      const actual = JSON.parse(readback.stdout);

      expect(actual.plugins.enabled).toEqual(['card-tools', 'custom-plugin']);
      expect(actual.plugins.disabled).toEqual(['disabled-plugin']);
      expect(actual.plugins.entries).toEqual({
        'card-tools': { allow_tool_override: false },
        'custom-plugin': { allow_tool_override: true },
      });
      expect(actual.plugins['custom-plugin']).toEqual({ setting: 'keep-me' });
      expect(actual.unrelated).toEqual({ nested: 'keep-me-too' });
    },
  );

  it('does not broaden the saved Card grants or external MCP surface during retirement', async () => {
    const fixture = await materializationFixture('builder');
    const selected = configuration({
      enabledTools: ['card.create', 'cbm.search_graph'],
      presentedTools: ['card.create', 'cbm.search_graph'],
      mcpConnectionIds: ['cbm'],
      externalMcpTools: [{
        canonicalName: 'cbm.search_graph',
        connectionId: 'cbm',
        nativeName: 'cbm.search_graph',
      }],
    });
    const before = structuredClone(selected);

    await materializeHermesCardToolsPlugin(
      fixture.profileHome,
      selected,
      { repoRoot: fixture.repoRoot, runCli: vi.fn(async () => undefined) },
    );

    expect(selected).toEqual(before);
    const toolFile = JSON.parse(await readFile(
      join(fixture.profileHome, 'plugins', 'card-tools', 'tools.json'),
      'utf8',
    ));
    expect(toolFile.tools).toEqual(selected.pluginTools);
    expect(JSON.stringify(toolFile)).not.toContain('cbm.search_graph');
  });
});

describe('requireHermesCardToolsReadback', () => {
  it('accepts the exact plugin and native surface', () => {
    expect(requireHermesCardToolsReadback({ sections: [
      { name: 'card-tools', tools: [{ name: 'card__card_create' }] },
      { name: 'memory', tools: [{ name: 'memory' }] },
    ] }, configuration())).toEqual({});
  });

  it('fails closed when the native plugin exposes an ungranted tool', () => {
    expect(() => requireHermesCardToolsReadback({ sections: [{
      name: 'card-tools',
      tools: [{ name: 'card__card_create' }, { name: 'card__canvas_inspect' }],
    }] }, configuration())).toThrow(
      'hermes_card_tools_readback_broadened:card__canvas_inspect',
    );
  });

  it('keeps chat available and reports a granted plugin tool that is missing', () => {
    expect(requireHermesCardToolsReadback({ sections: [
      { name: 'card-tools', tools: [] },
      { name: 'memory', tools: [{ name: 'memory' }] },
    ] }, configuration())).toEqual({
      'card.create': 'internal_plugin_tool_unavailable',
    });
  });

  it('accepts only the selected external MCP tool and reports a missing one', () => {
    const selected = configuration({
      enabledTools: ['graphiti.search_nodes'],
      presentedTools: ['graphiti.search_nodes'],
      nativeTools: [],
      mcpConnectionIds: [],
      pluginTools: [],
      externalMcpTools: [{
        canonicalName: 'graphiti.search_nodes',
        connectionId: 'graphiti',
        nativeName: 'search_nodes',
      }],
    });
    expect(requireHermesCardToolsReadback({ sections: [{
      name: 'mcp-graphiti',
      tools: [{ name: 'mcp__graphiti__search_nodes' }],
    }] }, selected)).toEqual({});
    expect(requireHermesCardToolsReadback({ sections: [], }, selected)).toEqual({
      'graphiti.search_nodes': 'external_mcp_tool_unavailable',
    });
  });

  it('fails closed when a selected MCP server exposes an ungranted tool', () => {
    const selected = configuration({
      enabledTools: ['graphiti.search_nodes'],
      presentedTools: ['graphiti.search_nodes'],
      nativeTools: [],
      mcpConnectionIds: [],
      pluginTools: [],
      externalMcpTools: [{
        canonicalName: 'graphiti.search_nodes',
        connectionId: 'graphiti',
        nativeName: 'search_nodes',
      }],
    });
    expect(() => requireHermesCardToolsReadback({ sections: [{
      name: 'mcp-graphiti',
      tools: [
        { name: 'mcp__graphiti__search_nodes' },
        { name: 'mcp__graphiti__add_memory' },
      ],
    }] }, selected)).toThrow('hermes_external_mcp_readback_broadened:graphiti');
  });
});

describe('materializeHermesExternalMcpTools', () => {
  it('derives one exact native server/tool surface from an individual Card tool grant', async () => {
    const selected = configuration({
      enabledTools: ['graphiti.search_nodes'],
      presentedTools: ['graphiti.search_nodes'],
      pluginTools: [],
      externalMcpTools: [{
        canonicalName: 'graphiti.search_nodes',
        connectionId: 'graphiti',
        nativeName: 'search_nodes',
      }],
    });
    const request = vi.fn(async (method: string) => {
      if (method === 'mcp.servers.list') return {
        servers: [{ name: 'graphiti', auth: null, tools: {} }],
      };
      if (method === 'mcp.servers.test') return {
        ok: true,
        tools: [{ name: 'search_nodes' }, { name: 'add_memory' }],
        prompts: 0,
        resources: 0,
      };
      if (method === 'tools.configure') return { changed: ['graphiti:search_nodes'] };
      throw new Error(`unexpected:${method}`);
    });

    await expect(materializeHermesExternalMcpTools(request, selected)).resolves.toEqual({});
    expect(request).toHaveBeenCalledWith('tools.configure', {
      action: 'disable',
      names: ['graphiti:add_memory'],
    });
    expect(request).toHaveBeenCalledWith('tools.configure', {
      action: 'enable',
      names: ['graphiti:search_nodes'],
    });
  });

  it('keeps the Card runtime available with a typed missing-server result', async () => {
    const selected = configuration({
      enabledTools: ['graphiti.search_nodes'],
      presentedTools: ['graphiti.search_nodes'],
      pluginTools: [],
      externalMcpTools: [{
        canonicalName: 'graphiti.search_nodes',
        connectionId: 'graphiti',
        nativeName: 'search_nodes',
      }],
    });
    const request = vi.fn(async (method: string) => {
      if (method === 'mcp.servers.list') return { servers: [] };
      if (method === 'profiles.configure') return { ok: true, applied: { mcp_servers: true } };
      throw new Error(`unexpected:${method}`);
    });

    await expect(materializeHermesExternalMcpTools(
      request,
      selected,
      { graphiti: 'mcp_server_not_configured' },
    )).resolves.toEqual({
      'graphiti.search_nodes': 'mcp_server_not_configured',
    });
    expect(request).toHaveBeenCalledWith('profiles.configure', {
      name: 'builder',
      enabled_mcp_servers: [],
    });
  });
});

describe('materializeHermesApplicationMcpServers', () => {
  it('writes exact profile-scoped views of the application MCP host', async () => {
    const selected = configuration({
      enabledTools: ['cbm.search_graph', 'graphiti.search_nodes'],
      presentedTools: ['cbm.search_graph', 'graphiti.search_nodes'],
      pluginTools: [],
      externalMcpTools: [
        {
          canonicalName: 'cbm.search_graph',
          connectionId: 'cbm',
          nativeName: 'cbm.search_graph',
        },
        {
          canonicalName: 'graphiti.search_nodes',
          connectionId: 'graphiti',
          nativeName: 'graphiti.search_nodes',
        },
      ],
    });
    const request = vi.fn(async (method: string, params: Record<string, unknown>) => {
      if (method === 'mcp.servers.list') return { servers: [] };
      if (method === 'mcp.servers.add') return { ok: true, name: params.name };
      throw new Error(`unexpected:${method}`);
    });

    await materializeHermesApplicationMcpServers(request, selected, {
      type: 'http',
      url: 'http://127.0.0.1:8765/mcp',
      headers: { Authorization: 'Bearer signed-run-token' },
    });

    expect(request).toHaveBeenCalledWith('mcp.servers.add', {
      name: 'cbm',
      config: {
        url: 'http://127.0.0.1:8765/mcp',
        tools: {
          include: ['cbm.search_graph'],
          prompts: false,
          resources: false,
        },
      },
      bearer_token: 'signed-run-token',
    });
    expect(request).toHaveBeenCalledWith('mcp.servers.add', {
      name: 'graphiti',
      config: {
        url: 'http://127.0.0.1:8765/mcp',
        tools: {
          include: ['graphiti.search_nodes'],
          prompts: false,
          resources: false,
        },
      },
      bearer_token: 'signed-run-token',
    });
  });

  it('renews an existing exact connection without replacing its filter', async () => {
    const selected = configuration({
      enabledTools: ['cbm.search_graph'],
      presentedTools: ['cbm.search_graph'],
      pluginTools: [],
      externalMcpTools: [{
        canonicalName: 'cbm.search_graph',
        connectionId: 'cbm',
        nativeName: 'cbm.search_graph',
      }],
    });
    const request = vi.fn(async (method: string, params: Record<string, unknown>) => {
      if (method === 'mcp.servers.list') return { servers: [{
        name: 'cbm',
        transport: 'http',
        url: 'http://127.0.0.1:8765/mcp',
        tools: { include: ['cbm.search_graph'], prompts: false, resources: false },
      }] };
      if (method === 'mcp.servers.set_api_key') return { ok: true, name: params.name };
      throw new Error(`unexpected:${method}`);
    });

    await materializeHermesApplicationMcpServers(request, selected, {
      type: 'http',
      url: 'http://127.0.0.1:8765/mcp',
      headers: { Authorization: 'Bearer next-run-token' },
    });

    expect(request).toHaveBeenCalledWith('mcp.servers.set_api_key', {
      name: 'cbm',
      value: 'next-run-token',
    });
    expect(request).not.toHaveBeenCalledWith('mcp.servers.add', expect.anything());
  });
});

describe('removeHermesApplicationMcpServers', () => {
  it('removes only the exact transient external connections selected for the turn', async () => {
    const selected = configuration({
      enabledTools: ['cbm.search_graph'],
      presentedTools: ['cbm.search_graph'],
      pluginTools: [],
      externalMcpTools: [{
        canonicalName: 'cbm.search_graph',
        connectionId: 'cbm',
        nativeName: 'cbm.search_graph',
      }],
    });
    const request = vi.fn(async (method: string, params: Record<string, unknown>) => {
      if (method === 'mcp.servers.list') return {
        servers: [{ name: 'cbm' }, { name: 'unrelated' }],
      };
      if (method === 'mcp.servers.remove') return { ok: true, removed: true };
      throw new Error(`unexpected:${method}`);
    });

    await removeHermesApplicationMcpServers(request, selected);

    expect(request).toHaveBeenCalledWith('mcp.servers.remove', {
      profile: 'builder',
      name: 'cbm',
    });
    expect(request).not.toHaveBeenCalledWith('mcp.servers.remove', {
      profile: 'builder',
      name: 'unrelated',
    });
  });
});
