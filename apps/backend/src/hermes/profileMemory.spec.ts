import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  configureHermesHolographicMemoryProfile,
  HOLOGRAPHIC_MEMORY_SETTINGS,
  resolveHermesCardRuntimeHome,
  resolveHermesHolographicMemoryDb,
} from './profileMemory';

const HERMES_ROOT = path.join(process.cwd(), 'Hermes');
const HERMES_PYTHON = path.join(HERMES_ROOT, 'venv', 'Scripts', 'python.exe');
const tempHomes: string[] = [];

function newProfileHome(): string {
  const home = mkdtempSync(path.join(tmpdir(), 'liquidaity-hermes-memory-'));
  tempHomes.push(home);
  mkdirSync(path.join(home, 'memories'), { recursive: true });
  return home;
}

function readRawHermesConfig(home: string): Record<string, any> {
  const output = execFileSync(
    HERMES_PYTHON,
    [
      '-c',
      'import json; from hermes_cli.config import read_raw_config; print(json.dumps(read_raw_config()))',
    ],
    {
      cwd: HERMES_ROOT,
      env: { ...process.env, HERMES_HOME: home },
      encoding: 'utf8',
      windowsHide: true,
      timeout: 20_000,
    },
  );
  return JSON.parse(output) as Record<string, any>;
}

afterEach(() => {
  for (const home of tempHomes.splice(0)) {
    rmSync(home, { recursive: true, force: true });
  }
});

describe('Hermes Holographic profile configuration', () => {
  it('resolves isolated profile homes and databases', () => {
    const profiles = ['liquidaity-main', 'coder', 'liquidaity-hermes-steward'];
    const homes = profiles.map((profile) => resolveHermesCardRuntimeHome(HERMES_ROOT, profile));
    expect(homes[0]).toBe(path.join(HERMES_ROOT, '.hermes', 'profiles', 'liquidaity-main'));
    expect(new Set(homes).size).toBe(3);
    expect(new Set(homes.map((home) => path.join(home, 'state.db'))).size).toBe(3);
    expect(new Set(homes.map((home) => path.join(home, 'memories', 'MEMORY.md'))).size).toBe(3);
    expect(new Set(profiles.map((profile) => resolveHermesHolographicMemoryDb(HERMES_ROOT, profile))).size).toBe(3);
    expect(() => resolveHermesCardRuntimeHome(HERMES_ROOT, '../escape')).toThrow(
      'hermes_profile_invalid',
    );
  });

  it('uses the upstream atomic config writer idempotently without replacing profile-owned files', () => {
    const home = newProfileHome();
    const memoryText = 'existing built-in memory\n';
    const userText = 'existing user profile\n';
    const authText = '{"account":"existing"}\n';
    writeFileSync(
      path.join(home, 'config.yaml'),
      'display:\n  skin: existing-skin\nmodel:\n  default: existing-model\n',
      'utf8',
    );
    writeFileSync(path.join(home, 'memories', 'MEMORY.md'), memoryText, 'utf8');
    writeFileSync(path.join(home, 'memories', 'USER.md'), userText, 'utf8');
    writeFileSync(path.join(home, 'auth.json'), authText, 'utf8');

    configureHermesHolographicMemoryProfile(HERMES_ROOT, home);
    const firstBytes = readFileSync(path.join(home, 'config.yaml'), 'utf8');
    const firstMtime = statSync(path.join(home, 'config.yaml')).mtimeMs;
    const raw = readRawHermesConfig(home);

    expect(raw.display.skin).toBe('existing-skin');
    expect(raw.model.default).toBe('existing-model');
    expect(raw.memory.provider).toBe('holographic');
    expect(raw.plugins['hermes-memory-store']).toEqual({
      db_path: '$HERMES_HOME/memory_store.db',
      auto_extract: false,
      default_trust: 0.5,
      min_trust_threshold: 0.3,
      hrr_dim: 1024,
      temporal_decay_half_life: 0,
    });
    expect(readFileSync(path.join(home, 'memories', 'MEMORY.md'), 'utf8')).toBe(memoryText);
    expect(readFileSync(path.join(home, 'memories', 'USER.md'), 'utf8')).toBe(userText);
    expect(readFileSync(path.join(home, 'auth.json'), 'utf8')).toBe(authText);
    expect(firstBytes).not.toContain('existing-account-token');

    configureHermesHolographicMemoryProfile(HERMES_ROOT, home);
    expect(readFileSync(path.join(home, 'config.yaml'), 'utf8')).toBe(firstBytes);
    expect(statSync(path.join(home, 'config.yaml')).mtimeMs).toBe(firstMtime);
  });

  it('keeps the intended provider settings explicit and bounded', () => {
    expect(HOLOGRAPHIC_MEMORY_SETTINGS).toEqual([
      ['memory.provider', 'holographic'],
      ['plugins.hermes-memory-store.db_path', '$HERMES_HOME/memory_store.db'],
      ['plugins.hermes-memory-store.auto_extract', false],
      ['plugins.hermes-memory-store.default_trust', 0.5],
      ['plugins.hermes-memory-store.min_trust_threshold', 0.3],
      ['plugins.hermes-memory-store.hrr_dim', 1024],
      ['plugins.hermes-memory-store.temporal_decay_half_life', 0],
    ]);
  });
});
