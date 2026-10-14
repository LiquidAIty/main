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

function openEndpoint(identity: AgentTerminalIdentity): string {
  return `/api/card-terminals/${encodeURIComponent(identity.projectId)}`
    + `/${encodeURIComponent(identity.deckId)}/${encodeURIComponent(identity.cardId)}/open`;
}

function terminalDimension(value: unknown, fallback: number): number {
  return Number.isSafeInteger(value) && Number(value) >= 1 ? Number(value) : fallback;
}

export type AgentTerminalClient = {
  open(identity: AgentTerminalIdentity, size: { cols: number; rows: number }): Promise<AgentTerminalSession>;
  stream(session: AgentTerminalSession, handlers: StreamHandlers): AgentTerminalStream;
};

export const agentTerminalClient: AgentTerminalClient = {
  async open(identity, size) {
    const response = await fetch(openEndpoint(identity), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(size),
    });
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok || !payload) {
      throw new Error(typeof payload?.error === 'string'
        ? payload.error : `card_terminal_open_failed_${response.status}`);
    }
    const cardId = String(payload.cardId || '');
    const profile = String(payload.profile || '');
    const attachIdentity = String(payload.attachIdentity || '');
    const websocketUrl = String(payload.websocketUrl || '');
    if (!cardId || !profile || !attachIdentity || !/^wss?:\/\//i.test(websocketUrl)) {
      throw new Error('card_terminal_invalid_response');
    }
    return {
      sessionId: attachIdentity,
      cardId,
      profile,
      pid: null,
      ptyId: attachIdentity,
      status: 'running',
      cols: terminalDimension(payload.cols, size.cols),
      rows: terminalDimension(payload.rows, size.rows),
      websocketUrl,
    };
  },

  stream(session, handlers) {
    const socket = new WebSocket(session.websocketUrl);
    socket.binaryType = 'arraybuffer';
    let sequence = 0;
    let closed = false;
    socket.onopen = () => handlers.onState({ status: 'running' });
    socket.onmessage = (event) => {
      sequence += 1;
      const data = typeof event.data === 'string'
        ? event.data
        : event.data instanceof ArrayBuffer
          ? new TextDecoder().decode(new Uint8Array(event.data))
          : '';
      if (data) handlers.onOutput({ sequence, data });
    };
    socket.onerror = () => {
      if (!closed) handlers.onTransportError();
    };
    socket.onclose = (event) => {
      if (closed) return;
      closed = true;
      handlers.onState({
        status: event.wasClean ? 'exited' : 'failed',
        exitCode: event.code || null,
        ...(event.wasClean ? {} : { error: event.reason || 'card_terminal_connection_closed' }),
      });
    };
    return {
      close() {
        if (closed) return;
        closed = true;
        socket.close();
      },
      write(data: string) {
        if (socket.readyState === WebSocket.OPEN) socket.send(data);
      },
      resize(cols: number, rows: number) {
        if (socket.readyState !== WebSocket.OPEN) return;
        socket.send(`\u001b[RESIZE:${Math.max(2, Math.floor(cols))};${Math.max(1, Math.floor(rows))}]`);
      },
    };
  },
};
