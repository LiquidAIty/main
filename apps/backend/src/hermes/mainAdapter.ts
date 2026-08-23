import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { resolveProductChatWorkingDirectory, resolveRepoRoot } from '../coder/workspaceRoot';
import {
  resolvePythonAgentMcpServerSpec,
} from '../services/mcp/pythonAgentMcpClient';
import { withoutInternalMcpSecret } from '../services/mcp/internalMcpAuth';
import { resolveSavedMcpConnections } from './mcpConnections';
import {
  ensureHermesHolographicMemoryHome,
} from './profileMemory';
import {
  createHermesChildExecutionContext,
  bindHermesRootExecutionSession,
  executionToolCallMeta,
  finishHermesExecutionContext,
  registerHermesRootExecutionContext,
} from './childExecutionContext';

export { resolveHermesRuntimeHome } from './profileMemory';

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
};

export type CardAccessMode = 'chatgpt-account' | 'openai-api' | 'openrouter-api';

export function requireHermesCompletionText(value: unknown): string {
  const text = typeof value === 'string' ? value : '';
  if (text.trim()) return text;
  throw new Error('hermes_empty_completion');
}

export function requireHermesEffectSuccess(
  effectToolNames: readonly string[],
  outcomes: ReadonlyArray<{ toolName: string; toolUseId: string; isError: boolean }>,
): void {
  const required = new Set(effectToolNames);
  const failed = outcomes.find((outcome) => outcome.isError && required.has(outcome.toolName));
  if (failed) throw new Error(`hermes_required_effect_failed:${failed.toolName}`);
}

export function resolveHermesEffectToolName(
  effectToolNames: ReadonlySet<string>,
  reportedName: string,
): string {
  if (effectToolNames.has(reportedName)) return reportedName;
  const matches = [...effectToolNames].filter((name) => (
    reportedName.endsWith(`__${name.replaceAll('.', '_')}`)
  ));
  return matches.length === 1 ? matches[0] : reportedName;
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
  runtime: {
    executable: string;
    pid: number | null;
    hermesHome: string;
    sessionId: string;
    transport: 'acp-stdio' | 'hermes-kanban';
  };
};

export type HermesPreparedSession = HermesTurnHandle['runtime'] & {
  cardId: string;
  provider: string;
  modelKey: string;
  providerModelId: string;
};

export type HermesHistoryMessage = {
  role: 'user' | 'assistant';
  text: string;
};

type PendingRequest = {
  method: string;
  resolve(value: any): void;
  reject(error: Error): void;
};

type HermesAcpInstall = {
  root: string;
  executable: string;
  args: string[];
};

type HermesAcpExit = {
  code: number | null;
  signal: NodeJS.Signals | null;
  explicit: boolean;
  lastProtocolEvent: string;
  stderrTail: string[];
  stdoutTail: string;
};

class HermesAcpExitedError extends Error {
  constructor(readonly exit: HermesAcpExit) {
    const stderr = exit.stderrTail.slice(-3).join(' | ');
    const stdout = exit.stdoutTail ? `:stdout=${exit.stdoutTail}` : '';
    super(
      `hermes_acp_exited:${exit.code ?? 'null'}:${exit.signal ?? 'none'}`
      + `:explicit=${exit.explicit ? 'yes' : 'no'}`
      + `:last=${exit.lastProtocolEvent}${stdout}:${stderr}`,
    );
    this.name = 'HermesAcpExitedError';
  }
}

type ActiveTurn = {
  onEvent(event: HermesSessionEvent): void;
  fullText: string;
  toolNames: Map<string, string>;
  effectToolNames: Set<string>;
  effectOutcomes: Array<{ toolName: string; toolUseId: string; isError: boolean }>;
  permissionRequestIds: Map<string, number | string>;
  rootExecutionContextId: string;
};

function resolveHermesInstall(): HermesAcpInstall {
  const root = path.join(resolveRepoRoot(), 'Hermes');
  const executable = path.join(root, 'venv', 'Scripts', 'python.exe');
  const bridge = path.join(
    resolveRepoRoot(),
    'apps',
    'python-models',
    'app',
    'python_models',
    'hermes_acp_bridge.py',
  );
  if (!existsSync(executable)) {
    throw new Error(`hermes_repo_python_missing:${executable}`);
  }
  if (!existsSync(bridge)) throw new Error(`liquidaity_hermes_acp_bridge_missing:${bridge}`);
  return { root, executable, args: [bridge] };
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
  executionContextId = '',
): Record<string, unknown> | null {
  const granted = args.tools.filter((name) => name !== 'web_search');
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
    requiresExecutionContext: true,
    executionContextId: String(executionContextId || '').trim() || undefined,
  }, env);
  const suffix = createHash('sha256').update(args.sessionKey).digest('hex').slice(0, 12);
  return {
    type: 'http',
    name: `main-runtime-${suffix}`,
    url: shared.url,
    headers: Object.entries(shared.headers).map(([name, value]) => ({ name, value })),
  };
}

function uniqueStrings(values: string[]): string[] {
  return values.filter((value, index, all) => Boolean(value) && all.indexOf(value) === index);
}

function mcpToolsetNames(servers: Record<string, unknown>[]): string[] {
  return servers.map((server) => `mcp-${String(server.name || '')}`).filter((name) => name !== 'mcp-');
}

export function buildHermesHostSessionProjection(
  args: HermesTurnArgs,
  env: NodeJS.ProcessEnv = process.env,
  executionContextId = '',
): {
  mcpServers: Record<string, unknown>[];
  sessionMeta: Record<string, unknown>;
} {
  const rootSaved = resolveSavedMcpConnections(args.mcpConnectionIds, env);
  const rootOfficial = buildHermesOfficialMcpServer(args, env, executionContextId);
  const rootServers: Record<string, unknown>[] = rootOfficial
    ? [rootOfficial, ...rootSaved]
    : rootSaved;
  return {
    mcpServers: rootServers,
    sessionMeta: {
      hermes: {
        sessionConfig: {
          enabledToolsets: uniqueStrings([
            ...args.toolsets,
            ...mcpToolsetNames(rootServers),
          ]),
          enabledTools: uniqueStrings([
            // Exact native Hermes registry names only. Card-assigned MCP tools
            // are exposed by the scoped mcp-main-runtime-* toolset above.
            ...args.nativeTools,
          ]),
          hostSessionKey: args.sessionKey,
          systemPrompt: args.prompt,
          ...(executionContextId ? {
            executionContextId,
            toolCallMeta: executionToolCallMeta(executionContextId),
          } : {}),
        },
      },
    },
  };
}

export class AcpProcess {
  readonly executable: string;
  readonly hermesHome: string;
  readonly transport = 'acp-stdio' as const;
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly turns = new Map<string, ActiveTurn>();
  private readonly sessionByKey = new Map<string, string>();
  private readonly historyCollectors = new Map<string, HermesHistoryMessage[]>();
  private nextRequestId = 1;
  private stdoutBuffer = '';
  private stderrTail: string[] = [];
  private ready: Promise<void>;
  private terminated = false;
  private explicitClose = false;
  private lastProtocolEvent = 'spawn';
  private readonly exitPromise: Promise<HermesAcpExit>;
  private resolveExit!: (exit: HermesAcpExit) => void;

  constructor(
    private readonly onClosed: (owner: AcpProcess) => void,
    options: { install?: HermesAcpInstall; hermesHome?: string } = {},
  ) {
    const install = options.install ?? resolveHermesInstall();
    this.executable = install.executable;
    this.hermesHome = options.hermesHome
      ?? ensureHermesHolographicMemoryHome(install.root);
    this.exitPromise = new Promise((resolve) => {
      this.resolveExit = resolve;
    });
    const childEnv = withoutInternalMcpSecret(process.env);
    this.child = spawn(this.executable, install.args, {
      cwd: install.root,
      env: {
        ...childEnv,
        HERMES_HOME: this.hermesHome,
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
    this.child.once('error', (error) => {
      this.lastProtocolEvent = 'process:error';
      this.failAll(error);
    });
    // `close`, unlike `exit`, fires only after stdout/stderr have drained. That
    // preserves the bridge's actual final diagnostic instead of normalizing a
    // clean pre-inference EOF while its explanation is still buffered.
    this.child.once('close', (code, signal) => {
      const exit: HermesAcpExit = {
        code,
        signal,
        explicit: this.explicitClose,
        lastProtocolEvent: this.lastProtocolEvent,
        stderrTail: [...this.stderrTail],
        stdoutTail: this.stdoutBuffer.trim().slice(-500),
      };
      this.resolveExit(exit);
      this.failAll(new HermesAcpExitedError(exit));
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

  get alive(): boolean {
    return !this.terminated && !this.child.killed && this.child.stdin.writable;
  }

  get closed(): Promise<HermesAcpExit> {
    return this.exitPromise;
  }

  close(): void {
    this.explicitClose = true;
    this.lastProtocolEvent = 'close:explicit';
    if (!this.child.killed) this.child.kill();
  }

  private send(payload: Record<string, unknown>): void {
    if (!this.child.stdin.writable) throw new Error('hermes_acp_transport_closed');
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  private request(method: string, params: Record<string, unknown>): Promise<any> {
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { method, resolve, reject });
      this.lastProtocolEvent = `request:${method}:write`;
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  private notify(method: string, params: Record<string, unknown>): void {
    this.send({ jsonrpc: '2.0', method, params });
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
      this.lastProtocolEvent = `response:${pending.method}:${message.error ? 'error' : 'ok'}`;
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
    if (message.method === '_session/create_execution_context' && Object.prototype.hasOwnProperty.call(message, 'id')) {
      const sessionId = String(message.params?.sessionId || '');
      const turn = this.turns.get(sessionId);
      if (!turn) {
        this.send({ jsonrpc: '2.0', id: message.id, error: { code: -32001, message: 'hermes_turn_context_unavailable' } });
        return;
      }
      void createHermesChildExecutionContext({
        sessionId,
        parentExecutionContextId: String(message.params?.parentExecutionContextId || ''),
        nativeChildId: String(message.params?.nativeChildId || ''),
      }).then((context) => {
        this.send({
          jsonrpc: '2.0', id: message.id, result: {
            executionContextId: context.contextId,
            runId: context.runId,
            toolCallMeta: executionToolCallMeta(context.contextId),
          },
        });
      }).catch((error) => {
        this.send({ jsonrpc: '2.0', id: message.id, error: { code: -32002, message: error instanceof Error ? error.message : 'hermes_child_context_failed' } });
      });
      return;
    }
    if (message.method === '_session/finish_execution_context' && Object.prototype.hasOwnProperty.call(message, 'id')) {
      void finishHermesExecutionContext({
        contextId: String(message.params?.executionContextId || ''),
        state: ['completed', 'failed', 'cancelled'].includes(String(message.params?.state || ''))
          ? message.params.state
          : 'failed',
        errorSummary: String(message.params?.errorSummary || '') || undefined,
        usage: message.params?.usage && typeof message.params.usage === 'object'
          ? message.params.usage
          : undefined,
      }).then((closed) => this.send({ jsonrpc: '2.0', id: message.id, result: { closed } }))
        .catch((error) => this.send({ jsonrpc: '2.0', id: message.id, error: { code: -32003, message: error instanceof Error ? error.message : 'hermes_child_context_finish_failed' } }));
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
    const update = params?.update || {};
    const kind = String(update.sessionUpdate || '');
    const history = this.historyCollectors.get(sessionId);
    if (history && (kind === 'user_message_chunk' || kind === 'agent_message_chunk')) {
      const text = textContent(update);
      if (text) {
        history.push({
          role: kind === 'user_message_chunk' ? 'user' : 'assistant',
          text,
        });
      }
      return;
    }
    const turn = this.turns.get(sessionId);
    if (!turn) return;
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
      const reportedName = turn.toolNames.get(id) || String(update.title || 'tool');
      const toolName = resolveHermesEffectToolName(turn.effectToolNames, reportedName);
      turn.effectOutcomes.push({
        toolName,
        toolUseId: id,
        isError: update.status === 'failed',
      });
      turn.onEvent({
        kind: 'tool_result',
        toolName,
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
    if (this.terminated) return;
    this.terminated = true;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    for (const turn of this.turns.values()) turn.onEvent({ kind: 'error', message: error.message });
    this.turns.clear();
    this.onClosed(this);
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

  private async resolveSession(
    args: HermesTurnArgs,
    executionContextId: string,
  ): Promise<{ sessionId: string; reused: boolean }> {
    const existing = this.sessionByKey.get(args.sessionKey);
    const cwd = this.sessionCwd(args.sessionKey, args.workingDirectory);
    const { mcpServers, sessionMeta } = buildHermesHostSessionProjection(
      args,
      process.env,
      executionContextId,
    );
    if (existing) {
      return { sessionId: existing, reused: true };
    }
    const listed = await this.request('session/list', { cwd, _meta: sessionMeta });
    const persisted = Array.isArray(listed?.sessions) ? listed.sessions[0]?.sessionId : null;
    if (persisted) {
      await this.request('session/load', {
        cwd,
        sessionId: persisted,
        mcpServers,
        _meta: sessionMeta,
      });
      this.sessionByKey.set(args.sessionKey, persisted);
      return { sessionId: persisted, reused: true };
    }
    const created = await this.request('session/new', {
      cwd,
      mcpServers,
      _meta: sessionMeta,
    });
    const sessionId = String(created?.sessionId || '');
    if (!sessionId) throw new Error('hermes_acp_session_id_missing');
    this.sessionByKey.set(args.sessionKey, sessionId);
    return { sessionId, reused: false };
  }

  async prepareSession(args: HermesTurnArgs): Promise<HermesPreparedSession> {
    await this.ready;
    const { sessionId } = await this.resolveSession(args, '');
    return {
      cardId: args.cardId,
      provider: args.provider,
      modelKey: args.modelKey,
      providerModelId: args.providerModelId,
      executable: this.executable,
      pid: this.pid,
      hermesHome: this.hermesHome,
      sessionId,
      transport: this.transport,
    };
  }

  async configureHostSession(
    args: HermesTurnArgs,
    executionContextId: string,
  ): Promise<HermesPreparedSession> {
    await this.ready;
    const contextId = String(executionContextId || '').trim();
    if (!contextId) throw new Error('hermes_execution_context_id_required');
    const { sessionId } = await this.resolveSession(args, contextId);
    bindHermesRootExecutionSession(contextId, sessionId);
    const { mcpServers, sessionMeta } = buildHermesHostSessionProjection(
      args,
      process.env,
      contextId,
    );
    await this.request('_session/configure_host', {
      sessionId,
      mcpServers,
      _meta: sessionMeta,
    });
    return {
      cardId: args.cardId,
      provider: args.provider,
      modelKey: args.modelKey,
      providerModelId: args.providerModelId,
      executable: this.executable,
      pid: this.pid,
      hermesHome: this.hermesHome,
      sessionId,
      transport: this.transport,
    };
  }

  async readHistory(args: HermesTurnArgs): Promise<{
    sessionId: string | null;
    messages: HermesHistoryMessage[];
  }> {
    await this.ready;
    const cwd = this.sessionCwd(args.sessionKey, args.workingDirectory);
    const { mcpServers, sessionMeta } = buildHermesHostSessionProjection(args, process.env, '');
    const listed = await this.request('session/list', { cwd, _meta: sessionMeta });
    const sessionId = String(
      Array.isArray(listed?.sessions) ? listed.sessions[0]?.sessionId || '' : '',
    );
    if (!sessionId) return { sessionId: null, messages: [] };
    if (this.turns.has(sessionId)) throw new Error('hermes_session_turn_already_running');

    const messages: HermesHistoryMessage[] = [];
    this.historyCollectors.set(sessionId, messages);
    try {
      await this.request('session/load', {
        cwd,
        sessionId,
        mcpServers,
        _meta: sessionMeta,
      });
      this.sessionByKey.set(args.sessionKey, sessionId);
      return { sessionId, messages };
    } finally {
      this.historyCollectors.delete(sessionId);
    }
  }

  async requestExtension(method: string, params: Record<string, unknown>): Promise<any> {
    await this.ready;
    const nativeManagerMethod = [
      '_profile/read',
      '_learning/detail',
      '_native/apply',
      '_mcp/test',
    ].includes(method);
    const runtimeMethod = /^_(?:session|kanban)\/[a-z_]+$/.test(method);
    if (!nativeManagerMethod && !runtimeMethod) {
      throw new Error('hermes_acp_extension_method_invalid');
    }
    return this.request(method, params);
  }

  async startTurn(args: HermesTurnArgs, onEvent: (event: HermesSessionEvent) => void): Promise<HermesTurnHandle> {
    await this.ready;
    const provisionalSessionId = args.sessionKey;
    const rootContext = registerHermesRootExecutionContext({
      sessionId: provisionalSessionId,
      runId: args.parentRunId,
      projectId: args.projectId,
      deckId: args.deckId,
      conversationId: args.conversationId,
      cardId: args.cardId,
      runtimeMode: args.runtime.mode,
      grantedTools: args.tools.filter((name) => name !== 'web_search'),
    });
    let sessionId: string;
    let active: ActiveTurn;
    try {
      ({ sessionId } = await this.resolveSession(args, rootContext.contextId));
      bindHermesRootExecutionSession(rootContext.contextId, sessionId);
      if (this.turns.has(sessionId)) throw new Error('hermes_session_turn_already_running');
      const { mcpServers, sessionMeta } = buildHermesHostSessionProjection(
        args,
        process.env,
        rootContext.contextId,
      );
      await this.request('_session/configure_host', {
        sessionId,
        mcpServers,
        _meta: sessionMeta,
      });
      active = {
        onEvent,
        fullText: '',
        toolNames: new Map(),
        effectToolNames: new Set(args.tools),
        effectOutcomes: [],
        permissionRequestIds: new Map(),
        rootExecutionContextId: rootContext.contextId,
      };
      this.turns.set(sessionId, active);
    } catch (error) {
      await finishHermesExecutionContext({ contextId: rootContext.contextId, state: 'failed' });
      throw error;
    }
    let rootTerminalState: 'completed' | 'failed' | 'cancelled' = 'failed';
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
      requireHermesEffectSuccess([...active.effectToolNames], active.effectOutcomes);
      const finalText = requireHermesCompletionText(active.fullText);
      rootTerminalState = 'completed';
      onEvent({ kind: 'done', fullText: finalText, usage });
      return {
        finalText,
        usage,
        transport: {
          threadId: null,
          turnId: null,
          authMode: null,
          planType: null,
        },
      };
    }).catch((error) => {
      const normalized = error instanceof Error ? error : new Error(String(error));
      rootTerminalState = normalized.message === 'hermes_turn_cancelled' ? 'cancelled' : 'failed';
      onEvent({ kind: 'error', message: normalized.message, code: 'hermes_turn_failed' });
      throw normalized;
    }).finally(() => {
      this.turns.delete(sessionId);
      void finishHermesExecutionContext({ contextId: rootContext.contextId, state: rootTerminalState });
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
        hermesHome: this.hermesHome,
        sessionId,
        transport: this.transport,
      },
    };
  }
}

function isRetryablePrePromptCleanExit(error: unknown): error is HermesAcpExitedError {
  if (!(error instanceof HermesAcpExitedError)) return false;
  const { code, signal, explicit, lastProtocolEvent } = error.exit;
  return code === 0
    && signal === null
    && !explicit
    && !lastProtocolEvent.startsWith('request:session/prompt')
    && !lastProtocolEvent.startsWith('response:session/prompt')
    && !lastProtocolEvent.startsWith('notification:session/update');
}

let processOwner: AcpProcess | null = null;

function sharedHermesProcess(): AcpProcess {
  if (processOwner?.alive) return processOwner;
  processOwner = new AcpProcess((closed) => {
    if (processOwner === closed) processOwner = null;
  });
  return processOwner;
}

export function deriveHermesSessionKey(projectId: string, conversationId: string, cardId: string): string {
  return `hermes:${projectId}:${conversationId}:${cardId}`;
}

export async function startHermesTurn(
  args: HermesTurnArgs,
  onEvent: (event: HermesSessionEvent) => void,
): Promise<HermesTurnHandle> {
  return startHermesTurnWithOnePrePromptRecovery(args, onEvent);
}

export async function startHermesTurnWithOnePrePromptRecovery(
  args: HermesTurnArgs,
  onEvent: (event: HermesSessionEvent) => void,
  acquireProcess: () => AcpProcess = sharedHermesProcess,
): Promise<HermesTurnHandle> {
  try {
    return await acquireProcess().startTurn(args, onEvent);
  } catch (error) {
    if (!isRetryablePrePromptCleanExit(error)) throw error;
    // A clean EOF before session/prompt cannot have reached inference or
    // created delegated native work. Re-establish this one failed transport
    // boundary once; never retry after prompt dispatch.
    console.warn(`[hermes] ACP closed before prompt dispatch; re-establishing once: ${(error as Error).message}`);
    return acquireProcess().startTurn(args, onEvent);
  }
}

export async function requestHermesExtension(
  method: string,
  params: Record<string, unknown>,
): Promise<any> {
  return sharedHermesProcess().requestExtension(method, params);
}

export async function configureHermesHostSession(
  args: HermesTurnArgs,
  executionContextId: string,
): Promise<HermesPreparedSession> {
  return sharedHermesProcess().configureHostSession(args, executionContextId);
}

export async function prepareHermesSession(
  args: HermesTurnArgs,
): Promise<HermesPreparedSession> {
  return sharedHermesProcess().prepareSession(args);
}

export async function readHermesHistory(
  args: HermesTurnArgs,
): Promise<{ sessionId: string | null; messages: HermesHistoryMessage[] }> {
  return sharedHermesProcess().readHistory(args);
}

export function closeHermesRuntimes(): void {
  processOwner?.close();
  processOwner = null;
}
