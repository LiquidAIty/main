/** Thin client for the saved Coder Card's Hermes terminal face. */

type ConsoleSessionState =
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'failed';

type ConsoleTransportMode = 'pty';

export type ConsoleSessionInfo = {
  id: string;
  ownerCardId: string;
  projectId: string;
  deckId: string;
  conversationId: string;
  targetRoot: string;
  mode: 'interactive';
  state: ConsoleSessionState;
  runtimeSource: 'repository_hermes_cli';
  transportMode: ConsoleTransportMode;
  profile: string;
  executable: string | null;
  hermesHome: string | null;
  interactiveSupported: true;
  pid: number | null;
  startedAt: string;
  updatedAt: string;
  stoppedAt: string | null;
  warnings: string[];
  error: string | null;
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
  listSessions(): Promise<ConsoleSessionInfo[]>;
  getSession(id: string): Promise<ConsoleSessionInfo | null>;
  streamOutput(
    id: string,
    onData: (data: string) => void,
    signal: AbortSignal,
  ): Promise<void>;
  sendInput(id: string, data: string): Promise<boolean>;
  resize(id: string, cols: number, rows: number): Promise<boolean>;
};

function createTerminalClient(base: string): CoderTerminalClient {
  return {
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
      return payload.session as ConsoleSessionInfo;
    },
    async streamOutput(id, onData, signal) {
      const response = await fetch(`${base}/sessions/${encodeURIComponent(id)}/pty`, {
        credentials: 'include',
        signal,
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(String(payload?.error || `coder_terminal_stream_failed_${response.status}`));
      }
      if (!response.body) throw new Error('coder_terminal_stream_body_missing');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const data = decoder.decode(value, { stream: true });
        if (data) onData(data);
      }
      const finalData = decoder.decode();
      if (finalData) onData(finalData);
    },
    async sendInput(id, data) {
      const response = await postJson(base, `/sessions/${encodeURIComponent(id)}/input`, { data });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.delivered) {
        throw new Error(String(payload?.error || `coder_terminal_input_failed_${response.status}`));
      }
      return Boolean(payload?.delivered);
    },
    async resize(id, cols, rows) {
      const response = await postJson(base, `/sessions/${encodeURIComponent(id)}/resize`, {
        cols,
        rows,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.resized) {
        throw new Error(String(payload?.error || `coder_terminal_resize_failed_${response.status}`));
      }
      return Boolean(payload?.resized);
    },
  };
}

export const coderTerminalClient = createTerminalClient('/api/coder/hermes/coder-terminal');
