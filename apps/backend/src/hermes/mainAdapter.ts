import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { resolveServerCodexExecutable, resolveServerCodexHome } from '../config/env';
import { resolveProductChatWorkingDirectory, resolveRepoRoot } from '../coder/workspaceRoot';
import {
  resolvePythonAgentMcpServerSpec,
} from '../services/mcp/pythonAgentMcpClient';
import { withoutInternalMcpSecret } from '../services/mcp/internalMcpAuth';
import { resolveSavedMcpConnections } from './mcpConnections';
import { ensureHermesHolographicMemoryProfile } from './profileMemory';

export { resolveHermesCardRuntimeHome } from './profileMemory';

export type HermesTurnUsage = {
  providerInputTokens: number | null;
  providerOutputTokens: number | null;
  totalCostUsd: number | null;
  usageAvailable: boolean;
  usageSource: string;
  contextBreakdownJson: string;
};

export type HermesSessionEvent =
  | { kind: 'text'; text: string }
  | { kind: 'reasoning'; text: string; source: 'provider_exposed' }
  | { kind: 'tool_start'; toolName: string; argsJson: string; toolUseId: string; agentType: string; invokingCardId: string }
  | { kind: 'tool_result'; toolName: string; toolUseId: string; output: string; isError: boolean }
  | { kind: 'permission'; promptId: string; question: string; promptType: string }
  | { kind: 'done'; fullText: string; usage: HermesTurnUsage }
  | { kind: 'error'; message: string; code?: string };

export type HermesRuntimeConfig = {
  cardId: string;
  title: string;
  runtime: { kind: 'hermes'; mode: 'main' | 'delegate' | 'kanban'; profile: string };
  prompt: string;
  provider: string;
  modelKey: string;
  providerModelId: string;
  accessMode: CardAccessMode;
  tools: string[];
  nativeTools: string[];
  skills: string[];
  toolsets: string[];
  mcpConnectionIds: string[];
  nativeHermesDelegates: HermesNativeDelegateConfig[];
};

export type HermesNativeDelegateConfig = {
  cardId: string;
  title: string;
  runtime: { kind: 'hermes'; mode: 'delegate'; profile: string };
  runtimeOwner: 'hermes';
  prompt: string;
  provider: string;
  providerModelId: string;
  accessMode: CardAccessMode;
  tools: string[];
  nativeTools: string[];
  skills: string[];
  toolsets: string[];
  mcpConnectionIds: string[];
};

export type CardAccessMode = 'chatgpt-account' | 'openai-api' | 'openrouter-api';

export type CodexAccountTransportMethod =
  | 'account/read'
  | 'account/login/start'
  | 'account/logout'
  | 'account/rateLimits/read';

export function requireHermesCompletionText(
  value: unknown,
  accessMode: CardAccessMode,
): string {
  const text = typeof value === 'string' ? value : '';
  if (text.trim()) return text;
  throw new Error(
    accessMode === 'chatgpt-account'
      ? 'codex_app_server_empty_completion'
      : 'hermes_empty_completion',
  );
}

export type HermesTurnArgs = HermesRuntimeConfig & {
  sessionKey: string;
  projectId: string;
  deckId: string;
  conversationId: string;
  parentRunId: string;
  message: string;
  workingDirectory?: string;
};

export type HermesTurnHandle = {
  answer(promptId: string, reply: string): void;
  cancel(): void;
  done: Promise<{
    finalText: string;
    usage: HermesTurnUsage;
    transport: {
      threadId: string | null;
      turnId: string | null;
      authMode: string | null;
      planType: string | null;
      nativeTaskId?: string;
      nativeRunId?: string | number | null;
      nativeStatus?: string;
    };
  }>;
  resolved: { cardId: string; provider: string; modelKey: string; providerModelId: string };
  runtime: { executable: string; pid: number | null; profileHome: string; transport: 'acp-stdio' };
};

type PendingRequest = {
  resolve(value: any): void;
  reject(error: Error): void;
};

type ActiveTurn = {
  onEvent(event: HermesSessionEvent): void;
  fullText: string;
  toolNames: Map<string, string>;
  permissionRequestIds: Map<string, number | string>;
};

function safeProfile(value: unknown): string {
  const profile = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(profile)) {
    throw new Error('hermes_profile_invalid');
  }
  return profile;
}

function resolveHermesInstall(): { root: string; executable: string } {
  const root = path.join(resolveRepoRoot(), 'Hermes');
  const executable = path.join(root, 'venv', 'Scripts', 'hermes-acp.exe');
  if (!existsSync(executable)) {
    throw new Error(`hermes_repo_acp_missing:${executable}`);
  }
  return { root, executable };
}

export function providerForHermes(provider: string, accessMode?: CardAccessMode): string {
  const normalized = String(provider || '').trim().toLowerCase();
  if (normalized === 'openai' && accessMode === 'chatgpt-account') return 'openai-codex';
  return normalized;
}

function textContent(update: any): string {
  return update?.content?.type === 'text' ? String(update.content.text || '') : '';
}

function jsonText(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return String(value ?? '');
  }
}

export function buildHermesOfficialMcpServer(
  args: Pick<
    HermesTurnArgs,
    | 'sessionKey'
    | 'projectId'
    | 'deckId'
    | 'conversationId'
    | 'parentRunId'
    | 'cardId'
    | 'runtime'
    | 'tools'
  >,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, unknown> | null {
  const granted = args.tools.filter((name) => name !== 'web_search');
  if (granted.length === 0) return null;
  const shared = resolvePythonAgentMcpServerSpec({
    kind: 'card-runtime',
    projectId: args.projectId,
    deckId: args.deckId,
    conversationId: args.conversationId,
    parentRunId: args.parentRunId,
    callerCardId: args.cardId,
    callerRuntimeKind: args.runtime.kind,
    callerRuntimeMode: args.runtime.mode,
    grantedTools: granted,
  }, env);
  const suffix = createHash('sha256').update(args.sessionKey).digest('hex').slice(0, 12);
  return {
    type: 'http',
    name: `main-runtime-${suffix}`,
    url: shared.url,
    headers: Object.entries(shared.headers).map(([name, value]) => ({ name, value })),
  };
}

function sanitizeHermesMcpName(value: string): string {
  return String(value || '').replace(/[^A-Za-z0-9_]/g, '_');
}

export function buildHermesDelegateCards(
  delegates: HermesNativeDelegateConfig[],
  officialServerName: string,
): Record<string, unknown>[] {
  const server = sanitizeHermesMcpName(officialServerName);
  return delegates.filter((delegate) => delegate.runtime.mode === 'delegate').map((delegate) => {
    const allowedToolNames = [
      ...delegate.nativeTools,
      ...delegate.tools.map((toolName) => {
        if (toolName === 'web_search') return toolName;
        if (!server) return '';
        return `mcp__${server}__${sanitizeHermesMcpName(toolName)}`;
      }),
    ].filter((name, index, names) => Boolean(name) && names.indexOf(name) === index);
    return {
      cardId: delegate.cardId,
      title: delegate.title,
      runtime: delegate.runtime,
      prompt: delegate.prompt,
      provider: delegate.provider,
      providerModelId: delegate.providerModelId,
      accessMode: delegate.accessMode,
      skills: delegate.skills,
      toolsets: delegate.toolsets,
      allowedToolNames,
    };
  });
}

class AcpProcess {
  readonly executable: string;
  readonly profileHome: string;
  readonly transport = 'acp-stdio' as const;
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly turns = new Map<string, ActiveTurn>();
  private readonly sessionByKey = new Map<string, string>();
  private readonly configuredModelBySession = new Map<string, string>();
  private nextRequestId = 1;
  private stdoutBuffer = '';
  private stderrTail: string[] = [];
  private ready: Promise<void>;

  constructor(profile: string) {
    const install = resolveHermesInstall();
    const codexHome = resolveServerCodexHome();
    this.executable = install.executable;
    this.profileHome = ensureHermesHolographicMemoryProfile(install.root, profile);
    const childEnv = withoutInternalMcpSecret(process.env);
    this.child = spawn(this.executable, [], {
      cwd: install.root,
      env: {
        ...childEnv,
        HERMES_HOME: this.profileHome,
        CODEX_HOME: codexHome,
        HERMES_CODEX_HOME: codexHome,
        HERMES_CODEX_BIN: resolveServerCodexExecutable(),
        HERMES_ACP_SKIP_CONFIGURED_MCP: '1',
      },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => this.consumeStdout(String(chunk)));
    this.child.stderr.on('data', (chunk) => {
      this.stderrTail.push(...String(chunk).split(/\r?\n/).filter(Boolean));
      this.stderrTail = this.stderrTail.slice(-30);
    });
    this.child.once('error', (error) => this.failAll(error));
    this.child.once('exit', (code, signal) => {
      this.failAll(new Error(`hermes_acp_exited:${code ?? 'null'}:${signal ?? 'none'}:${this.stderrTail.slice(-3).join(' | ')}`));
    });
    this.ready = this.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: { name: 'repository-main-adapter', version: '1.0.0' },
    }).then((result) => {
      if (Number(result?.protocolVersion) !== 1) {
        throw new Error(`hermes_acp_protocol_unsupported:${String(result?.protocolVersion)}`);
      }
    });
  }

  get pid(): number | null {
    return this.child.pid ?? null;
  }

  close(): void {
    if (!this.child.killed) this.child.kill();
  }

  private send(payload: Record<string, unknown>): void {
    if (!this.child.stdin.writable) throw new Error('hermes_acp_transport_closed');
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  private request(method: string, params: Record<string, unknown>): Promise<any> {
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  private notify(method: string, params: Record<string, unknown>): void {
    this.send({ jsonrpc: '2.0', method, params });
  }

  async requestCodexAccount(
    method: CodexAccountTransportMethod,
    params: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    await this.ready;
    const result = await this.request('_liquidaity/codex-account', { method, params });
    return result && typeof result === 'object' ? result : {};
  }

  private consumeStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    for (;;) {
      const newline = this.stdoutBuffer.indexOf('\n');
      if (newline < 0) return;
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      let message: any;
      try {
        message = JSON.parse(line);
      } catch {
        this.failAll(new Error('hermes_acp_invalid_json'));
        continue;
      }
      this.receive(message);
    }
  }

  private receive(message: any): void {
    if (Object.prototype.hasOwnProperty.call(message, 'id') && !message.method) {
      const pending = this.pending.get(Number(message.id));
      if (!pending) return;
      this.pending.delete(Number(message.id));
      if (message.error) {
        pending.reject(new Error(`hermes_acp_rpc_error:${jsonText(message.error)}`));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (message.method === 'session/update') {
      this.receiveUpdate(message.params);
      return;
    }
    if (message.method === 'session/request_permission' && Object.prototype.hasOwnProperty.call(message, 'id')) {
      this.receivePermission(message.id, message.params);
      return;
    }
    if (Object.prototype.hasOwnProperty.call(message, 'id')) {
      this.send({
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32601, message: `Unsupported client method: ${String(message.method || '')}` },
      });
    }
  }

  private receiveUpdate(params: any): void {
    const sessionId = String(params?.sessionId || '');
    const turn = this.turns.get(sessionId);
    if (!turn) return;
    const update = params?.update || {};
    const kind = String(update.sessionUpdate || '');
    if (kind === 'agent_message_chunk') {
      const text = textContent(update);
      if (text) {
        turn.fullText += text;
        turn.onEvent({ kind: 'text', text });
      }
      return;
    }
    if (kind === 'agent_thought_chunk') {
      const text = textContent(update);
      if (text) turn.onEvent({ kind: 'reasoning', text, source: 'provider_exposed' });
      return;
    }
    if (kind === 'tool_call') {
      const id = String(update.toolCallId || '');
      const name = String(update.title || update.kind || 'tool');
      turn.toolNames.set(id, name);
      turn.onEvent({
        kind: 'tool_start',
        toolName: name,
        argsJson: jsonText(update.rawInput),
        toolUseId: id,
        agentType: '',
        invokingCardId: '',
      });
      return;
    }
    if (kind === 'tool_call_update' && (update.status === 'completed' || update.status === 'failed')) {
      const id = String(update.toolCallId || '');
      turn.onEvent({
        kind: 'tool_result',
        toolName: turn.toolNames.get(id) || String(update.title || 'tool'),
        toolUseId: id,
        output: jsonText(update.rawOutput),
        isError: update.status === 'failed',
      });
    }
  }

  private receivePermission(requestId: number | string, params: any): void {
    const sessionId = String(params?.sessionId || '');
    const turn = this.turns.get(sessionId);
    if (!turn) {
      this.send({ jsonrpc: '2.0', id: requestId, result: { outcome: { outcome: 'cancelled' } } });
      return;
    }
    const promptId = `permission_${String(requestId)}`;
    turn.permissionRequestIds.set(promptId, requestId);
    turn.onEvent({
      kind: 'permission',
      promptId,
      question: String(params?.toolCall?.title || 'Hermes requests permission to use a tool.'),
      promptType: jsonText(params?.options || []),
    });
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    for (const turn of this.turns.values()) turn.onEvent({ kind: 'error', message: error.message });
    this.turns.clear();
  }

  private sessionCwd(sessionKey: string, requested?: string): string {
    if (requested) {
      mkdirSync(requested, { recursive: true });
      return requested;
    }
    const digest = createHash('sha256').update(sessionKey).digest('hex').slice(0, 24);
    const cwd = path.join(resolveProductChatWorkingDirectory(), digest);
    mkdirSync(cwd, { recursive: true });
    return cwd;
  }

  private mcpServers(args: HermesTurnArgs): Record<string, unknown>[] {
    const referenced = resolveSavedMcpConnections(args.mcpConnectionIds);
    const official = buildHermesOfficialMcpServer(args);
    return official ? [official, ...referenced] : referenced;
  }

  private async resolveSession(args: HermesTurnArgs): Promise<string> {
    const existing = this.sessionByKey.get(args.sessionKey);
    const cwd = this.sessionCwd(args.sessionKey, args.workingDirectory);
    const mcpServers = this.mcpServers(args);
    const officialServerName = String(
      mcpServers.find((server) => String(server.name || '').startsWith('main-runtime-'))?.name || '',
    );
    const sessionConfig = {
      systemPrompt: args.prompt,
      accessMode: args.accessMode,
      enabledTools: args.nativeTools,
      enabledToolsets: args.toolsets,
      skills: args.skills,
      delegateCards: buildHermesDelegateCards(
        args.nativeHermesDelegates,
        officialServerName,
      ),
    };
    if (existing) {
      await this.request('session/load', {
        cwd,
        sessionId: existing,
        mcpServers,
        _meta: { sessionConfig },
      });
      return existing;
    }
    const listed = await this.request('session/list', { cwd });
    const persisted = Array.isArray(listed?.sessions) ? listed.sessions[0]?.sessionId : null;
    if (persisted) {
      await this.request('session/load', {
        cwd,
        sessionId: persisted,
        mcpServers,
        _meta: { sessionConfig },
      });
      this.sessionByKey.set(args.sessionKey, persisted);
      return persisted;
    }
    const created = await this.request('session/new', {
      cwd,
      mcpServers,
      _meta: { sessionConfig },
    });
    const sessionId = String(created?.sessionId || '');
    if (!sessionId) throw new Error('hermes_acp_session_id_missing');
    this.sessionByKey.set(args.sessionKey, sessionId);
    return sessionId;
  }

  async startTurn(args: HermesTurnArgs, onEvent: (event: HermesSessionEvent) => void): Promise<HermesTurnHandle> {
    await this.ready;
    if (args.runtime.mode === 'kanban') {
      throw new Error('hermes_acp_kanban_gateway_required');
    }
    const sessionId = await this.resolveSession(args);
    if (this.turns.has(sessionId)) throw new Error('hermes_session_turn_already_running');
    const modelChoice = `${providerForHermes(args.provider, args.accessMode)}:${args.providerModelId}`;
    if (this.configuredModelBySession.get(sessionId) !== modelChoice) {
      await this.request('session/set_model', { sessionId, modelId: modelChoice });
      this.configuredModelBySession.set(sessionId, modelChoice);
    }
    const active: ActiveTurn = {
      onEvent,
      fullText: '',
      toolNames: new Map(),
      permissionRequestIds: new Map(),
    };
    this.turns.set(sessionId, active);
    const done = this.request('session/prompt', {
      sessionId,
      messageId: randomUUID(),
      prompt: [{ type: 'text', text: args.message }],
    }).then((result) => {
      const raw = result?.usage;
      const usage: HermesTurnUsage = {
        providerInputTokens: Number.isFinite(raw?.inputTokens) ? Number(raw.inputTokens) : null,
        providerOutputTokens: Number.isFinite(raw?.outputTokens) ? Number(raw.outputTokens) : null,
        totalCostUsd: null,
        usageAvailable: Number.isFinite(raw?.inputTokens) && Number.isFinite(raw?.outputTokens),
        usageSource: raw ? 'acp_prompt_usage' : 'unavailable',
        contextBreakdownJson: '',
      };
      if (result?.stopReason === 'cancelled') throw new Error('hermes_turn_cancelled');
      if (result?.stopReason === 'refusal') throw new Error('hermes_turn_refused');
      const finalText = requireHermesCompletionText(active.fullText, args.accessMode);
      onEvent({ kind: 'done', fullText: finalText, usage });
      const meta = result?._meta?.liquidaity || {};
      return {
        finalText,
        usage,
        transport: {
          threadId: typeof meta.codexThreadId === 'string' ? meta.codexThreadId : null,
          turnId: typeof meta.codexTurnId === 'string' ? meta.codexTurnId : null,
          authMode: typeof meta.authMode === 'string' ? meta.authMode : null,
          planType: typeof meta.planType === 'string' ? meta.planType : null,
        },
      };
    }).catch((error) => {
      const normalized = error instanceof Error ? error : new Error(String(error));
      onEvent({ kind: 'error', message: normalized.message, code: 'hermes_turn_failed' });
      throw normalized;
    }).finally(() => {
      this.turns.delete(sessionId);
    });
    return {
      answer: (promptId, reply) => {
        const requestId = active.permissionRequestIds.get(promptId);
        if (requestId === undefined) return;
        active.permissionRequestIds.delete(promptId);
        const options = (() => {
          try { return JSON.parse(reply); } catch { return null; }
        })();
        const optionId = typeof options?.optionId === 'string' ? options.optionId : String(reply || '').trim();
        this.send({
          jsonrpc: '2.0',
          id: requestId,
          result: { outcome: optionId ? { outcome: 'selected', optionId } : { outcome: 'cancelled' } },
        });
      },
      cancel: () => this.notify('session/cancel', { sessionId }),
      done,
      resolved: {
        cardId: args.cardId,
        provider: args.provider,
        modelKey: args.modelKey,
        providerModelId: args.providerModelId,
      },
      runtime: {
        executable: this.executable,
        pid: this.pid,
        profileHome: this.profileHome,
        transport: this.transport,
      },
    };
  }
}

const processes = new Map<string, AcpProcess>();

function processForProfile(profile: string): AcpProcess {
  const normalized = safeProfile(profile);
  const existing = processes.get(normalized);
  if (existing) return existing;
  const created = new AcpProcess(normalized);
  processes.set(normalized, created);
  return created;
}

export function deriveHermesSessionKey(projectId: string, conversationId: string, cardId: string): string {
  return `hermes:${projectId}:${conversationId}:${cardId}`;
}

export async function startHermesTurn(
  args: HermesTurnArgs,
  onEvent: (event: HermesSessionEvent) => void,
): Promise<HermesTurnHandle> {
  return processForProfile(args.runtime.profile).startTurn(args, onEvent);
}

export async function requestHermesCodexAccount(
  profile: string,
  method: CodexAccountTransportMethod,
  params: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  return processForProfile(profile).requestCodexAccount(method, params);
}

export function closeHermesRuntimes(): void {
  for (const process of processes.values()) process.close();
  processes.clear();
}
