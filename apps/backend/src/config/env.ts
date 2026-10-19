/**
 * Entity: Application Startup
 * Relationship: This file loads the backend's one workspace-owned environment file and validates mandatory configuration without depending on the process working directory.
 *
 * Entity: Credentials
 * Relationship: This file resolves supported file-backed secrets while preserving process-injected values and keeping secret contents out of configuration errors.
 */

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
  'ALPACA_API_KEY_ID',
  'ALPACA_API_SECRET_KEY',
  'SEC_API_KEY',
  'MCP_AUTH0_CLIENT_SECRET',
  'WORLDSIGNALS_HMAC_SECRET',
] as const;

export function backendEnvPathFromModuleDirectory(moduleDirectory: string): string {
  const sourceOrBuildRoot = path.resolve(moduleDirectory, '../..');
  const backendRoot = path.basename(sourceOrBuildRoot) === 'dist'
    ? path.dirname(sourceOrBuildRoot)
    : sourceOrBuildRoot;
  return path.join(backendRoot, '.env');
}

const BACKEND_ENV_PATH = backendEnvPathFromModuleDirectory(__dirname);

function optionalEnvPath(envPath: string): string | null {
  return fs.existsSync(envPath) ? envPath : null;
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
  envPath = BACKEND_ENV_PATH,
): void {
  // Docker-injected *_FILE values are process configuration, so resolve them
  // before dotenv. This preserves injected configuration authority over files.
  resolveFileBackedConfig(env);

  const existingEnvPath = optionalEnvPath(envPath);
  if (existingEnvPath) {
    const result = dotenv.config({
      path: existingEnvPath,
      override: false,
      processEnv: env as Record<string, string>,
    });
    if (result.error) {
      throw new Error(`optional_env_load_failed: ${existingEnvPath}`);
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
