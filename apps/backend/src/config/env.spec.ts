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
    `await import(${JSON.stringify(envModuleUrl)});`,
    'const variable = process.env.CONFIG_PROBE_VARIABLE;',
    'if (variable) {',
    "  console.log(process.env[variable] === process.env.CONFIG_EXPECTED_VALUE ? 'CONFIG_MATCH' : 'CONFIG_MISMATCH');",
    '}',
  ].join('\n');
  writeFileSync(path.join(workspace, 'probe.mts'), probe, 'utf8');
  return workspace;
}

function runConfig(workspace: string, env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [tsxCli, path.join(workspace, 'probe.mts')], {
    cwd: workspace,
    env: { ...inheritedEnv, ...env },
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
