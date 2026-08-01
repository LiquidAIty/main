import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';

type RpcResponse = { id?: number; result?: unknown; error?: { message?: string } };

export type CodexAppServerInspection = {
  ready: boolean;
  cardId: string;
  runtime: 'codex_app_server';
  agentClass: 'external_general';
  account: unknown;
  models: unknown;
  error: string | null;
};

/** Dedicated owner for the ordinary OpenAI Codex card. It speaks the native
 * app-server JSON-RPC protocol directly; it is deliberately unrelated to the
 * OpenClaude System Coder and never injects LiquidAIty or CBM MCP servers. */
export class CodexAppServerSession {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  private initialized = false;
  private ownerCardId: string | null = null;
  private activeThreadId: string | null = null;
  private activeTurnId: string | null = null;
  private events: Array<{ method: string; params: unknown }> = [];

  private command(): string {
    return String(process.env.LIQUIDAITY_CODEX_COMMAND || 'codex').trim();
  }

  private async request(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.child?.stdin.writable) throw new Error('codex_app_server_not_running');
    const id = this.nextId++;
    const result = new Promise<unknown>((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.child.stdin.write(`${JSON.stringify({ method, id, params })}\n`);
    const timer = setTimeout(() => {
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      pending.reject(new Error(`codex_app_server_timeout:${method}`));
    }, 8_000);
    return result.finally(() => clearTimeout(timer));
  }

  private notify(method: string, params: Record<string, unknown> = {}): void {
    if (!this.child?.stdin.writable) throw new Error('codex_app_server_not_running');
    this.child.stdin.write(`${JSON.stringify({ method, params })}\n`);
  }

  private async ensureStarted(cardId: string): Promise<void> {
    if (this.initialized && this.child) return;
    this.ownerCardId = cardId;
    const child = spawn(this.command(), ['app-server'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.child = child;
    createInterface({ input: child.stdout }).on('line', (line) => {
      let message: RpcResponse;
      try { message = JSON.parse(line) as RpcResponse; } catch { return; }
      if (typeof message.id === 'number') {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message || 'codex_app_server_error'));
        else pending.resolve(message.result);
        return;
      }
      const notification = message as unknown as { method?: string; params?: any };
      if (notification.method) {
        this.events.push({ method: notification.method, params: notification.params ?? null });
        if (this.events.length > 200) this.events.shift();
      }
      if (notification.method === 'turn/started') {
        this.activeTurnId = String(notification.params?.turn?.id || '') || this.activeTurnId;
      }
      if (notification.method === 'turn/completed') this.activeTurnId = null;
    });
    child.once('exit', () => {
      for (const pending of this.pending.values()) pending.reject(new Error('codex_app_server_exited'));
      this.pending.clear();
      this.child = null;
      this.initialized = false;
      this.activeThreadId = null;
      this.activeTurnId = null;
    });
    child.once('error', (error) => {
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    });
    await this.request('initialize', {
      clientInfo: { name: 'liquidaity-openai-coder', title: 'LiquidAIty OpenAI Coder', version: '0.1.0' },
    });
    this.notify('initialized');
    this.initialized = true;
  }

  async inspect(cardId: string): Promise<CodexAppServerInspection> {
    try {
      await this.ensureStarted(cardId);
      const [account, models] = await Promise.all([
        this.request('account/read', { refreshToken: false }),
        this.request('model/list', {}),
      ]);
      return { ready: true, cardId, runtime: 'codex_app_server', agentClass: 'external_general', account, models, error: null };
    } catch (error) {
      return {
        ready: false, cardId, runtime: 'codex_app_server', agentClass: 'external_general',
        account: null, models: null, error: error instanceof Error ? error.message : 'codex_app_server_unavailable',
      };
    }
  }

  async stop(cardId: string): Promise<void> {
    if (cardId !== this.ownerCardId) throw new Error('codex_card_process_owner_mismatch');
    if (!this.activeThreadId || !this.activeTurnId) throw new Error('codex_card_no_active_turn');
    await this.request('turn/interrupt', { threadId: this.activeThreadId, turnId: this.activeTurnId });
  }

  async start(input: {
    cardId: string; model: string; cwd: string; assignment: string;
    approvalPolicy: string; sandbox: string;
  }): Promise<{ threadId: string; turnId: string; events: Array<{ method: string; params: unknown }> }> {
    await this.ensureStarted(input.cardId);
    if (input.cardId !== this.ownerCardId) throw new Error('codex_card_process_owner_mismatch');
    if (this.activeTurnId) throw new Error('codex_card_turn_already_active');
    const threadResult = await this.request('thread/start', {
      model: input.model,
      cwd: input.cwd,
      approvalPolicy: input.approvalPolicy,
      sandbox: input.sandbox,
    }) as { thread?: { id?: unknown } };
    const threadId = String(threadResult?.thread?.id || '');
    if (!threadId) throw new Error('codex_app_server_thread_id_missing');
    this.activeThreadId = threadId;
    this.events = [];
    const turnResult = await this.request('turn/start', {
      threadId,
      input: [{ type: 'text', text: input.assignment }],
    }) as { turn?: { id?: unknown } };
    const turnId = String(turnResult?.turn?.id || '');
    if (!turnId) throw new Error('codex_app_server_turn_id_missing');
    this.activeTurnId = turnId;
    return { threadId, turnId, events: [...this.events] };
  }

  status(cardId: string): Record<string, unknown> {
    return {
      cardId,
      runtime: 'codex_app_server',
      agentClass: 'external_general',
      ownsProcess: cardId === this.ownerCardId && Boolean(this.child),
      initialized: this.initialized,
      threadId: cardId === this.ownerCardId ? this.activeThreadId : null,
      turnId: cardId === this.ownerCardId ? this.activeTurnId : null,
      events: cardId === this.ownerCardId ? [...this.events] : [],
    };
  }

  async steer(cardId: string, input: string): Promise<void> {
    if (cardId !== this.ownerCardId) throw new Error('codex_card_process_owner_mismatch');
    if (!this.activeThreadId || !this.activeTurnId) throw new Error('codex_card_no_active_turn');
    await this.request('turn/steer', {
      threadId: this.activeThreadId,
      turnId: this.activeTurnId,
      input: [{ type: 'text', text: input }],
    });
  }
}

export const codexAppServerSession = new CodexAppServerSession();
