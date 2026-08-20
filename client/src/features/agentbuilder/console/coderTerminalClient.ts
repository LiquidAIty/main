/** Thin client for the saved Coder Card's Hermes terminal face. */

export type ConsoleMode = 'interactive';

export type ConsoleSessionState =
  | 'starting'
  | 'ready'
  | 'working'
  | 'waiting'
  | 'stopped'
  | 'failed'
  | 'auth_required';

type ConsoleTransportMode = 'acp-stdio';

export type ConsoleSessionInfo = {
  id: string;
  ownerCardId: string;
  projectId: string;
  deckId: string;
  conversationId: string;
  targetRoot: string;
  mode: 'interactive';
  state: ConsoleSessionState;
  runtimeSource: 'saved_hermes_card';
  transportMode: ConsoleTransportMode;
  profile: string;
  provider: string | null;
  model: string | null;
  interactiveSupported: true;
  pid: number | null;
  nativeSessionId: string | null;
  activeRunId: string | null;
  startedAt: string;
  updatedAt: string;
  stoppedAt: string | null;
  warnings: string[];
  error: string | null;
};

export type ConsoleOutputChunk = {
  seq: number;
  stream: 'stdout' | 'stderr' | 'system';
  data: string;
  at: string;
};

type StartSessionResult =
  | { ok: true; session: ConsoleSessionInfo; transcript: ConsoleOutputChunk[] }
  | {
    ok: false;
    error: string;
    missing: string[];
    session?: ConsoleSessionInfo;
    transcript?: ConsoleOutputChunk[];
  };

async function postJson(base: string, path: string, body: unknown): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
}

export type CoderTerminalClient = {
  startSession(request: {
    projectId: string;
    deckId: string;
    conversationId: string;
    targetRoot?: string;
    mode?: ConsoleMode;
  }): Promise<StartSessionResult>;
  listSessions(): Promise<ConsoleSessionInfo[]>;
  getSession(id: string): Promise<{ session: ConsoleSessionInfo; transcript: ConsoleOutputChunk[] } | null>;
  sendInput(id: string, message: string): Promise<boolean>;
  stopSession(id: string): Promise<boolean>;
  streamUrl(id: string): string;
};

export function createTerminalClient(base: string): CoderTerminalClient {
  return {
  async startSession(request) {
    const response = await postJson(base, '/sessions', request);
    const payload = await response.json().catch(() => ({}));
    if (response.ok && payload?.ok) {
      return {
        ok: true,
        session: payload.session as ConsoleSessionInfo,
        transcript: Array.isArray(payload.transcript) ? payload.transcript as ConsoleOutputChunk[] : [],
      };
    }
    return {
      ok: false,
      error: String(payload?.error || `coder_terminal_start_http_${response.status}`),
      missing: Array.isArray(payload?.missing) ? payload.missing.map(String) : [],
      ...(payload?.session ? { session: payload.session as ConsoleSessionInfo } : {}),
      ...(Array.isArray(payload?.transcript)
        ? { transcript: payload.transcript as ConsoleOutputChunk[] }
        : {}),
    };
  },
  async listSessions() {
    const response = await fetch(`${base}/sessions`, { credentials: 'include' });
    if (!response.ok) throw new Error(`console_sessions_unavailable_${response.status}`);
    const payload = await response.json().catch(() => null);
    if (!payload?.ok || !Array.isArray(payload.sessions)) {
      throw new Error('console_sessions_invalid_response');
    }
    return payload.sessions as ConsoleSessionInfo[];
  },
  async getSession(id) {
    const response = await fetch(`${base}/sessions/${encodeURIComponent(id)}`, {
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
  async sendInput(id, message) {
    const response = await postJson(base, `/sessions/${encodeURIComponent(id)}/input`, { message });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.delivered) {
      throw new Error(String(payload?.error || `coder_terminal_input_failed_${response.status}`));
    }
    return Boolean(payload?.delivered);
  },
  async stopSession(id) {
    const response = await postJson(base, `/sessions/${encodeURIComponent(id)}/stop`, {});
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(String(payload?.error || `coder_terminal_stop_failed_${response.status}`));
    }
    return Boolean(payload?.stopped);
  },
  streamUrl(id) {
    return `${base}/sessions/${encodeURIComponent(id)}/stream`;
  },
  };
}

export const coderTerminalClient = createTerminalClient('/api/coder/hermes/coder-terminal');
