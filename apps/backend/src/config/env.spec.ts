/**
 * Entity: Application Startup
 * Relationship: Executes the real backend environment loader in isolated processes and verifies module-relative path resolution, process precedence, and explicit missing-required configuration failure.
 *
 * Entity: Credentials
 * Relationship: Verifies file-backed secret resolution and proves configuration failures identify configuration keys without echoing secret values.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../..');
const envModuleUrl = pathToFileURL(path.join(repoRoot, 'apps/backend/src/config/env.ts')).href;
const tsxCli = path.join(repoRoot, 'node_modules/tsx/dist/cli.mjs');

const inheritedEnv = { ...process.env };
for (const variable of [
  'DATABASE_URL',
  'DATABASE_URL_FILE',
  'OPENAI_API_KEY',
  'OPENAI_API_KEY_FILE',
  'CONFIG_TEST_VALUE',
  'CONFIG_TEST_VALUE_FILE',
  'CONFIG_PROBE_VARIABLE',
  'CONFIG_EXPECTED_VALUE',
]) {
  delete inheritedEnv[variable];
}

function makeWorkspace(): string {
  const workspace = mkdtempSync(path.join(tmpdir(), 'liquidaity-env-'));
  const probe = [
    `const imported = await import(${JSON.stringify(envModuleUrl)});`,
    'const config = imported.default ?? imported;',
    'const moduleDirectory = process.env.CONFIG_TEST_MODULE_DIRECTORY;',
    'if (moduleDirectory) {',
    '  const resolved = config.backendEnvPathFromModuleDirectory(moduleDirectory);',
    "  console.log(resolved === process.env.CONFIG_EXPECTED_PATH ? 'CONFIG_MATCH' : 'CONFIG_MISMATCH');",
    '} else {',
    "  const targetEnv = JSON.parse(process.env.CONFIG_TEST_TARGET_ENV || '{}');",
    '  config.loadBackendEnvironment(targetEnv, process.env.CONFIG_TEST_ENV_PATH);',
    '  const variable = process.env.CONFIG_PROBE_VARIABLE;',
    '  if (variable) {',
    "    console.log(targetEnv[variable] === process.env.CONFIG_EXPECTED_VALUE ? 'CONFIG_MATCH' : 'CONFIG_MISMATCH');",
    '  }',
    '}',
  ].join('\n');
  writeFileSync(path.join(workspace, 'probe.mts'), probe, 'utf8');
  return workspace;
}

function runConfig(
  workspace: string,
  env: NodeJS.ProcessEnv = {},
  envPath = path.join(workspace, 'apps/backend/.env'),
) {
  return spawnSync(process.execPath, [tsxCli, path.join(workspace, 'probe.mts')], {
    cwd: workspace,
    env: {
      ...inheritedEnv,
      DATABASE_URL: 'postgresql://module-import.invalid/app',
      CONFIG_TEST_TARGET_ENV: JSON.stringify(env),
      CONFIG_TEST_ENV_PATH: envPath,
      CONFIG_PROBE_VARIABLE: env.CONFIG_PROBE_VARIABLE,
      CONFIG_EXPECTED_VALUE: env.CONFIG_EXPECTED_VALUE,
    },
    encoding: 'utf8',
  });
}

function runPathResolution(
  workspace: string,
  moduleDirectory: string,
  expectedPath: string,
  cwd: string,
) {
  return spawnSync(process.execPath, [tsxCli, path.join(workspace, 'probe.mts')], {
    cwd,
    env: {
      ...inheritedEnv,
      DATABASE_URL: 'postgresql://module-import.invalid/app',
      CONFIG_TEST_MODULE_DIRECTORY: moduleDirectory,
      CONFIG_EXPECTED_PATH: expectedPath,
    },
    encoding: 'utf8',
  });
}

describe('backend runtime configuration boundary', () => {
  const workspaces: string[] = [];

  afterEach(() => {
    for (const workspace of workspaces.splice(0)) {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  function workspace(): string {
    const created = makeWorkspace();
    workspaces.push(created);
    return created;
  }

  it('loads with no env file when required process configuration is supplied', () => {
    const result = runConfig(workspace(), {
      DATABASE_URL: 'postgresql://runtime-injected.invalid/app',
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('loads the optional backend env file for local development', () => {
    const cwd = workspace();
    const envDir = path.join(cwd, 'apps/backend');
    mkdirSync(envDir, { recursive: true });
    writeFileSync(
      path.join(envDir, '.env'),
      'DATABASE_URL=postgresql://dotenv.invalid/app\nCONFIG_TEST_VALUE=from-file\n',
      'utf8',
    );

    const result = runConfig(cwd, {
      CONFIG_PROBE_VARIABLE: 'CONFIG_TEST_VALUE',
      CONFIG_EXPECTED_VALUE: 'from-file',
    });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('CONFIG_MATCH');
  });

  it('resolves the same backend env from source and built layouts regardless of launcher cwd', () => {
    const root = workspace();
    const backendRoot = path.join(root, 'apps/backend');
    const expectedPath = path.join(backendRoot, '.env');
    const sourceModuleDirectory = path.join(backendRoot, 'src/config');
    const builtModuleDirectory = path.join(backendRoot, 'dist/src/config');
    mkdirSync(builtModuleDirectory, { recursive: true });

    for (const cwd of [root, backendRoot]) {
      for (const moduleDirectory of [sourceModuleDirectory, builtModuleDirectory]) {
        const result = runPathResolution(root, moduleDirectory, expectedPath, cwd);
        expect(result.status).toBe(0);
        expect(result.stderr).toBe('');
        expect(result.stdout.trim()).toBe('CONFIG_MATCH');
      }
    }
  });

  it('does not fall back to a repository-root env file', () => {
    const cwd = workspace();
    writeFileSync(
      path.join(cwd, '.env'),
      'DATABASE_URL=postgresql://root-fallback.invalid/app\n',
      'utf8',
    );

    const result = runConfig(cwd);
    const output = `${result.stdout}\n${result.stderr}`;

    expect(result.status).not.toBe(0);
    expect(output).toContain('missing_required_config: DATABASE_URL');
    expect(output).not.toContain('root-fallback.invalid');
  });

  it('keeps process environment authoritative over dotenv', () => {
    const cwd = workspace();
    const envDir = path.join(cwd, 'apps/backend');
    mkdirSync(envDir, { recursive: true });
    writeFileSync(
      path.join(envDir, '.env'),
      'DATABASE_URL=postgresql://dotenv.invalid/app\nCONFIG_TEST_VALUE=from-file\n',
      'utf8',
    );

    const result = runConfig(cwd, {
      DATABASE_URL: 'postgresql://process.invalid/app',
      CONFIG_TEST_VALUE: 'from-process',
      CONFIG_PROBE_VARIABLE: 'CONFIG_TEST_VALUE',
      CONFIG_EXPECTED_VALUE: 'from-process',
    });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('CONFIG_MATCH');
  });

  it('names the missing mandatory variable instead of requiring an env file', () => {
    const result = runConfig(workspace());
    const output = `${result.stdout}\n${result.stderr}`;

    expect(result.status).not.toBe(0);
    expect(output).toContain('missing_required_config: DATABASE_URL');
    expect(output).not.toContain('backend_env_missing');
  });

  it('resolves conventional file-backed secrets once at startup', () => {
    const cwd = workspace();
    const secretPath = path.join(cwd, 'openai-api-key');
    writeFileSync(secretPath, 'file-backed-test-secret\n', 'utf8');

    const result = runConfig(cwd, {
      DATABASE_URL: 'postgresql://runtime-injected.invalid/app',
      OPENAI_API_KEY_FILE: secretPath,
      CONFIG_PROBE_VARIABLE: 'OPENAI_API_KEY',
      CONFIG_EXPECTED_VALUE: 'file-backed-test-secret',
    });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('CONFIG_MATCH');
  });

  it('never includes secret values in configuration errors', () => {
    const cwd = workspace();
    const secret = 'must-not-appear-in-output';
    const secretPath = path.join(cwd, 'openai-api-key');
    writeFileSync(secretPath, secret, 'utf8');

    const result = runConfig(cwd, {
      OPENAI_API_KEY_FILE: secretPath,
    });
    const output = `${result.stdout}\n${result.stderr}`;

    expect(result.status).not.toBe(0);
    expect(output).toContain('missing_required_config: DATABASE_URL');
    expect(output).not.toContain(secret);
  });
});
