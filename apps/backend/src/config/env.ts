import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dotenv from 'dotenv';

const REQUIRED_CONFIG = ['DATABASE_URL'] as const;
const FILE_BACKED_CONFIG = [
  'DATABASE_URL',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'ANTHROPIC_API_KEY',
  'TAVILY_API_KEY',
  'AUTH_BOOTSTRAP_TOKEN',
  'NEO4J_PASSWORD',
  'POSTGRES_PASSWORD',
  'ALPACA_API_SECRET_KEY',
  'SEC_API_KEY',
  'MCP_AUTH0_CLIENT_SECRET',
] as const;

function optionalEnvPath(cwd: string): string | null {
  const candidates = [
    path.resolve(cwd, 'apps/backend/.env'),
    path.resolve(cwd, '.env'),
  ];
  return candidates.find((candidate, index) => (
    candidates.indexOf(candidate) === index && fs.existsSync(candidate)
  )) ?? null;
}

function resolveFileBackedConfig(env: NodeJS.ProcessEnv): void {
  for (const variable of FILE_BACKED_CONFIG) {
    const fileVariable = `${variable}_FILE`;
    const configuredPath = env[fileVariable];
    if (!configuredPath || String(env[variable] ?? '').trim()) continue;

    try {
      env[variable] = fs.readFileSync(configuredPath, 'utf8').replace(/[\r\n]+$/, '');
    } catch {
      throw new Error(`config_secret_file_unreadable: ${fileVariable}`);
    }
  }
}

/**
 * Resolve the one server-owned Codex credential-store directory.
 *
 * Hermes' app-server transport receives this
 * directory reference. Token material remains owned by Codex in auth.json and
 * is never copied into LiquidAIty persistence or browser state.
 */
export function resolveServerCodexHome(
  env: NodeJS.ProcessEnv = process.env,
  homeDirectory = os.homedir(),
): string {
  const configured = String(env.CODEX_HOME || '').trim();
  const legacyHermesReference = String(env.HERMES_CODEX_HOME || '').trim();
  if (
    configured
    && legacyHermesReference
    && path.resolve(configured) !== path.resolve(legacyHermesReference)
  ) {
    throw new Error('codex_home_authority_conflict');
  }
  return path.resolve(configured || legacyHermesReference || path.join(homeDirectory, '.codex'));
}

/** Resolve the native Codex executable used for stdio app-server transport. */
export function resolveServerCodexExecutable(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configured = String(env.CODEX_BIN || env.HERMES_CODEX_BIN || '').trim();
  if (configured) return path.resolve(configured);

  if (process.platform === 'win32') {
    const architecture = process.arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc';
    const packageName = process.arch === 'arm64' ? 'codex-win32-arm64' : 'codex-win32-x64';
    for (const entry of String(env.PATH || '').split(path.delimiter).filter(Boolean)) {
      const candidate = path.join(
        entry,
        'node_modules',
        '@openai',
        'codex',
        'node_modules',
        '@openai',
        packageName,
        'vendor',
        architecture,
        'codex',
        'codex.exe',
      );
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  return 'codex';
}

export function loadBackendEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): void {
  // Docker-injected *_FILE values are process configuration, so resolve them
  // before dotenv. This preserves injected configuration authority over files.
  resolveFileBackedConfig(env);

  const envPath = optionalEnvPath(cwd);
  if (envPath) {
    const result = dotenv.config({
      path: envPath,
      override: false,
      processEnv: env as Record<string, string>,
    });
    if (result.error) {
      throw new Error(`optional_env_load_failed: ${envPath}`);
    }
  }

  // Also support *_FILE references declared by the optional local dotenv file.
  resolveFileBackedConfig(env);

  // Materialize the default as explicit process configuration so every
  // supervised child consumes the same Codex credential-store reference.
  env.CODEX_HOME = resolveServerCodexHome(env);

  for (const variable of REQUIRED_CONFIG) {
    if (!String(env[variable] ?? '').trim()) {
      throw new Error(`missing_required_config: ${variable}`);
    }
  }
}

loadBackendEnvironment();
