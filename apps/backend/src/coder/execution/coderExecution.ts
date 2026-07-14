import { createHash, randomUUID } from 'node:crypto';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolveRepoRoot } from '../workspaceRoot';
import {
  buildCoderMcpServers,
  resolveCoderToolPolicy,
  LEGACY_HARNESS_TOOL_POLICY,
  type CoderAuthorityMode,
} from './coderRuntimeContract';

export const CODER_ADAPTER_IDS = ['claude_code', 'codex'] as const;
export type CoderAdapterId = (typeof CODER_ADAPTER_IDS)[number];
export type CoderInvocationMode = 'individual' | 'harness_subagent' | 'mag_one_team';
export type CoderRunStatus = 'prepared' | 'running' | 'completed' | 'failed' | 'cancelled';

export type CoderRunPacket = {
  version: '1';
  runId: string;
  correlationId: string;
  parentRunId: string;
  projectId: string;
  deckId: string;
  cardId: string;
  adapter: CoderAdapterId;
  invocationMode: CoderInvocationMode;
  /**
   * Caller-supplied Coder authority (dossier §3.3). Optional: when unset, the
   * run keeps the legacy harness_subagent tool policy + dev-harness MCP (exactly
   * today's behavior). Set explicitly to opt into read-only audit or execution.
   */
  authority?: CoderAuthorityMode;
  repositoryRoot: string;
  allowedPaths: string[];
  deniedPaths: string[];
  rawRequest: string;
  approvedPrompt: string;
  promptVersion: number;
  promptHash: string;
  approvedAt: string;
  workspaceGranted: true;
  liveRunApproved: true;
  proofRequirements: string[];
};

export type CoderRunEvent = {
  sequence: number;
  timestamp: string;
  type: 'session_prepared' | 'process_started' | 'structured_stream_initialized' | 'session_identified' | 'tool_invocation' | 'tool_result' | 'output' | 'report' | 'completed' | 'failed' | 'cancelled';
  stream?: 'stdout' | 'stderr';
  text?: string;
  data?: Record<string, unknown>;
};

export type CoderRunSnapshot = {
  packet: CoderRunPacket;
  status: CoderRunStatus;
  sessionId: string;
  processId: number | null;
  exitCode: number | null;
  error: string | null;
  events: CoderRunEvent[];
  finalOutput: string;
  report: Record<string, unknown> | null;
};

export type CoderLaunchDescriptor = { executable: string; args: string[]; cwd: string; environmentKeys: string[] };
export type CoderAdapterAvailability = { available: boolean; executable: string | null; version: string | null; error: string | null };

export interface CoderExecutionAdapter {
  readonly id: CoderAdapterId;
  availability(): CoderAdapterAvailability;
  validate(packet: CoderRunPacket): void;
  prepare(packet: CoderRunPacket): CoderRunSnapshot;
  start(runId: string): CoderRunSnapshot;
  wait(runId: string): Promise<CoderRunSnapshot>;
  sendInput(runId: string, input: string): void;
  cancel(runId: string): CoderRunSnapshot;
  inspect(runId: string): CoderRunSnapshot | null;
  finalOutput(runId: string): string;
  inspectLaunch(runId: string): CoderLaunchDescriptor;
  dispose(runId: string): void;
}

const MAX_PROMPT_BYTES = 100_000;
const MAX_EVENT_TEXT = 32_000;
const MAX_EVENTS = 1_000;
const PATH_PATTERN = /^(?![A-Za-z]:)(?![\\/])(?!.*(?:^|[\\/])\.\.(?:[\\/]|$)).+$/;

// One report contract for every CLI coder: the model's final structured answer.
const CODER_REPORT_SCHEMA = {
  type: 'object',
  properties: {
    exactCommand: { type: 'string' },
    stdout: { type: 'string' },
    stderr: { type: 'string' },
    exitStatus: { type: 'integer' },
    blockers: { type: 'array', items: { type: 'string' } },
    exactFilePath: { type: 'string' },
    fileContent: { type: 'string' },
    filesChanged: { type: 'array', items: { type: 'string' } },
  },
  required: ['exactCommand', 'stdout', 'stderr', 'exitStatus', 'blockers'],
  additionalProperties: false,
} as const;

export function hashPrompt(prompt: string): string {
  return createHash('sha256').update(Buffer.from(prompt, 'utf8')).digest('hex');
}

export function createApprovedCoderRun(input: Omit<CoderRunPacket, 'version' | 'runId' | 'correlationId' | 'promptHash' | 'approvedAt'> & { runId?: string; correlationId?: string }): CoderRunPacket {
  const approvedPrompt = String(input.approvedPrompt ?? '');
  return {
    ...input,
    version: '1',
    runId: input.runId || `coder_${randomUUID()}`,
    correlationId: input.correlationId || `trace_${randomUUID()}`,
    approvedPrompt,
    promptHash: hashPrompt(approvedPrompt),
    approvedAt: new Date().toISOString(),
  };
}

function boundedRelativePaths(values: string[], field: string): string[] {
  if (!Array.isArray(values) || values.length > 100) throw new Error(`${field}_invalid`);
  return values.map((value) => {
    const normalized = String(value).replace(/\\/g, '/').trim();
    if (!normalized || !PATH_PATTERN.test(normalized)) throw new Error(`${field}_path_invalid: ${value}`);
    return normalized;
  });
}

type InternalRun = CoderRunSnapshot & {
  child: ChildProcessWithoutNullStreams | null;
  runtimeDir: string;
  stdoutBuffer: string;
  completion: Promise<void>;
  resolveCompletion: () => void;
};

/**
 * Shared lifecycle for every CLI coder (spawn, event ring, cancellation,
 * snapshots). An adapter contributes only what differs per CLI: run files,
 * argv, env hygiene, and structured-output parsing. Adding another coder
 * stack (cursor, antigravity, …) = one small subclass, never a second
 * lifecycle.
 */
abstract class CliCoderAdapter implements CoderExecutionAdapter {
  abstract readonly id: CoderAdapterId;
  private readonly runs = new Map<string, InternalRun>();

  constructor(protected readonly executable: string) {}

  availability(): CoderAdapterAvailability {
    const probe = spawnSync(this.executable, ['--version'], { encoding: 'utf8', windowsHide: true });
    return probe.status === 0
      ? { available: true, executable: this.executable, version: String(probe.stdout).trim(), error: null }
      : { available: false, executable: null, version: null, error: String(probe.error?.message || probe.stderr || `${this.id}_unavailable`).trim() };
  }

  validate(packet: CoderRunPacket): void {
    if (packet.adapter !== this.id) throw new Error('coder_adapter_mismatch');
    if (!packet.workspaceGranted || !packet.liveRunApproved || !packet.approvedAt) throw new Error('coder_run_not_approved');
    if (!packet.projectId || !packet.deckId || !packet.cardId || !packet.invocationMode || !packet.parentRunId) throw new Error('coder_run_identity_incomplete');
    if (Buffer.byteLength(packet.approvedPrompt, 'utf8') === 0 || Buffer.byteLength(packet.approvedPrompt, 'utf8') > MAX_PROMPT_BYTES) throw new Error('approved_prompt_size_invalid');
    if (hashPrompt(packet.approvedPrompt) !== packet.promptHash) throw new Error('approved_prompt_hash_mismatch');
    const root = realpathSync(packet.repositoryRoot);
    if (!existsSync(path.join(root, '.git'))) throw new Error('repository_root_invalid');
    packet.allowedPaths = boundedRelativePaths(packet.allowedPaths, 'allowed');
    packet.deniedPaths = boundedRelativePaths(packet.deniedPaths, 'denied');
  }

  prepare(packet: CoderRunPacket): CoderRunSnapshot {
    this.validate(packet);
    if (this.runs.has(packet.runId)) throw new Error('coder_run_already_exists');
    const runtimeDir = path.join(resolveRepoRoot(), 'coder-workspace', 'runs', packet.runId);
    mkdirSync(runtimeDir, { recursive: true });
    writeFileSync(path.join(runtimeDir, 'prompt.txt'), packet.approvedPrompt, { encoding: 'utf8', flag: 'wx' });
    writeFileSync(path.join(runtimeDir, 'run.json'), JSON.stringify({ ...packet, approvedPrompt: undefined }, null, 2), { encoding: 'utf8', flag: 'wx' });
    this.writeAdapterRunFiles(packet, runtimeDir);
    let resolveCompletion: () => void = () => undefined;
    const completion = new Promise<void>((resolve) => { resolveCompletion = resolve; });
    const run: InternalRun = { packet, status: 'prepared', sessionId: randomUUID(), processId: null, exitCode: null, error: null, events: [], finalOutput: '', report: null, child: null, runtimeDir, stdoutBuffer: '', completion, resolveCompletion };
    this.runs.set(packet.runId, run);
    this.event(run, { type: 'session_prepared' });
    return this.public(run);
  }

  start(runId: string): CoderRunSnapshot {
    const run = this.required(runId);
    if (run.status !== 'prepared' || run.child) throw new Error('coder_run_duplicate_start');
    const childEnv = { ...process.env, LIQUIDAITY_CODER_RUN_ID: runId };
    this.pruneEnv(childEnv);
    const child = spawn(this.executable, this.buildArgs(run), { cwd: run.packet.repositoryRoot, env: childEnv, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    run.child = child;
    run.status = 'running';
    run.processId = child.pid ?? null;
    this.event(run, { type: 'process_started' });
    this.event(run, { type: 'structured_stream_initialized' });
    child.stdout.on('data', (chunk) => this.consume(run, 'stdout', chunk));
    child.stderr.on('data', (chunk) => this.consume(run, 'stderr', chunk));
    child.once('error', (error) => { run.error = error.message; run.status = 'failed'; this.event(run, { type: 'failed', text: error.message }); run.resolveCompletion(); });
    child.once('close', (code) => { this.flushStdout(run); this.onProcessClose(run); run.exitCode = code; run.child = null; if (run.status !== 'cancelled') run.status = code === 0 ? 'completed' : 'failed'; this.event(run, { type: run.status === 'completed' ? 'completed' : 'failed', text: `exit_code=${code}` }); this.persistEvidence(run); run.resolveCompletion(); });
    child.stdin.end();
    return this.public(run);
  }

  async wait(runId: string): Promise<CoderRunSnapshot> {
    const run = this.required(runId);
    await run.completion;
    return this.public(run);
  }

  sendInput(runId: string, input: string): void {
    const run = this.required(runId);
    if (!run.child || run.status !== 'running') throw new Error('coder_run_not_running');
    run.child.stdin.write(String(input).slice(0, MAX_EVENT_TEXT));
  }

  cancel(runId: string): CoderRunSnapshot {
    const run = this.required(runId);
    if (run.status !== 'running' || !run.child) throw new Error('coder_run_not_running');
    run.status = 'cancelled';
    run.child.kill();
    this.event(run, { type: 'cancelled' });
    return this.public(run);
  }

  inspect(runId: string): CoderRunSnapshot | null { const run = this.runs.get(runId); return run ? this.public(run) : null; }
  finalOutput(runId: string): string { return this.required(runId).finalOutput; }
  inspectLaunch(runId: string): CoderLaunchDescriptor {
    const run = this.required(runId);
    const env = { ...process.env, LIQUIDAITY_CODER_RUN_ID: runId };
    this.pruneEnv(env);
    return { executable: this.executable, args: [...this.buildArgs(run)], cwd: run.packet.repositoryRoot, environmentKeys: Object.keys(env).sort() };
  }
  dispose(runId: string): void { const run = this.required(runId); if (run.child) throw new Error('coder_run_still_running'); rmSync(run.runtimeDir, { recursive: true, force: true }); this.runs.delete(runId); }

  /** Extra run-scoped files this CLI needs (MCP config, output schema, …). */
  protected abstract writeAdapterRunFiles(packet: CoderRunPacket, runtimeDir: string): void;
  /** Full argv for one non-interactive run of this CLI. */
  protected abstract buildArgs(run: InternalRun): string[];
  /** Strip provider credentials so the CLI's own logged-in account is the only auth path. */
  protected abstract pruneEnv(env: NodeJS.ProcessEnv): void;
  /** One line of CLI stdout — extract session identity / structured report. */
  protected abstract parseStructuredLine(run: InternalRun, line: string): void;
  /** Called after the process closes, before final status is derived. */
  protected onProcessClose(_run: InternalRun): void { /* default: nothing */ }

  private persistEvidence(run: InternalRun): void {
    try {
      writeFileSync(path.join(run.runtimeDir, 'events.json'), JSON.stringify(run.events, null, 2), 'utf8');
      writeFileSync(path.join(run.runtimeDir, 'result.json'), JSON.stringify(this.public(run), null, 2), 'utf8');
    } catch { /* an evidence write failure cannot rewrite process truth */ }
  }

  private consume(run: InternalRun, stream: 'stdout' | 'stderr', chunk: Buffer): void {
    const text = chunk.toString('utf8').slice(0, MAX_EVENT_TEXT);
    run.finalOutput = (run.finalOutput + text).slice(-500_000);
    this.event(run, { type: 'output', stream, text });
    if (stream === 'stdout') {
      run.stdoutBuffer += text;
      const lines = run.stdoutBuffer.split(/\r?\n/);
      run.stdoutBuffer = lines.pop() ?? '';
      for (const line of lines) if (line.trim()) this.parseStructuredLine(run, line);
    }
  }

  private flushStdout(run: InternalRun): void { if (run.stdoutBuffer.trim()) this.parseStructuredLine(run, run.stdoutBuffer); run.stdoutBuffer = ''; }

  protected event(run: InternalRun, event: Omit<CoderRunEvent, 'sequence' | 'timestamp'>): void { run.events.push({ ...event, sequence: run.events.length + 1, timestamp: new Date().toISOString() }); if (run.events.length > MAX_EVENTS) run.events.splice(0, run.events.length - MAX_EVENTS); }
  private required(runId: string): InternalRun { const run = this.runs.get(runId); if (!run) throw new Error('coder_run_not_found'); return run; }
  private public(run: InternalRun): CoderRunSnapshot {
    return structuredClone({ packet: run.packet, status: run.status, sessionId: run.sessionId, processId: run.processId, exitCode: run.exitCode, error: run.error, events: run.events, finalOutput: run.finalOutput, report: run.report });
  }
}

export class ClaudeCodeAdapter extends CliCoderAdapter {
  readonly id = 'claude_code' as const;

  constructor(executable = process.env.CLAUDE_CODE_EXECUTABLE || 'claude', private readonly requireAuthentication = true) { super(executable); }

  authentication() {
    const probe = spawnSync(this.executable, ['auth', 'status'], { encoding: 'utf8', windowsHide: true });
    try {
      const parsed = JSON.parse(String(probe.stdout || '{}'));
      return { accepted: probe.status === 0 && parsed.loggedIn === true, loggedIn: parsed.loggedIn === true, authMethod: typeof parsed.authMethod === 'string' ? parsed.authMethod : null, apiProvider: typeof parsed.apiProvider === 'string' ? parsed.apiProvider : null, sourceDistinguishable: false };
    } catch {
      return { accepted: false, loggedIn: false, authMethod: null, apiProvider: null, sourceDistinguishable: false };
    }
  }

  override availability(): CoderAdapterAvailability {
    const executable = super.availability();
    if (!executable.available || !this.requireAuthentication) return executable;
    const auth = this.authentication();
    return auth.accepted ? executable : { ...executable, available: false, error: 'claude_code_not_authenticated' };
  }

  protected writeAdapterRunFiles(packet: CoderRunPacket, runtimeDir: string): void {
    // Composed MCP config (dossier §3 / blocker B): dev-harness MCP always;
    // the CodeGraph host (mcp_host.py) is added only for read-only audit runs.
    // No authority set = dev-harness only, byte-identical to before.
    const mcpConfig = {
      mcpServers: buildCoderMcpServers({
        runId: packet.runId,
        includeCodeGraph: packet.authority === 'direct_main_audit',
      }),
    };
    writeFileSync(path.join(runtimeDir, 'mcp.json'), JSON.stringify(mcpConfig), { encoding: 'utf8', flag: 'wx' });
  }

  protected buildArgs(run: InternalRun): string[] {
    // Caller authority selects the tool/permission policy (dossier §3.3); unset
    // keeps the legacy shell-capable harness policy (byte-identical to before).
    // dontAsk AUTO-DENIES anything not in --allowedTools; --verbose is REQUIRED
    // by the CLI whenever --print uses stream-json output.
    const policy = run.packet.authority ? resolveCoderToolPolicy(run.packet.authority) : LEGACY_HARNESS_TOOL_POLICY;
    return ['--print', '--output-format', 'stream-json', '--verbose', '--include-hook-events', '--input-format', 'text', '--session-id', run.sessionId, '--mcp-config', path.join(run.runtimeDir, 'mcp.json'), '--strict-mcp-config', '--permission-mode', policy.permissionMode, '--allowedTools', policy.allowedTools.join(','), '--disallowedTools', policy.disallowedTools.join(','), '--json-schema', JSON.stringify(CODER_REPORT_SCHEMA), run.packet.approvedPrompt];
  }

  protected pruneEnv(env: NodeJS.ProcessEnv): void {
    for (const name of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN']) delete env[name];
  }

  protected parseStructuredLine(run: InternalRun, line: string): void {
    try {
      const parsed = JSON.parse(line);
      if (typeof parsed?.session_id === 'string' && parsed.session_id && run.sessionId !== parsed.session_id) { run.sessionId = parsed.session_id; this.event(run, { type: 'session_identified', text: parsed.session_id }); }
      const content = Array.isArray(parsed?.message?.content) ? parsed.message.content : [];
      for (const item of content) {
        if (item?.type === 'tool_use') this.event(run, { type: 'tool_invocation', text: String(item.name || ''), data: { name: String(item.name || ''), input: item.input && typeof item.input === 'object' ? item.input : {} } });
        if (item?.type === 'tool_result') this.event(run, { type: 'tool_result', text: typeof item.content === 'string' ? item.content.slice(0, MAX_EVENT_TEXT) : JSON.stringify(item.content ?? '').slice(0, MAX_EVENT_TEXT), data: { toolUseId: String(item.tool_use_id || ''), isError: Boolean(item.is_error) } });
      }
      if (parsed?.type === 'result' && parsed?.structured_output && typeof parsed.structured_output === 'object') { run.report = parsed.structured_output; this.event(run, { type: 'report' }); }
    } catch { /* raw output event already preserves malformed lines */ }
  }
}

/** Find the codex CLI: explicit env override, else the desktop-app install, else PATH. */
export function discoverCodexExecutable(): string {
  if (process.env.CODEX_EXECUTABLE) return process.env.CODEX_EXECUTABLE;
  const local = process.env.LOCALAPPDATA;
  if (local) {
    const bin = path.join(local, 'OpenAI', 'Codex', 'bin');
    if (existsSync(bin)) {
      for (const entry of readdirSync(bin)) {
        const exe = path.join(bin, entry, 'codex.exe');
        if (existsSync(exe)) return exe;
      }
    }
  }
  return 'codex';
}

export class CodexAdapter extends CliCoderAdapter {
  readonly id = 'codex' as const;

  constructor(executable = discoverCodexExecutable()) { super(executable); }

  protected writeAdapterRunFiles(_packet: CoderRunPacket, runtimeDir: string): void {
    writeFileSync(path.join(runtimeDir, 'report-schema.json'), JSON.stringify(CODER_REPORT_SCHEMA), { encoding: 'utf8', flag: 'wx' });
  }

  protected buildArgs(run: InternalRun): string[] {
    // `codex exec` = proven non-interactive mode (codex-cli 0.144.0): JSONL
    // events on stdout, schema-shaped final message mirrored to a file.
    // Sandbox stays workspace-write: the CLI's own sandbox bounds writes to
    // the working root; auth is the user's existing Codex login, never a key.
    return ['exec', '--json', '--output-schema', path.join(run.runtimeDir, 'report-schema.json'), '--output-last-message', path.join(run.runtimeDir, 'last-message.json'), '--sandbox', 'workspace-write', '--color', 'never', run.packet.approvedPrompt];
  }

  protected pruneEnv(env: NodeJS.ProcessEnv): void {
    delete env.OPENAI_API_KEY;
  }

  protected parseStructuredLine(run: InternalRun, line: string): void {
    try {
      const parsed = JSON.parse(line);
      const threadId = parsed?.thread_id ?? parsed?.threadId;
      if (typeof threadId === 'string' && threadId && run.sessionId !== threadId) { run.sessionId = threadId; this.event(run, { type: 'session_identified', text: threadId }); }
    } catch { /* raw output event already preserves malformed lines */ }
  }

  protected override onProcessClose(run: InternalRun): void {
    // The final agent message file is the report authority (robust against
    // event-name drift across codex versions); its absence stays an honest null.
    try {
      const parsed = JSON.parse(readFileSync(path.join(run.runtimeDir, 'last-message.json'), 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) { run.report = parsed; this.event(run, { type: 'report' }); }
    } catch { /* no readable last message = no report */ }
  }
}

export const claudeCodeAdapter = new ClaudeCodeAdapter();
export const codexAdapter = new CodexAdapter();
