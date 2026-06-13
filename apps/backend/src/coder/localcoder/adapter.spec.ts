import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import type { CoderPacket } from '../../contracts/coderContracts';
import {
  LocalCoderAdapter,
  deriveLocalCoderPermissionMode,
  resolveLocalCoderWorkspaceRoot,
} from './adapter';

function packet(repoPath: string): CoderPacket {
  return {
    id: 'packet-1',
    projectId: 'project-1',
    repoPath,
    objective: 'Run LocalCoder.',
    planExcerpt: 'First loop.',
    contextSummary: 'Adapter proof.',
    codeAnchors: ['apps/backend/src/coder'],
    cbmQueries: ['search_graph LocalCoder'],
    guardrails: ['No fake success.'],
    allowedFiles: ['apps/backend/src/coder/**'],
    forbiddenWork: ['No specs/.'],
    proofRequired: ['Compile.'],
    reportFormat: 'CoderReport JSON',
    stopConditions: ['Stop after one job.'],
  };
}

function structuredStdout(): string {
  return JSON.stringify({
    structured_output: {
      coderPacketId: 'packet-1',
      status: 'succeeded',
      summary: 'Done.',
      specComparison: [],
      filesChanged: [],
      proofCommands: [],
      proofResults: [],
      failedCommands: [],
      blockers: [],
      assumptions: [],
      nextRecommendedTask: 'Wire UI.',
      rawOutput: '',
    },
  });
}

// A schema-valid stdio MCP server using the running node binary (absolute,
// exists, resolvable) so the default fixture passes MCP flags.
const VALID_MCP_CONFIG = JSON.stringify({
  mcpServers: { local: { type: 'stdio', command: process.execPath, args: [] } },
});

/**
 * A built + installed vendored runtime under a fresh workspace root.
 * `mcpConfig`: JSON string to write as apps/backend/mcp.config.json,
 * or null to omit the file entirely.
 */
function createRuntimeFixture(mcpConfig: string | null = VALID_MCP_CONFIG): string {
  const root = path.join(tmpdir(), `liquidaity-localcoder-${Date.now()}-${Math.random()}`);
  const requiredFiles = [
    'localcoder/package.json',
    'localcoder/bin/openclaude',
    'localcoder/dist/cli.mjs',
    'apps/backend/.env',
  ];
  for (const file of requiredFiles) {
    const absolute = path.join(root, file);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, '{}');
  }
  if (mcpConfig !== null) {
    const mcpPath = path.join(root, 'apps/backend/mcp.config.json');
    mkdirSync(path.dirname(mcpPath), { recursive: true });
    writeFileSync(mcpPath, mcpConfig);
  }
  mkdirSync(path.join(root, 'localcoder/node_modules'), { recursive: true });
  return root;
}

/** A bare workspace root with NO vendored build (no node_modules/dist). */
function createBareWorkspace(): string {
  const root = path.join(tmpdir(), `liquidaity-bare-${Date.now()}-${Math.random()}`);
  mkdirSync(root, { recursive: true });
  return root;
}

/** A standalone OpenClaude launcher script the adapter can run via `node`. */
function createLauncherScript(): string {
  const dir = path.join(tmpdir(), `liquidaity-cli-${Date.now()}-${Math.random()}`);
  mkdirSync(dir, { recursive: true });
  const scriptPath = path.join(dir, 'openclaude.mjs');
  writeFileSync(scriptPath, 'process.exit(0);');
  return scriptPath;
}

/** A directory holding an `openclaude` command discoverable on PATH. */
function createPathDir(): string {
  const dir = path.join(tmpdir(), `liquidaity-path-${Date.now()}-${Math.random()}`);
  mkdirSync(dir, { recursive: true });
  const name = process.platform === 'win32' ? 'openclaude.CMD' : 'openclaude';
  writeFileSync(path.join(dir, name), '');
  return dir;
}

const versionOk = async () => ({
  started: true,
  exitCode: 0,
  stdout: 'openclaude 0.5.2',
  stderr: '',
});

describe('LocalCoderAdapter', () => {
  it('walks up to the monorepo root that holds PLAN.md and apps/backend', () => {
    const root = path.join(tmpdir(), `liquidaity-root-${Date.now()}-${Math.random()}`);
    const startPath = path.join(root, 'apps', 'backend', 'src', 'coder');
    mkdirSync(startPath, { recursive: true });
    writeFileSync(path.join(root, 'PLAN.md'), '# plan');
    expect(resolveLocalCoderWorkspaceRoot(startPath)).toBe(path.resolve(root));
  });

  it('returns an exact blocked report with vendored missing deps when nothing is runnable', async () => {
    const root = createBareWorkspace();
    const adapter = new LocalCoderAdapter({
      workspaceRoot: root,
      env: { PATH: '', OPENAI_API_KEY: 'key', OPENAI_MODEL: 'gpt-5.3-codex' },
    });
    const report = await adapter.run(packet(root));
    expect(report.status).toBe('blocked');
    expect(report.blockers.join(' ')).toContain('localcoder_package_missing');
    expect(report.blockers.join(' ')).toContain('localcoder_dist_entrypoint_missing');
    expect(report.blockers.join(' ')).toContain('localcoder_node_modules_missing');
  });

  it('prefers an explicit LOCALCODER_COMMAND over other sources', async () => {
    const root = createBareWorkspace();
    const script = createLauncherScript();
    let usedArgs: string[] = [];
    const adapter = new LocalCoderAdapter({
      workspaceRoot: root,
      env: {
        PATH: '',
        LOCALCODER_COMMAND: `node ${script}`,
        OPENCLAUDE_COMMAND: 'node /should/not/win.mjs',
        OPENAI_API_KEY: 'key',
        OPENAI_MODEL: 'gpt-5.3-codex',
      },
      runProcess: async (command, args) => {
        expect(command).toBe(process.execPath);
        expect(args[0]).toBe(script);
        usedArgs = args;
        return { started: true, exitCode: 0, stdout: structuredStdout(), stderr: '' };
      },
    });
    const report = await adapter.run(packet(root));
    expect(report.status).toBe('succeeded');
    expect(usedArgs).toContain('--print');
    expect(usedArgs).toContain('--json-schema');
  });

  it('accepts an explicit OPENCLAUDE_COMMAND when LOCALCODER_* is unset', async () => {
    const root = createBareWorkspace();
    const script = createLauncherScript();
    const adapter = new LocalCoderAdapter({
      workspaceRoot: root,
      env: {
        PATH: '',
        OPENCLAUDE_COMMAND: `node ${script}`,
        OPENAI_API_KEY: 'key',
        OPENAI_MODEL: 'gpt-5.3-codex',
      },
      runProcess: async (command, args) => {
        expect(command).toBe(process.execPath);
        expect(args[0]).toBe(script);
        return { started: true, exitCode: 0, stdout: structuredStdout(), stderr: '' };
      },
    });
    const report = await adapter.run(packet(root));
    expect(report.status).toBe('succeeded');
  });

  it('does not block a valid explicit command just because vendored deps are missing', async () => {
    const root = createBareWorkspace();
    const script = createLauncherScript();
    const adapter = new LocalCoderAdapter({
      workspaceRoot: root,
      env: {
        PATH: '',
        LOCALCODER_COMMAND: `node ${script}`,
        OPENAI_API_KEY: 'key',
        OPENAI_MODEL: 'gpt-5.3-codex',
      },
      runProcess: versionOk,
    });
    const inspection = await adapter.inspectRuntime(root);
    expect(inspection.ready).toBe(true);
    expect(inspection.source).toBe('explicit_command');
  });

  it('blocks loudly when an explicit command points at a missing script', async () => {
    const root = createBareWorkspace();
    const adapter = new LocalCoderAdapter({
      workspaceRoot: root,
      env: {
        PATH: '',
        LOCALCODER_COMMAND: 'node C:/does/not/exist/openclaude.mjs',
        OPENAI_API_KEY: 'key',
        OPENAI_MODEL: 'gpt-5.3-codex',
      },
    });
    const report = await adapter.run(packet(root));
    expect(report.status).toBe('blocked');
    expect(report.blockers.join(' ')).toContain('localcoder_explicit_command_script_not_found');
  });

  it('accepts an openclaude command discovered on PATH', async () => {
    const root = createBareWorkspace();
    const pathDir = createPathDir();
    let sawCommand = '';
    const adapter = new LocalCoderAdapter({
      workspaceRoot: root,
      env: {
        PATH: pathDir,
        PATHEXT: '.CMD',
        OPENAI_API_KEY: 'key',
        OPENAI_MODEL: 'gpt-5.3-codex',
      },
      runProcess: async (command, args) => {
        sawCommand = command;
        expect(args).toContain('--print');
        return { started: true, exitCode: 0, stdout: structuredStdout(), stderr: '' };
      },
    });
    const report = await adapter.run(packet(root));
    expect(report.status).toBe('succeeded');
    expect(sawCommand.toLowerCase()).toContain('openclaude');
  });

  it('reports ready from a safe --version probe for a PATH command', async () => {
    const root = createBareWorkspace();
    const pathDir = createPathDir();
    let probeArgs: string[] = [];
    const adapter = new LocalCoderAdapter({
      workspaceRoot: root,
      env: {
        PATH: pathDir,
        PATHEXT: '.CMD',
        OPENAI_API_KEY: 'key',
        OPENAI_MODEL: 'gpt-5.3-codex',
      },
      runProcess: async (_command, args) => {
        probeArgs = args;
        return { started: true, exitCode: 0, stdout: 'v1', stderr: '' };
      },
    });
    const inspection = await adapter.inspectRuntime(root);
    expect(inspection.ready).toBe(true);
    expect(inspection.source).toBe('path_openclaude');
    expect(probeArgs).toContain('--version');
    // Status detection must never run a coding job.
    expect(probeArgs).not.toContain('--print');
  });

  it('blocks status when the command fails safe --version and --help detection', async () => {
    const root = createBareWorkspace();
    const script = createLauncherScript();
    const adapter = new LocalCoderAdapter({
      workspaceRoot: root,
      env: {
        PATH: '',
        LOCALCODER_COMMAND: `node ${script}`,
        OPENAI_API_KEY: 'key',
        OPENAI_MODEL: 'gpt-5.3-codex',
      },
      runProcess: async () => ({ started: true, exitCode: 1, stdout: '', stderr: 'bad flag' }),
    });
    const inspection = await adapter.inspectRuntime(root);
    expect(inspection.ready).toBe(false);
    expect(inspection.missing.join(' ')).toContain('localcoder_safe_detection_failed');
  });

  it('accepts the built vendored runtime when no explicit/PATH command exists', async () => {
    const root = createRuntimeFixture();
    let invoked = false;
    const adapter = new LocalCoderAdapter({
      workspaceRoot: root,
      env: {
        PATH: '',
        OPENAI_API_KEY: 'key',
        OPENAI_MODEL: 'gpt-5.3-codex',
      },
      runProcess: async (command, args) => {
        invoked = true;
        expect(command).toBe(process.execPath);
        expect(args[0]).toBe(path.join(root, 'localcoder', 'bin', 'openclaude'));
        expect(args).toContain('--mcp-config');
        expect(args).toContain('--json-schema');
        return { started: true, exitCode: 0, stdout: structuredStdout(), stderr: '' };
      },
    });
    const report = await adapter.run(packet(root));
    expect(invoked).toBe(true);
    expect(report.status).toBe('succeeded');
    expect(report.rawOutput).toContain('structured_output');
  });

  it('never reports success when the real process does not start', async () => {
    const root = createRuntimeFixture();
    const adapter = new LocalCoderAdapter({
      workspaceRoot: root,
      env: { PATH: '', OPENAI_API_KEY: 'key', OPENAI_MODEL: 'gpt-5.3-codex' },
      runProcess: async () => ({
        started: false,
        exitCode: null,
        stdout: '',
        stderr: '',
        error: 'spawn failed',
      }),
    });
    const report = await adapter.run(packet(root));
    expect(report.status).toBe('blocked');
    expect(report.summary).toContain('localcoder_process_not_started');
  });

  it('returns failed (never succeeded) when the command exits non-zero', async () => {
    const root = createRuntimeFixture();
    const adapter = new LocalCoderAdapter({
      workspaceRoot: root,
      env: { PATH: '', OPENAI_API_KEY: 'key', OPENAI_MODEL: 'gpt-5.3-codex' },
      runProcess: async () => ({
        started: true,
        exitCode: 2,
        stdout: '{"structured_output":{}}',
        stderr: 'boom',
      }),
    });
    const report = await adapter.run(packet(root));
    expect(report.status).toBe('failed');
    expect(report.summary).toContain('localcoder_process_failed');
  });

  it('blocks when required env API keys are missing even with a runnable command', async () => {
    const root = createBareWorkspace();
    const script = createLauncherScript();
    const adapter = new LocalCoderAdapter({
      workspaceRoot: root,
      env: { PATH: '', LOCALCODER_COMMAND: `node ${script}` },
    });
    const report = await adapter.run(packet(root));
    expect(report.status).toBe('blocked');
    expect(report.blockers.join(' ')).toContain('localcoder_env_missing: OPENAI_API_KEY');
  });
});

describe('deriveLocalCoderPermissionMode', () => {
  it('selects plan for explicit writeMode read-only', () => {
    expect(deriveLocalCoderPermissionMode({ ...packet('C:/repo'), writeMode: 'read-only' })).toBe(
      'plan',
    );
  });

  it('selects acceptEdits only for explicit writeMode edit', () => {
    expect(deriveLocalCoderPermissionMode({ ...packet('C:/repo'), writeMode: 'edit' })).toBe(
      'acceptEdits',
    );
  });

  it('selects plan when forbiddenWork declares no file edits', () => {
    const p = { ...packet('C:/repo'), forbiddenWork: ['no file edits', 'no commits'] };
    expect(deriveLocalCoderPermissionMode(p)).toBe('plan');
  });

  it('selects plan when stopConditions say inspect only', () => {
    const p = { ...packet('C:/repo'), stopConditions: ['inspect only, return report only'] };
    expect(deriveLocalCoderPermissionMode(p)).toBe('plan');
  });

  it('defaults an ambiguous packet to plan (conservative, never silent edits)', () => {
    const p = {
      ...packet('C:/repo'),
      forbiddenWork: ['no specs/'],
      stopConditions: ['stop after one job'],
    };
    expect(p.writeMode).toBeUndefined();
    expect(deriveLocalCoderPermissionMode(p)).toBe('plan');
  });
});

describe('LocalCoderAdapter permission mode wiring', () => {
  function permModeOf(args: string[]): string | undefined {
    const i = args.indexOf('--permission-mode');
    return i >= 0 ? args[i + 1] : undefined;
  }

  async function runCapturingArgs(packetOverride: Partial<CoderPacket>): Promise<string[]> {
    const root = createRuntimeFixture();
    let captured: string[] = [];
    const adapter = new LocalCoderAdapter({
      workspaceRoot: root,
      env: { PATH: '', OPENAI_API_KEY: 'key', OPENAI_MODEL: 'gpt-5.3-codex' },
      runProcess: async (_command, args) => {
        captured = args;
        return { started: true, exitCode: 0, stdout: structuredStdout(), stderr: '' };
      },
    });
    await adapter.run({ ...packet(root), ...packetOverride });
    return captured;
  }

  it('passes --permission-mode plan for a read-only packet through run()', async () => {
    expect(permModeOf(await runCapturingArgs({ writeMode: 'read-only' }))).toBe('plan');
  });

  it('passes --permission-mode acceptEdits for an edit packet through run()', async () => {
    expect(permModeOf(await runCapturingArgs({ writeMode: 'edit' }))).toBe('acceptEdits');
  });

  it('passes --permission-mode plan for a no-edit-language packet through run()', async () => {
    expect(
      permModeOf(await runCapturingArgs({ forbiddenWork: ['no file edits', 'no pushes'] })),
    ).toBe('plan');
  });
});

describe('LocalCoderAdapter MCP config handling', () => {
  type Capture = { args: string[]; mcpConfigContent: string | null };

  async function runWithFixtureMcp(
    mcpConfig: string | null,
    env: Record<string, string> = {},
  ): Promise<{ capture: Capture; report: Awaited<ReturnType<LocalCoderAdapter['run']>> }> {
    const root = createRuntimeFixture(mcpConfig);
    const capture: Capture = { args: [], mcpConfigContent: null };
    const adapter = new LocalCoderAdapter({
      workspaceRoot: root,
      env: { PATH: '', OPENAI_API_KEY: 'key', OPENAI_MODEL: 'gpt-5.3-codex', ...env },
      runProcess: async (_command, args) => {
        capture.args = args;
        const idx = args.indexOf('--mcp-config');
        if (idx >= 0) capture.mcpConfigContent = readFileSync(args[idx + 1], 'utf8');
        return { started: true, exitCode: 0, stdout: structuredStdout(), stderr: '' };
      },
    });
    const report = await adapter.run(packet(root));
    return { capture, report };
  }

  it('passes MCP flags for a valid OpenClaude-compatible config', async () => {
    const { capture, report } = await runWithFixtureMcp(VALID_MCP_CONFIG);
    expect(capture.args).toContain('--mcp-config');
    expect(capture.args).toContain('--strict-mcp-config');
    expect(report.assumptions.join(' ')).toContain('localcoder_mcp_config_normalized');
  });

  it('transforms backend transport:"sse" into OpenClaude type:"sse" when the url resolves', async () => {
    const backendConfig = JSON.stringify({
      mcpServers: { remote: { transport: 'sse', url: '${SMOKE_MCP_URL}', headers: { Authorization: 'Bearer x' } } },
    });
    const { capture } = await runWithFixtureMcp(backendConfig, { SMOKE_MCP_URL: 'https://mcp.example/sse' });
    expect(capture.args).toContain('--mcp-config');
    const parsed = JSON.parse(capture.mcpConfigContent || '{}');
    expect(parsed.mcpServers.remote.type).toBe('sse');
    expect(parsed.mcpServers.remote.transport).toBeUndefined();
    expect(parsed.mcpServers.remote.url).toBe('https://mcp.example/sse');
  });

  it('omits MCP flags and records the reason when every server is invalid', async () => {
    const invalidConfig = JSON.stringify({
      mcpServers: {
        github: { transport: 'sse', url: '${UNSET_GITHUB_MCP_URL}' },
        tavily: { transport: 'http', url: '${UNSET_TAVILY_MCP_URL}' },
      },
    });
    const { capture, report } = await runWithFixtureMcp(invalidConfig);
    expect(capture.args).not.toContain('--mcp-config');
    expect(capture.args).not.toContain('--strict-mcp-config');
    expect(report.status).toBe('succeeded');
    expect(report.assumptions.join(' ')).toContain('localcoder_mcp_config_omitted');
    expect(report.assumptions.join(' ')).toContain('unresolved env placeholder');
  });

  it('keeps the valid server and drops the unresolvable one', async () => {
    const mixedConfig = JSON.stringify({
      mcpServers: {
        local: { type: 'stdio', command: process.execPath, args: [] },
        github: { transport: 'sse', url: '${UNSET_GITHUB_MCP_URL}' },
      },
    });
    const { capture, report } = await runWithFixtureMcp(mixedConfig);
    expect(capture.args).toContain('--mcp-config');
    const parsed = JSON.parse(capture.mcpConfigContent || '{}');
    expect(Object.keys(parsed.mcpServers)).toEqual(['local']);
    expect(report.assumptions.join(' ')).toContain('kept [local]');
    expect(report.assumptions.join(' ')).toContain('dropped');
  });

  it('does not fail the run when the MCP config has no servers', async () => {
    const { capture, report } = await runWithFixtureMcp('{}');
    expect(capture.args).not.toContain('--mcp-config');
    expect(report.status).toBe('succeeded');
    expect(report.assumptions.join(' ')).toContain('localcoder_mcp_config_omitted');
  });

  it('does not fail the run when the MCP config file is missing', async () => {
    const { capture, report } = await runWithFixtureMcp(null);
    expect(capture.args).not.toContain('--mcp-config');
    expect(report.status).toBe('succeeded');
    expect(report.assumptions.join(' ')).toContain('localcoder_mcp_config_absent');
  });
});
