import { spawn } from 'node:child_process';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  coderReportJsonSchema,
  type CoderPacket,
  type CoderReport,
} from '../../contracts/coderContracts';
import {
  buildOpenClaudeJobArgs,
  parseOpenClaudeCoderReport,
} from '../execution/coderRuntimeContract';
import { resolveServerCodexHome } from '../../config/env';

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
  reasoningEffort: 'low' | 'medium' | 'high' | 'xhigh' | null;
  authTransportClass: 'coder_oauth' | 'openai_api_key' | 'openrouter_api_key';
  grantedMcpTools: string[];
  sessionId: string | null;
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
  providerThreadId: string | null;
  providerTurnId: string | null;
  providerAuthMode: string | null;
  providerPlanType: string | null;
};

const EXPLICIT_ENV_NAMES = [
  'LOCALCODER_COMMAND',
  'LOCALCODER_BIN',
  'OPENCLAUDE_COMMAND',
  'OPENCLAUDE_BIN',
] as const;

const WINDOWS_EXEC_EXTENSIONS = ['.exe', '.cmd', '.bat', '.com'];
const MAX_LOCALCODER_ARGV_PROMPT_CHARS = 16_000;
const MAX_DIAGNOSTIC_LINE_CHARS = 500;

/** Translate a saved CBM grant into the native server's OpenClaude tool name. */
export function toOpenClaudeMcpToolName(name: string): string {
  const canonical = String(name || '').trim();
  if (!canonical) throw new Error('localcoder_mcp_tool_name_empty');
  if (canonical.startsWith('mcp__')) {
    throw new Error(`localcoder_mcp_tool_name_must_be_canonical: ${canonical}`);
  }
  if (!canonical.startsWith('cbm.') || canonical.length <= 4) {
    throw new Error(`localcoder_mcp_tool_name_invalid: ${canonical}`);
  }
  return `mcp__codebase-memory-mcp__${canonical.slice(4).replace(/\./g, '_')}`;
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

type McpPrepResult = { flags: string[]; note: string; tempPath: string | null };

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

export function buildCoderPrompt(packet: CoderPacket): string {
  if (packet.exactIdf) return packet.exactIdf;
  return [
    'Execute the exact transient LiquidAIty coding communication below as the complete spec and task.',
    'Use repository tools and return only the requested structured CoderReport.',
    'Do not claim success without actual edits and proof. Stop at the packet stop conditions.',
    'Trusted execution envelope:',
    JSON.stringify(packet, null, 2),
  ].filter(Boolean).join('\n\n');
}

function parseLocalCoderOutput(
  stdout: string,
  packetId: string,
): {
  report: CoderReport | null;
  jsonParseStarted: boolean;
  coderReportValidationStarted: boolean;
} {
  // One parser for both OpenClaude surfaces: the headless job pins its packet id.
  return parseOpenClaudeCoderReport(stdout, { requirePacketId: packetId });
}

function extractOpenClaudeSessionId(stdout: string): string | null {
  try {
    const envelope = JSON.parse(stdout) as Record<string, unknown>;
    for (const key of ['session_id', 'sessionId', 'session']) {
      const value = envelope[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  } catch {
    // Invalid JSON is handled by the CoderReport parser and remains a failure.
  }
  return null;
}

function createRuntimeDiagnostics(
  packet: CoderPacket,
  workingDirectory: string,
  prompt: string,
  mcpMode: 'production' | 'disabled',
): LocalCoderRuntimeDiagnostics {
  const model = String(packet.providerModelId || '');
  return {
    commandPath: '',
    argvShape: [],
    workingDirectory,
    provider: String(packet.modelProvider || 'openai'),
    model,
    reasoningEffort: packet.reasoningEffort ?? null,
    authTransportClass:
      packet.accessMode === 'coder-oauth'
        ? 'coder_oauth'
        : packet.accessMode === 'openrouter-api'
          ? 'openrouter_api_key'
          : 'openai_api_key',
    grantedMcpTools: (packet.mcpTools ?? []).map(toOpenClaudeMcpToolName),
    sessionId: null,
    permissionMode: deriveLocalCoderPermissionMode(packet),
    timeoutMs: 0,
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
    providerThreadId: null,
    providerTurnId: null,
    providerAuthMode: null,
    providerPlanType: null,
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
      baseArgs: [...runtime.baseArgs, ...this.coderPluginFlags()],
      describe: runtime.describe,
      shell: runtime.shell,
      source: runtime.source,
      envMissing: this.envMissing(),
    };
  }

  private coderPluginFlags(): string[] {
    const pluginRoot = path.join(this.vendoredRoot(), 'plugins', 'repository-coder');
    const manifest = path.join(pluginRoot, '.claude-plugin', 'plugin.json');
    const hooks = path.join(pluginRoot, 'hooks', 'hooks.json');
    if (!existsSync(manifest) || !existsSync(hooks)) {
      throw new Error(`localcoder_repository_plugin_missing: ${pluginRoot}`);
    }
    return ['--plugin-dir', pluginRoot];
  }

  private envMissing(packet?: CoderPacket): string[] {
    const missing: string[] = [];
    if (!packet) return missing;
    const provider = String(packet?.modelProvider || 'openai').trim().toLowerCase();
    if (packet.accessMode === 'openrouter-api' && !String(this.env.OPENROUTER_API_KEY || '').trim()) {
      missing.push('localcoder_env_missing: OPENROUTER_API_KEY');
    }
    if (packet.accessMode === 'openai-api' && !String(this.env.OPENAI_API_KEY || '').trim()) {
      missing.push('localcoder_env_missing: OPENAI_API_KEY');
    }
    if (packet.accessMode && (
      (packet.accessMode === 'openrouter-api' && provider !== 'openrouter')
      || (packet.accessMode !== 'openrouter-api' && provider !== 'openai')
    )) {
      missing.push('localcoder_access_mode_provider_mismatch');
    }
    if (!String(packet.providerModelId || '').trim()) {
      missing.push('localcoder_model_missing: providerModelId');
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

  /** Resolve the one repo-owned native CBM server used by Coder. */
  private resolveNativeCbmServer():
    | { server: Record<string, unknown>; note: string }
    | { note: string } {
    const executable = path.join(
      this.workspaceRoot,
      '.tools',
      'codebase-memory-mcp',
      'bin',
      'codebase-memory-mcp.exe',
    );
    if (!existsSync(executable)) {
      return { note: `localcoder_native_cbm_unavailable: ${executable}` };
    }
    return {
      server: { type: 'stdio', command: executable, args: [] },
      note: 'localcoder_native_cbm_injected',
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
    const kept: Record<string, unknown> = {};
    const keptNames: string[] = [];
    const nativeCbm = this.resolveNativeCbmServer();
    if ('server' in nativeCbm) {
      kept['codebase-memory-mcp'] = nativeCbm.server;
      keptNames.push('codebase-memory-mcp');
    }

    if (keptNames.length === 0) {
      const reason = [
        'no Coder MCP server configured',
        nativeCbm.note,
      ].filter(Boolean).join('; ');
      return { flags: [], note: `localcoder_mcp_config_omitted: ${reason}`, tempPath: null };
    }

    const tempPath = path.join(tmpdir(), `main-mcp-${Date.now()}-${process.pid}.json`);
    writeFileSync(tempPath, JSON.stringify({ mcpServers: kept }, null, 2));
    const note = [
      `localcoder_mcp_config_normalized: kept [${keptNames.join(', ')}]`,
      nativeCbm.note,
    ].filter(Boolean).join('; ');
    return { flags: ['--mcp-config', tempPath, '--strict-mcp-config'], note, tempPath };
  }

  private jobArgs(packet: CoderPacket, mcpFlags: string[], prompt: string): string[] {
    return buildOpenClaudeJobArgs({
      prompt,
      model: String(packet.providerModelId),
      permissionMode: deriveLocalCoderPermissionMode(packet),
      jsonSchema: coderReportJsonSchema,
      mcpFlags,
      reasoningEffort: packet.reasoningEffort,
      allowedTools: (packet.mcpTools ?? []).map(toOpenClaudeMcpToolName),
    });
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

    const envMissing = this.envMissing(packet);
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
    const args = [
      ...runtime.baseArgs,
      ...this.coderPluginFlags(),
      ...this.jobArgs(packet, mcp.flags, prompt),
    ];
    runtimeDiagnostics.argvShape = redactArgv(args);
    runtimeDiagnostics.mcpConfigPassed = mcp.flags.includes('--mcp-config');
    const withMcpNote = (report: CoderReport): CoderReport => ({
      ...report,
      assumptions: [...report.assumptions, mcp.note],
    });
    const childEnv: NodeJS.ProcessEnv = {
      ...this.env,
      OPENAI_MODEL: String(packet.providerModelId),
    };
    if (packet.accessMode === 'openrouter-api') {
      childEnv.OPENAI_API_KEY = String(this.env.OPENROUTER_API_KEY || '');
      childEnv.OPENAI_BASE_URL = String(
        this.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
      );
      childEnv.CLAUDE_CODE_USE_OPENAI = '1';
    } else if (packet.accessMode === 'openai-api') {
      childEnv.OPENAI_API_KEY = String(this.env.OPENAI_API_KEY || '');
      childEnv.OPENAI_BASE_URL = String(this.env.OPENAI_BASE_URL || 'https://api.openai.com/v1');
      childEnv.CLAUDE_CODE_USE_OPENAI = '1';
    } else if (packet.accessMode === 'coder-oauth') {
      delete childEnv.OPENAI_API_KEY;
      delete childEnv.CODEX_AUTH_JSON_PATH;
      childEnv.CODEX_HOME = resolveServerCodexHome(this.env);
      childEnv.OPENAI_BASE_URL = 'https://chatgpt.com/backend-api/codex';
      childEnv.CLAUDE_CODE_USE_OPENAI = '1';
    } else {
      throw new Error('localcoder_access_mode_missing_or_invalid');
    }
    const result = await this.runProcess(
      runtime.command,
      args,
      {
        cwd: resolvedRepo,
        env: childEnv,
        shell: runtime.shell,
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
    runtimeDiagnostics.sessionId = extractOpenClaudeSessionId(result.stdout);
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
