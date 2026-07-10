import { createHash, randomUUID } from 'node:crypto';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolveRepoRoot } from '../workspaceRoot';

export const CODER_ADAPTER_IDS = ['claude_code', 'codex'] as const;
export type CoderAdapterId = (typeof CODER_ADAPTER_IDS)[number];
export type CoderInvocationMode = 'individual' | 'harness_subagent' | 'mag_one_team';
export type CoderRunStatus = 'prepared' | 'running' | 'completed' | 'failed' | 'cancelled';

export type CoderRunPacket = {
  version: '1';
  runId: string;
  correlationId: string;
  projectId: string;
  deckId: string;
  cardId: string;
  adapter: 'claude_code';
  invocationMode: CoderInvocationMode;
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
  type: 'session_prepared' | 'process_started' | 'output' | 'report' | 'completed' | 'failed' | 'cancelled';
  stream?: 'stdout' | 'stderr';
  text?: string;
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

export interface CoderExecutionAdapter {
  readonly id: CoderAdapterId;
  availability(): { available: boolean; executable: string | null; version: string | null; error: string | null };
  validate(packet: CoderRunPacket): void;
  prepare(packet: CoderRunPacket): CoderRunSnapshot;
  start(runId: string): CoderRunSnapshot;
  sendInput(runId: string, input: string): void;
  cancel(runId: string): CoderRunSnapshot;
  inspect(runId: string): CoderRunSnapshot | null;
  finalOutput(runId: string): string;
  dispose(runId: string): void;
}

const MAX_PROMPT_BYTES = 100_000;
const MAX_EVENT_TEXT = 32_000;
const MAX_EVENTS = 1_000;
const PATH_PATTERN = /^(?![A-Za-z]:)(?![\\/])(?!.*(?:^|[\\/])\.\.(?:[\\/]|$)).+$/;

export function hashPrompt(prompt: string): string {
  return createHash('sha256').update(Buffer.from(prompt, 'utf8')).digest('hex');
}

export function createApprovedCoderRun(input: Omit<CoderRunPacket, 'version' | 'runId' | 'correlationId' | 'promptHash' | 'approvedAt' | 'adapter'> & { runId?: string; correlationId?: string }): CoderRunPacket {
  const approvedPrompt = String(input.approvedPrompt ?? '');
  return {
    ...input,
    version: '1',
    adapter: 'claude_code',
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

type InternalRun = CoderRunSnapshot & { child: ChildProcessWithoutNullStreams | null; runtimeDir: string };

export class ClaudeCodeAdapter implements CoderExecutionAdapter {
  readonly id = 'claude_code' as const;
  private readonly runs = new Map<string, InternalRun>();

  constructor(private readonly executable = process.env.CLAUDE_CODE_EXECUTABLE || 'claude') {}

  availability() {
    const probe = spawnSync(this.executable, ['--version'], { encoding: 'utf8', windowsHide: true });
    return probe.status === 0
      ? { available: true, executable: this.executable, version: String(probe.stdout).trim(), error: null }
      : { available: false, executable: null, version: null, error: String(probe.error?.message || probe.stderr || 'claude_code_unavailable').trim() };
  }

  validate(packet: CoderRunPacket): void {
    if (packet.adapter !== this.id) throw new Error('coder_adapter_mismatch');
    if (!packet.workspaceGranted || !packet.liveRunApproved || !packet.approvedAt) throw new Error('coder_run_not_approved');
    if (!packet.projectId || !packet.deckId || !packet.cardId || !packet.invocationMode) throw new Error('coder_run_identity_incomplete');
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
    const mcpConfig = {
      mcpServers: {
        liquid_aity_coder: {
          type: 'stdio',
          command: process.env.LIQUIDAITY_PYTHON || path.join(resolveRepoRoot(), 'apps', 'python-models', '.venv', 'Scripts', 'python.exe'),
          args: [path.join(resolveRepoRoot(), 'apps', 'python-models', 'app', 'dev_agent_harness_mcp.py')],
          env: { LIQUIDAITY_CODER_RUN_ID: packet.runId },
        },
      },
    };
    writeFileSync(path.join(runtimeDir, 'mcp.json'), JSON.stringify(mcpConfig), { encoding: 'utf8', flag: 'wx' });
    writeFileSync(path.join(runtimeDir, 'prompt.txt'), packet.approvedPrompt, { encoding: 'utf8', flag: 'wx' });
    writeFileSync(path.join(runtimeDir, 'run.json'), JSON.stringify({ ...packet, approvedPrompt: undefined }, null, 2), { encoding: 'utf8', flag: 'wx' });
    const run: InternalRun = { packet, status: 'prepared', sessionId: randomUUID(), processId: null, exitCode: null, error: null, events: [], finalOutput: '', report: null, child: null, runtimeDir };
    this.runs.set(packet.runId, run);
    this.event(run, { type: 'session_prepared' });
    return this.public(run);
  }

  start(runId: string): CoderRunSnapshot {
    const run = this.required(runId);
    if (run.status !== 'prepared' || run.child) throw new Error('coder_run_duplicate_start');
    const args = ['--print', '--output-format', 'stream-json', '--include-hook-events', '--input-format', 'text', '--session-id', run.sessionId, '--mcp-config', path.join(run.runtimeDir, 'mcp.json'), '--strict-mcp-config', '--permission-mode', 'dontAsk', '--disallowedTools', 'WebFetch,WebSearch', run.packet.approvedPrompt];
    const child = spawn(this.executable, args, { cwd: run.packet.repositoryRoot, env: { ...process.env, LIQUIDAITY_CODER_RUN_ID: runId }, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    run.child = child;
    run.status = 'running';
    run.processId = child.pid ?? null;
    this.event(run, { type: 'process_started' });
    child.stdout.on('data', (chunk) => this.consume(run, 'stdout', chunk));
    child.stderr.on('data', (chunk) => this.consume(run, 'stderr', chunk));
    child.once('error', (error) => { run.error = error.message; run.status = 'failed'; this.event(run, { type: 'failed', text: error.message }); });
    child.once('close', (code) => { run.exitCode = code; run.child = null; if (run.status !== 'cancelled') run.status = code === 0 ? 'completed' : 'failed'; this.event(run, { type: run.status === 'completed' ? 'completed' : 'failed', text: `exit_code=${code}` }); });
    child.stdin.end();
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
  dispose(runId: string): void { const run = this.required(runId); if (run.child) throw new Error('coder_run_still_running'); rmSync(run.runtimeDir, { recursive: true, force: true }); this.runs.delete(runId); }

  private consume(run: InternalRun, stream: 'stdout' | 'stderr', chunk: Buffer): void {
    const text = chunk.toString('utf8').slice(0, MAX_EVENT_TEXT);
    run.finalOutput = (run.finalOutput + text).slice(-500_000);
    this.event(run, { type: 'output', stream, text });
    for (const line of text.split(/\r?\n/).filter(Boolean)) {
      try { const parsed = JSON.parse(line); if (parsed?.type === 'result' && parsed?.structured_output && typeof parsed.structured_output === 'object') { run.report = parsed.structured_output; this.event(run, { type: 'report' }); } } catch { /* partial stream line */ }
    }
  }

  private event(run: InternalRun, event: Omit<CoderRunEvent, 'sequence' | 'timestamp'>): void { run.events.push({ ...event, sequence: run.events.length + 1, timestamp: new Date().toISOString() }); if (run.events.length > MAX_EVENTS) run.events.splice(0, run.events.length - MAX_EVENTS); }
  private required(runId: string): InternalRun { const run = this.runs.get(runId); if (!run) throw new Error('coder_run_not_found'); return run; }
  private public(run: InternalRun): CoderRunSnapshot {
    return structuredClone({ packet: run.packet, status: run.status, sessionId: run.sessionId, processId: run.processId, exitCode: run.exitCode, error: run.error, events: run.events, finalOutput: run.finalOutput, report: run.report });
  }
}

export const claudeCodeAdapter = new ClaudeCodeAdapter();
