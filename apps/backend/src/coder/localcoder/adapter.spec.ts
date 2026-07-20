import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import type { CoderPacket } from '../../contracts/coderContracts';
import type { LocalCoderCbmScopeGateResult } from '../../services/graphContext/cbmScopeGate';
import {
  LocalCoderAdapter,
  deriveLocalCoderPermissionMode,
  resolveLocalCoderWorkspaceRoot,
} from './adapter';
import { LocalCoderService } from './service';

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
      outOfScopeFindings: [],
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

function createHungLauncherScript(): string {
  const dir = path.join(tmpdir(), `liquidaity-cli-hung-${Date.now()}-${Math.random()}`);
  mkdirSync(dir, { recursive: true });
  const scriptPath = path.join(dir, 'openclaude.mjs');
  writeFileSync(scriptPath, 'setInterval(() => {}, 1000);');
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

  it('applies a bounded run timeout and returns failed when the process times out', async () => {
    const root = createRuntimeFixture();
    let timeoutMs: number | undefined;
    const adapter = new LocalCoderAdapter({
      workspaceRoot: root,
      env: {
        PATH: '',
        OPENAI_API_KEY: 'key',
        OPENAI_MODEL: 'gpt-5.3-codex',
        LOCALCODER_RUN_TIMEOUT_MS: '2500',
      },
      runProcess: async (_command, _args, options) => {
        timeoutMs = options.timeoutMs;
        return {
          started: true,
          exitCode: null,
          stdout: '',
          stderr: '',
          error: 'process_timeout_after_2500ms',
        };
      },
    });

    const { report, runtimeDiagnostics } = await adapter.runWithDiagnostics(packet(root));

    expect(timeoutMs).toBe(2500);
    expect(report.status).toBe('failed');
    expect(report.summary).toBe('localcoder_process_failed: process_timeout_after_2500ms');
    expect(runtimeDiagnostics.runtimeStage).toBe('process_timeout');
  });

  it('returns bounded redacted argv/process diagnostics without exposing the prompt or MCP temp path', async () => {
    const root = createRuntimeFixture();
    const adapter = new LocalCoderAdapter({
      workspaceRoot: root,
      env: { PATH: '', OPENAI_API_KEY: 'secret-key', OPENAI_MODEL: 'gpt-5.3-codex' },
      runProcess: async () => ({
        started: true,
        exitCode: 0,
        stdout: structuredStdout(),
        stderr: '',
        firstStdoutAt: '2026-06-13T12:00:00.000Z',
        exitSignal: null,
        timeoutKilled: false,
      }),
    });

    const { runtimeDiagnostics } = await adapter.runWithDiagnostics(packet(root));

    expect(runtimeDiagnostics.runtimeStage).toBe('completed');
    expect(runtimeDiagnostics.promptDelivery).toBe('argv');
    expect(runtimeDiagnostics.stdinClosed).toBe(true);
    expect(runtimeDiagnostics.provider).toBe('openai');
    expect(runtimeDiagnostics.model).toBe('gpt-5.3-codex');
    expect(runtimeDiagnostics.mcpConfigPassed).toBe(true);
    expect(runtimeDiagnostics.firstStdoutAt).toBe('2026-06-13T12:00:00.000Z');
    expect(runtimeDiagnostics.argvShape.join(' ')).toContain('<prompt:');
    expect(runtimeDiagnostics.argvShape).toContain('<coder-report-schema>');
    expect(runtimeDiagnostics.argvShape).toContain('<generated-mcp-config>');
    expect(runtimeDiagnostics.argvShape.join(' ')).not.toContain('Execute this LiquidAIty CoderPacket');
    expect(runtimeDiagnostics.argvShape.join(' ')).not.toContain('grpc');
    expect(JSON.stringify(runtimeDiagnostics)).not.toContain('secret-key');
  });

  it('blocks before spawn when the argv prompt exceeds the owned Windows-safe bound', async () => {
    const root = createRuntimeFixture();
    const runProcess = vi.fn();
    const adapter = new LocalCoderAdapter({
      workspaceRoot: root,
      env: { PATH: '', OPENAI_API_KEY: 'key', OPENAI_MODEL: 'gpt-5.3-codex' },
      runProcess,
    });

    const { report, runtimeDiagnostics } = await adapter.runWithDiagnostics({
      ...packet(root),
      objective: 'x'.repeat(20_000),
    });

    expect(runProcess).not.toHaveBeenCalled();
    expect(report.status).toBe('blocked');
    expect(report.summary).toContain('localcoder_argv_prompt_too_large');
    expect(runtimeDiagnostics.runtimeStage).toBe('prompt_bounds');
  });

  it('kills a real child process on timeout and records stage evidence', async () => {
    const root = createBareWorkspace();
    const script = createHungLauncherScript();
    const adapter = new LocalCoderAdapter({
      workspaceRoot: root,
      env: {
        PATH: '',
        LOCALCODER_COMMAND: `node ${script}`,
        OPENAI_API_KEY: 'key',
        OPENAI_MODEL: 'gpt-5.3-codex',
        LOCALCODER_RUN_TIMEOUT_MS: '1000',
      },
      diagnosticMcpMode: 'disabled',
    });

    const { report, runtimeDiagnostics } = await adapter.runWithDiagnostics(packet(root));

    expect(report.status).toBe('failed');
    expect(runtimeDiagnostics.runtimeStage).toBe('process_timeout');
    expect(runtimeDiagnostics.timeoutKilled).toBe(true);
    expect(runtimeDiagnostics.exitCode).not.toBe(0);
  }, 10_000);

  it('captures a missing context-window warning without claiming it caused the timeout', async () => {
    const root = createRuntimeFixture();
    const adapter = new LocalCoderAdapter({
      workspaceRoot: root,
      env: { PATH: '', OPENAI_API_KEY: 'key', OPENAI_MODEL: 'gpt-5.1-chat-latest' },
      runProcess: async () => ({
        started: true,
        exitCode: null,
        stdout: '',
        stderr: 'Warning: gpt-5.1-chat-latest is missing from context-window table',
        error: 'process_timeout_after_30000ms',
        timeoutKilled: true,
      }),
    });

    const { runtimeDiagnostics } = await adapter.runWithDiagnostics(packet(root));

    expect(runtimeDiagnostics.runtimeStage).toBe('process_timeout');
    expect(runtimeDiagnostics.warningLines).toEqual([
      'Warning: gpt-5.1-chat-latest is missing from context-window table',
    ]);
    expect(JSON.stringify(runtimeDiagnostics)).not.toContain('caused');
  });

  it('starts strict JSON validation and cannot fake success from malformed output', async () => {
    const root = createRuntimeFixture();
    const adapter = new LocalCoderAdapter({
      workspaceRoot: root,
      env: { PATH: '', OPENAI_API_KEY: 'key', OPENAI_MODEL: 'gpt-5.3-codex' },
      runProcess: async () => ({
        started: true,
        exitCode: 0,
        stdout: JSON.stringify({ structured_output: { status: 'succeeded' } }),
        stderr: '',
      }),
    });

    const { report, runtimeDiagnostics } = await adapter.runWithDiagnostics(packet(root));

    expect(report.status).toBe('failed');
    expect(runtimeDiagnostics.jsonParseStarted).toBe(true);
    expect(runtimeDiagnostics.coderReportValidationStarted).toBe(true);
    expect(runtimeDiagnostics.runtimeStage).toBe('coder_report_validation');
    expect(runtimeDiagnostics.validCoderReportReturned).toBe(false);
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

  it('defaults to plan when writeMode is absent', () => {
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

  /** Create the resolved liquidaity host layout under a fixture root (dummy files;
   * the adapter only existsSync-checks them) and run, capturing the generated MCP
   * config. Proves the card-Coder connects the SAME one Python MCP host the
   * chat-Coder gets, so write_mag_one_instructions/read_model_results reach both. */
  async function runWithLiquidaityHost(mcpConfig: string | null): Promise<{
    mcpContent: string;
    report: Awaited<ReturnType<LocalCoderAdapter['run']>>;
    pyExe: string;
    hostPath: string;
  }> {
    const root = createRuntimeFixture(mcpConfig);
    const pyExe = path.join(root, 'apps', 'python-models', '.venv', 'Scripts', 'python.exe');
    const hostPath = path.join(root, 'apps', 'python-models', 'app', 'mcp_host.py');
    mkdirSync(path.dirname(pyExe), { recursive: true });
    writeFileSync(pyExe, '');
    mkdirSync(path.dirname(hostPath), { recursive: true });
    writeFileSync(hostPath, '# host');
    let mcpContent = '';
    const adapter = new LocalCoderAdapter({
      workspaceRoot: root,
      env: { PATH: '', OPENAI_API_KEY: 'key', OPENAI_MODEL: 'gpt-5.3-codex' },
      runProcess: async (_command, args) => {
        const idx = args.indexOf('--mcp-config');
        if (idx >= 0) mcpContent = readFileSync(args[idx + 1], 'utf8');
        return { started: true, exitCode: 0, stdout: structuredStdout(), stderr: '' };
      },
    });
    const report = await adapter.run(packet(root));
    return { mcpContent, report, pyExe, hostPath };
  }

  it('injects the one liquidaity Python MCP host so the card-Coder shares the chat-Coder tool surface', async () => {
    const { mcpContent, report, pyExe, hostPath } = await runWithLiquidaityHost(VALID_MCP_CONFIG);
    expect(report.status).toBe('succeeded');
    const parsed = JSON.parse(mcpContent);
    expect(parsed.mcpServers.liquidaity).toEqual({ type: 'stdio', command: pyExe, args: [hostPath] });
    expect(report.assumptions.join(' ')).toContain('localcoder_mcp_liquidaity_injected');
  });

  it('injects the liquidaity host even when mcp.config.json is absent — the card-Coder always gets it', async () => {
    const { mcpContent, report } = await runWithLiquidaityHost(null);
    expect(report.status).toBe('succeeded');
    const parsed = JSON.parse(mcpContent);
    expect(Object.keys(parsed.mcpServers)).toEqual(['liquidaity']);
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

  it('supports only an explicit diagnostic MCP-disabled mode and records it visibly', async () => {
    const root = createRuntimeFixture(VALID_MCP_CONFIG);
    let capturedArgs: string[] = [];
    const adapter = new LocalCoderAdapter({
      workspaceRoot: root,
      env: { PATH: '', OPENAI_API_KEY: 'key', OPENAI_MODEL: 'gpt-5.3-codex' },
      diagnosticMcpMode: 'disabled',
      runProcess: async (_command, args) => {
        capturedArgs = args;
        return { started: true, exitCode: 0, stdout: structuredStdout(), stderr: '' };
      },
    });

    const { report, runtimeDiagnostics } = await adapter.runWithDiagnostics(packet(root));

    expect(capturedArgs).not.toContain('--mcp-config');
    expect(runtimeDiagnostics.mcpMode).toBe('disabled');
    expect(runtimeDiagnostics.mcpConfigPassed).toBe(false);
    expect(report.assumptions).toContain('localcoder_mcp_diagnostic_disabled_explicit');
  });
});

describe('LocalCoderService structural edit-scope gate', () => {
  const okGate: LocalCoderCbmScopeGateResult = {
    sourceRoot: 'C:/Projects/main',
    scopeStatus: 'ok',
    editAllowed: true,
    blockedReason: '',
  };

  it('does not invoke the process adapter when the structural edit-scope is blocked', async () => {
    const run = vi.fn(async () => {
      throw new Error('adapter must not run');
    });
    const service = new LocalCoderService(
      { inspectRuntime: vi.fn(), run },
      async () => ({
        ...okGate,
        scopeStatus: 'blocked' as const,
        editAllowed: false,
        blockedReason: 'edit_scope_root_not_found: /nonexistent',
      }),
    );

    const result = await service.run({ ...packet(process.cwd()), writeMode: 'read-only' });

    expect(run).not.toHaveBeenCalled();
    expect(result.report.status).toBe('blocked');
    expect(result.report.blockers).toContain('edit_scope_root_not_found: /nonexistent');
    expect(result.cbmScopeGate.editAllowed).toBe(false);
  });

  it('invokes the process adapter only after the CBM scope gate allows it', async () => {
    const run = vi.fn(async () => ({
      coderPacketId: 'packet-1',
      status: 'succeeded' as const,
      summary: 'Done.',
      specComparison: [],
      filesChanged: [],
      proofCommands: [],
      proofResults: [],
      failedCommands: [],
      blockers: [],
      assumptions: [],
      outOfScopeFindings: [],
      nextRecommendedTask: '',
      rawOutput: '',
    }));
    const service = new LocalCoderService(
      { inspectRuntime: vi.fn(), run },
      async () => okGate,
    );

    const result = await service.run({ ...packet(process.cwd()), writeMode: 'read-only' });

    expect(run).toHaveBeenCalledOnce();
    expect(result.report.status).toBe('succeeded');
    expect(result.cbmScopeGate.editAllowed).toBe(true);
  });

  it('propagates owned adapter runtime diagnostics separately from the strict CoderReport', async () => {
    const report = {
      coderPacketId: 'packet-1',
      status: 'failed' as const,
      summary: 'localcoder_process_failed: process_timeout_after_30000ms',
      specComparison: [],
      filesChanged: [],
      proofCommands: [],
      proofResults: [],
      failedCommands: [],
      blockers: ['timeout'],
      assumptions: [],
      outOfScopeFindings: [],
      nextRecommendedTask: '',
      rawOutput: '',
    };
    const runtimeDiagnostics = {
      commandPath: 'node openclaude',
      argvShape: ['--print', '<prompt:100 chars>'],
      workingDirectory: process.cwd(),
      provider: 'openai',
      model: 'gpt-5.1-chat-latest',
      permissionMode: 'plan' as const,
      timeoutMs: 30_000,
      promptDelivery: 'argv' as const,
      promptLength: 100,
      stdinClosed: true as const,
      mcpMode: 'production' as const,
      mcpConfigPassed: true,
      firstStdoutAt: null,
      firstStderrAt: '2026-06-13T12:00:00.000Z',
      lastStdoutLine: '',
      lastStderrLine: 'warning',
      exitCode: null,
      exitSignal: null,
      timeoutKilled: true,
      jsonParseStarted: false,
      coderReportValidationStarted: false,
      runtimeStage: 'process_timeout' as const,
      warningLines: ['warning'],
      validCoderReportReturned: false,
    };
    const service = new LocalCoderService(
      {
        inspectRuntime: vi.fn(),
        run: vi.fn(async () => report),
        runWithDiagnostics: vi.fn(async () => ({ report, runtimeDiagnostics })),
      },
      async () => okGate,
    );

    const result = await service.run({ ...packet(process.cwd()), writeMode: 'read-only' });

    expect(result.report).toEqual(report);
    expect(result.runtimeDiagnostics).toEqual(runtimeDiagnostics);
    expect(result.report).not.toHaveProperty('runtimeDiagnostics');
  });
});
