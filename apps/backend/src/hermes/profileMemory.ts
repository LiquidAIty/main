import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const HOLOGRAPHIC_MEMORY_SETTINGS = [
  ['memory.provider', 'holographic'],
  ['plugins.hermes-memory-store.db_path', '$HERMES_HOME/memory_store.db'],
  ['plugins.hermes-memory-store.auto_extract', false],
  ['plugins.hermes-memory-store.default_trust', 0.5],
  ['plugins.hermes-memory-store.min_trust_threshold', 0.3],
  ['plugins.hermes-memory-store.hrr_dim', 1024],
  ['plugins.hermes-memory-store.temporal_decay_half_life', 0],
] as const;

// Hermes documents `auto` as its native AIAgent loop. The only alternative,
// `codex_app_server`, hands the turn to a separate Codex subprocess and is not
// part of LiquidAIty's runtime contract.
export const HERMES_NATIVE_OPENAI_RUNTIME = 'auto' as const;

const CONFIGURE_HOLOGRAPHIC_MEMORY_SCRIPT = String.raw`
import json
import sys

from hermes_cli.config import read_raw_config, set_config_value

desired = json.loads(sys.argv[1])
raw = read_raw_config()
missing = object()

def get_nested(document, dotted_key):
    current = document
    for segment in dotted_key.split('.'):
        if not isinstance(current, dict) or segment not in current:
            return missing
        current = current[segment]
    return current

def cli_value(value):
    if isinstance(value, bool):
        return 'true' if value else 'false'
    return str(value)

for key, value in desired:
    if get_nested(raw, key) != value:
        set_config_value(key, cli_value(value), force=True)
`;

function resolveHermesPythonExecutable(hermesRoot: string): string {
  const windowsPython = path.join(hermesRoot, 'venv', 'Scripts', 'python.exe');
  if (existsSync(windowsPython)) return windowsPython;
  const posixPython = path.join(hermesRoot, 'venv', 'bin', 'python');
  if (existsSync(posixPython)) return posixPython;
  throw new Error('hermes_home_config_python_missing');
}

export function resolveHermesRuntimeHome(hermesRoot: string): string {
  return path.join(hermesRoot, '.hermes');
}

export function resolveHermesHolographicMemoryDb(hermesRoot: string): string {
  return path.join(resolveHermesRuntimeHome(hermesRoot), 'memory_store.db');
}

/**
 * Select the bundled Hermes Holographic provider through Hermes' own atomic
 * config writer. Existing Hermes config and built-in MEMORY.md/USER.md files
 * remain owned by Hermes and are never copied or replaced here.
 */
export function configureHermesHolographicMemoryHome(
  hermesRoot: string,
  hermesHome: string,
  settings: ReadonlyArray<readonly [string, unknown]> = HOLOGRAPHIC_MEMORY_SETTINGS,
): void {
  mkdirSync(hermesHome, { recursive: true });
  const result = spawnSync(
    resolveHermesPythonExecutable(hermesRoot),
    ['-c', CONFIGURE_HOLOGRAPHIC_MEMORY_SCRIPT, JSON.stringify(settings)],
    {
      cwd: hermesRoot,
      env: { ...process.env, HERMES_HOME: hermesHome },
      encoding: 'utf8',
      windowsHide: true,
      timeout: 20_000,
      maxBuffer: 1024 * 1024,
    },
  );
  if (result.error || result.status !== 0) {
    throw new Error('hermes_holographic_home_config_failed');
  }
}

export function ensureHermesHolographicMemoryHome(hermesRoot: string): string {
  const hermesHome = resolveHermesRuntimeHome(hermesRoot);
  configureHermesHolographicMemoryHome(hermesRoot, hermesHome, [
    ...HOLOGRAPHIC_MEMORY_SETTINGS,
    ['model.openai_runtime', HERMES_NATIVE_OPENAI_RUNTIME],
  ]);
  return hermesHome;
}
