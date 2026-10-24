// Entity: Card Terminals
// Relationship: This file opens the authenticated same-origin terminal proxy and streams output, input, resize frames, and connection state.
// Entity: Card Sessions
// Relationship: This file validates the exact Project, deck, Card, profile, session, and application-owned WebSocket identity returned before streaming.

export type AgentTerminalStatus = 'opening' | 'connected' | 'disconnected' | 'failed';

export type AgentTerminalSession = {
  projectId: string;
  deckId: string;
  sessionId: string;
  cardId: string;
  profile: string;
  status: AgentTerminalStatus;
  cols: number;
  rows: number;
  websocketUrl: string;
  closeCode?: number | null;
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

function terminalDimension(value: unknown, defaultValue: number): number {
  return Number.isSafeInteger(value) && Number(value) >= 1 ? Number(value) : defaultValue;
}

function sameOriginWebSocketUrl(path: string): string {
  if (!path.startsWith('/api/card-terminals/') || !path.endsWith('/stream')) {
    throw new Error('card_terminal_invalid_response');
  }
  const url = new URL(path, window.location.href);
  url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  url.username = '';
  url.password = '';
  return url.toString();
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
    const projectId = String(payload.projectId || '');
    const deckId = String(payload.deckId || '');
    const cardId = String(payload.cardId || '');
    const profile = String(payload.profile || '');
    const sessionId = String(payload.sessionId || '');
    const websocketPath = String(payload.websocketPath || '');
    if (
      projectId !== identity.projectId
      || deckId !== identity.deckId
      || cardId !== identity.cardId
      || !profile
      || !sessionId
      || !websocketPath
    ) {
      throw new Error('card_terminal_invalid_response');
    }
    return {
      projectId,
      deckId,
      sessionId,
      cardId,
      profile,
      status: 'opening',
      cols: terminalDimension(payload.cols, size.cols),
      rows: terminalDimension(payload.rows, size.rows),
      websocketUrl: sameOriginWebSocketUrl(websocketPath),
    };
  },

  stream(session, handlers) {
    const socket = new WebSocket(session.websocketUrl);
    socket.binaryType = 'arraybuffer';
    let sequence = 0;
    let closed = false;
    socket.onopen = () => {
      handlers.onState({ status: 'connected' });
      socket.send(`\u001b[RESIZE:${Math.max(2, Math.floor(session.cols))};${Math.max(1, Math.floor(session.rows))}]`);
    };
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
        status: event.wasClean ? 'disconnected' : 'failed',
        closeCode: event.code || null,
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
