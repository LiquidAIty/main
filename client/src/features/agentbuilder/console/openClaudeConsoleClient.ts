/**
 * OpenClaude Console Bridge — frontend client.
 *
 * Thin wrapper over the backend `/api/coder/openclaude/console/*` routes that
 * run the real OpenClaude CLI as a streamed process. The terminal view uses
 * this to start/stop sessions, send input, and read the live transcript.
 */

export type ConsoleMode = 'interactive' | 'print' | 'task' | 'shell';

export type ConsoleSessionState = 'starting' | 'running' | 'exited' | 'failed';

export type ConsoleTransportMode = 'pty' | 'pipe';

export type ConsoleSessionInfo = {
  id: string;
  targetRoot: string;
  mode: ConsoleMode;
  state: ConsoleSessionState;
  commandPath: string;
  runtimeSource: string;
  transportMode: ConsoleTransportMode;
  provider: string | null;
  model: string | null;
  interactiveSupported: boolean;
  pid: number | null;
  startedAt: string | null;
  exitedAt: string | null;
  exitCode: number | null;
  exitSignal: string | null;
  warnings: string[];
  error: string | null;
};

export type ConsoleOutputChunk = {
  seq: number;
  stream: 'stdout' | 'stderr' | 'system';
  data: string;
  at: string;
};

export type StartSessionResult =
  | { ok: true; session: ConsoleSessionInfo }
  | { ok: false; error: string; missing: string[] };

export type CodingRunStatus =
  | 'requested'
  | 'planned'
  | 'awaiting_approval'
  | 'approved'
  | 'dispatched'
  | 'running'
  | 'completed'
  | 'failed'
  | 'blocked';

export type CodingRunLifecycle = {
  id: string;
  projectId: string;
  targetRoot: string;
  userGoal: string;
  generatedSpec: string;
  sessionId: string | null;
  status: CodingRunStatus;
  resultSummary: string;
  proofCommands: string[];
  proofFiles: string[];
  validatedCoderReport: boolean;
  coderReport: {
    filesChanged: string[];
    nextRecommendedTask: string;
  } | null;
  blocker: string | null;
  memoryRecordStatus: 'pending' | 'recorded' | 'skipped' | 'failed';
  memoryRecordDetail: string;
};

export type CodingRunResult = {
  codingRun: CodingRunLifecycle;
  consoleTranscriptPath: string | null;
};

const BASE = '/api/coder/openclaude/console';

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
}

export type OpenClaudeConsoleClient = {
  startSession(request: {
    targetRoot?: string;
    mode?: ConsoleMode;
    model?: string;
    provider?: string;
    prompt?: string;
    args?: string[];
  }): Promise<StartSessionResult>;
  getSession(id: string): Promise<{ session: ConsoleSessionInfo; transcript: ConsoleOutputChunk[] } | null>;
  getCodingRun(idOrStatusUrl: string): Promise<CodingRunResult | null>;
  sendInput(id: string, data: string): Promise<boolean>;
  resizeSession(id: string, cols: number, rows: number): Promise<boolean>;
  stopSession(id: string): Promise<boolean>;
  streamUrl(id: string): string;
};

export const openClaudeConsoleClient: OpenClaudeConsoleClient = {
  async startSession(request) {
    const response = await postJson('/sessions', request);
    const payload = await response.json().catch(() => ({}));
    if (response.ok && payload?.ok) {
      return { ok: true, session: payload.session as ConsoleSessionInfo };
    }
    return {
      ok: false,
      error: String(payload?.error || `console_start_failed_${response.status}`),
      missing: Array.isArray(payload?.missing) ? payload.missing.map(String) : [],
    };
  },
  async getSession(id) {
    const response = await fetch(`${BASE}/sessions/${encodeURIComponent(id)}`, {
      credentials: 'include',
    });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => null);
    if (!payload?.ok) return null;
    return {
      session: payload.session as ConsoleSessionInfo,
      transcript: (payload.transcript || []) as ConsoleOutputChunk[],
    };
  },
  async getCodingRun(idOrStatusUrl) {
    const url = idOrStatusUrl.startsWith('/')
      ? idOrStatusUrl
      : `${BASE}/runs/${encodeURIComponent(idOrStatusUrl)}`;
    const response = await fetch(url, { credentials: 'include' });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => null);
    if (!payload?.ok || !payload?.codingRun) return null;
    return {
      codingRun: payload.codingRun as CodingRunLifecycle,
      consoleTranscriptPath:
        typeof payload.consoleTranscriptPath === 'string'
          ? payload.consoleTranscriptPath
          : null,
    };
  },
  async sendInput(id, data) {
    const response = await postJson(`/sessions/${encodeURIComponent(id)}/input`, { data });
    const payload = await response.json().catch(() => ({}));
    return Boolean(payload?.delivered);
  },
  async resizeSession(id, cols, rows) {
    const response = await postJson(`/sessions/${encodeURIComponent(id)}/resize`, { cols, rows });
    const payload = await response.json().catch(() => ({}));
    return Boolean(payload?.resized);
  },
  async stopSession(id) {
    const response = await postJson(`/sessions/${encodeURIComponent(id)}/stop`, {});
    const payload = await response.json().catch(() => ({}));
    return Boolean(payload?.stopped);
  },
  streamUrl(id) {
    return `${BASE}/sessions/${encodeURIComponent(id)}/stream`;
  },
};
