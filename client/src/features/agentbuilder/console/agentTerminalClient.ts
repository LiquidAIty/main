export type AgentTerminalStatus = 'running' | 'exited' | 'failed';

export type AgentTerminalSession = {
  sessionId: string;
  cardId: string;
  profile: string;
  pid: number | null;
  ptyId: string | null;
  status: AgentTerminalStatus;
  cols: number;
  rows: number;
  exitCode?: number | null;
  error?: string | null;
};

export type AgentTerminalIdentity = {
  projectId: string;
  deckId: string;
  cardId: string;
};

export type AgentTerminalStream = {
  close(): void;
};

type StreamHandlers = {
  onOutput(output: { sequence: number; data: string }): void;
  onState(state: Partial<AgentTerminalSession>): void;
  onTransportError(): void;
};

function endpoint(identity: AgentTerminalIdentity): string {
  return `/api/agent-terminals/${encodeURIComponent(identity.projectId)}`
    + `/${encodeURIComponent(identity.deckId)}/${encodeURIComponent(identity.cardId)}`;
}

async function readResponse(response: Response): Promise<Record<string, unknown>> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(payload?.error || `agent_terminal_request_failed_${response.status}`));
  }
  if (!payload || typeof payload !== 'object') throw new Error('agent_terminal_invalid_response');
  return payload as Record<string, unknown>;
}

async function post(
  path: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return readResponse(response);
}

function sessionFrom(payload: Record<string, unknown>): AgentTerminalSession {
  if (
    typeof payload.sessionId !== 'string'
    || typeof payload.cardId !== 'string'
    || typeof payload.profile !== 'string'
    || !['running', 'exited', 'failed'].includes(String(payload.status))
    || !Number.isInteger(payload.cols)
    || !Number.isInteger(payload.rows)
  ) {
    throw new Error('agent_terminal_invalid_session');
  }
  return payload as unknown as AgentTerminalSession;
}

export type AgentTerminalClient = {
  open(identity: AgentTerminalIdentity, size: { cols: number; rows: number }): Promise<AgentTerminalSession>;
  stream(
    identity: AgentTerminalIdentity,
    sessionId: string,
    after: number,
    handlers: StreamHandlers,
  ): AgentTerminalStream;
  input(identity: AgentTerminalIdentity, sessionId: string, data: string): Promise<void>;
  resize(identity: AgentTerminalIdentity, sessionId: string, cols: number, rows: number): Promise<void>;
  stop(identity: AgentTerminalIdentity, sessionId: string): Promise<Partial<AgentTerminalSession>>;
};

export const agentTerminalClient: AgentTerminalClient = {
  async open(identity, size) {
    return sessionFrom(await post(`${endpoint(identity)}/open`, size));
  },

  stream(identity, sessionId, after, handlers) {
    const query = new URLSearchParams({ after: String(Math.max(0, after)) });
    const source = new EventSource(
      `${endpoint(identity)}/${encodeURIComponent(sessionId)}/events?${query.toString()}`,
      { withCredentials: true },
    );
    let closed = false;
    source.addEventListener('output', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as Record<string, unknown>;
        if (!Number.isInteger(payload.sequence) || typeof payload.data !== 'string') return;
        handlers.onOutput({ sequence: payload.sequence as number, data: payload.data });
      } catch {
        handlers.onTransportError();
      }
    });
    source.addEventListener('state', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as Record<string, unknown>;
        handlers.onState(payload as Partial<AgentTerminalSession>);
        if (payload.status === 'exited' || payload.status === 'failed') {
          closed = true;
          source.close();
        }
      } catch {
        handlers.onTransportError();
      }
    });
    source.onerror = () => {
      // EventSource retains this exact session stream and reconnects with its
      // Last-Event-ID. The initial `after` also gives the server a bounded replay.
      if (!closed) handlers.onTransportError();
    };
    return { close: () => { closed = true; source.close(); } };
  },

  async input(identity, sessionId, data) {
    await post(`${endpoint(identity)}/${encodeURIComponent(sessionId)}/input`, { data });
  },

  async resize(identity, sessionId, cols, rows) {
    await post(`${endpoint(identity)}/${encodeURIComponent(sessionId)}/resize`, { cols, rows });
  },

  async stop(identity, sessionId) {
    return await post(`${endpoint(identity)}/${encodeURIComponent(sessionId)}/stop`, {});
  },
};
