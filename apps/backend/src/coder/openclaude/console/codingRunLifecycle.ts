import path from 'node:path';
import {
  parseCoderReport,
  parseCodingRunLifecycle,
  type CoderReport,
  type CodingRunLifecycle,
} from '../../../contracts/coderContracts';
import { recordThinkGraphEvent } from '../../../services/thinkgraph/thinkgraphMemory';
import {
  openClaudeConsoleSessionManager,
  type OpenClaudeConsoleSessionManager,
} from './consoleSession';

const MAX_RESULT_CHARS = 4_000;

export type RequestCodingRunInput = {
  projectId: string;
  targetRoot: string;
  userGoal: string;
  generatedSpec: string;
  editMode?: 'read_only' | 'edit';
};

type LifecycleDeps = {
  sessionManager?: OpenClaudeConsoleSessionManager;
  now?: () => string;
  idFactory?: () => string;
  recordMemory?: typeof recordThinkGraphEvent;
};

function compact(value: string, limit = MAX_RESULT_CHARS): string {
  const text = String(value || '').trim();
  return text.length <= limit ? text : `...[last ${limit} chars]\n${text.slice(-limit)}`;
}

function cleanList(values: string[], limit = 30): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, limit);
}

function extractProof(transcript: string): { commands: string[]; files: string[] } {
  const commands = Array.from(transcript.matchAll(/(?:^|\n)\s*(?:\$|>)\s+([^\r\n]+)/g))
    .map((match) => match[1] || '');
  const files = Array.from(
    transcript.matchAll(/\b(?:apps|client|scripts|skills|repo-intake)[\\/][A-Za-z0-9_.\-/\\]+/g),
  ).map((match) => match[0].replace(/\\/g, '/'));
  return { commands: cleanList(commands), files: cleanList(files) };
}

function coderReportCandidates(transcript: string): string[] {
  const fenced = Array.from(transcript.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi))
    .map((match) => match[1]?.trim() || '')
    .filter(Boolean);
  const objects: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < transcript.length; index += 1) {
    const char = transcript[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        objects.push(transcript.slice(start, index + 1));
        start = -1;
      }
    }
  }
  return [transcript.trim(), ...fenced, ...objects];
}

export function extractValidatedCoderReport(transcript: string): CoderReport | null {
  for (const candidate of coderReportCandidates(transcript)) {
    try {
      return parseCoderReport(JSON.parse(candidate));
    } catch {
      // Terminal text is evidence, not a valid CoderReport unless strict parsing succeeds.
    }
  }
  return null;
}

export class CodingRunLifecycleService {
  private readonly runs = new Map<string, CodingRunLifecycle>();
  private readonly sessionManager: OpenClaudeConsoleSessionManager;
  private readonly now: () => string;
  private readonly idFactory: () => string;
  private readonly recordMemory: typeof recordThinkGraphEvent;
  private counter = 0;

  constructor(deps: LifecycleDeps = {}) {
    this.sessionManager = deps.sessionManager || openClaudeConsoleSessionManager;
    this.now = deps.now || (() => new Date().toISOString());
    this.idFactory = deps.idFactory || (() => `coding_run_${Date.now().toString(36)}_${++this.counter}`);
    this.recordMemory = deps.recordMemory || recordThinkGraphEvent;
  }

  request(input: RequestCodingRunInput): CodingRunLifecycle {
    const now = this.now();
    const run = parseCodingRunLifecycle({
      id: this.idFactory(),
      projectId: String(input.projectId || '').trim(),
      targetRoot: path.resolve(input.targetRoot),
      userGoal: String(input.userGoal || '').trim(),
      generatedSpec: String(input.generatedSpec || '').trim(),
      editMode: input.editMode || 'read_only',
      sessionId: null,
      provider: null,
      model: null,
      status: 'awaiting_approval',
      resultSummary: 'Plan/SPEC created. Waiting for explicit user approval.',
      proofCommands: [],
      proofFiles: [],
      validatedCoderReport: false,
      coderReport: null,
      blocker: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      memoryRecordStatus: 'pending',
      memoryRecordDetail: '',
    });
    this.runs.set(run.id, run);
    return run;
  }

  approve(id: string): CodingRunLifecycle {
    return this.patch(id, {
      status: 'approved',
      resultSummary: 'Explicit user approval recorded. Dispatch is allowed.',
    });
  }

  dispatched(id: string, sessionId: string, provider: string | null, model: string | null): CodingRunLifecycle {
    return this.patch(id, {
      status: 'running',
      sessionId,
      provider: provider || null,
      model: model || null,
      resultSummary: `Coder Console session ${sessionId} started asynchronously.`,
    });
  }

  blocked(id: string, blocker: string): CodingRunLifecycle {
    return this.patch(id, {
      status: 'blocked',
      blocker,
      resultSummary: `Coding run blocked: ${blocker}`,
      completedAt: this.now(),
    });
  }

  get(id: string): CodingRunLifecycle | undefined {
    return this.runs.get(id);
  }

  async refresh(id: string): Promise<CodingRunLifecycle | undefined> {
    const run = this.runs.get(id);
    if (!run || !run.sessionId || ['completed', 'failed', 'blocked'].includes(run.status)) return run;
    const session = this.sessionManager.get(run.sessionId);
    if (!session) return this.blocked(id, 'console_session_not_found');
    if (session.info.state === 'starting' || session.info.state === 'running') {
      return this.patch(id, { status: 'running' });
    }
    const transcript = session.transcriptText();
    const report = extractValidatedCoderReport(transcript);
    const proof = extractProof(transcript);
    const failed = session.info.state === 'failed' || session.info.exitCode !== 0;
    const updated = this.patch(id, {
      status: failed ? 'failed' : 'completed',
      resultSummary: report
        ? compact(report.summary)
        : compact(transcript) || `Coder Console session exited with code ${String(session.info.exitCode)}.`,
      proofCommands: report?.proofCommands || proof.commands,
      proofFiles: report?.filesChanged || proof.files,
      validatedCoderReport: Boolean(report),
      coderReport: report,
      blocker: failed
        ? session.info.error || `console_session_exit_code_${String(session.info.exitCode)}`
        : null,
      completedAt: this.now(),
    });
    await this.recordOutcome(updated);
    return updated;
  }

  private patch(id: string, patch: Partial<CodingRunLifecycle>): CodingRunLifecycle {
    const current = this.runs.get(id);
    if (!current) throw new Error('coding_run_not_found');
    const updated = parseCodingRunLifecycle({ ...current, ...patch, updatedAt: this.now() });
    this.runs.set(id, updated);
    return updated;
  }

  private async recordOutcome(run: CodingRunLifecycle): Promise<void> {
    if (run.memoryRecordStatus !== 'pending') return;
    try {
      await this.recordMemory({
        projectId: run.projectId,
        eventType: run.status === 'completed' ? 'run_completed' : 'run_failed',
        title: `Coding run ${run.status}: ${run.userGoal}`,
        summary: run.resultSummary,
        status: run.status === 'completed' ? 'complete' : 'failed',
        task: run.generatedSpec,
        runtimeRoute: 'chat -> Mag One -> coder_console_task -> Code Console -> lifecycle collector',
        finalOutput: run.resultSummary,
        error: run.blocker,
        proofSummary: [
          ...run.proofCommands.map((command) => `command: ${command}`),
          ...run.proofFiles.map((file) => `file: ${file}`),
          `validatedCoderReport: ${String(run.validatedCoderReport)}`,
          `sessionId: ${run.sessionId || ''}`,
        ],
      });
      this.patch(run.id, { memoryRecordStatus: 'recorded', memoryRecordDetail: 'ThinkGraph run outcome recorded.' });
    } catch (error) {
      this.patch(run.id, {
        memoryRecordStatus: 'failed',
        memoryRecordDetail: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export const codingRunLifecycleService = new CodingRunLifecycleService();
