import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createInterface } from 'node:readline';

type RpcResponse = { id?: number; result?: unknown; error?: { message?: string } };
type CodexEvent = { method: string; params: unknown; at: string };

export type CodexAppServerInspection = {
  ready: boolean;
  testReady: boolean;
  state: 'READY' | 'AWAITING_USER_LOGIN' | 'MODEL_UNAVAILABLE' | 'UNAVAILABLE';
  cardId: string;
  runtime: 'codex_app_server';
  agentClass: 'external_general';
  account: unknown;
  rateLimits: unknown;
  models: unknown;
  selectedModel: string;
  selectedModelAvailable: boolean;
  error: string | null;
};

export type CodexRunReceipt = {
  cardId: string;
  route: 'main_mag_one_openai_coder';
  runtime: 'codex_app_server';
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  taskBody: string;
  threadId: string;
  turnId: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  toolCalls: Array<{ method: string; at: string }>;
  usage: unknown;
  controlEvents: Array<{ action: 'stop' | 'steer'; at: string }>;
  result: unknown;
  failure: string | null;
};

const OPENAI_CODER_MODEL = 'gpt-5.6-sol';

function modelIds(value: unknown): string[] {
  const rows = Array.isArray((value as { data?: unknown[] } | null)?.data)
    ? (value as { data: unknown[] }).data
    : [];
  return rows
    .map((row) => String((row as { id?: unknown; model?: unknown })?.id || (row as { model?: unknown })?.model || '').trim())
    .filter(Boolean);
}

function accountValue(value: unknown): unknown {
  return (value as { account?: unknown } | null)?.account ?? null;
}

/** One native Codex app-server owner for the ordinary OpenAI Coder card. */
export class CodexAppServerSession {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  private initialized = false;
  private ownerCardId: string | null = null;
  private activeThreadId: string | null = null;
  private activeTurnId: string | null = null;
  private pendingLoginId: string | null = null;
  private events: CodexEvent[] = [];
  private receipt: CodexRunReceipt | null = null;
  private activeOutputText = '';
  private completionWaiters = new Map<string, Set<(receipt: CodexRunReceipt) => void>>();

  private launch(): { command: string; args: string[] } {
    const configured = String(process.env.LIQUIDAITY_CODEX_COMMAND || '').trim();
    if (configured) return { command: configured, args: ['app-server'] };
    const require = createRequire(path.join(process.cwd(), 'package.json'));
    const packageJson = require.resolve('@openai/codex/package.json');
    return {
      command: process.execPath,
      args: [path.join(path.dirname(packageJson), 'bin', 'codex.js'), 'app-server'],
    };
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

  private failPending(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  private recordNotification(method: string, params: unknown): void {
    const at = new Date().toISOString();
    this.events.push({ method, params: params ?? null, at });
    if (this.events.length > 200) this.events.shift();
    const body = params as any;
    if (method === 'turn/started') {
      this.activeTurnId = String(body?.turn?.id || '') || this.activeTurnId;
    }
    if (method === 'account/login/completed') this.pendingLoginId = null;
    if (this.receipt && (method === 'item/started' || method === 'item/completed')) {
      const itemType = String(body?.item?.type || '').trim();
      if (itemType && /command|tool|mcp/i.test(itemType)) {
        this.receipt.toolCalls.push({ method: `${method}:${itemType}`, at });
      }
    }
    if (this.receipt && /usage/i.test(method)) this.receipt.usage = params;
    if (method === 'item/agentMessage/delta') {
      this.activeOutputText += String(body?.delta || '').slice(0, 32_000);
      this.activeOutputText = this.activeOutputText.slice(-500_000);
    }
    if (method === 'item/completed' && String(body?.item?.type || '') === 'agentMessage') {
      const completedText = String(body?.item?.text || body?.item?.content || '').trim();
      if (completedText) this.activeOutputText = completedText.slice(-500_000);
    }
    if (method === 'turn/completed') {
      const status = String(body?.turn?.status || body?.status || '').toLowerCase();
      const endedAt = new Date().toISOString();
      if (this.receipt) {
        this.receipt.status = status === 'interrupted' ? 'cancelled' : status === 'completed' ? 'completed' : 'failed';
        this.receipt.endedAt = endedAt;
        this.receipt.durationMs = Date.parse(endedAt) - Date.parse(this.receipt.startedAt);
        this.receipt.result = { turn: body?.turn ?? params, finalText: this.activeOutputText };
        this.receipt.failure = this.receipt.status === 'failed'
          ? String(body?.turn?.error?.message || body?.error?.message || status || 'codex_turn_failed')
          : null;
        const waiters = this.completionWaiters.get(this.receipt.turnId);
        if (waiters) {
          for (const resolve of waiters) resolve(structuredClone(this.receipt));
          this.completionWaiters.delete(this.receipt.turnId);
        }
      }
      this.activeTurnId = null;
    }
  }

  private async ensureStarted(cardId: string): Promise<void> {
    if (this.initialized && this.child) {
      if (cardId !== this.ownerCardId) throw new Error('codex_card_process_owner_mismatch');
      return;
    }
    this.ownerCardId = cardId;
    const launch = this.launch();
    const child = spawn(launch.command, launch.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
    });
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
      const notification = message as unknown as { method?: string; params?: unknown };
      if (notification.method) this.recordNotification(notification.method, notification.params);
    });
    child.once('exit', () => {
      this.failPending(new Error('codex_app_server_exited'));
      this.child = null;
      this.initialized = false;
      this.activeThreadId = null;
      this.activeTurnId = null;
    });
    child.once('error', (error) => {
      this.failPending(error);
      this.child = null;
      this.initialized = false;
    });
    await this.request('initialize', {
      clientInfo: { name: 'liquidaity_openai_coder', title: 'LiquidAIty OpenAI Coder', version: '0.1.0' },
    });
    this.notify('initialized');
    this.initialized = true;
  }

  async inspect(cardId: string): Promise<CodexAppServerInspection> {
    try {
      await this.ensureStarted(cardId);
      const [account, models] = await Promise.all([
        this.request('account/read', { refreshToken: false }),
        this.request('model/list', { limit: 100, includeHidden: false }),
      ]);
      const signedIn = Boolean(accountValue(account));
      const selectedModelAvailable = modelIds(models).includes(OPENAI_CODER_MODEL);
      const rateLimits = signedIn ? await this.request('account/rateLimits/read') : null;
      const state = !signedIn ? 'AWAITING_USER_LOGIN' : selectedModelAvailable ? 'READY' : 'MODEL_UNAVAILABLE';
      return {
        ready: true,
        testReady: state === 'READY',
        state,
        cardId,
        runtime: 'codex_app_server',
        agentClass: 'external_general',
        account,
        rateLimits,
        models,
        selectedModel: OPENAI_CODER_MODEL,
        selectedModelAvailable,
        error: null,
      };
    } catch (error) {
      return {
        ready: false,
        testReady: false,
        state: 'UNAVAILABLE',
        cardId,
        runtime: 'codex_app_server',
        agentClass: 'external_general',
        account: null,
        rateLimits: null,
        models: null,
        selectedModel: OPENAI_CODER_MODEL,
        selectedModelAvailable: false,
        error: error instanceof Error ? error.message : 'codex_app_server_unavailable',
      };
    }
  }

  async loginStart(cardId: string): Promise<unknown> {
    await this.ensureStarted(cardId);
    const result = await this.request('account/login/start', {
      type: 'chatgpt',
      useHostedLoginSuccessPage: true,
      appBrand: 'chatgpt',
    }) as { loginId?: unknown };
    this.pendingLoginId = String(result?.loginId || '') || null;
    return result;
  }

  async loginCancel(cardId: string): Promise<void> {
    if (cardId !== this.ownerCardId) throw new Error('codex_card_process_owner_mismatch');
    if (!this.pendingLoginId) throw new Error('codex_login_not_pending');
    await this.request('account/login/cancel', { loginId: this.pendingLoginId });
    this.pendingLoginId = null;
  }

  async logout(cardId: string): Promise<void> {
    if (cardId !== this.ownerCardId) throw new Error('codex_card_process_owner_mismatch');
    await this.request('account/logout');
  }

  async stop(cardId: string): Promise<void> {
    if (cardId !== this.ownerCardId) throw new Error('codex_card_process_owner_mismatch');
    if (!this.activeThreadId || !this.activeTurnId) throw new Error('codex_card_no_active_turn');
    const at = new Date().toISOString();
    await this.request('turn/interrupt', { threadId: this.activeThreadId, turnId: this.activeTurnId });
    this.receipt?.controlEvents.push({ action: 'stop', at });
  }

  async start(input: {
    cardId: string; model: string; cwd: string; assignment: string;
    approvalPolicy: string; sandbox: string;
  }): Promise<{ threadId: string; turnId: string; events: CodexEvent[] }> {
    await this.ensureStarted(input.cardId);
    if (input.cardId !== this.ownerCardId) throw new Error('codex_card_process_owner_mismatch');
    if (this.activeTurnId) throw new Error('codex_card_turn_already_active');
    const models = await this.request('model/list', { limit: 100, includeHidden: false });
    if (!modelIds(models).includes(input.model)) throw new Error(`codex_card_model_unavailable:${input.model}`);
    const threadResult = await this.request('thread/start', {
      model: input.model,
      cwd: input.cwd,
      approvalPolicy: input.approvalPolicy,
      sandbox: input.sandbox,
      serviceName: 'liquidaity_openai_coder',
    }) as { thread?: { id?: unknown } };
    const threadId = String(threadResult?.thread?.id || '');
    if (!threadId) throw new Error('codex_app_server_thread_id_missing');
    this.activeThreadId = threadId;
    this.events = [];
    this.activeOutputText = '';
    const turnResult = await this.request('turn/start', {
      threadId,
      input: [{ type: 'text', text: input.assignment }],
    }) as { turn?: { id?: unknown } };
    const turnId = String(turnResult?.turn?.id || '');
    if (!turnId) throw new Error('codex_app_server_turn_id_missing');
    this.activeTurnId = turnId;
    this.receipt = {
      cardId: input.cardId,
      route: 'main_mag_one_openai_coder',
      runtime: 'codex_app_server',
      status: 'running',
      taskBody: input.assignment,
      threadId,
      turnId,
      startedAt: new Date().toISOString(),
      endedAt: null,
      durationMs: null,
      toolCalls: [],
      usage: null,
      controlEvents: [],
      result: null,
      failure: null,
    };
    return { threadId, turnId, events: [...this.events] };
  }

  status(cardId: string): Record<string, unknown> {
    return {
      cardId,
      runtime: 'codex_app_server',
      agentClass: 'external_general',
      ownsProcess: cardId === this.ownerCardId && Boolean(this.child),
      initialized: this.initialized,
      pendingLoginId: cardId === this.ownerCardId ? this.pendingLoginId : null,
      threadId: cardId === this.ownerCardId ? this.activeThreadId : null,
      turnId: cardId === this.ownerCardId ? this.activeTurnId : null,
      events: cardId === this.ownerCardId ? [...this.events] : [],
      receipt: cardId === this.ownerCardId ? this.receipt : null,
    };
  }

  getReceipt(cardId: string): CodexRunReceipt | null {
    if (cardId !== this.ownerCardId) return null;
    return this.receipt ? structuredClone(this.receipt) : null;
  }

  async waitForReceipt(cardId: string, turnId: string, timeoutMs = 120_000): Promise<CodexRunReceipt> {
    if (cardId !== this.ownerCardId) throw new Error('codex_card_process_owner_mismatch');
    if (!this.receipt || this.receipt.turnId !== turnId) throw new Error('codex_card_turn_identity_mismatch');
    if (this.receipt.status !== 'running') return structuredClone(this.receipt);
    return new Promise<CodexRunReceipt>((resolve, reject) => {
      const waiters = this.completionWaiters.get(turnId) ?? new Set();
      const finish = (receipt: CodexRunReceipt) => {
        clearTimeout(timer);
        resolve(receipt);
      };
      waiters.add(finish);
      this.completionWaiters.set(turnId, waiters);
      const timer = setTimeout(() => {
        waiters.delete(finish);
        if (waiters.size === 0) this.completionWaiters.delete(turnId);
        reject(new Error(`codex_card_turn_wait_timeout:${turnId}`));
      }, Math.min(120_000, Math.max(1, timeoutMs)));
    });
  }

  async steer(cardId: string, input: string): Promise<void> {
    if (cardId !== this.ownerCardId) throw new Error('codex_card_process_owner_mismatch');
    if (!this.activeThreadId || !this.activeTurnId) throw new Error('codex_card_no_active_turn');
    const at = new Date().toISOString();
    await this.request('turn/steer', {
      threadId: this.activeThreadId,
      input: [{ type: 'text', text: input }],
      expectedTurnId: this.activeTurnId,
    });
    this.receipt?.controlEvents.push({ action: 'steer', at });
  }

  async shutdown(cardId: string): Promise<void> {
    if (cardId !== this.ownerCardId) throw new Error('codex_card_process_owner_mismatch');
    if (this.activeTurnId) throw new Error('codex_card_turn_active');
    const child = this.child;
    this.child = null;
    this.initialized = false;
    this.ownerCardId = null;
    this.activeThreadId = null;
    this.pendingLoginId = null;
    child?.kill('SIGTERM');
  }
}

export const codexAppServerSession = new CodexAppServerSession();
