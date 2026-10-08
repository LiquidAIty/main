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
  websocketUrl: string;
  exitCode?: number | null;
  error?: string | null;
};

export type AgentTerminalIdentity = {
  projectId: string;
  deckId: string;
  cardId: string;
  conversationId: string;
};

export type AgentTerminalStream = {
  close(): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
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
    || typeof payload.websocketUrl !== 'string'
    || !payload.websocketUrl.startsWith('ws://127.0.0.1:9119/api/pty?')
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
  stream(session: AgentTerminalSession, handlers: StreamHandlers): AgentTerminalStream;
};

export const agentTerminalClient: AgentTerminalClient = {
  async open(identity, size) {
    return sessionFrom(await post(`${endpoint(identity)}/open`, {
      ...size,
      conversationId: identity.conversationId,
    }));
  },

  stream(session, handlers) {
    const socket = new WebSocket(session.websocketUrl);
    socket.binaryType = 'arraybuffer';
    let closed = false;
    let sequence = 0;
    const decoder = new TextDecoder();
    socket.onopen = () => handlers.onState({ status: 'running' });
    socket.onmessage = (event) => {
      let data = '';
      if (typeof event.data === 'string') {
        if (event.data.startsWith('{')) {
          try {
            const control = JSON.parse(event.data) as Record<string, unknown>;
            if (control.type === 'resume') return;
          } catch {
            /* Raw terminal output may legitimately begin with an opening brace. */
          }
        }
        data = event.data;
      } else if (event.data instanceof ArrayBuffer) {
        data = decoder.decode(event.data);
      }
      if (data) handlers.onOutput({ sequence: ++sequence, data });
    };
    socket.onerror = () => {
      if (!closed) handlers.onTransportError();
    };
    socket.onclose = (event) => {
      if (closed) return;
      closed = true;
      handlers.onState({
        status: event.code === 1000 ? 'exited' : 'failed',
        exitCode: event.code,
        ...(event.reason ? { error: event.reason } : {}),
      });
    };
    return {
      close: () => {
        closed = true;
        socket.close();
      },
      write: (data) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(data);
      },
      resize: (cols, rows) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(`\u001b[RESIZE:${cols};${rows}]`);
        }
      },
    };
  },
};
