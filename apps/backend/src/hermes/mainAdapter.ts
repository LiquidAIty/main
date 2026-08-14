import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { BUILDER_DECK_ID, getDeckDocument } from '../decks/store';
import { resolveRuntimeBinding } from '../contracts/runtimeBinding';
import { resolveProductChatWorkingDirectory, resolveRepoRoot } from '../coder/workspaceRoot';
import { resolveModel } from '../llm/models.config';
import { resolveSavedMcpConnections } from './mcpConnections';

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
  runtimeBinding: string;
  prompt: string;
  profile: string;
  provider: string;
  modelKey: string;
  providerModelId: string;
  executionMode: 'single' | 'auto-kanban';
  tools: string[];
  nativeTools: string[];
  skills: string[];
  toolsets: string[];
  mcpConnectionIds: string[];
  coderCardIds: string[];
  directSubagents: { cardId: string; title: string; runtimeBinding: string }[];
};

export type HermesTurnArgs = HermesRuntimeConfig & {
  sessionKey: string;
  projectId: string;
  conversationId: string;
  parentRunId: string;
  message: string;
  workingDirectory?: string;
};

export type HermesTurnHandle = {
  answer(promptId: string, reply: string): void;
  cancel(): void;
  done: Promise<{ finalText: string; usage: HermesTurnUsage }>;
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

function savedStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => String(entry || '').trim())
    .filter((entry, index, all) => Boolean(entry) && all.indexOf(entry) === index);
}

function resolveHermesInstall(): { root: string; executable: string } {
  const root = path.join(resolveRepoRoot(), 'Hermes');
  const executable = path.join(root, 'venv', 'Scripts', 'hermes-acp.exe');
  if (!existsSync(executable)) {
    throw new Error(`hermes_repo_acp_missing:${executable}`);
  }
  return { root, executable };
}

export function resolveHermesCardRuntimeHome(root: string, cardId: string): string {
  return path.join(root, '.hermes', 'profiles', safeProfile(cardId));
}

export function providerForHermes(provider: string): string {
  const normalized = String(provider || '').trim().toLowerCase();
  if (normalized === 'openai') return 'openai-codex';
  return normalized;
}

function resolveSavedCardModel(card: any): {
  provider: string;
  modelKey: string;
  providerModelId: string;
} {
  const modelKey = String(card?.runtimeOptions?.modelKey || '').trim();
  if (!modelKey) throw new Error(`card_model_config_missing: cardId=${String(card?.id || '')}`);
  const resolved = resolveModel(modelKey);
  const savedProvider = String(card?.runtimeOptions?.provider || '').trim().toLowerCase();
  if (savedProvider && savedProvider !== resolved.provider) {
    throw new Error(
      `card_model_config_mismatch: cardId=${String(card?.id || '')} uiProvider=${savedProvider} registryProvider=${resolved.provider}`,
    );
  }
  return { provider: resolved.provider, modelKey, providerModelId: resolved.id };
}

export function resolveDirectHermesSubagents(
  parentCardId: string,
  nodes: any[],
  edges: any[],
): { cardId: string; title: string; runtimeBinding: string }[] {
  const byId = new Map(nodes.map((node) => [String(node?.id || ''), node]));
  const children = new Map<string, { cardId: string; title: string; runtimeBinding: string }>();
  for (const edge of edges) {
    if (
      String(edge?.source || '') !== parentCardId ||
      String(edge?.target || '') === parentCardId ||
      String(edge?.edgeType || '').trim().toLowerCase() !== 'flow'
    ) continue;
    const node: any = byId.get(String(edge?.target || ''));
    if (
      !node ||
      node.enabled === false ||
      node?.runtimeOptions?.enabled === false ||
      String(node?.parentGraphId || '').trim() ||
      String(node?.runtimeType || '').trim() !== 'assistant_agent'
    ) continue;
    const id = String(node.id || '').trim();
    const binding = resolveRuntimeBinding(node?.runtimeBinding);
    if (id && binding) {
      children.set(id, {
        cardId: id,
        title: String(node?.title || id),
        runtimeBinding: binding,
      });
    }
  }
  return [...children.values()];
}

export function resolveHermesCardRuntimeConfig(
  card: any,
  directSubagents: { cardId: string; title: string; runtimeBinding: string }[] = [],
): HermesRuntimeConfig {
  const model = resolveSavedCardModel(card);
  const runtimeBinding = resolveRuntimeBinding(card?.runtimeBinding);
  const requestedExecutionMode =
    card?.runtimeOptions?.executionMode === 'auto-kanban' ? 'auto-kanban' : 'single';
  if (runtimeBinding === 'main_chat' && requestedExecutionMode !== 'single') {
    throw new Error('main_execution_mode_must_be_single');
  }
  const coderCardIds = directSubagents
    .filter((child) => child.runtimeBinding === 'local_coder')
    .map((child) => child.cardId);
  return {
    cardId: String(card?.id || ''),
    title: String(card?.title || card?.id || ''),
    runtimeBinding,
    prompt: [
      String(card?.prompt || '').trim(),
      directSubagents.length > 0
        ? [
            '[DIRECT_SUBAGENTS]',
            ...directSubagents.map(
              (child) => `${child.cardId} | ${child.title} | ${child.runtimeBinding}`,
            ),
            'Invoke only these saved cards through card.run_assistant_agent, and only for a bounded assignment appropriate to that saved role.',
          ].join('\n')
        : '',
      coderCardIds.length > 0
        ? [
            '[RUNTIME_CONTEXT]',
            `The saved Coder subagent card ids are: ${coderCardIds.join(', ')}.`,
            'For an agreed bounded coding task, call card.run_assistant_agent with that saved cardId and the exact task input.',
            'Coder returns the existing bounded CoderReport contract. Do not invent a code result.',
          ].join('\n')
        : '',
    ].filter(Boolean).join('\n\n'),
    // The saved LiquidAIty card is the profile authority. A separate selectable
    // Hermes profile would create a second agent identity/configuration owner.
    profile: safeProfile(card?.id),
    provider: model.provider,
    modelKey: model.modelKey,
    providerModelId: model.providerModelId,
    executionMode: requestedExecutionMode,
    tools: [
      ...savedStringList(card?.runtimeOptions?.tools),
      ...(directSubagents.length > 0 ? ['card.run_assistant_agent'] : []),
    ].filter((tool, index, all) => tool !== 'web_search' && all.indexOf(tool) === index),
    nativeTools: savedStringList(card?.runtimeOptions?.nativeTools),
    skills: savedStringList(card?.runtimeOptions?.skills),
    toolsets: savedStringList(card?.runtimeOptions?.toolsets),
    mcpConnectionIds: savedStringList(card?.runtimeOptions?.mcpConnectionIds),
    coderCardIds,
    directSubagents,
  };
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
    this.executable = install.executable;
    this.profileHome = resolveHermesCardRuntimeHome(install.root, profile);
    mkdirSync(this.profileHome, { recursive: true });
    this.child = spawn(this.executable, [], {
      cwd: install.root,
      env: {
        ...process.env,
        HERMES_HOME: this.profileHome,
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
    const granted = args.tools.filter((name) => name !== 'web_search');
    if (granted.length === 0) return referenced;
    const root = resolveRepoRoot();
    const python = path.join(root, 'apps', 'python-models', '.venv', 'Scripts', 'python.exe');
    const host = path.join(root, 'apps', 'python-models', 'app', 'mcp_host.py');
    if (!existsSync(python) || !existsSync(host)) {
      throw new Error(`hermes_main_mcp_unavailable:${!existsSync(python) ? python : host}`);
    }
    const suffix = createHash('sha256').update(args.sessionKey).digest('hex').slice(0, 12);
    return [{
      name: `main-runtime-${suffix}`,
      command: python,
      args: [host],
      env: [
        { name: 'MCP_TRANSPORT', value: 'stdio' },
        { name: 'MCP_TOOL_ALLOWLIST', value: granted.join(',') },
        {
          name: 'MCP_TRUSTED_MAIN_CONTEXT',
          value: JSON.stringify({
            projectId: args.projectId,
            deckId: BUILDER_DECK_ID,
            conversationId: args.conversationId,
            parentRunId: args.parentRunId,
            mainCardId: args.cardId,
            callerRuntimeBinding: args.runtimeBinding,
          }),
        },
      ],
    }, ...referenced];
  }

  private async resolveSession(args: HermesTurnArgs): Promise<string> {
    const existing = this.sessionByKey.get(args.sessionKey);
    const cwd = this.sessionCwd(args.sessionKey, args.workingDirectory);
    const sessionConfig = {
      systemPrompt: args.prompt,
      enabledTools: args.nativeTools,
      enabledToolsets: args.toolsets,
      skills: args.skills,
    };
    const mcpServers = this.mcpServers(args);
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
    if (args.executionMode !== 'single') {
      throw new Error('hermes_auto_kanban_card_execution_not_wired');
    }
    const sessionId = await this.resolveSession(args);
    if (this.turns.has(sessionId)) throw new Error('hermes_session_turn_already_running');
    const modelChoice = `${providerForHermes(args.provider)}:${args.providerModelId}`;
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
      onEvent({ kind: 'done', fullText: active.fullText, usage });
      return { finalText: active.fullText, usage };
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

export async function resolveMainHermesRuntimeConfig(projectId: string): Promise<HermesRuntimeConfig | null> {
  const doc = await getDeckDocument(projectId, BUILDER_DECK_ID);
  const nodes = Array.isArray((doc?.deck as any)?.nodes) ? (doc!.deck as any).nodes : [];
  const matches = nodes.filter((node: any) => resolveRuntimeBinding(node?.runtimeBinding) === 'main_chat');
  if (matches.length !== 1) return null;
  const card = matches[0];
  const edges = Array.isArray((doc?.deck as any)?.edges) ? (doc!.deck as any).edges : [];
  return resolveHermesCardRuntimeConfig(
    card,
    resolveDirectHermesSubagents(String(card.id || ''), nodes, edges),
  );
}

export async function startHermesTurn(
  args: HermesTurnArgs,
  onEvent: (event: HermesSessionEvent) => void,
): Promise<HermesTurnHandle> {
  return processForProfile(args.profile).startTurn(args, onEvent);
}

export function closeHermesRuntimes(): void {
  for (const process of processes.values()) process.close();
  processes.clear();
}
