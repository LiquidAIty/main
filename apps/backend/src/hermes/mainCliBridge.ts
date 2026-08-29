import { randomBytes, randomUUID } from 'node:crypto';

export type MainDriverSource = 'internal_chat' | 'external_plugin' | 'native_cli';

export type MainCliBridgeEvent = {
  requestId: string;
  runId: string;
  kind: 'accepted' | 'started' | 'text' | 'completed' | 'failed' | 'rejected' | 'cancel_requested';
  delta?: string;
  finalText?: string;
  error?: string;
  nativeSessionId?: string;
  nativeTurnId?: string;
};

export type MainCliHistoryMessage = {
  role: 'user' | 'assistant';
  text: string;
};

type MainCliTurn = {
  requestId: string;
  runId: string;
  driverSource: Exclude<MainDriverSource, 'native_cli'>;
  message: string;
  delivered: boolean;
  onEvent: (event: MainCliBridgeEvent) => void;
  resolve: (value: { finalText: string; nativeSessionId: string; nativeTurnId: string }) => void;
  reject: (error: Error) => void;
};

export class MainCliBridge {
  private active: MainCliTurn | null = null;
  private lastPollAt = 0;
  private historySnapshot: { sessionId: string | null; messages: MainCliHistoryMessage[] } | null = null;

  notePoll(): void {
    this.lastPollAt = Date.now();
  }

  ready(): boolean {
    return Date.now() - this.lastPollAt < 5_000;
  }

  status(): { ready: boolean; activeDriver: MainDriverSource | null; runId: string | null } {
    return {
      ready: this.ready(),
      activeDriver: this.active?.driverSource || null,
      runId: this.active?.runId || null,
    };
  }

  submit(args: {
    runId: string;
    driverSource: Exclude<MainDriverSource, 'native_cli'>;
    message: string;
    onEvent: (event: MainCliBridgeEvent) => void;
  }): Promise<{ finalText: string; nativeSessionId: string; nativeTurnId: string }> {
    if (!this.ready()) throw new Error('main_cli_bridge_unavailable');
    if (this.active) throw new Error('main_driver_turn_already_running');
    const requestId = `main_cli_${randomUUID()}`;
    return new Promise((resolve, reject) => {
      this.active = {
        requestId,
        runId: args.runId,
        driverSource: args.driverSource,
        message: args.message,
        delivered: false,
        onEvent: args.onEvent,
        resolve,
        reject,
      };
    });
  }

  take(): Omit<MainCliTurn, 'onEvent' | 'resolve' | 'reject' | 'delivered'> | null {
    this.notePoll();
    if (!this.active || this.active.delivered) return null;
    this.active.delivered = true;
    const { requestId, runId, driverSource, message } = this.active;
    return { requestId, runId, driverSource, message };
  }

  acceptEvent(event: MainCliBridgeEvent): void {
    const active = this.active;
    if (!active || event.requestId !== active.requestId || event.runId !== active.runId) {
      throw new Error('main_cli_bridge_event_identity_mismatch');
    }
    active.onEvent(event);
    if (event.kind === 'completed') {
      this.active = null;
      active.resolve({
        finalText: String(event.finalText || ''),
        nativeSessionId: String(event.nativeSessionId || ''),
        nativeTurnId: String(event.nativeTurnId || ''),
      });
    } else if (event.kind === 'failed' || event.kind === 'rejected') {
      this.active = null;
      active.reject(new Error(event.error || `main_cli_turn_${event.kind}`));
    }
  }

  requestCancel(runId: string): boolean {
    return Boolean(this.active?.runId === runId);
  }

  acceptHistory(value: unknown): void {
    if (!value || typeof value !== 'object') throw new Error('main_cli_history_invalid');
    const record = value as Record<string, unknown>;
    if (!Array.isArray(record.messages) || record.messages.length > 1_000) {
      throw new Error('main_cli_history_invalid');
    }
    const messages: MainCliHistoryMessage[] = record.messages.map((message) => {
      if (!message || typeof message !== 'object') throw new Error('main_cli_history_invalid');
      const item = message as Record<string, unknown>;
      if (!['user', 'assistant'].includes(String(item.role)) || typeof item.text !== 'string') {
        throw new Error('main_cli_history_invalid');
      }
      return { role: item.role as MainCliHistoryMessage['role'], text: item.text };
    });
    if (messages.reduce((total, message) => total + message.text.length, 0) > 2_000_000) {
      throw new Error('main_cli_history_too_large');
    }
    this.historySnapshot = {
      sessionId: typeof record.sessionId === 'string' && record.sessionId
        ? record.sessionId
        : null,
      messages,
    };
    this.notePoll();
  }

  history(): { sessionId: string | null; messages: MainCliHistoryMessage[] } | null {
    return this.ready() && this.historySnapshot
      ? {
          sessionId: this.historySnapshot.sessionId,
          messages: this.historySnapshot.messages.map((message) => ({ ...message })),
        }
      : null;
  }
}

export const mainCliBridge = new MainCliBridge();
export const mainCliBridgeToken = randomBytes(32).toString('hex');
