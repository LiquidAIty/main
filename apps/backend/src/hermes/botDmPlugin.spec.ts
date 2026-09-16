import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  materializeHermesBotDmPlugin,
  requireLoadedHermesBotDmPlugin,
  type HermesCliRunner,
} from './botDmPlugin';

const roots: string[] = [];

async function fixture(options: { missing?: string } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'bot-dm-plugin-'));
  roots.push(root);
  const source = path.join(root, 'packages', 'hermes-card-bot-dm');
  const hermesRoot = path.join(root, 'Hermes');
  const executable = path.join(hermesRoot, 'venv', 'Scripts', 'python.exe');
  const profileHome = path.join(hermesRoot, '.hermes', 'profiles', 'main');
  await mkdir(source, { recursive: true });
  await mkdir(path.dirname(executable), { recursive: true });
  await mkdir(profileHome, { recursive: true });
  await writeFile(executable, 'fixture', 'utf8');
  await writeFile(path.join(profileHome, 'config.yaml'), 'model: fixture\n', 'utf8');
  const contents: Record<string, string> = {
    '__init__.py': '# plugin\n',
    'plugin.yaml': 'name: card-bot-dm\nversion: 1\n',
  };
  for (const [name, content] of Object.entries(contents)) {
    if (name !== options.missing) await writeFile(path.join(source, name), content, 'utf8');
  }
  await mkdir(path.join(source, 'tests'));
  await writeFile(path.join(source, 'tests', 'test_plugin.py'), '# source-only tests\n', 'utf8');
  const runCli = vi.fn<HermesCliRunner>().mockResolvedValue(undefined);
  return { root, source, hermesRoot, executable, profileHome, runCli };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('materializeHermesBotDmPlugin', () => {
  it('copies the tracked plugin idempotently and verifies source hashes', async () => {
    const item = await fixture();
    const first = await materializeHermesBotDmPlugin(item.profileHome, {
      repoRoot: item.root,
      runCli: item.runCli,
    });
    const second = await materializeHermesBotDmPlugin(item.profileHome, {
      repoRoot: item.root,
      runCli: item.runCli,
    });

    expect(first.files).toEqual(second.files);
    expect(first.files.map((file) => file.relativePath)).toEqual([
      '__init__.py',
      'plugin.yaml',
    ]);
    await expect(readFile(path.join(second.destinationDir, 'plugin.yaml'), 'utf8'))
      .resolves.toBe('name: card-bot-dm\nversion: 1\n');
    await expect(readFile(path.join(second.destinationDir, 'tests', 'test_plugin.py'), 'utf8'))
      .rejects.toThrow();
    expect(item.runCli).toHaveBeenCalledTimes(2);
  });

  it('removes stale managed files without changing sibling plugins', async () => {
    const item = await fixture();
    const managed = path.join(item.profileHome, 'plugins', 'card-bot-dm');
    const sibling = path.join(item.profileHome, 'plugins', 'other-plugin');
    await mkdir(managed, { recursive: true });
    await mkdir(sibling, { recursive: true });
    await writeFile(path.join(managed, 'stale.py'), 'stale', 'utf8');
    await writeFile(path.join(sibling, 'keep.py'), 'keep', 'utf8');

    await materializeHermesBotDmPlugin(item.profileHome, {
      repoRoot: item.root,
      runCli: item.runCli,
    });

    await expect(readFile(path.join(managed, 'stale.py'), 'utf8')).rejects.toThrow();
    await expect(readFile(path.join(sibling, 'keep.py'), 'utf8')).resolves.toBe('keep');
  });

  it('rejects a plugins directory that escapes through a symlink', async () => {
    const item = await fixture();
    const outside = path.join(item.root, 'outside');
    await mkdir(outside);
    await symlink(outside, path.join(item.profileHome, 'plugins'), 'junction');

    await expect(materializeHermesBotDmPlugin(item.profileHome, {
      repoRoot: item.root,
      runCli: item.runCli,
    })).rejects.toThrow('hermes_bot_dm_plugin_destination_outside_profile');
    expect(item.runCli).not.toHaveBeenCalled();
  });

  it('fails before mutation when the tracked source is missing', async () => {
    const item = await fixture();
    await rm(item.source, { recursive: true });

    await expect(materializeHermesBotDmPlugin(item.profileHome, {
      repoRoot: item.root,
      runCli: item.runCli,
    })).rejects.toThrow('hermes_bot_dm_plugin_source_missing');
    expect(item.runCli).not.toHaveBeenCalled();
  });

  it('fails when a required source file is missing', async () => {
    const item = await fixture({ missing: '__init__.py' });

    await expect(materializeHermesBotDmPlugin(item.profileHome, {
      repoRoot: item.root,
      runCli: item.runCli,
    })).rejects.toThrow('hermes_bot_dm_plugin_source_file_missing:__init__.py');
    expect(item.runCli).not.toHaveBeenCalled();
  });

  it('enables the plugin noninteractively in the exact profile environment', async () => {
    const item = await fixture();
    await materializeHermesBotDmPlugin(item.profileHome, {
      repoRoot: item.root,
      env: { PRESERVED: 'yes', LIQUIDAITY_INTERNAL_MCP_SECRET: 'do-not-forward' },
      runCli: item.runCli,
    });

    expect(item.runCli).toHaveBeenCalledWith(
      item.executable,
      [
        '-m', 'hermes_cli.main',
        'plugins', 'enable', 'card-bot-dm', '--no-allow-tool-override',
      ],
      expect.objectContaining({
        cwd: item.hermesRoot,
        windowsHide: true,
        env: expect.objectContaining({
          PRESERVED: 'yes',
          HERMES_HOME: item.profileHome,
          PYTHONUTF8: '1',
          PYTHONIOENCODING: 'utf-8',
        }),
      }),
    );
    expect(item.runCli.mock.calls[0][2].env.LIQUIDAITY_INTERNAL_MCP_SECRET).toBeUndefined();
  });
});

describe('requireLoadedHermesBotDmPlugin', () => {
  it('returns the one enabled matching runtime row', () => {
    expect(requireLoadedHermesBotDmPlugin({
      plugins: [
        { name: 'other', version: '1', enabled: true },
        { name: 'card-bot-dm', version: '0.1.0', enabled: true },
      ],
    })).toEqual({ name: 'card-bot-dm', version: '0.1.0', enabled: true });
  });

  it('rejects a missing runtime row', () => {
    expect(() => requireLoadedHermesBotDmPlugin({ plugins: [] }))
      .toThrow('hermes_bot_dm_plugin_runtime_missing');
  });

  it('rejects duplicate runtime rows', () => {
    expect(() => requireLoadedHermesBotDmPlugin({
      plugins: [
        { name: 'card-bot-dm', enabled: true },
        { name: 'card-bot-dm', enabled: true },
      ],
    })).toThrow('hermes_bot_dm_plugin_runtime_ambiguous');
  });

  it('rejects a disabled runtime row', () => {
    expect(() => requireLoadedHermesBotDmPlugin({
      plugins: [{ name: 'card-bot-dm', enabled: false }],
    })).toThrow('hermes_bot_dm_plugin_runtime_disabled');
  });
});
