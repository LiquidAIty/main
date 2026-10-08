export type CardTerminalConnectionState = 'opening' | 'connected' | 'exited' | 'failed';

export type CardTerminalAttachment = {
  storedSessionId: string;
  cardId: string;
  profile: string;
  attachIdentity: string;
  cols: number;
  rows: number;
  websocketUrl: string;
};

export type CardTerminalIdentity = {
  projectId: string;
  deckId: string;
  cardId: string;
  conversationId: string;
};

export type CardTerminalStream = {
  close(): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
};

type StreamHandlers = {
  onOutput(output: { sequence: number; data: string }): void;
  onState(state: {
    state: Exclude<CardTerminalConnectionState, 'opening'>;
    closeCode?: number;
    error?: string;
  }): void;
  onTransportError(): void;
};

function endpoint(identity: CardTerminalIdentity): string {
  return `/api/card-terminals/${encodeURIComponent(identity.projectId)}`
    + `/${encodeURIComponent(identity.deckId)}/${encodeURIComponent(identity.cardId)}`;
}

async function readResponse(response: Response): Promise<Record<string, unknown>> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(payload?.error || `card_terminal_request_failed_${response.status}`));
  }
  if (!payload || typeof payload !== 'object') throw new Error('card_terminal_invalid_response');
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

function attachmentFrom(payload: Record<string, unknown>): CardTerminalAttachment {
  if (
    typeof payload.storedSessionId !== 'string'
    || typeof payload.cardId !== 'string'
    || typeof payload.profile !== 'string'
    || typeof payload.attachIdentity !== 'string'
    || typeof payload.websocketUrl !== 'string'
    || !payload.websocketUrl.startsWith('ws://127.0.0.1:9119/api/pty?')
    || !Number.isInteger(payload.cols)
    || !Number.isInteger(payload.rows)
  ) {
    throw new Error('card_terminal_attachment_invalid');
  }
  return payload as unknown as CardTerminalAttachment;
}

export type CardTerminalClient = {
  open(identity: CardTerminalIdentity, size: { cols: number; rows: number }): Promise<CardTerminalAttachment>;
  stream(attachment: CardTerminalAttachment, handlers: StreamHandlers): CardTerminalStream;
};

export const cardTerminalClient: CardTerminalClient = {
  async open(identity, size) {
    return attachmentFrom(await post(`${endpoint(identity)}/open`, {
      ...size,
      conversationId: identity.conversationId,
    }));
  },

  stream(attachment, handlers) {
    const socket = new WebSocket(attachment.websocketUrl);
    socket.binaryType = 'arraybuffer';
    let closed = false;
    let sequence = 0;
    const decoder = new TextDecoder();
    socket.onopen = () => handlers.onState({ state: 'connected' });
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
        state: event.code === 1000 ? 'exited' : 'failed',
        closeCode: event.code,
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
