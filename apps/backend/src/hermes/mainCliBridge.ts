import { randomBytes, randomUUID } from 'node:crypto';

export type MainDriverSource = 'internal_chat' | 'external_plugin' | 'native_cli';
export type MainContextAuthorityMode = 'main_native_honcho' | 'plugin_context_only';

export function contextAuthorityModeForDriver(
  driverSource: MainDriverSource,
): MainContextAuthorityMode {
  return driverSource === 'external_plugin' ? 'plugin_context_only' : 'main_native_honcho';
}

export type MainCliBridgeEvent = {
  requestId: string;
  runId: string;
  kind: 'accepted' | 'started' | 'text' | 'completed' | 'failed' | 'rejected' | 'cancel_requested';
  delta?: string;
  finalText?: string;
  error?: string;
  nativeSessionId?: string;
  nativeTurnId?: string;
  contextAuthorityMode?: MainContextAuthorityMode;
};

export type MainCliHistoryMessage = {
  role: 'user' | 'assistant';
  text: string;
};

type MainCliTurn = {
  requestId: string;
  runId: string;
  executionContextId: string;
  driverSource: Exclude<MainDriverSource, 'native_cli'>;
  message: string;
  contextAuthorityMode: MainContextAuthorityMode;
  delivered: boolean;
  onEvent: (event: MainCliBridgeEvent) => void;
  resolve: (value: { finalText: string; nativeSessionId: string; nativeTurnId: string;
    contextAuthorityMode: MainContextAuthorityMode }) => void;
  reject: (error: Error) => void;
};

export type MainCliTeamDelivery = {
  deliveryId: string;
  sessionId: string;
  taskId: string;
  result: string;
  state: 'completed' | 'blocked' | 'failed' | 'cancelled';
};

type PendingTeamDelivery = MainCliTeamDelivery & {
  claimed: boolean;
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

export class MainCliBridge {
  private active: MainCliTurn | null = null;
  private lastPollAt = 0;
  private historySnapshot: { sessionId: string | null; messages: MainCliHistoryMessage[] } | null = null;
  private teamDeliveries = new Map<string, PendingTeamDelivery>();

  notePoll(): void {
    this.lastPollAt = Date.now();
  }

  ready(): boolean {
    return Date.now() - this.lastPollAt < 5_000;
  }

  status(): { ready: boolean; activeDriver: MainDriverSource | null;
    activeContextAuthorityMode: MainContextAuthorityMode | null; runId: string | null } {
    return {
      ready: this.ready(),
      activeDriver: this.active?.driverSource || null,
      activeContextAuthorityMode: this.active?.contextAuthorityMode || null,
      runId: this.active?.runId || null,
    };
  }

  submit(args: {
    runId: string;
    executionContextId: string;
    driverSource: Exclude<MainDriverSource, 'native_cli'>;
    message: string;
    onEvent: (event: MainCliBridgeEvent) => void;
  }): Promise<{ finalText: string; nativeSessionId: string; nativeTurnId: string;
    contextAuthorityMode: MainContextAuthorityMode }> {
    if (!this.ready()) throw new Error('main_cli_bridge_unavailable');
    if (this.active) throw new Error('main_driver_turn_already_running');
    const executionContextId = String(args.executionContextId || '').trim();
    if (!executionContextId) throw new Error('main_cli_execution_context_required');
    const requestId = `main_cli_${randomUUID()}`;
    return new Promise((resolve, reject) => {
      this.active = {
        requestId,
        runId: args.runId,
        executionContextId,
        driverSource: args.driverSource,
        contextAuthorityMode: contextAuthorityModeForDriver(args.driverSource),
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
    const { requestId, runId, executionContextId, driverSource, message, contextAuthorityMode } = this.active;
    return { requestId, runId, executionContextId, driverSource, message, contextAuthorityMode };
  }

  authorizeExecutionBinding(args: {
    requestId: string;
    runId: string;
    executionContextId: string;
  }): void {
    const active = this.active;
    if (
      !active
      || args.requestId !== active.requestId
      || args.runId !== active.runId
      || args.executionContextId !== active.executionContextId
    ) {
      throw new Error('main_cli_execution_binding_identity_mismatch');
    }
  }

  queueTeamResult(
    args: Omit<MainCliTeamDelivery, 'deliveryId'>,
    timeoutMs = 1_000,
  ): Promise<void> {
    const taskId = String(args.taskId || '').trim();
    const sessionId = String(args.sessionId || '').trim();
    const result = String(args.result || '').trim();
    if (!taskId || !sessionId || !result) throw new Error('main_cli_team_delivery_incomplete');
    const existing = this.teamDeliveries.get(taskId);
    if (existing) return existing.promise;
    const deliveryId = `main_team_${randomUUID()}`;
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((accept, decline) => {
      resolve = accept;
      reject = decline;
    });
    const delivery: PendingTeamDelivery = {
      ...args,
      taskId,
      sessionId,
      result,
      deliveryId,
      claimed: false,
      promise,
      resolve,
      reject,
      timeout: setTimeout(() => {
        if (this.teamDeliveries.get(taskId)?.deliveryId !== deliveryId) return;
        this.teamDeliveries.delete(taskId);
        reject(new Error('hermes_team_session_turn_in_progress'));
      }, Math.max(100, Math.min(5_000, timeoutMs))),
    };
    this.teamDeliveries.set(taskId, delivery);
    return promise;
  }

  takeTeamResult(): MainCliTeamDelivery | null {
    this.notePoll();
    const delivery = [...this.teamDeliveries.values()].find((item) => !item.claimed);
    if (!delivery) return null;
    delivery.claimed = true;
    const { deliveryId, sessionId, taskId, result, state } = delivery;
    return { deliveryId, sessionId, taskId, result, state };
  }

  acknowledgeTeamResult(args: {
    deliveryId: string;
    delivered: boolean;
    retry?: boolean;
    error?: string;
  }): void {
    const match = [...this.teamDeliveries.entries()]
      .find(([, delivery]) => delivery.deliveryId === args.deliveryId);
    if (!match) throw new Error('main_cli_team_delivery_unknown');
    const [taskId, delivery] = match;
    clearTimeout(delivery.timeout);
    this.teamDeliveries.delete(taskId);
    if (args.delivered) {
      delivery.resolve();
      return;
    }
    delivery.reject(new Error(args.retry
      ? 'hermes_team_session_turn_in_progress'
      : String(args.error || 'main_cli_team_delivery_failed')));
  }

  acceptEvent(event: MainCliBridgeEvent): void {
    const active = this.active;
    if (!active || event.requestId !== active.requestId || event.runId !== active.runId) {
      throw new Error('main_cli_bridge_event_identity_mismatch');
    }
    if (event.contextAuthorityMode && event.contextAuthorityMode !== active.contextAuthorityMode) {
      throw new Error('main_cli_bridge_context_authority_mismatch');
    }
    active.onEvent(event);
    if (event.kind === 'completed') {
      this.active = null;
      active.resolve({
        finalText: String(event.finalText || ''),
        nativeSessionId: String(event.nativeSessionId || ''),
        nativeTurnId: String(event.nativeTurnId || ''),
        contextAuthorityMode: active.contextAuthorityMode,
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
