import fs from 'node:fs';
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

  for (const variable of REQUIRED_CONFIG) {
    if (!String(env[variable] ?? '').trim()) {
      throw new Error(`missing_required_config: ${variable}`);
    }
  }
}

loadBackendEnvironment();
