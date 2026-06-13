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

type ProcessResult = {
  started: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  error?: string;
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
};

const EXPLICIT_ENV_NAMES = [
  'LOCALCODER_COMMAND',
  'LOCALCODER_BIN',
  'OPENCLAUDE_COMMAND',
  'OPENCLAUDE_BIN',
] as const;

const WINDOWS_EXEC_EXTENSIONS = ['.exe', '.cmd', '.bat', '.com'];

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
    let settled = false;
    let timer: NodeJS.Timeout | null = null;
    const finish = (result: ProcessResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
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
        child.kill();
        finish({
          started: true,
          exitCode: null,
          stdout,
          stderr,
          error: `process_timeout_after_${options.timeoutMs}ms`,
        });
      }, options.timeoutMs);
    }
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      finish({ started: false, exitCode: null, stdout, stderr, error: error.message });
    });
    child.on('close', (exitCode) => {
      finish({ started: true, exitCode, stdout, stderr });
    });
  });
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

const NO_EDIT_PATTERNS: RegExp[] = [
  /no file edits/i,
  /no edits/i,
  /do not edit files?/i,
  /don'?t edit files?/i,
  /read[\s-]?only/i,
  /inspect only/i,
  /return report only/i,
  /report only/i,
];

/**
 * Derive the OpenClaude permission mode from the CoderPacket. Conservative by
 * default: a packet only edits files when it explicitly declares
 * `writeMode: 'edit'`. Read-only is selected for `writeMode: 'read-only'`, for
 * any no-edit language in forbiddenWork/stopConditions, and for ambiguous
 * packets — so a no-edit job can never silently gain edit permission.
 */
export function deriveLocalCoderPermissionMode(packet: CoderPacket): LocalCoderPermissionMode {
  if (packet.writeMode === 'read-only') return 'plan';
  if (packet.writeMode === 'edit') return 'acceptEdits';
  const haystack = [...packet.forbiddenWork, ...packet.stopConditions].join('\n');
  if (NO_EDIT_PATTERNS.some((pattern) => pattern.test(haystack))) return 'plan';
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

function parseLocalCoderOutput(stdout: string, packetId: string): CoderReport | null {
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
      const parsed = coderReportSchema.safeParse(parsedCandidate);
      if (parsed.success && parsed.data.coderPacketId === packetId) {
        return { ...parsed.data, rawOutput: stdout };
      }
    }
  } catch {
    return null;
  }
  return null;
}

export class LocalCoderAdapter {
  private readonly workspaceRoot: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly runProcess: RunProcess;

  constructor(options: LocalCoderAdapterOptions = {}) {
    this.workspaceRoot = options.workspaceRoot
      ? path.resolve(options.workspaceRoot)
      : resolveLocalCoderWorkspaceRoot(process.cwd());
    this.env = options.env || process.env;
    this.runProcess = options.runProcess || runChildProcess;
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
  private prepareMcpConfig(): McpPrepResult {
    const configPath = this.mcpConfigPath();
    if (!existsSync(configPath)) {
      return { flags: [], note: `localcoder_mcp_config_absent: ${configPath}`, tempPath: null };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    } catch (error) {
      return {
        flags: [],
        note: `localcoder_mcp_config_unparseable: ${error instanceof Error ? error.message : 'invalid json'}`,
        tempPath: null,
      };
    }
    const servers =
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as { mcpServers?: unknown }).mcpServers === 'object' &&
      (parsed as { mcpServers?: unknown }).mcpServers !== null
        ? ((parsed as { mcpServers: Record<string, unknown> }).mcpServers)
        : {};

    const kept: Record<string, unknown> = {};
    const keptNames: string[] = [];
    const dropped: string[] = [];
    for (const [name, raw] of Object.entries(servers)) {
      const result = normalizeMcpServer(name, raw, this.env);
      if (result.ok) {
        kept[name] = result.value;
        keptNames.push(name);
      } else {
        dropped.push(result.reason);
      }
    }

    if (keptNames.length === 0) {
      const reason = dropped.length ? `dropped: ${dropped.join('; ')}` : 'no mcpServers defined';
      return { flags: [], note: `localcoder_mcp_config_omitted: ${reason}`, tempPath: null };
    }

    const tempPath = path.join(tmpdir(), `liquidaity-mcp-${Date.now()}-${process.pid}.json`);
    writeFileSync(tempPath, JSON.stringify({ mcpServers: kept }, null, 2));
    const note =
      `localcoder_mcp_config_normalized: kept [${keptNames.join(', ')}]` +
      (dropped.length ? `; dropped: ${dropped.join('; ')}` : '');
    return { flags: ['--mcp-config', tempPath, '--strict-mcp-config'], note, tempPath };
  }

  private jobArgs(packet: CoderPacket, mcpFlags: string[]): string[] {
    const args = [
      '--print',
      buildCoderPrompt(packet),
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

  async run(packet: CoderPacket): Promise<CoderReport> {
    const setupCommand = buildSetupCommand(this.vendoredRoot());
    const resolvedRepo = path.resolve(packet.repoPath);
    if (!existsSync(resolvedRepo)) {
      return buildBlockedReport(
        packet.id,
        `localcoder_repo_path_missing: ${resolvedRepo}`,
        setupCommand,
      );
    }

    const runtime = this.discoverRuntime();
    if (!runtime.ready) {
      return buildBlockedReport(packet.id, runtime.missing.join('; '), setupCommand);
    }

    const envMissing = this.envMissing();
    if (envMissing.length > 0) {
      return buildBlockedReport(packet.id, envMissing.join('; '), setupCommand);
    }

    const mcp = this.prepareMcpConfig();
    const withMcpNote = (report: CoderReport): CoderReport => ({
      ...report,
      assumptions: [...report.assumptions, mcp.note],
    });
    const result = await this.runProcess(
      runtime.command,
      [...runtime.baseArgs, ...this.jobArgs(packet, mcp.flags)],
      {
        cwd: resolvedRepo,
        env: { ...this.env, CLAUDE_CODE_USE_OPENAI: '1' },
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
    const rawOutput = [result.stdout, result.stderr].filter(Boolean).join('\n');
    if (!result.started) {
      return withMcpNote(
        buildBlockedReport(
          packet.id,
          `localcoder_process_not_started: ${result.error || 'unknown spawn error'}`,
          setupCommand,
          rawOutput,
        ),
      );
    }
    if (result.exitCode !== 0) {
      return withMcpNote(
        buildFailedReport(
          packet.id,
          `localcoder_process_failed: exitCode=${String(result.exitCode)}`,
          rawOutput,
        ),
      );
    }
    const report = parseLocalCoderOutput(result.stdout, packet.id);
    if (!report) {
      return withMcpNote(buildFailedReport(packet.id, 'localcoder_coder_report_invalid', rawOutput));
    }
    return withMcpNote(report);
  }
}
