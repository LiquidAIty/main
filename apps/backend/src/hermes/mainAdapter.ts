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
  bindHermesRootExecutionSession,
  executionToolCallMeta,
  finishHermesExecutionContext,
  registerHermesRootExecutionContext,
} from './childExecutionContext';
import {
  handleHermesHostExecutionRequest,
  startHermesHostTeamMonitor,
} from './hostExecutionLifecycle';
import {
  HERMES_BACKGROUND_REVIEW_MAX_INPUT_TOKENS,
  sameNativeSubagentModel,
  toNativeSubagentModel,
  type NativeSubagentModel,
  type SavedSubagentModel,
} from './subagentModel';

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
  | { kind: 'tool_progress'; toolName: string; toolUseId: string; output: string }
  | { kind: 'permission'; promptId: string; question: string; promptType: string }
  | { kind: 'script_start'; version: number; sourceHash: string; compiledHash: string }
  | { kind: 'script_result'; ok: boolean; output: string; receipt: Record<string, unknown> | null; fallback: Record<string, unknown> | null }
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
  subagentModel?: SavedSubagentModel;
  effectiveSubagentModel?: {
    desired: SavedSubagentModel;
    provider: string;
    model: string;
    fallbackOccurred: boolean;
    fallbackReason: string | null;
  };
  accessMode: CardAccessMode;
  /** Model-visible tools for this turn. */
  tools: string[];
  /** Complete saved authorization ceiling; never inferred from presentation. */
  grantedTools?: string[];
  toolCatalogPolicy?: 'selected' | 'all_healthy';
  disabledTools?: string[];
  mcpConnectionIds: string[];
  nativeTools?: string[];
  toolsets?: string[];
  nativeProfileToolsets?: string[];
  nativeProfileMcpServerNames?: string[];
  script?: {
    version: number;
    source: string;
    sourceHash: string;
    compiledHash: string;
    mode: 'outer_controller';
    inputSchema: Record<string, unknown>;
    outputSchema: Record<string, unknown>;
    toolHandles: string[];
    toolStates: Record<string, number>;
    offToolIds: string[];
    scriptToolIds: string[];
    agentToolIds: string[];
    timeoutSeconds: number;
    maxToolCalls: number;
    maxOutputBytes: number;
  };
  scriptInput?: Record<string, unknown>;
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

export type HermesHistoryArgs = {
  sessionKey: string;
  profile: string;
  workingDirectory?: string;
  // Supplied only by the persisted Run, never selected by the browser.
  sessionId?: string;
  terminal?: boolean;
};

export type HermesToolObservation = {
  toolName: string;
  toolUseId: string;
  argsJson: string;
  output?: string;
  isError?: boolean;
  sequence: number;
  timestamp: string;
  completedAt?: string;
  completedSequence?: number;
  partialOutput?: string;
  partialSequence?: number;
  partialTimestamp?: string;
};

export type HermesRunSnapshot = {
  projectId: string;
  deckId: string;
  cardId: string;
  cardName: string;
  runId: string;
  sessionId: string;
  fullText: string;
  textSequence: number;
  textTimestamp: string | null;
  tools: HermesToolObservation[];
  modelBlocks?: Array<{ text: string; sequence: number; timestamp: string }>;
  configuration?: {
    provider: string; model: string; profile: string; grantedTools: string[]; loadedSkills: null;
    subagentModel: HermesRuntimeConfig['effectiveSubagentModel'] | null;
  };
};

type HermesHistoryResult = {
  sessionId: string | null;
  messages: HermesHistoryMessage[];
  events?: HermesSessionEvent[];
};

export type HermesTurnHandle = {
  answer(promptId: string, reply: string): void;
  cancel(): void | Promise<void>;
  done: Promise<{
    finalText: string;
    usage: HermesTurnUsage;
    transport: {
      threadId: string | null;
      turnId: string | null;
      authMode: string | null;
      planType: string | null;
      scriptReceipt?: Record<string, unknown> | null;
      scriptFallback?: Record<string, unknown> | null;
      scriptControl?: Record<string, unknown> | null;
      nativeTaskId?: string;
      nativeRunId?: string | number | null;
      nativeStatus?: string;
    };
  }>;
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
    super(
      `hermes_acp_exited:${exit.code ?? 'null'}:${exit.signal ?? 'none'}`
      + `:explicit=${exit.explicit ? 'yes' : 'no'}`
      + `:last=${exit.lastProtocolEvent}`
      + `:stderr_lines=${exit.stderrTail.length}`
      + `:stdout_buffered=${exit.stdoutTail ? 'yes' : 'no'}`,
    );
    this.name = 'HermesAcpExitedError';
  }
}

type ActiveTurn = {
  runId: string;
  identity: Pick<HermesRunSnapshot, 'projectId' | 'deckId' | 'cardId' | 'cardName'>;
  onEvent(event: HermesSessionEvent): void;
  fullText: string;
  sequence: number;
  textSequence: number;
  textTimestamp: string | null;
  toolNames: Map<string, HermesToolObservation>;
  effectToolNames: Set<string>;
  effectOutcomes: Array<{ toolName: string; toolUseId: string; isError: boolean }>;
  permissionRequestIds: Map<string, number | string>;
  rootExecutionContextId: string;
  configuration: NonNullable<HermesRunSnapshot['configuration']>;
  modelBlocks: NonNullable<HermesRunSnapshot['modelBlocks']>;
  lastPublicKind: string;
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
    | 'grantedTools'
    | 'script'
  >,
  env: NodeJS.ProcessEnv = process.env,
  executionContextId = '',
): Record<string, unknown> | null {
  const granted = (args.grantedTools ?? args.tools).filter((name) => name !== 'web_search');
  const presented = uniqueStrings(args.script ? granted : args.tools)
    .filter((name) => name !== 'web_search');
  if (presented.length === 0) return null;
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
    presentedTools: presented,
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

function hermesMcpToolName(serverName: string, toolName: string): string {
  const sanitize = (value: string) => value.replace(/[^A-Za-z0-9_]/g, '_');
  return `mcp__${sanitize(serverName)}__${sanitize(toolName)}`;
}

function uniqueStrings(values: string[]): string[] {
  return values.filter((value, index, all) => Boolean(value) && all.indexOf(value) === index);
}

type CardProgramBlock = { id: string; content: string };

function boundedProgramBlock(value: unknown, field: string): CardProgramBlock {
  if (!value || typeof value !== 'object') throw new Error(`hermes_host_script_overlay_${field}_invalid`);
  const record = value as Record<string, unknown>;
  const id = String(record.id || '').trim();
  const content = typeof record.content === 'string' ? record.content : '';
  if (!/^script\.[A-Za-z0-9._-]{1,120}$/.test(id)) {
    throw new Error(`hermes_host_script_overlay_${field}_id_invalid`);
  }
  if (Buffer.byteLength(content, 'utf8') > 32_768) {
    throw new Error(`hermes_host_script_overlay_${field}_too_large`);
  }
  return { id, content };
}

function applyCardScriptAgentStage(
  args: HermesTurnArgs,
  agent: Record<string, unknown>,
): { prompt: string; receipt: Record<string, unknown> } {
  const hasPrompt = Object.hasOwn(agent, 'prompt');
  const overlay = agent.overlay;
  if (hasPrompt && overlay !== undefined) throw new Error('hermes_host_script_agent_prompt_overlay_conflict');
  if (hasPrompt) {
    if (typeof agent.prompt !== 'string' || !agent.prompt.trim()) {
      throw new Error('hermes_host_script_agent_prompt_invalid');
    }
    return {
      prompt: agent.prompt,
      receipt: {
        agentInvoked: true,
        promptMode: 'replace',
        promptSha256: createHash('sha256').update(agent.prompt, 'utf8').digest('hex'),
      },
    };
  }
  if (overlay === undefined) {
    return {
      prompt: args.message,
      receipt: {
        agentInvoked: true,
        promptMode: 'preserved-default',
        promptSha256: createHash('sha256').update(args.message, 'utf8').digest('hex'),
      },
    };
  }
  if (!overlay || typeof overlay !== 'object' || Array.isArray(overlay)) {
    throw new Error('hermes_host_script_agent_overlay_invalid');
  }
  const control = overlay as Record<string, unknown>;
  const allowed = new Set(['order', 'select', 'exclude', 'replace', 'prepend', 'append', 'maxChars']);
  const unknown = Object.keys(control).find((name) => !allowed.has(name));
  if (unknown) throw new Error(`hermes_host_script_agent_overlay_field_invalid:${unknown}`);
  const inputCard = args.scriptInput?.card;
  const rawBlocks = inputCard && typeof inputCard === 'object'
    ? (inputCard as Record<string, unknown>).blocks
    : null;
  if (!Array.isArray(rawBlocks) || rawBlocks.length < 1 || rawBlocks.length > 16) {
    throw new Error('hermes_host_script_agent_overlay_blocks_unavailable');
  }
  const base = rawBlocks.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('hermes_host_script_agent_overlay_block_invalid');
    const record = item as Record<string, unknown>;
    const id = String(record.id || '').trim();
    const content = typeof record.content === 'string' ? record.content : '';
    if (!id || Buffer.byteLength(content, 'utf8') > 65_536) {
      throw new Error('hermes_host_script_agent_overlay_block_invalid');
    }
    return { id, content };
  });
  if (new Set(base.map((item) => item.id)).size !== base.length) {
    throw new Error('hermes_host_script_agent_overlay_block_duplicate');
  }
  const baseIds = new Set(base.map((item) => item.id));
  const idList = (name: 'order' | 'select' | 'exclude'): string[] => {
    const value = control[name];
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > 16 || value.some((item) => typeof item !== 'string')) {
      throw new Error(`hermes_host_script_agent_overlay_${name}_invalid`);
    }
    const ids = value.map((item) => String(item));
    const invalid = ids.find((id) => !baseIds.has(id));
    if (invalid) throw new Error(`hermes_host_script_agent_overlay_reference_unknown:${invalid}`);
    if (new Set(ids).size !== ids.length) throw new Error(`hermes_host_script_agent_overlay_${name}_duplicate`);
    return ids;
  };
  const selected = idList('select');
  const excluded = new Set(idList('exclude'));
  const ordered = idList('order');
  let blocks = selected.length > 0 ? base.filter((item) => selected.includes(item.id)) : [...base];
  blocks = blocks.filter((item) => !excluded.has(item.id));
  if (ordered.length > 0) {
    const positions = new Map(ordered.map((id, index) => [id, index]));
    blocks = blocks
      .map((item, index) => ({ item, index }))
      .sort((left, right) => (
        (positions.get(left.item.id) ?? ordered.length + left.index)
        - (positions.get(right.item.id) ?? ordered.length + right.index)
      ))
      .map(({ item }) => item);
  }
  const replace = control.replace;
  if (replace !== undefined) {
    if (!replace || typeof replace !== 'object' || Array.isArray(replace)) {
      throw new Error('hermes_host_script_agent_overlay_replace_invalid');
    }
    for (const [id, content] of Object.entries(replace as Record<string, unknown>)) {
      if (!baseIds.has(id)) throw new Error(`hermes_host_script_agent_overlay_reference_unknown:${id}`);
      if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > 32_768) {
        throw new Error(`hermes_host_script_agent_overlay_replace_invalid:${id}`);
      }
      blocks = blocks.map((item) => item.id === id ? { ...item, content } : item);
    }
  }
  const prepend = control.prepend === undefined ? [] : control.prepend;
  const append = control.append === undefined ? [] : control.append;
  if (!Array.isArray(prepend) || !Array.isArray(append) || prepend.length > 8 || append.length > 8) {
    throw new Error('hermes_host_script_agent_overlay_additions_invalid');
  }
  blocks = [
    ...prepend.map((item) => boundedProgramBlock(item, 'prepend')),
    ...blocks,
    ...append.map((item) => boundedProgramBlock(item, 'append')),
  ];
  let prompt = blocks.map((item) => item.content).filter(Boolean).join('\n\n');
  if (control.maxChars !== undefined) {
    if (!Number.isInteger(control.maxChars) || Number(control.maxChars) < 256 || Number(control.maxChars) > 65_536) {
      throw new Error('hermes_host_script_agent_overlay_budget_invalid');
    }
    prompt = prompt.slice(0, Number(control.maxChars));
  }
  if (!prompt.trim()) throw new Error('hermes_host_script_agent_overlay_empty');
  return {
    prompt,
    receipt: {
      agentInvoked: true,
      promptMode: 'sparse-overlay',
      blockOrder: blocks.map((item) => item.id),
      excluded: [...excluded],
      replaced: replace && typeof replace === 'object' ? Object.keys(replace) : [],
      promptSha256: createHash('sha256').update(prompt, 'utf8').digest('hex'),
      promptBytes: Buffer.byteLength(prompt, 'utf8'),
    },
  };
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
  const officialServerName = String(rootOfficial?.name || '');
  const hostScript = args.script && (rootOfficial || args.script.toolHandles.length === 0) ? {
    version: args.script.version,
    source: args.script.source,
    sourceHash: args.script.sourceHash,
    compiledHash: args.script.compiledHash,
    mode: args.script.mode,
    inputSchema: args.script.inputSchema,
    outputSchema: args.script.outputSchema,
    toolAliases: Object.fromEntries(args.script.scriptToolIds.map((canonicalId) => [
      canonicalId,
      hermesMcpToolName(officialServerName, canonicalId),
    ])),
    fallbackToolAliases: Object.fromEntries(
      (args.grantedTools ?? args.tools)
        .filter((canonicalId) => canonicalId !== 'web_search')
        .map((canonicalId) => [
          canonicalId,
          hermesMcpToolName(officialServerName, canonicalId),
        ]),
    ),
    toolStates: args.script.toolStates,
    timeoutSeconds: args.script.timeoutSeconds,
    maxToolCalls: args.script.maxToolCalls,
    maxOutputBytes: args.script.maxOutputBytes,
  } : null;
  const rawOfficialTools = hostScript && rootOfficial
    ? args.tools
        .filter((name) => name !== 'web_search')
        .map((canonicalId) => hermesMcpToolName(officialServerName, canonicalId))
    : [];
  return {
    mcpServers: rootServers,
    sessionMeta: {
      hermes: {
        sessionConfig: {
          enabledToolsets: uniqueStrings([
            // Native Hermes toolsets remain explicit saved Card/profile
            // selections because several include write-capable tools. The
            // all_healthy policy applies to the exact LiquidAIty MCP catalog,
            // whose read/write effects are gated during IDF materialization.
            ...(args.toolsets || []),
            ...(args.nativeProfileToolsets || []),
            ...(args.nativeProfileMcpServerNames || []).map((name) => `mcp-${name}`),
            ...(!hostScript ? mcpToolsetNames(rootServers) : []),
          ]),
          enabledTools: uniqueStrings([
            ...(args.nativeTools || []),
            // Existing saved web_search selection uses Hermes' native tool.
            ...args.tools.filter((name) => name === 'web_search'),
            ...rawOfficialTools,
          ]),
          // This narrows only the trusted LiquidAIty session projection. The
          // native delegate_task registry keeps every upstream role.
          delegationRoles: args.cardId === 'card_main_chat'
            ? ['team', 'leaf']
            : ['team'],
          hostSessionKey: args.sessionKey,
          systemPrompt: args.prompt,
          ...(hostScript ? { hostScript } : {}),
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
  private readonly configuringSessions = new Set<string>();
  private readonly sessionByKey = new Map<string, string>();
  private readonly historyCollectors = new Map<string, {
    messages: HermesHistoryMessage[];
    events?: HermesSessionEvent[];
    toolNames: Map<string, string>;
  }>();
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
    options: { install?: HermesAcpInstall; hermesHome?: string; profile?: string } = {},
  ) {
    const install = options.install ?? resolveHermesInstall();
    this.executable = install.executable;
    const rootHome = options.hermesHome ?? path.join(install.root, '.hermes');
    const profile = String(options.profile || '').trim().toLowerCase();
    if (profile && !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(profile)) {
      throw new Error('hermes_runtime_profile_invalid');
    }
    this.hermesHome = profile ? path.join(rootHome, 'profiles', profile) : rootHome;
    if (profile && !existsSync(this.hermesHome)) {
      throw new Error(`hermes_native_profile_not_found:${profile}`);
    }
    this.exitPromise = new Promise((resolve) => {
      this.resolveExit = resolve;
    });
    const childEnv = withoutInternalMcpSecret(process.env);
    this.child = spawn(this.executable, install.args, {
      cwd: install.root,
      env: {
        ...childEnv,
        HERMES_HOME: this.hermesHome,
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
    if (
      ['_session/create_execution_context', '_session/finish_execution_context'].includes(message.method)
      && Object.prototype.hasOwnProperty.call(message, 'id')
    ) {
      const sessionId = String(message.params?.sessionId || '');
      if (message.method === '_session/create_execution_context' && !this.turns.get(sessionId)) {
        this.send({ jsonrpc: '2.0', id: message.id, error: { code: -32001, message: 'hermes_turn_context_unavailable' } });
        return;
      }
      const method = message.method === '_session/create_execution_context'
        ? 'session/create_execution_context'
        : 'session/finish_execution_context';
      void handleHermesHostExecutionRequest({
        method,
        params: message.params && typeof message.params === 'object' ? message.params : {},
      }).then((outcome) => {
        this.send({ jsonrpc: '2.0', id: message.id, result: outcome.result });
        if (outcome.nativeContext) {
          startHermesHostTeamMonitor({
            context: outcome.nativeContext,
            appendTeamResult: async (result) => {
              await this.request('_session/append_native_team_result', result);
            },
          });
        }
      }).catch((error) => {
        this.send({
          jsonrpc: '2.0',
          id: message.id,
          error: {
            code: method === 'session/create_execution_context' ? -32002 : -32003,
            message: error instanceof Error ? error.message : 'hermes_execution_context_failed',
          },
        });
      });
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
    if (history) {
      if (kind === 'user_message_chunk' || kind === 'agent_message_chunk') {
        const text = textContent(update);
        if (text) {
          history.messages.push({
            role: kind === 'user_message_chunk' ? 'user' : 'assistant',
            text,
          });
          // Native replay identifies persisted assistant messages. Its explicit
          // compaction metadata is not model output for the Card terminal.
          if (kind === 'agent_message_chunk'
            && !update?._meta?.hermes?.compactionSummary
            && !update?._meta?.hermes?.containsCompactionSummary) {
            history.events?.push({ kind: 'text', text });
          }
        }
      }
      if (history.events && kind === 'tool_call') {
        const toolUseId = String(update.toolCallId || '');
        const toolName = String(update.title || update.kind || 'tool');
        history.toolNames.set(toolUseId, toolName);
        history.events.push({ kind: 'tool_start', toolUseId, toolName,
          argsJson: jsonText(update.rawInput), agentType: '', invokingCardId: '' });
      }
      if (history.events && kind === 'tool_call_update'
        && (update.status === 'completed' || update.status === 'failed')) {
        const toolUseId = String(update.toolCallId || '');
        history.events.push({ kind: 'tool_result', toolUseId,
          toolName: history.toolNames.get(toolUseId) || String(update.title || 'tool'),
          output: jsonText(update.rawOutput), isError: update.status === 'failed' });
      }
      return;
    }
    const turn = this.turns.get(sessionId);
    if (!turn) return;
    if (kind === 'agent_message_chunk') {
      const messageSource = String(update?._meta?.hermes?.messageSource || '');
      if (messageSource !== 'model') return;
      const text = textContent(update);
      if (text) {
        if (turn.lastPublicKind !== 'text') turn.modelBlocks.push({ text: '',
          sequence: ++turn.sequence, timestamp: new Date().toISOString() });
        turn.modelBlocks[turn.modelBlocks.length - 1].text += text;
        turn.textSequence = turn.modelBlocks[0].sequence;
        turn.textTimestamp = turn.modelBlocks[0].timestamp;
        turn.lastPublicKind = 'text';
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
      turn.lastPublicKind = 'tool_call';
      const id = String(update.toolCallId || '');
      const name = String(update.title || update.kind || 'tool');
      turn.toolNames.set(id, {
        toolName: name, toolUseId: id, argsJson: jsonText(update.rawInput),
        sequence: ++turn.sequence, timestamp: new Date().toISOString(),
      });
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
    if (kind === 'tool_call_update' && update.status !== 'completed' && update.status !== 'failed') {
      const id = String(update.toolCallId || '');
      const tool = turn.toolNames.get(id);
      if (tool && update.rawOutput != null) {
        turn.lastPublicKind = 'tool_progress';
        tool.partialOutput = jsonText(update.rawOutput);
        tool.partialSequence ??= ++turn.sequence;
        tool.partialTimestamp ??= new Date().toISOString();
        turn.onEvent({ kind: 'tool_progress', toolName: tool.toolName, toolUseId: id, output: tool.partialOutput });
      }
      return;
    }
    if (kind === 'tool_call_update' && (update.status === 'completed' || update.status === 'failed')) {
      turn.lastPublicKind = 'tool_result';
      const id = String(update.toolCallId || '');
      const observation = turn.toolNames.get(id);
      const reportedName = observation?.toolName || String(update.title || 'tool');
      const toolName = resolveHermesEffectToolName(turn.effectToolNames, reportedName);
      if (observation) {
        observation.output = jsonText(update.rawOutput);
        observation.isError = update.status === 'failed';
        observation.completedAt = new Date().toISOString();
        observation.completedSequence = ++turn.sequence;
      }
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

  async configureHostSession(
    args: HermesTurnArgs,
    executionContextId: string,
  ): Promise<HermesPreparedSession> {
    await this.ready;
    const contextId = String(executionContextId || '').trim();
    if (!contextId) throw new Error('hermes_execution_context_id_required');
    const { sessionId } = await this.resolveSession(args, contextId);
    if (this.turns.has(sessionId) || this.configuringSessions.has(sessionId)) {
      throw new Error('hermes_session_turn_already_running');
    }
    if (this.historyCollectors.has(sessionId)) throw new Error('hermes_history_read_in_progress');
    this.configuringSessions.add(sessionId);
    try {
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
    } finally {
      this.configuringSessions.delete(sessionId);
    }
  }

  async readHistory(args: HermesHistoryArgs): Promise<HermesHistoryResult> {
    await this.ready;
    const cwd = args.sessionId ? '' : this.sessionCwd(args.sessionKey, args.workingDirectory);
    const sessionMeta = {
      hermes: {
        sessionConfig: {
          hostSessionKey: args.sessionKey,
        },
      },
    };
    const listed = args.sessionId ? null : await this.request('session/list', { cwd, _meta: sessionMeta });
    const sessionId = args.sessionId || String(
      Array.isArray(listed?.sessions) ? listed.sessions[0]?.sessionId || '' : '',
    );
    if (!sessionId) return { sessionId: null, messages: [] };
    if (this.turns.has(sessionId) || this.configuringSessions.has(sessionId)) throw new Error('hermes_session_turn_already_running');
    if (this.historyCollectors.has(sessionId)) throw new Error('hermes_history_read_in_progress');

    const messages: HermesHistoryMessage[] = [];
    const events: HermesSessionEvent[] | undefined = args.terminal ? [] : undefined;
    this.historyCollectors.set(sessionId, { messages, events, toolNames: new Map() });
    try {
      await this.request('_session/read_history', { sessionId });
      if (!args.sessionId) this.sessionByKey.set(args.sessionKey, sessionId);
      return { sessionId, messages, ...(events ? { events } : {}) };
    } finally {
      this.historyCollectors.delete(sessionId);
    }
  }

  async deleteHistory(args: HermesHistoryArgs): Promise<{
    sessionId: string | null;
    deleted: boolean;
  }> {
    await this.ready;
    const cwd = args.sessionId ? '' : this.sessionCwd(args.sessionKey, args.workingDirectory);
    const listed = args.sessionId ? null : await this.request('session/list', {
      cwd,
      _meta: {
        hermes: {
          sessionConfig: {
            hostSessionKey: args.sessionKey,
          },
        },
      },
    });
    const sessionId = args.sessionId || String(
      Array.isArray(listed?.sessions) ? listed.sessions[0]?.sessionId || '' : '',
    );
    if (!sessionId) return { sessionId: null, deleted: false };
    if (this.turns.has(sessionId) || this.configuringSessions.has(sessionId)) throw new Error('hermes_session_turn_already_running');
    if (this.historyCollectors.has(sessionId)) throw new Error('hermes_history_read_in_progress');
    // The same native-session exclusion used by history reads also protects a
    // deletion from an overlapping host turn start or second deletion.
    this.historyCollectors.set(sessionId, { messages: [], toolNames: new Map() });
    try {
      const result = await this.request('_session/delete_history', { sessionId });
      if (result?.deleted === true) {
        for (const [key, value] of this.sessionByKey) {
          if (value === sessionId) this.sessionByKey.delete(key);
        }
      }
      return { sessionId, deleted: result?.deleted === true };
    } finally { this.historyCollectors.delete(sessionId); }
  }

  /** Projection of the existing active turn, not a second event log or owner. */
  readRunSnapshot(runId: string): HermesRunSnapshot | null {
    const match = [...this.turns.entries()].find(([, turn]) => turn.runId === runId);
    if (!match) return null;
    const [sessionId, turn] = match;
    return {
      ...turn.identity, runId, sessionId, fullText: turn.fullText,
      configuration: turn.configuration,
      modelBlocks: turn.modelBlocks.map((block) => ({ ...block })),
      textSequence: turn.textSequence, textTimestamp: turn.textTimestamp,
      tools: [...turn.toolNames.values()].map((tool) => ({ ...tool })),
    };
  }

  async requestExtension(method: string, params: Record<string, unknown>): Promise<any> {
    await this.ready;
    const nativeManagerMethod = method === '_native/call';
    const runtimeMethod = /^_(?:session|kanban)\/[a-z_]+$/.test(method);
    if (!nativeManagerMethod && !runtimeMethod) {
      throw new Error('hermes_acp_extension_method_invalid');
    }
    return this.request(method, params);
  }

  private activeTurnForSessionKey(sessionKey: string): { sessionId: string; turn: ActiveTurn } | null {
    const sessionId = this.sessionByKey.get(sessionKey);
    if (!sessionId) return null;
    const turn = this.turns.get(sessionId);
    return turn ? { sessionId, turn } : null;
  }

  cancelSessionKey(sessionKey: string, expectedRunId = ''): string {
    const active = this.activeTurnForSessionKey(sessionKey);
    if (!active) throw new Error('hermes_session_turn_not_running');
    if (expectedRunId && active.turn.runId !== expectedRunId) {
      throw new Error('hermes_session_run_mismatch');
    }
    this.notify('session/cancel', { sessionId: active.sessionId });
    return active.turn.runId;
  }

  cancelRun(runId: string): void {
    const match = [...this.turns.entries()].find(([, turn]) => turn.runId === runId);
    if (!match) throw new Error('hermes_run_not_running');
    this.notify('session/cancel', { sessionId: match[0] });
  }

  answerSessionKey(sessionKey: string, promptId: string, reply: string): void {
    const active = this.activeTurnForSessionKey(sessionKey);
    if (!active) throw new Error('hermes_session_turn_not_running');
    const requestId = active.turn.permissionRequestIds.get(promptId);
    if (requestId === undefined) throw new Error('hermes_permission_prompt_not_found');
    active.turn.permissionRequestIds.delete(promptId);
    const options = (() => {
      try { return JSON.parse(reply); } catch { return null; }
    })();
    const optionId = typeof options?.optionId === 'string' ? options.optionId : String(reply || '').trim();
    this.send({
      jsonrpc: '2.0',
      id: requestId,
      result: { outcome: optionId ? { outcome: 'selected', optionId } : { outcome: 'cancelled' } },
    });
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
      grantedTools: (args.grantedTools ?? args.tools).filter((name) => name !== 'web_search'),
    });
    let sessionId: string;
    let active: ActiveTurn;
    let configuringSessionId: string | undefined;
    try {
      ({ sessionId } = await this.resolveSession(args, rootContext.contextId));
      bindHermesRootExecutionSession(rootContext.contextId, sessionId);
      if (this.turns.has(sessionId) || this.configuringSessions.has(sessionId)) throw new Error('hermes_session_turn_already_running');
      if (this.historyCollectors.has(sessionId)) throw new Error('hermes_history_read_in_progress');
      // Reserve before the asynchronous configure call. Only this invocation
      // releases its reservation; a rejected concurrent caller must not do so.
      this.configuringSessions.add(sessionId);
      configuringSessionId = sessionId;
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
        runId: args.parentRunId,
        identity: { projectId: args.projectId, deckId: args.deckId,
          cardId: args.cardId, cardName: args.title },
        onEvent,
        fullText: '',
        sequence: 0,
        textSequence: 0,
        textTimestamp: null,
        toolNames: new Map(),
        effectToolNames: new Set(args.tools),
        effectOutcomes: [],
        permissionRequestIds: new Map(),
        rootExecutionContextId: rootContext.contextId,
        configuration: { provider: args.provider, model: args.providerModelId, profile: args.runtime.profile,
          grantedTools: [...(args.grantedTools ?? args.tools)], loadedSkills: null,
          subagentModel: args.effectiveSubagentModel || null },
        modelBlocks: [],
        lastPublicKind: '',
      };
      this.turns.set(sessionId, active);
    } catch (error) {
      await finishHermesExecutionContext({ contextId: rootContext.contextId, state: 'failed' });
      throw error;
    } finally {
      if (configuringSessionId) this.configuringSessions.delete(configuringSessionId);
    }
    let promptText = args.message;
    let directFinalText: string | null = null;
    let scriptReceipt: Record<string, unknown> | null = null;
    let scriptFallback: Record<string, unknown> | null = null;
    let scriptControl: Record<string, unknown> | null = null;
    if (args.script) {
      onEvent({
        kind: 'script_start',
        version: args.script.version,
        sourceHash: args.script.sourceHash,
        compiledHash: args.script.compiledHash,
      });
      let controller: any;
      try {
        controller = await this.request('_session/execute_host_script', {
          sessionId,
          input: args.scriptInput || { mission: args.message },
        });
      } catch (error) {
        this.turns.delete(sessionId);
        await finishHermesExecutionContext({ contextId: rootContext.contextId, state: 'failed' });
        const normalized = error instanceof Error ? error : new Error(String(error));
        onEvent({ kind: 'error', message: normalized.message, code: 'hermes_host_script_failed' });
        throw normalized;
      }
      scriptReceipt = controller?.receipt && typeof controller.receipt === 'object'
        ? controller.receipt as Record<string, unknown>
        : null;
      scriptFallback = controller?.fallback && typeof controller.fallback === 'object'
        ? controller.fallback as Record<string, unknown>
        : null;
      onEvent({
        kind: 'script_result',
        ok: controller?.ok === true,
        output: JSON.stringify(controller?.output ?? null),
        receipt: scriptReceipt,
        fallback: scriptFallback,
      });
      if (controller?.ok === true) {
        const output = controller.output;
        const agent = output?.agent;
        if (!output || typeof output !== 'object' || !agent || typeof agent !== 'object'
          || typeof agent.run !== 'boolean') {
          this.turns.delete(sessionId);
          await finishHermesExecutionContext({ contextId: rootContext.contextId, state: 'failed' });
          throw new Error('hermes_host_script_agent_stage_invalid');
        }
        if (agent.run) {
          const applied = applyCardScriptAgentStage(args, agent);
          promptText = applied.prompt;
          scriptControl = applied.receipt;
        } else {
          const finalValue = Object.hasOwn(output, 'result') ? output.result : output;
          directFinalText = typeof finalValue === 'string'
            ? finalValue
            : JSON.stringify(finalValue);
          scriptControl = { agentInvoked: false, promptMode: 'none' };
        }
      } else if (scriptFallback?.activated !== true) {
        this.turns.delete(sessionId);
        await finishHermesExecutionContext({ contextId: rootContext.contextId, state: 'failed' });
        throw new Error(String(controller?.error || 'hermes_host_script_failed'));
      }
    }
    let rootTerminalState: 'completed' | 'failed' | 'cancelled' = 'failed';
    const nativeStage = directFinalText === null
      ? this.request('session/prompt', {
          sessionId,
          messageId: randomUUID(),
          prompt: [{ type: 'text', text: promptText }],
        })
      : Promise.resolve({
          _meta: { hermes: { finalAssistantText: directFinalText } },
          usage: null,
          stopReason: 'end_turn',
        });
    const done = nativeStage.then((result) => {
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
      const finalText = requireHermesCompletionText(
        result?._meta?.hermes?.finalAssistantText,
      );
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
          scriptReceipt,
          scriptFallback,
          scriptControl,
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

const processOwners = new Map<string, AcpProcess>();

function sharedHermesProcess(profile = ''): AcpProcess {
  const key = String(profile || '').trim().toLowerCase();
  const existing = processOwners.get(key);
  if (existing?.alive) return existing;
  const owner = new AcpProcess((closed) => {
    if (processOwners.get(key) === closed) processOwners.delete(key);
  }, key ? { profile: key } : {});
  processOwners.set(key, owner);
  return owner;
}

function runningHermesProcess(profile = ''): AcpProcess {
  const key = String(profile || '').trim().toLowerCase();
  const owner = processOwners.get(key);
  if (!owner?.alive) throw new Error('hermes_profile_process_not_running');
  return owner;
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

export type HermesProfileMaterialization = {
  native: any;
  effectiveSubagentModel?: HermesRuntimeConfig['effectiveSubagentModel'];
};

export async function materializeHermesProfileSelections(
  args: HermesRuntimeConfig,
  readNativeProfile: (profile: string) => Promise<any> = (profile) => (
    requestHermesNative('profiles.describe', { name: profile })
  ),
  configureNativeSubagentModel: (
    profile: string,
    selection: NativeSubagentModel,
  ) => Promise<any> = (profile, selection) => requestHermesNative('profiles.configure', {
    name: profile,
    subagent_model: selection,
    background_review: {
      enabled: true,
      provider: selection.provider,
      model: selection.model,
      max_input_tokens: HERMES_BACKGROUND_REVIEW_MAX_INPUT_TOKENS,
    },
  }),
): Promise<HermesProfileMaterialization> {
  const profile = String(args.runtime.profile || '').trim();
  let native = await readNativeProfile(profile);
  if (!native || String(native.name || '').trim().toLowerCase() !== profile.toLowerCase()) {
    throw new Error(`hermes_native_profile_readback_mismatch:${profile}`);
  }
  let effectiveSubagentModel = args.effectiveSubagentModel;
  if (args.subagentModel) {
    const expected = toNativeSubagentModel(args.subagentModel);
    const review = native.background_review && typeof native.background_review === 'object'
      ? native.background_review as Record<string, unknown>
      : {};
    const reviewMatches = review.enabled === true
      && sameNativeSubagentModel(review, expected)
      && Number(review.max_input_tokens) === HERMES_BACKGROUND_REVIEW_MAX_INPUT_TOKENS;
    if (!sameNativeSubagentModel(native.subagent_model, expected) || !reviewMatches) {
      const configured = await configureNativeSubagentModel(profile, expected);
      const applied = configured?.applied && typeof configured.applied === 'object'
        ? configured.applied as Record<string, unknown>
        : {};
      if (configured?.ok !== true || applied.subagent_model !== true || applied.background_review !== true) {
        throw new Error(`hermes_native_subagent_model_apply_failed:${profile}`);
      }
      native = await readNativeProfile(profile);
    }
    const finalReview = native?.background_review && typeof native.background_review === 'object'
      ? native.background_review as Record<string, unknown>
      : {};
    if (
      !sameNativeSubagentModel(native?.subagent_model, expected)
      || finalReview.enabled !== true
      || !sameNativeSubagentModel(finalReview, expected)
      || Number(finalReview.max_input_tokens) !== HERMES_BACKGROUND_REVIEW_MAX_INPUT_TOKENS
    ) {
      throw new Error(`hermes_native_subagent_model_readback_mismatch:${profile}`);
    }
    effectiveSubagentModel = {
      desired: args.subagentModel,
      provider: expected.provider,
      model: expected.model,
      fallbackOccurred: false,
      fallbackReason: null,
    };
  }
  return {
    native,
    ...(effectiveSubagentModel ? { effectiveSubagentModel } : {}),
  };
}

export async function startHermesTurnWithOnePrePromptRecovery(
  args: HermesTurnArgs,
  onEvent: (event: HermesSessionEvent) => void,
  acquireProcess: (profile?: string) => AcpProcess = sharedHermesProcess,
  readNativeProfile: (profile: string) => Promise<any> = (profile) => (
    requestHermesNative('profiles.describe', { name: profile })
  ),
  configureNativeSubagentModel: (
    profile: string,
    selection: NativeSubagentModel,
  ) => Promise<any> = (profile, selection) => requestHermesNative('profiles.configure', {
    name: profile,
    subagent_model: selection,
    background_review: {
      enabled: true,
      provider: selection.provider,
      model: selection.model,
      max_input_tokens: HERMES_BACKGROUND_REVIEW_MAX_INPUT_TOKENS,
    },
  }),
): Promise<HermesTurnHandle> {
  const profile = String(args.runtime.profile || '').trim();
  const materialized = await materializeHermesProfileSelections(
    args,
    readNativeProfile,
    configureNativeSubagentModel,
  );
  const { native, effectiveSubagentModel } = materialized;
  const nativeArgs: HermesTurnArgs = {
    ...args,
    ...(effectiveSubagentModel ? { effectiveSubagentModel } : {}),
    nativeProfileToolsets: Array.isArray(native.toolsets)
      ? native.toolsets
        .filter((item: any) => item?.enabled === true)
        .map((item: any) => String(item.name || '').trim())
        .filter(Boolean)
      : [],
    nativeProfileMcpServerNames: Array.isArray(native.mcp_servers)
      ? native.mcp_servers
        .filter((item: any) => item?.enabled === true)
        .map((item: any) => String(item.name || '').trim())
        .filter(Boolean)
      : [],
  };
  try {
    return await acquireProcess(profile).startTurn(nativeArgs, onEvent);
  } catch (error) {
    if (!isRetryablePrePromptCleanExit(error)) throw error;
    // A clean EOF before session/prompt cannot have reached inference or
    // created delegated native work. Re-establish this one failed transport
    // boundary once; never retry after prompt dispatch.
    console.warn(`[hermes] ACP closed before prompt dispatch; re-establishing once: ${(error as Error).message}`);
    return acquireProcess(profile).startTurn(nativeArgs, onEvent);
  }
}

export async function requestHermesExtension(
  method: string,
  params: Record<string, unknown>,
  profile = '',
): Promise<any> {
  return sharedHermesProcess(profile).requestExtension(method, params);
}

export async function requestHermesNative(
  method: string,
  params: Record<string, unknown>,
  profile = '',
): Promise<any> {
  return requestHermesExtension('_native/call', {
    method,
    params,
    ...(String(profile || '').trim() ? { profile: String(profile).trim() } : {}),
  });
}

export async function dispatchHermesLearnCommand(profile: string, request: string): Promise<string> {
  const result = await requestHermesNative(
    'command.dispatch',
    { name: 'learn', arg: request },
    profile,
  );
  const message = result?.type === 'send' ? String(result.message || '').trim() : '';
  if (!message) throw new Error('hermes_learn_command_dispatch_failed');
  return message;
}

export function cancelHermesRun(profile: string, runId: string): void {
  runningHermesProcess(profile).cancelRun(runId);
}

export function cancelHermesSession(
  profile: string,
  sessionKey: string,
  expectedRunId = '',
): string {
  return runningHermesProcess(profile).cancelSessionKey(sessionKey, expectedRunId);
}

export function answerHermesSession(
  profile: string,
  sessionKey: string,
  promptId: string,
  reply: string,
): void {
  runningHermesProcess(profile).answerSessionKey(sessionKey, promptId, reply);
}

export async function configureHermesHostSession(
  args: HermesTurnArgs,
  executionContextId: string,
): Promise<HermesPreparedSession> {
  return sharedHermesProcess().configureHostSession(args, executionContextId);
}

export async function readHermesHistory(
  args: HermesHistoryArgs,
): Promise<HermesHistoryResult> {
  return sharedHermesProcess(args.profile).readHistory(args);
}

/** Read-only: a disconnected observer must never acquire/start a runtime. */
export function readHermesRunSnapshot(profile: string, runId: string): HermesRunSnapshot | null {
  return processOwners.get(profile.trim().toLowerCase())?.readRunSnapshot(runId) ?? null;
}

export async function deleteHermesHistory(
  args: HermesHistoryArgs,
): Promise<{ sessionId: string | null; deleted: boolean }> {
  return sharedHermesProcess(args.profile).deleteHistory(args);
}

export function closeHermesRuntimes(): void {
  for (const owner of processOwners.values()) owner.close();
  processOwners.clear();
}
