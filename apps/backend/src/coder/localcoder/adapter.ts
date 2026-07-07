import { spawn } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  coderReportJsonSchema,
  coderReportSchema,
  type CoderPacket,
  type CoderReport,
} from '../../contracts/coderContracts';

export type ProcessResult = {
  started: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  error?: string;
  firstStdoutAt?: string | null;
  firstStderrAt?: string | null;
  lastStdoutLine?: string;
  lastStderrLine?: string;
  exitSignal?: NodeJS.Signals | null;
  timeoutKilled?: boolean;
};

type RunProcessOptions = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  shell?: boolean;
  timeoutMs?: number;
};

export type RunProcess = (
  command: string,
  args: string[],
  options: RunProcessOptions,
) => Promise<ProcessResult>;

/**
 * A LocalCoder/OpenClaude command the backend can actually spawn.
 *
 * `command` is the executable handed to `spawn`; `baseArgs` are the prefix
 * arguments that must precede every job/probe argument (for example the
 * vendored `bin/openclaude` script path when the command is `node`).
 */
type ResolvedRuntime =
  | {
      ready: true;
      source: RuntimeSource;
      command: string;
      baseArgs: string[];
      describe: string;
      shell: boolean;
    }
  | {
      ready: false;
      missing: string[];
    };

export type RuntimeSource =
  | 'explicit_command'
  | 'path_openclaude'
  | 'vendored_built'
  | 'none';

/**
 * A runnable OpenClaude command resolved for the Console Bridge. Unlike the
 * one-shot job path, the bridge owns the spawned process directly (long-lived,
 * streamed), so it needs the raw command/baseArgs/shell rather than a built
 * argv. `envMissing` is advisory: an interactive/help session may start without
 * provider keys, but a real `print`/`task` run cannot.
 */
export type ConsoleRuntimeResolution =
  | {
      ready: true;
      command: string;
      baseArgs: string[];
      describe: string;
      shell: boolean;
      source: RuntimeSource;
      envMissing: string[];
    }
  | { ready: false; missing: string[] };

export type LocalCoderRuntimeInspection = {
  ready: boolean;
  source: RuntimeSource;
  command: string;
  rootPath: string;
  entrypoint: string;
  missing: string[];
  setupCommand: string;
};

export type LocalCoderAdapterOptions = {
  workspaceRoot?: string;
  env?: NodeJS.ProcessEnv;
  runProcess?: RunProcess;
  diagnosticMcpMode?: 'production' | 'disabled';
};

export type LocalCoderRuntimeStage =
  | 'preflight'
  | 'prompt_bounds'
  | 'process_not_started'
  | 'process_timeout'
  | 'process_exit_failed'
  | 'json_parse'
  | 'coder_report_validation'
  | 'completed';

export type LocalCoderRuntimeDiagnostics = {
  commandPath: string;
  argvShape: string[];
  workingDirectory: string;
  provider: string;
  model: string;
  permissionMode: LocalCoderPermissionMode;
  timeoutMs: number;
  promptDelivery: 'argv';
  promptLength: number;
  stdinClosed: true;
  mcpMode: 'production' | 'disabled';
  mcpConfigPassed: boolean;
  firstStdoutAt: string | null;
  firstStderrAt: string | null;
  lastStdoutLine: string;
  lastStderrLine: string;
  exitCode: number | null;
  exitSignal: NodeJS.Signals | null;
  timeoutKilled: boolean;
  jsonParseStarted: boolean;
  coderReportValidationStarted: boolean;
  runtimeStage: LocalCoderRuntimeStage;
  warningLines: string[];
  validCoderReportReturned: boolean;
};

const EXPLICIT_ENV_NAMES = [
  'LOCALCODER_COMMAND',
  'LOCALCODER_BIN',
  'OPENCLAUDE_COMMAND',
  'OPENCLAUDE_BIN',
] as const;

const WINDOWS_EXEC_EXTENSIONS = ['.exe', '.cmd', '.bat', '.com'];
const DEFAULT_LOCALCODER_RUN_TIMEOUT_MS = 300_000;
const MAX_LOCALCODER_ARGV_PROMPT_CHARS = 16_000;
const MAX_DIAGNOSTIC_LINE_CHARS = 500;

function localCoderRunTimeoutMs(env: NodeJS.ProcessEnv): number {
  const configured = Number.parseInt(String(env.LOCALCODER_RUN_TIMEOUT_MS || ''), 10);
  if (!Number.isFinite(configured)) return DEFAULT_LOCALCODER_RUN_TIMEOUT_MS;
  return Math.max(1_000, Math.min(3_600_000, configured));
}

export function resolveLocalCoderWorkspaceRoot(startPath: string): string {
  let candidate = path.resolve(startPath);
  while (true) {
    if (
      existsSync(path.join(candidate, 'PLAN.md')) &&
      existsSync(path.join(candidate, 'apps', 'backend'))
    ) {
      return candidate;
    }
    const parent = path.dirname(candidate);
    if (parent === candidate) return path.resolve(startPath);
    candidate = parent;
  }
}

function buildSetupCommand(rootPath: string): string {
  const binPath = path.join(rootPath, 'bin', 'openclaude');
  return [
    `Set LOCALCODER_COMMAND to a runnable OpenClaude CLI (e.g. "node ${binPath}" or an "openclaude" on PATH),`,
    `or build the vendored runtime: cd "${rootPath}"; bun install; bun run build`,
  ].join(' ');
}

function pathExtensions(env: NodeJS.ProcessEnv): string[] {
  if (process.platform !== 'win32') return [''];
  const raw = String(env.PATHEXT || '.EXE;.CMD;.BAT;.COM');
  return ['', ...raw.split(';').map((ext) => ext.trim()).filter(Boolean)];
}

function existsWithExtensions(basePath: string, env: NodeJS.ProcessEnv): string | null {
  for (const extension of pathExtensions(env)) {
    const candidateLower = `${basePath}${extension.toLowerCase()}`;
    if (existsSync(candidateLower)) return candidateLower;
    const candidateUpper = `${basePath}${extension.toUpperCase()}`;
    if (existsSync(candidateUpper)) return candidateUpper;
  }
  return null;
}

/** Resolve a command name or path to an existing executable file, or null. */
function resolveExecutablePath(name: string, env: NodeJS.ProcessEnv): string | null {
  const looksLikePath =
    path.isAbsolute(name) || name.includes('/') || name.includes('\\');
  if (looksLikePath) {
    if (existsSync(name)) return name;
    return existsWithExtensions(name, env);
  }
  const pathValue = String(env.PATH || env.Path || '').trim();
  if (!pathValue) return null;
  for (const directory of pathValue.split(path.delimiter)) {
    if (!directory) continue;
    const found = existsWithExtensions(path.join(directory, name), env);
    if (found) return found;
  }
  return null;
}

/** Split a command line into argv, honouring simple single/double quotes. */
function tokenizeCommand(input: string): string[] {
  const tokens: string[] = [];
  const matcher = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(input)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? '');
  }
  return tokens;
}

function hasExecutableExtension(resolvedPath: string): boolean {
  const ext = path.extname(resolvedPath).toLowerCase();
  return WINDOWS_EXEC_EXTENSIONS.includes(ext);
}

/** Extensionless launchers (the vendored shebang script) need `node` on win32. */
function needsNodePrefix(resolvedPath: string): boolean {
  if (hasExecutableExtension(resolvedPath)) return false;
  return process.platform === 'win32';
}

function isShellShim(resolvedPath: string): boolean {
  const ext = path.extname(resolvedPath).toLowerCase();
  return ext === '.cmd' || ext === '.bat';
}

async function runChildProcess(
  command: string,
  args: string[],
  options: RunProcessOptions,
): Promise<ProcessResult> {
  return await new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let firstStdoutAt: string | null = null;
    let firstStderrAt: string | null = null;
    let timedOut = false;
    let timeoutKilled = false;
    let settled = false;
    let timer: NodeJS.Timeout | null = null;
    let killFallbackTimer: NodeJS.Timeout | null = null;
    const finish = (result: ProcessResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (killFallbackTimer) clearTimeout(killFallbackTimer);
      resolve({
        ...result,
        firstStdoutAt,
        firstStderrAt,
        lastStdoutLine: lastBoundedLine(stdout),
        lastStderrLine: lastBoundedLine(stderr),
        timeoutKilled,
      });
    };
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      shell: options.shell ?? false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (options.timeoutMs && options.timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        timeoutKilled = child.kill();
        killFallbackTimer = setTimeout(() => {
          finish({
            started: true,
            exitCode: null,
            stdout,
            stderr,
            error: `process_timeout_after_${options.timeoutMs}ms`,
          });
        }, 5_000);
      }, options.timeoutMs);
    }
    child.stdout?.on('data', (chunk) => {
      if (!firstStdoutAt) firstStdoutAt = new Date().toISOString();
      stdout += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      if (!firstStderrAt) firstStderrAt = new Date().toISOString();
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      finish({ started: false, exitCode: null, stdout, stderr, error: error.message });
    });
    child.on('close', (exitCode, exitSignal) => {
      finish({
        started: true,
        exitCode,
        stdout,
        stderr,
        exitSignal,
        error: timedOut ? `process_timeout_after_${options.timeoutMs}ms` : undefined,
      });
    });
  });
}

function lastBoundedLine(value: string): string {
  const lines = value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  const line = lines.length > 0 ? lines[lines.length - 1] : '';
  return line.slice(0, MAX_DIAGNOSTIC_LINE_CHARS);
}

function warningLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /warn|context.?window|missing from/i.test(line))
    .slice(-10)
    .map((line) => line.slice(0, MAX_DIAGNOSTIC_LINE_CHARS));
}

function redactArgv(args: string[]): string[] {
  const redacted = [...args];
  const redactValueAfter = (flag: string, replacement: (value: string) => string) => {
    const index = redacted.indexOf(flag);
    if (index >= 0 && index + 1 < redacted.length) {
      redacted[index + 1] = replacement(redacted[index + 1]);
    }
  };
  redactValueAfter('--print', (value) => `<prompt:${value.length} chars>`);
  redactValueAfter('--json-schema', () => '<coder-report-schema>');
  redactValueAfter('--mcp-config', () => '<generated-mcp-config>');
  return redacted;
}

function buildBlockedReport(
  packetId: string,
  blocker: string,
  nextRecommendedTask: string,
  rawOutput = '',
): CoderReport {
  return {
    coderPacketId: packetId,
    status: 'blocked',
    summary: blocker,
    specComparison: [],
    filesChanged: [],
    proofCommands: [],
    proofResults: [],
    failedCommands: [],
    blockers: [blocker],
    assumptions: [],
    outOfScopeFindings: [],
    nextRecommendedTask,
    rawOutput,
  };
}

function buildFailedReport(packetId: string, error: string, rawOutput: string): CoderReport {
  return {
    coderPacketId: packetId,
    status: 'failed',
    summary: error,
    specComparison: [],
    filesChanged: [],
    proofCommands: [],
    proofResults: [],
    failedCommands: [],
    blockers: [error],
    assumptions: [],
    outOfScopeFindings: [],
    nextRecommendedTask: 'Inspect LocalCoder stderr and repair the runtime before retrying.',
    rawOutput,
  };
}

// OpenClaude (`localcoder/src/services/mcp/types.ts`) discriminates MCP servers
// by a `type` literal, NOT `transport`, and rejects anything else under
// `--strict-mcp-config`. These transports carry a `url`.
const MCP_URL_TRANSPORTS = new Set(['sse', 'sse-ide', 'http', 'ws']);

type McpPrepResult = { flags: string[]; note: string; tempPath: string | null };

/** Resolve `${VAR}` placeholders from env; flag any that cannot be resolved. */
function resolveEnvPlaceholders(
  node: unknown,
  env: NodeJS.ProcessEnv,
  state: { unresolved: boolean },
): unknown {
  if (typeof node === 'string') {
    return node.replace(/\$\{([A-Za-z0-9_]+)\}/g, (match, name: string) => {
      const value = env[name];
      if (value === undefined || String(value).trim() === '') {
        state.unresolved = true;
        return match;
      }
      return String(value);
    });
  }
  if (Array.isArray(node)) {
    return node.map((item) => resolveEnvPlaceholders(item, env, state));
  }
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      out[key] = resolveEnvPlaceholders(value, env, state);
    }
    return out;
  }
  return node;
}

/**
 * Normalize one backend MCP server entry into OpenClaude's `type`-discriminated
 * shape, or reject it with an exact reason. Drops servers with unresolved env
 * placeholders or unresolvable stdio commands so they cannot fail the run.
 */
function normalizeMcpServer(
  name: string,
  raw: unknown,
  env: NodeJS.ProcessEnv,
): { ok: true; value: Record<string, unknown> } | { ok: false; reason: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, reason: `${name}: not an object` };
  }
  const server = raw as Record<string, unknown>;
  const transport = String(server.type ?? server.transport ?? '').trim();
  if (!transport) return { ok: false, reason: `${name}: missing type/transport` };

  let built: Record<string, unknown>;
  if (transport === 'stdio') {
    const command = typeof server.command === 'string' ? server.command.trim() : '';
    if (!command) return { ok: false, reason: `${name}: stdio missing command` };
    built = { type: 'stdio', command, args: Array.isArray(server.args) ? server.args : [] };
    if (server.env && typeof server.env === 'object') built.env = server.env;
  } else if (MCP_URL_TRANSPORTS.has(transport)) {
    const url = typeof server.url === 'string' ? server.url.trim() : '';
    if (!url) return { ok: false, reason: `${name}: ${transport} missing url` };
    built = { type: transport, url };
    if (server.headers && typeof server.headers === 'object') built.headers = server.headers;
  } else {
    return { ok: false, reason: `${name}: unsupported transport "${transport}"` };
  }

  const state = { unresolved: false };
  const resolved = resolveEnvPlaceholders(built, env, state) as Record<string, unknown>;
  if (state.unresolved) {
    return { ok: false, reason: `${name}: unresolved env placeholder` };
  }
  if (transport === 'stdio' && !resolveExecutablePath(String(resolved.command), env)) {
    return { ok: false, reason: `${name}: stdio command not found: ${String(resolved.command)}` };
  }
  return { ok: true, value: resolved };
}

export type LocalCoderPermissionMode = 'plan' | 'acceptEdits';

/**
 * Derive the OpenClaude permission mode from the CoderPacket. Conservative by
 * default: a packet only edits files when it explicitly declares
 * `writeMode: 'edit'`. Read-only is selected for `writeMode: 'read-only'`
 * or by default.
 */
export function deriveLocalCoderPermissionMode(packet: CoderPacket): LocalCoderPermissionMode {
  if (packet.writeMode === 'read-only') return 'plan';
  if (packet.writeMode === 'edit') return 'acceptEdits';
  return 'plan';
}

function buildCoderPrompt(packet: CoderPacket): string {
  return [
    'Execute this LiquidAIty CoderPacket as the complete spec and task.',
    'Use repository tools and return only the requested structured CoderReport.',
    'Do not claim success without actual edits and proof. Stop at the packet stop conditions.',
    JSON.stringify(packet, null, 2),
  ].join('\n\n');
}

function parseLocalCoderOutput(
  stdout: string,
  packetId: string,
): {
  report: CoderReport | null;
  jsonParseStarted: boolean;
  coderReportValidationStarted: boolean;
} {
  let coderReportValidationStarted = false;
  try {
    const envelope = JSON.parse(stdout) as Record<string, unknown>;
    const candidates = [
      envelope.structured_output,
      envelope.result,
      envelope.output,
      envelope,
    ];
    for (const candidate of candidates) {
      const parsedCandidate =
        typeof candidate === 'string'
          ? (() => {
              try {
                return JSON.parse(candidate);
              } catch {
                return null;
              }
            })()
          : candidate;
      coderReportValidationStarted = true;
      const parsed = coderReportSchema.safeParse(parsedCandidate);
      if (parsed.success && parsed.data.coderPacketId === packetId) {
        return {
          report: { ...parsed.data, rawOutput: stdout },
          jsonParseStarted: true,
          coderReportValidationStarted,
        };
      }
    }
  } catch {
    return {
      report: null,
      jsonParseStarted: true,
      coderReportValidationStarted,
    };
  }
  return {
    report: null,
    jsonParseStarted: true,
    coderReportValidationStarted,
  };
}

function createRuntimeDiagnostics(
  packet: CoderPacket,
  workingDirectory: string,
  prompt: string,
  env: NodeJS.ProcessEnv,
  mcpMode: 'production' | 'disabled',
): LocalCoderRuntimeDiagnostics {
  return {
    commandPath: '',
    argvShape: [],
    workingDirectory,
    provider: 'openai',
    model: String(env.OPENAI_MODEL || ''),
    permissionMode: deriveLocalCoderPermissionMode(packet),
    timeoutMs: localCoderRunTimeoutMs(env),
    promptDelivery: 'argv',
    promptLength: prompt.length,
    stdinClosed: true,
    mcpMode,
    mcpConfigPassed: false,
    firstStdoutAt: null,
    firstStderrAt: null,
    lastStdoutLine: '',
    lastStderrLine: '',
    exitCode: null,
    exitSignal: null,
    timeoutKilled: false,
    jsonParseStarted: false,
    coderReportValidationStarted: false,
    runtimeStage: 'preflight',
    warningLines: [],
    validCoderReportReturned: false,
  };
}

function applyProcessDiagnostics(
  diagnostics: LocalCoderRuntimeDiagnostics,
  result: ProcessResult,
): void {
  diagnostics.firstStdoutAt = result.firstStdoutAt ?? null;
  diagnostics.firstStderrAt = result.firstStderrAt ?? null;
  diagnostics.lastStdoutLine = result.lastStdoutLine ?? lastBoundedLine(result.stdout);
  diagnostics.lastStderrLine = result.lastStderrLine ?? lastBoundedLine(result.stderr);
  diagnostics.exitCode = result.exitCode;
  diagnostics.exitSignal = result.exitSignal ?? null;
  diagnostics.timeoutKilled = result.timeoutKilled ?? false;
  diagnostics.warningLines = warningLines([result.stdout, result.stderr].filter(Boolean).join('\n'));
}

export class LocalCoderAdapter {
  private readonly workspaceRoot: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly runProcess: RunProcess;
  private readonly diagnosticMcpMode: 'production' | 'disabled';

  constructor(options: LocalCoderAdapterOptions = {}) {
    this.workspaceRoot = options.workspaceRoot
      ? path.resolve(options.workspaceRoot)
      : resolveLocalCoderWorkspaceRoot(process.cwd());
    this.env = options.env || process.env;
    this.runProcess = options.runProcess || runChildProcess;
    this.diagnosticMcpMode = options.diagnosticMcpMode || 'production';
  }

  private vendoredRoot(): string {
    return path.join(this.workspaceRoot, 'localcoder');
  }

  private vendoredEntrypoint(): string {
    return path.join(this.vendoredRoot(), 'bin', 'openclaude');
  }

  private mcpConfigPath(): string {
    return path.join(this.workspaceRoot, 'apps', 'backend', 'mcp.config.json');
  }

  /** Build a runnable command from an explicit env command/path, or null. */
  private resolveExplicitRuntime(): ResolvedRuntime | null {
    let picked: { name: string; value: string; kind: 'command' | 'bin' } | null = null;
    for (const name of EXPLICIT_ENV_NAMES) {
      const value = String(this.env[name] || '').trim();
      if (value) {
        picked = { name, value, kind: name.endsWith('_BIN') ? 'bin' : 'command' };
        break;
      }
    }
    if (!picked) return null;

    const tokens =
      picked.kind === 'bin' ? [picked.value] : tokenizeCommand(picked.value);
    if (tokens.length === 0) {
      return { ready: false, missing: [`localcoder_explicit_command_empty: ${picked.name}`] };
    }

    const head = tokens[0];
    const rest = tokens.slice(1);

    if (head === 'node' || head === 'node.exe') {
      const scriptPath = rest[0];
      if (!scriptPath) {
        return {
          ready: false,
          missing: [`localcoder_explicit_command_missing_script: ${picked.name}=${picked.value}`],
        };
      }
      const resolvedScript = path.isAbsolute(scriptPath)
        ? scriptPath
        : path.resolve(this.workspaceRoot, scriptPath);
      if (!existsSync(resolvedScript)) {
        return {
          ready: false,
          missing: [
            `localcoder_explicit_command_script_not_found: ${picked.name}=${picked.value} (${resolvedScript})`,
          ],
        };
      }
      return {
        ready: true,
        source: 'explicit_command',
        command: process.execPath,
        baseArgs: [resolvedScript, ...rest.slice(1)],
        describe: picked.value,
        shell: false,
      };
    }

    const resolved = resolveExecutablePath(head, this.env);
    if (!resolved) {
      return {
        ready: false,
        missing: [
          `localcoder_explicit_command_not_found: ${picked.name}=${picked.value}`,
        ],
      };
    }
    if (needsNodePrefix(resolved)) {
      return {
        ready: true,
        source: 'explicit_command',
        command: process.execPath,
        baseArgs: [resolved, ...rest],
        describe: picked.value,
        shell: false,
      };
    }
    return {
      ready: true,
      source: 'explicit_command',
      command: resolved,
      baseArgs: rest,
      describe: picked.value,
      shell: isShellShim(resolved),
    };
  }

  /** An `openclaude` already on PATH. */
  private resolvePathRuntime(): ResolvedRuntime | null {
    const resolved = resolveExecutablePath('openclaude', this.env);
    if (!resolved) return null;
    if (needsNodePrefix(resolved)) {
      return {
        ready: true,
        source: 'path_openclaude',
        command: process.execPath,
        baseArgs: [resolved],
        describe: resolved,
        shell: false,
      };
    }
    return {
      ready: true,
      source: 'path_openclaude',
      command: resolved,
      baseArgs: [],
      describe: resolved,
      shell: isShellShim(resolved),
    };
  }

  /** The vendored runtime, but only when it is actually built and installed. */
  private resolveVendoredRuntime(): ResolvedRuntime {
    const root = this.vendoredRoot();
    const entrypoint = this.vendoredEntrypoint();
    const missing: string[] = [];
    const requiredPaths = [
      ['localcoder_package_missing', path.join(root, 'package.json')],
      ['localcoder_entrypoint_missing', entrypoint],
      ['localcoder_dist_entrypoint_missing', path.join(root, 'dist', 'cli.mjs')],
      ['localcoder_node_modules_missing', path.join(root, 'node_modules')],
    ] as const;
    for (const [code, requiredPath] of requiredPaths) {
      if (!existsSync(requiredPath)) missing.push(`${code}: ${requiredPath}`);
    }
    if (missing.length > 0) {
      return { ready: false, missing };
    }
    return {
      ready: true,
      source: 'vendored_built',
      command: process.execPath,
      baseArgs: [entrypoint],
      describe: `node ${entrypoint}`,
      shell: false,
    };
  }

  /**
   * Discover a runnable LocalCoder/OpenClaude command in priority order:
   * explicit env command -> PATH openclaude -> built vendored runtime.
   */
  private discoverRuntime(): ResolvedRuntime {
    const explicit = this.resolveExplicitRuntime();
    if (explicit) return explicit;
    const onPath = this.resolvePathRuntime();
    if (onPath) return onPath;
    return this.resolveVendoredRuntime();
  }

  /**
   * Resolve a runnable OpenClaude command for the Console Bridge without
   * spawning anything. Reuses the same discovery order as the job adapter
   * (explicit env command -> PATH openclaude -> built vendored runtime) so the
   * live terminal and the headless job invoke the exact same CLI.
   */
  resolveConsoleRuntime(): ConsoleRuntimeResolution {
    const runtime = this.discoverRuntime();
    if (!runtime.ready) {
      return { ready: false, missing: runtime.missing };
    }
    return {
      ready: true,
      command: runtime.command,
      baseArgs: [...runtime.baseArgs],
      describe: runtime.describe,
      shell: runtime.shell,
      source: runtime.source,
      envMissing: this.envMissing(),
    };
  }

  private envMissing(): string[] {
    const missing: string[] = [];
    if (!String(this.env.OPENAI_API_KEY || '').trim()) {
      missing.push('localcoder_env_missing: OPENAI_API_KEY');
    }
    if (!String(this.env.OPENAI_MODEL || '').trim()) {
      missing.push('localcoder_model_missing: OPENAI_MODEL');
    }
    return missing;
  }

  private blockedInspection(missing: string[]): LocalCoderRuntimeInspection {
    return {
      ready: false,
      source: 'none',
      command: '',
      rootPath: this.vendoredRoot(),
      entrypoint: this.vendoredEntrypoint(),
      missing,
      setupCommand: buildSetupCommand(this.vendoredRoot()),
    };
  }

  /**
   * Build a strict-valid MCP config for OpenClaude from the backend config.
   * Transforms each server into OpenClaude's `type`-discriminated shape and
   * keeps only schema-valid, env-resolvable servers. If none survive (or the
   * file is missing/unparseable) the run is MCP-less and the reason is recorded
   * so it stays visible in the CoderReport.
   */
  /**
   * The ONE app Python MCP host (apps/python-models/app/mcp_host.py), resolved
   * from the workspace root exactly like the gRPC harness does
   * (localcoder/scripts/start-grpc.ts). Injecting it here is what gives the
   * card-Coder the SAME MCP tool surface the chat-Coder already gets from the
   * server-lifetime host — including write_mag_one_instructions /
   * read_model_results. Absent build → honest note, host omitted (no fake).
   */
  private resolveLiquidaityMcpServer():
    | { server: Record<string, unknown>; note: string }
    | { note: string } {
    const pythonExe = path.join(
      this.workspaceRoot, 'apps', 'python-models', '.venv', 'Scripts', 'python.exe',
    );
    const hostPath = path.join(this.workspaceRoot, 'apps', 'python-models', 'app', 'mcp_host.py');
    if (!existsSync(pythonExe) || !existsSync(hostPath)) {
      const missing = !existsSync(pythonExe) ? pythonExe : hostPath;
      return { note: `localcoder_mcp_liquidaity_unavailable: ${missing}` };
    }
    return {
      server: { type: 'stdio', command: pythonExe, args: [hostPath] },
      note: 'localcoder_mcp_liquidaity_injected',
    };
  }

  private prepareMcpConfig(): McpPrepResult {
    if (this.diagnosticMcpMode === 'disabled') {
      return {
        flags: [],
        note: 'localcoder_mcp_diagnostic_disabled_explicit',
        tempPath: null,
      };
    }
    const configPath = this.mcpConfigPath();
    // Read the declared servers when the file exists/parses; a missing or bad
    // file is a note, not an early return — the liquidaity host is still injected.
    let servers: Record<string, unknown> = {};
    let fileNote = '';
    if (!existsSync(configPath)) {
      fileNote = `localcoder_mcp_config_absent: ${configPath}`;
    } else {
      try {
        const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
        if (
          parsed &&
          typeof parsed === 'object' &&
          typeof (parsed as { mcpServers?: unknown }).mcpServers === 'object' &&
          (parsed as { mcpServers?: unknown }).mcpServers !== null
        ) {
          servers = (parsed as { mcpServers: Record<string, unknown> }).mcpServers;
        }
      } catch (error) {
        fileNote = `localcoder_mcp_config_unparseable: ${error instanceof Error ? error.message : 'invalid json'}`;
      }
    }

    const kept: Record<string, unknown> = {};
    const keptNames: string[] = [];
    const dropped: string[] = [];
    for (const [name, raw] of Object.entries(servers)) {
      if (name === 'liquidaity') continue; // injected below from the resolved layout
      const result = normalizeMcpServer(name, raw, this.env);
      if (result.ok) {
        kept[name] = result.value;
        keptNames.push(name);
      } else {
        dropped.push(result.reason);
      }
    }

    const liquidaity = this.resolveLiquidaityMcpServer();
    if ('server' in liquidaity) {
      kept['liquidaity'] = liquidaity.server;
      keptNames.push('liquidaity');
    }

    if (keptNames.length === 0) {
      const reason = [
        fileNote,
        dropped.length ? `dropped: ${dropped.join('; ')}` : 'no mcpServers defined',
        liquidaity.note,
      ].filter(Boolean).join('; ');
      return { flags: [], note: `localcoder_mcp_config_omitted: ${reason}`, tempPath: null };
    }

    const tempPath = path.join(tmpdir(), `liquidaity-mcp-${Date.now()}-${process.pid}.json`);
    writeFileSync(tempPath, JSON.stringify({ mcpServers: kept }, null, 2));
    const note = [
      `localcoder_mcp_config_normalized: kept [${keptNames.join(', ')}]`,
      dropped.length ? `dropped: ${dropped.join('; ')}` : '',
      fileNote,
      liquidaity.note,
    ].filter(Boolean).join('; ');
    return { flags: ['--mcp-config', tempPath, '--strict-mcp-config'], note, tempPath };
  }

  private jobArgs(packet: CoderPacket, mcpFlags: string[], prompt: string): string[] {
    const args = [
      '--print',
      prompt,
      '--output-format',
      'json',
      '--json-schema',
      JSON.stringify(coderReportJsonSchema),
    ];
    args.push(...mcpFlags);
    args.push(
      '--permission-mode',
      deriveLocalCoderPermissionMode(packet),
      '--model',
      String(this.env.OPENAI_MODEL),
      '--provider',
      'openai',
      '--no-session-persistence',
    );
    return args;
  }

  /**
   * Safe, token-free readiness check used by the status route. Resolves the
   * command and verifies it answers `--version` (or `--help`). Never runs a
   * coding job.
   */
  async inspectRuntime(repoPath = this.workspaceRoot): Promise<LocalCoderRuntimeInspection> {
    const resolvedRepo = path.resolve(repoPath);
    if (!existsSync(resolvedRepo)) {
      return this.blockedInspection([`localcoder_repo_path_missing: ${resolvedRepo}`]);
    }

    const runtime = this.discoverRuntime();
    if (!runtime.ready) {
      return this.blockedInspection(runtime.missing);
    }

    const envMissing = this.envMissing();
    if (envMissing.length > 0) {
      return this.blockedInspection(envMissing);
    }

    const probeOptions = {
      cwd: resolvedRepo,
      env: { ...this.env, CLAUDE_CODE_USE_OPENAI: '1' },
      shell: runtime.shell,
      timeoutMs: 15000,
    };
    const version = await this.runProcess(
      runtime.command,
      [...runtime.baseArgs, '--version'],
      probeOptions,
    );
    let detected = version.started && version.exitCode === 0;
    if (!detected) {
      const help = await this.runProcess(
        runtime.command,
        [...runtime.baseArgs, '--help'],
        probeOptions,
      );
      detected = help.started && help.exitCode === 0;
      if (!detected) {
        const reason = version.started
          ? `--version exit=${String(version.exitCode)} --help exit=${String(help.exitCode)}`
          : version.error || 'spawn_failed';
        return this.blockedInspection([
          `localcoder_safe_detection_failed: ${runtime.describe} (${reason})`,
        ]);
      }
    }

    return {
      ready: true,
      source: runtime.source,
      command: runtime.describe,
      rootPath: this.vendoredRoot(),
      entrypoint: this.vendoredEntrypoint(),
      missing: [],
      setupCommand: buildSetupCommand(this.vendoredRoot()),
    };
  }

  async runWithDiagnostics(packet: CoderPacket): Promise<{
    report: CoderReport;
    runtimeDiagnostics: LocalCoderRuntimeDiagnostics;
  }> {
    const setupCommand = buildSetupCommand(this.vendoredRoot());
    const resolvedRepo = path.resolve(packet.repoPath);
    const prompt = buildCoderPrompt(packet);
    const runtimeDiagnostics = createRuntimeDiagnostics(
      packet,
      resolvedRepo,
      prompt,
      this.env,
      this.diagnosticMcpMode,
    );
    if (!existsSync(resolvedRepo)) {
      return {
        report: buildBlockedReport(
          packet.id,
          `localcoder_repo_path_missing: ${resolvedRepo}`,
          setupCommand,
        ),
        runtimeDiagnostics,
      };
    }

    const runtime = this.discoverRuntime();
    if (!runtime.ready) {
      return {
        report: buildBlockedReport(packet.id, runtime.missing.join('; '), setupCommand),
        runtimeDiagnostics,
      };
    }
    runtimeDiagnostics.commandPath = runtime.describe;

    const envMissing = this.envMissing();
    if (envMissing.length > 0) {
      return {
        report: buildBlockedReport(packet.id, envMissing.join('; '), setupCommand),
        runtimeDiagnostics,
      };
    }

    if (prompt.length > MAX_LOCALCODER_ARGV_PROMPT_CHARS) {
      runtimeDiagnostics.runtimeStage = 'prompt_bounds';
      return {
        report: buildBlockedReport(
          packet.id,
          `localcoder_argv_prompt_too_large: ${prompt.length} > ${MAX_LOCALCODER_ARGV_PROMPT_CHARS}`,
          'Create a narrower CoderPacket before retrying the argv-based CLI adapter.',
        ),
        runtimeDiagnostics,
      };
    }

    const mcp = this.prepareMcpConfig();
    const args = [...runtime.baseArgs, ...this.jobArgs(packet, mcp.flags, prompt)];
    runtimeDiagnostics.argvShape = redactArgv(args);
    runtimeDiagnostics.mcpConfigPassed = mcp.flags.includes('--mcp-config');
    const withMcpNote = (report: CoderReport): CoderReport => ({
      ...report,
      assumptions: [...report.assumptions, mcp.note],
    });
    const result = await this.runProcess(
      runtime.command,
      args,
      {
        cwd: resolvedRepo,
        env: { ...this.env, CLAUDE_CODE_USE_OPENAI: '1' },
        shell: runtime.shell,
        timeoutMs: localCoderRunTimeoutMs(this.env),
      },
    );
    if (mcp.tempPath) {
      try {
        unlinkSync(mcp.tempPath);
      } catch {
        // best-effort cleanup of the generated MCP config
      }
    }
    applyProcessDiagnostics(runtimeDiagnostics, result);
    const rawOutput = [result.stdout, result.stderr].filter(Boolean).join('\n');
    if (!result.started) {
      runtimeDiagnostics.runtimeStage = 'process_not_started';
      return {
        report: withMcpNote(buildBlockedReport(
          packet.id,
          `localcoder_process_not_started: ${result.error || 'unknown spawn error'}`,
          setupCommand,
          rawOutput,
        )),
        runtimeDiagnostics,
      };
    }
    if (result.error) {
      runtimeDiagnostics.runtimeStage = result.error.startsWith('process_timeout_after_')
        ? 'process_timeout'
        : 'process_exit_failed';
      return {
        report: withMcpNote(
          buildFailedReport(packet.id, `localcoder_process_failed: ${result.error}`, rawOutput),
        ),
        runtimeDiagnostics,
      };
    }
    if (result.exitCode !== 0) {
      runtimeDiagnostics.runtimeStage = 'process_exit_failed';
      return {
        report: withMcpNote(buildFailedReport(
          packet.id,
          `localcoder_process_failed: exitCode=${String(result.exitCode)}`,
          rawOutput,
        )),
        runtimeDiagnostics,
      };
    }
    runtimeDiagnostics.runtimeStage = 'json_parse';
    const parsed = parseLocalCoderOutput(result.stdout, packet.id);
    runtimeDiagnostics.jsonParseStarted = parsed.jsonParseStarted;
    runtimeDiagnostics.coderReportValidationStarted = parsed.coderReportValidationStarted;
    if (!parsed.report) {
      runtimeDiagnostics.runtimeStage = parsed.coderReportValidationStarted
        ? 'coder_report_validation'
        : 'json_parse';
      return {
        report: withMcpNote(buildFailedReport(packet.id, 'localcoder_coder_report_invalid', rawOutput)),
        runtimeDiagnostics,
      };
    }
    runtimeDiagnostics.runtimeStage = 'completed';
    runtimeDiagnostics.validCoderReportReturned = true;
    return {
      report: withMcpNote(parsed.report),
      runtimeDiagnostics,
    };
  }

  async run(packet: CoderPacket): Promise<CoderReport> {
    return (await this.runWithDiagnostics(packet)).report;
  }
}
