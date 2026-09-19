import { EventEmitter } from 'node:events';
import { createHash, createHmac } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import type { IPty, IPtyForkOptions, IWindowsPtyForkOptions } from 'node-pty';
import {
  AgentTerminalManager,
  createNativeGatewayClient,
  requireAgentTerminalCard,
  type AgentTerminalGatewayEvent,
  type AgentTerminalLaunch,
  type AgentTerminalOwner,
} from './agentTerminal';
import type { AgentCardInstance, DeckDocument } from '../types';

vi.mock('../services/mcp/pythonAgentMcpClient', () => ({
  listPythonAgentMcpCatalog: vi.fn(),
  resolvePythonAgentMcpServerSpec: vi.fn(),
}));

function card(id: string, profile: string): AgentCardInstance {
  return {
    id,
    _cardRevisionId: `revision-${id}`,
    _cardRevision: 1,
    _cardRevisionSha256: 'a'.repeat(64),
    title: id,
    templateId: 'agent',
    position: { x: 0, y: 0 },
    prompt: `Prompt ${id}`,
    runtime: { kind: 'hermes', mode: 'delegate', profile },
    runtimeOptions: {
      provider: 'openai',
      accessMode: 'chatgpt-account',
      modelKey: 'gpt-5.6-sol',
      providerModelId: 'gpt-5.6-sol',
      nativeTools: ['memory'],
      toolsets: ['memory'],
      tools: ['canvas.inspect'],
    },
  };
}

class FakeGatewayProcess extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin = null;
  readonly stdio = [null, this.stdout, this.stderr];
  killed = false;
  exitCode: number | null = null;
  signalCode = null;
  connected = false;
  spawnfile = 'hermes.exe';
  spawnargs: string[] = [];
  channel = undefined;
  readonly pid: number;

  constructor(pid: number) {
    super();
    this.pid = pid;
  }

  kill = vi.fn(() => {
    if (this.exitCode !== null) return true;
    this.killed = true;
    this.exitCode = 0;
    this.emit('exit', 0, null);
    return true;
  });
}

class FakeGatewayClient {
  connectionState = 'idle';
  readonly requests: Array<{ method: string; params: Record<string, unknown> }> = [];
  readonly handlers = new Set<(event: AgentTerminalGatewayEvent) => void>();
  url = '';
  closed = false;
  private activeStored = '';
  private activeNative = '';
  private readonly botMeta = new Map<string, { value: Record<string, unknown>; revision: number }>();
  private readonly botRosters = new Map<string, string[]>();

  constructor(
    private readonly index: number,
    private readonly durableByTitle: Map<string, string>,
    private readonly controls: {
      enumerationFailure: boolean;
    },
    private readonly profileNames: string[],
  ) {}

  seedManagedProfile(name: string, roster: string[]) {
    this.botMeta.set(name, { value: { title: name }, revision: 1 });
    this.botRosters.set(name, roster);
  }

  async connect(url: string) {
    this.url = url;
    this.connectionState = 'open';
  }

  close() {
    this.closed = true;
    this.connectionState = 'closed';
  }

  onEvent(handler: (event: AgentTerminalGatewayEvent) => void) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  emitEvent(event: AgentTerminalGatewayEvent) {
    if (event.type === 'session.info') {
      const stored = String(event.payload?.stored_session_id || '').trim();
      if (stored) this.activeStored = stored;
    }
    for (const handler of this.handlers) handler(event);
  }

  async request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    this.requests.push({ method, params });
    const profile = String(params.profile || '');
    const titleKey = (title: string) => `${profile}\u0000${title}`;
    if (method === 'profiles.list') {
      return { profiles: this.profileNames.map((name) => {
        const meta = this.botMeta.get(name);
        return {
          name,
          ui_meta: meta ? { 'hermes-bots': meta.value } : {},
          ui_meta_revisions: { 'hermes-bots': meta?.revision || 0 },
        };
      }) } as T;
    }
    if (method === 'profiles.describe') {
      const name = String(params.name || '');
      return {
        name,
        bot_mode_roster: this.botRosters.has(name) ? this.botRosters.get(name) : null,
      } as T;
    }
    if (method === 'profiles.configure') {
      const name = String(params.name || '');
      const desired = (params.ui_meta as Record<string, unknown> | undefined)?.['hermes-bots'];
      const prior = this.botMeta.get(name);
      if (params.ui_meta) {
        if (desired === null) this.botMeta.delete(name);
        else this.botMeta.set(name, {
          value: desired && typeof desired === 'object' ? desired as Record<string, unknown> : {},
          revision: (prior?.revision || 0) + 1,
        });
      }
      if (Array.isArray(params.bot_mode_roster)) {
        this.botRosters.set(name, params.bot_mode_roster as string[]);
      }
      return { ok: true, applied: {
        ...(params.ui_meta ? { ui_meta: true } : {}),
        ...(Array.isArray(params.bot_mode_roster) ? { bot_mode_roster: true } : {}),
      } } as T;
    }
    if (method === 'session.list') {
      if (this.controls.enumerationFailure) throw new Error('storage failed');
      const title = String(params.title || '');
      if (title) {
        const durable = this.durableByTitle.get(titleKey(title));
        return { sessions: durable ? [{ id: durable, resolved_id: durable, title }] : [] } as T;
      }
      return { sessions: [...this.durableByTitle.entries()]
        .filter(([key]) => key.startsWith(`${profile}\u0000`))
        .map(([key, durable]) => ({
          id: durable,
          resolved_id: durable,
          title: key.slice(profile.length + 1),
        })) } as T;
    }
    if (method === 'session.create') {
      const title = String(params.title || '');
      const durable = `stored-${this.durableByTitle.size + 1}`;
      this.durableByTitle.set(titleKey(title), durable);
      this.activeStored = durable;
      this.activeNative = `live-${this.index}-created`;
      return { session_id: this.activeNative, stored_session_id: durable } as T;
    }
    if (method === 'session.resume') {
      this.activeStored = String(params.session_id || '');
      this.activeNative ||= `live-${this.index}-resumed`;
      return {
        session_id: this.activeNative,
        stored_session_id: this.activeStored,
        session_key: this.activeStored,
        running: false,
      } as T;
    }
    if (method === 'session.activate') {
      return {
        session_id: this.activeNative,
        session_key: this.activeStored,
        running: false,
      } as T;
    }
    if (method === 'session.title') {
      const title = String(params.title || '');
      for (const [key, value] of [...this.durableByTitle.entries()]) {
        if (key.startsWith(`${profile}\u0000`) && value === this.activeStored) {
          this.durableByTitle.delete(key);
        }
      }
      this.durableByTitle.set(titleKey(title), this.activeStored);
      return { pending: false, title } as T;
    }
    if (method === 'prompt.submit') {
      const sessionId = String(params.session_id || '');
      queueMicrotask(() => this.emitEvent({
        type: 'message.complete',
        session_id: sessionId,
        payload: { text: `reply:${String(params.text || '')}`, status: 'completed' },
      }));
      return { status: 'streaming' } as T;
    }
    if (method === 'plugins.list') {
      return { plugins: [
        { name: 'card-tools', version: '0.1.0', enabled: true },
      ] } as T;
    }
    if (method === 'tools.show') return { sections: [
      { name: 'memory', tools: [{ name: 'memory', description: 'Memory' }] },
      { name: 'card-tools', tools: [{ name: 'card__canvas_inspect', description: 'Inspect' }] },
    ], total: 2 } as T;
    if (method === 'session.interrupt') return { ok: true } as T;
    throw new Error(`unexpected fake gateway request:${method}`);
  }
}

function fixture(extraProfileNames: string[] = []) {
  const cards = [card('signal', 'signal-analyst'), card('quant', 'quant-analyst')];
  const deck: DeckDocument = {
    id: 'deck',
    name: 'Deck',
    nodes: cards,
    edges: [],
    promptTemplates: [],
    version: 1,
    workspaceRoot: 'C:\\workspace',
  };
  const ptys: Array<{
    pid: number;
    write: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
    kill: ReturnType<typeof vi.fn>;
    data(value: string): void;
    exit(value: { exitCode: number }): void;
    options: IPtyForkOptions | IWindowsPtyForkOptions;
  }> = [];
  const spawnPty = vi.fn((
    _file: string,
    _args: string | string[],
    options: IPtyForkOptions | IWindowsPtyForkOptions,
  ) => {
    const record = {
      pid: 200 + ptys.length,
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      data: (_value: string) => {},
      exit: (_value: { exitCode: number }) => {},
      options,
    };
    record.kill.mockImplementation(() => record.exit({ exitCode: 0 }));
    const pty = {
      pid: record.pid,
      write: record.write,
      resize: record.resize,
      kill: record.kill,
      onData: (fn: typeof record.data) => { record.data = fn; return { dispose() {} }; },
      onExit: (fn: typeof record.exit) => { record.exit = fn; return { dispose() {} }; },
    } as unknown as IPty;
    ptys.push(record);
    return pty;
  });
  const gateways: FakeGatewayProcess[] = [];
  const spawnGateway = vi.fn((_file: string, _args: string[], _options: Record<string, unknown>) => {
    const process = new FakeGatewayProcess(100 + gateways.length);
    gateways.push(process);
    queueMicrotask(() => process.stdout.write(`HERMES_BACKEND_READY port=${9100 + gateways.length}\n`));
    return process as unknown as ChildProcess;
  });
  const durableByTitle = new Map<string, string>();
  const controls = {
    enumerationFailure: false,
  };
  const clients: FakeGatewayClient[] = [];
  const createGatewayClient = vi.fn(async () => {
    const client = new FakeGatewayClient(
      clients.length + 1,
      durableByTitle,
      controls,
      [
        ...cards.map((selected) => selected.runtime.kind === 'hermes' ? selected.runtime.profile : ''),
        ...extraProfileNames,
      ],
    );
    clients.push(client);
    return client;
  });
  const prepare = vi.fn((_owner: AgentTerminalOwner, selected: AgentCardInstance, _deck: DeckDocument, sessionId: string, workingDirectory?: string): AgentTerminalLaunch => ({
    file: 'hermes.exe',
    gatewayArgs: ['-p', selected.runtime.kind === 'hermes' ? selected.runtime.profile : '', 'serve'],
    tuiArgs: ['-p', selected.runtime.kind === 'hermes' ? selected.runtime.profile : '', '--tui'],
    cwd: workingDirectory || process.cwd(),
    profile: selected.runtime.kind === 'hermes' ? selected.runtime.profile : '',
    profileHome: `C:\\profiles\\${selected.runtime.kind === 'hermes' ? selected.runtime.profile : ''}`,
    env: { SESSION: sessionId },
    profileSelection: {
      runtime: selected.runtime.kind === 'hermes' ? selected.runtime : { kind: 'hermes', mode: 'delegate', profile: '' },
      provider: 'openai',
      accessMode: 'chatgpt-account',
      modelKey: 'gpt-5.6-sol',
      providerModelId: 'gpt-5.6-sol',
      openaiRuntime: null,
      skills: [],
    },
    providerSelection: {
      savedProvider: 'openai',
      accessMode: 'chatgpt-account',
      provider: 'openai-codex',
      model: 'gpt-5.6-sol',
      apiMode: null,
      openaiRuntime: null,
      profileOpenaiRuntime: 'auto',
    },
  }));
  const onExit = vi.fn(async () => undefined);
  const materialize = vi.fn(async () => ({ native: {}, unavailableNativeToolReasons: {} }));
  const resolveCardTools = vi.fn(async (
    owner: AgentTerminalOwner,
    selected: AgentCardInstance,
  ) => ({
    projectId: owner.projectId,
    deckId: owner.deckId,
    cardId: owner.cardId,
    cardRevisionId: selected._cardRevisionId || '',
    cardRevisionSha256: selected._cardRevisionSha256 || '',
    runtime: selected.runtime.kind === 'hermes' ? selected.runtime : {
      kind: 'hermes' as const, mode: 'delegate' as const, profile: '',
    },
    enabledTools: ['canvas.inspect'],
    unavailableTools: [],
    unavailableToolReasons: {},
    presentedTools: ['canvas.inspect'],
    nativeTools: ['memory'],
    toolsets: ['memory'],
    mcpConnectionIds: [],
    pluginTools: [{
      canonicalName: 'canvas.inspect',
      hermesName: 'card__canvas_inspect',
      description: 'Inspect the saved canvas.',
      inputSchema: { type: 'object', properties: {} },
    }],
    externalMcpTools: [],
    configurationFingerprint: createHash('sha256')
      .update(String(selected._cardRevisionId || ''))
      .digest('hex'),
  }));
  const materializeCardToolsPlugin = vi.fn(async () => undefined);
  const materializeExternalMcpTools = vi.fn(async () => ({}));
  const resolveBotRoster = vi.fn(async (owner: AgentTerminalOwner) => {
    const selected = cards.find((candidate) => candidate.id === owner.cardId)!;
    return {
      cardId: selected.id,
      cardRevisionId: '',
      profile: selected.runtime.kind === 'hermes' ? selected.runtime.profile : '',
      title: selected.title,
      botEnabled: true,
      roster: [],
    };
  });
  const manager = new AgentTerminalManager(
    spawnPty,
    prepare,
    onExit,
    spawnGateway,
    createGatewayClient,
    materialize as never,
    resolveCardTools as never,
    materializeCardToolsPlugin as never,
    materializeExternalMcpTools as never,
    resolveBotRoster,
  );
  const owners = cards.map((selected): AgentTerminalOwner => ({
    userId: 'owner', projectId: 'project', deckId: 'deck', cardId: selected.id,
  }));
  return {
    manager, spawnPty, spawnGateway, prepare, materialize,
    resolveCardTools, materializeCardToolsPlugin, cards, deck, owners,
    materializeExternalMcpTools, resolveBotRoster,
    ptys, gateways, clients, durableByTitle, controls, onExit,
  };
}

describe('native Hermes Gateway client loader', () => {
  it('loads the shared TypeScript client with its Node-ESM output specifiers intact', async () => {
    const client = await createNativeGatewayClient();
    expect(client.connectionState).toBe('idle');
    expect(typeof client.request).toBe('function');
    expect(typeof client.onEvent).toBe('function');
    client.close();
  });
});

describe('one Gateway-owned runtime and native TUI per saved Card', () => {
  it('starts distinct Gateway AIAgents and attached native TUI PTYs, then reopens without duplicates', async () => {
    const f = fixture();
    const [a, b] = await Promise.all([
      f.manager.open(f.owners[0], f.cards[0], f.deck, 80, 24),
      f.manager.open(f.owners[1], f.cards[1], f.deck, 100, 30),
    ]);
    expect(a.gatewayPid).not.toBe(b.gatewayPid);
    expect(a.tuiPid).not.toBe(b.tuiPid);
    expect(a.nativeSessionId).not.toBe(b.nativeSessionId);
    expect(a.storedSessionId).not.toBe(b.storedSessionId);
    expect(a.profile).toBe('signal-analyst');
    expect(b.profile).toBe('quant-analyst');
    expect((await f.manager.open(f.owners[0], f.cards[0], f.deck, 80, 24)).sessionId).toBe(a.sessionId);
    expect(f.spawnGateway).toHaveBeenCalledTimes(2);
    expect(f.spawnPty).toHaveBeenCalledTimes(2);
    expect(f.materialize).toHaveBeenCalledTimes(2);
    expect(String(f.ptys[0].options.env)).not.toContain('message.complete');
  });

  it('deduplicates concurrent first opens for the same Card', async () => {
    const f = fixture();
    const [first, second] = await Promise.all([
      f.manager.open(f.owners[0], f.cards[0], f.deck, 80, 24),
      f.manager.open(f.owners[0], f.cards[0], f.deck, 80, 24),
    ]);
    expect(first.sessionId).toBe(second.sessionId);
    expect(f.spawnGateway).toHaveBeenCalledOnce();
    expect(f.spawnPty).toHaveBeenCalledOnce();
  });

  it('keeps one Gateway-owned runtime when a headless presentation later attaches its native TUI', async () => {
    const f = fixture();
    const headless = await f.manager.open(
      f.owners[0],
      f.cards[0],
      f.deck,
      80,
      24,
      { attachTui: false },
    );
    expect(headless.tuiPid).toBeNull();
    expect(headless.ptyId).toBeNull();
    expect(f.spawnGateway).toHaveBeenCalledOnce();
    expect(f.spawnPty).not.toHaveBeenCalled();
    expect(() => f.manager.resize(f.owners[0], headless.sessionId, 80, 24)).toThrow('tui_not_attached');

    const attached = await f.manager.open(
      f.owners[0], f.cards[0], f.deck, 100, 30, { attachTui: true },
    );
    expect(attached.sessionId).toBe(headless.sessionId);
    expect(attached.gatewayPid).toBe(headless.gatewayPid);
    expect(attached.nativeSessionId).toBe(headless.nativeSessionId);
    expect(attached.storedSessionId).toBe(headless.storedSessionId);
    expect(attached.tuiPid).not.toBeNull();
    expect(f.spawnGateway).toHaveBeenCalledOnce();
    expect(f.spawnPty).toHaveBeenCalledOnce();
    expect(f.spawnPty.mock.calls[0]?.[1]).toEqual([
      '-p', 'signal-analyst', '--tui', '--resume', headless.storedSessionId,
    ]);
    expect(f.ptys[0].options.env).toMatchObject({
      HERMES_TUI_INLINE: '1',
    });
    expect((f.ptys[0].options.env as Record<string, string>).HERMES_TUI_RESUME).toBeUndefined();
  });

  it('allows the native TUI client to close and reattach without killing its Card runtime', async () => {
    const f = fixture();
    const first = await f.manager.open(f.owners[0], f.cards[0], f.deck, 80, 24);
    f.ptys[0].exit({ exitCode: 0 });
    const detached = f.manager.state(f.owners[0], first.sessionId);
    expect(detached.status).toBe('running');
    expect(detached.tuiPid).toBeNull();
    expect(f.gateways[0].kill).not.toHaveBeenCalled();
    expect(f.onExit).not.toHaveBeenCalled();

    const reopened = await f.manager.open(
      f.owners[0], f.cards[0], f.deck, 90, 25, { attachTui: true },
    );
    expect(reopened.sessionId).toBe(first.sessionId);
    expect(reopened.gatewayPid).toBe(first.gatewayPid);
    expect(reopened.nativeSessionId).toBe(first.nativeSessionId);
    expect(f.spawnGateway).toHaveBeenCalledOnce();
    expect(f.spawnPty).toHaveBeenCalledTimes(2);
  });

  it('allows explicit open to start a Card omitted from automatic topology without a duplicate', async () => {
    const f = fixture();
    await f.manager.reconcile([]);
    const first = await f.manager.open(f.owners[0], f.cards[0], f.deck, 80, 24);
    const second = await f.manager.open(f.owners[0], f.cards[0], f.deck, 80, 24);
    expect(second.sessionId).toBe(first.sessionId);
    expect(f.spawnGateway).toHaveBeenCalledOnce();
    expect(f.spawnPty).toHaveBeenCalledOnce();
  });

  it('isolates automatic terminal output, resize, close, and replay between Cards', async () => {
    const f = fixture();
    const a = await f.manager.open(f.owners[0], f.cards[0], f.deck, 80, 24);
    const b = await f.manager.open(f.owners[1], f.cards[1], f.deck, 100, 30);
    const aEvents = vi.fn();
    const bEvents = vi.fn();
    const detach = f.manager.subscribe(f.owners[0], a.sessionId, 0, aEvents);
    f.manager.subscribe(f.owners[1], b.sessionId, 0, bEvents);
    f.ptys[0].data('native A');
    expect(aEvents).toHaveBeenCalledWith('output', { sequence: 1, data: 'native A' });
    expect(bEvents).not.toHaveBeenCalledWith('output', expect.anything());
    f.manager.resize(f.owners[0], a.sessionId, 70, 20);
    expect(f.ptys[0].resize).toHaveBeenCalledWith(70, 20);
    expect(f.ptys[1].resize).not.toHaveBeenCalled();
    detach();
    f.manager.stop(f.owners[0], a.sessionId);
    expect(f.ptys[0].kill).toHaveBeenCalledOnce();
    expect(f.gateways[0].kill).toHaveBeenCalledOnce();
    expect(f.ptys[1].kill).not.toHaveBeenCalled();
    expect(f.manager.state(f.owners[0], a.sessionId).status).toBe('exited');
    expect(f.manager.state(f.owners[1], b.sessionId).status).toBe('running');
  });

  it('submits structured turns to the same native session and never projects events into PTY output', async () => {
    const f = fixture();
    const state = await f.manager.open(f.owners[0], f.cards[0], f.deck, 80, 24);
    const terminalEvents = vi.fn();
    f.manager.subscribe(f.owners[0], state.sessionId, 0, terminalEvents);
    const [first, second] = await Promise.all([
      f.manager.submit(f.owners[0], state.sessionId, 'first', { surface: 'card-shared-chat' }),
      f.manager.submit(f.owners[0], state.sessionId, 'second'),
    ]);
    expect(first.text).toBe('reply:first');
    expect(second.text).toBe('reply:second');
    const submits = f.clients[0].requests.filter((request) => request.method === 'prompt.submit');
    expect(submits.map((request) => request.params)).toEqual([
      {
        session_id: state.nativeSessionId,
        text: 'first',
        profile: state.profile,
        surface: 'card-shared-chat',
      },
      { session_id: state.nativeSessionId, text: 'second', profile: state.profile },
    ]);
    expect(terminalEvents).not.toHaveBeenCalledWith('output', expect.anything());
    expect(f.clients[0].requests.filter((request) => request.method === 'plugins.list')).toHaveLength(1);
    expect(f.clients[0].requests.find((request) => request.method === 'plugins.list')?.params)
      .toEqual({});
    expect(f.clients[0].requests.find((request) => request.method === 'tools.show')?.params)
      .toEqual({ session_id: state.nativeSessionId });
    expect(f.clients[0].requests.findIndex((request) => request.method === 'plugins.list'))
      .toBeLessThan(f.clients[0].requests.findIndex((request) => request.method === 'prompt.submit'));
  });

  it('projects exact same-session Gateway events without submitting or owning a turn', async () => {
    const f = fixture();
    const state = await f.manager.open(f.owners[0], f.cards[0], f.deck, 80, 24);
    const handlersBefore = f.clients[0].handlers.size;
    const listener = vi.fn();
    const detach = f.manager.subscribeGatewayEvents(f.owners[0], state.sessionId, listener);
    f.clients[0].emitEvent({
      type: 'message.complete', session_id: 'different-session', seq: 4,
      payload: { text: 'wrong session' },
    });
    f.clients[0].emitEvent({
      type: 'message.complete', session_id: state.nativeSessionId, seq: 5,
      payload: { text: 'native completion' },
    });
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith({
      type: 'message.complete', session_id: state.nativeSessionId, seq: 5,
      payload: { text: 'native completion' },
    });
    expect(f.clients[0].requests.filter((request) => request.method === 'prompt.submit')).toEqual([]);
    expect(f.clients[0].handlers.size).toBe(handlersBefore);
    detach();
    f.clients[0].emitEvent({
      type: 'message.complete', session_id: state.nativeSessionId, seq: 6,
      payload: { text: 'after detach' },
    });
    expect(listener).toHaveBeenCalledOnce();
    expect(f.ptys[0].resize).not.toHaveBeenCalled();
  });

  it('materializes Card tools before Gateway start and owns one canonical Bot Chat', async () => {
    const f = fixture();
    const state = await f.manager.open(f.owners[0], f.cards[0], f.deck, 80, 24);
    expect(f.materializeCardToolsPlugin).toHaveBeenCalledWith(
      'C:\\profiles\\signal-analyst',
      expect.objectContaining({
        cardId: 'signal',
        presentedTools: ['canvas.inspect'],
        pluginTools: [expect.objectContaining({ hermesName: 'card__canvas_inspect' })],
      }),
      { env: expect.objectContaining({ SESSION: expect.any(String) }) },
    );
    expect(f.spawnGateway.mock.calls[0][2].env).toEqual(expect.objectContaining({
      HERMES_DASHBOARD_SESSION_TOKEN: expect.any(String),
      CARD_TOOLS_MANAGED: '1',
      CARD_TOOLS_HOST_URL: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/api\/hermes-card-tools$/),
    }));
    const creates = f.clients[0].requests.filter((request) => request.method === 'session.create');
    expect(creates).toHaveLength(1);
    expect(creates[0].params).toEqual(expect.objectContaining({
      title: 'Bot Chat', hidden: true, follow_profile_config: true, close_on_disconnect: false,
    }));
    expect(f.durableByTitle.get('signal-analyst\u0000Bot Chat')).toBe(state.storedSessionId);
  });

  it('ignores obsolete Card runtime sessions and owns only canonical Bot Chat', async () => {
    const f = fixture();
    f.durableByTitle.set('signal-analyst\u0000Card runtime: signal @ old', 'stored-old');
    const state = await f.manager.open(f.owners[0], f.cards[0], f.deck, 80, 24);

    expect(state.storedSessionId).not.toBe('stored-old');
    expect(f.clients[0].requests.filter((request) => request.method === 'session.create')).toHaveLength(1);
    expect(f.durableByTitle.get('signal-analyst\u0000Bot Chat')).toBe(state.storedSessionId);
    expect(f.durableByTitle.get('signal-analyst\u0000Card runtime: signal @ old')).toBe('stored-old');
  });

  it('derives one registered Card tool from the signed live runtime and rejects replay', async () => {
    const f = fixture();
    const state = await f.manager.open(f.owners[0], f.cards[0], f.deck, 80, 24);
    const env = f.spawnGateway.mock.calls[0][2].env as Record<string, string>;
    const token = env.HERMES_DASHBOARD_SESSION_TOKEN;
    const payload = JSON.stringify({
      version: 1,
      expiresAt: Math.floor(Date.now() / 1000) + 60,
      nonce: 'e'.repeat(32),
      sourceStoredSessionId: state.storedSessionId,
      tool: 'card__canvas_inspect',
      arguments: { depth: 1 },
    });
    const keyId = createHash('sha256').update(token).digest('hex');
    const signature = createHmac('sha256', token).update(payload).digest('hex');

    await expect(f.manager.authenticateCardToolRequest(keyId, payload, signature)).resolves.toEqual({
      owner: f.owners[0],
      state,
      canonicalToolName: 'canvas.inspect',
      cardTools: expect.objectContaining({
        cardRevisionId: 'revision-signal',
        runtimeMode: 'delegate',
      }),
      request: expect.objectContaining({
        tool: 'card__canvas_inspect',
        arguments: { depth: 1 },
      }),
    });
    await expect(f.manager.authenticateCardToolRequest(keyId, payload, signature))
      .rejects.toThrow('hermes_card_tool_authentication_failed');

    const unknownPayload = JSON.stringify({
      version: 1,
      expiresAt: Math.floor(Date.now() / 1000) + 60,
      nonce: 'f'.repeat(32),
      sourceStoredSessionId: state.storedSessionId,
      tool: 'card__not_registered',
      arguments: {},
    });
    await expect(f.manager.authenticateCardToolRequest(
      keyId,
      unknownPayload,
      createHmac('sha256', token).update(unknownPayload).digest('hex'),
    )).rejects.toThrow('hermes_card_tool_authentication_failed');
  });

  it('restarts the Gateway and TUI while resuming the exact durable Card session', async () => {
    const f = fixture();
    const first = await f.manager.open(f.owners[0], f.cards[0], f.deck, 80, 24);
    f.manager.stop(f.owners[0], first.sessionId);
    const second = await f.manager.open(f.owners[0], f.cards[0], f.deck, 80, 24);
    expect(second.sessionId).not.toBe(first.sessionId);
    expect(second.gatewayPid).not.toBe(first.gatewayPid);
    expect(second.tuiPid).not.toBe(first.tuiPid);
    expect(second.storedSessionId).toBe(first.storedSessionId);
    expect(second.nativeSessionId).not.toBe(first.nativeSessionId);
    expect(f.clients[1].requests.map((request) => request.method)).toContain('session.resume');
    expect(f.clients[1].requests.map((request) => request.method)).not.toContain('session.create');
    expect(f.spawnPty.mock.calls[1]?.[1]).toEqual([
      '-p', 'signal-analyst', '--tui', '--resume', first.storedSessionId,
    ]);
    expect(f.ptys[1].options.env).toMatchObject({
      HERMES_TUI_INLINE: '1',
    });
    expect((f.ptys[1].options.env as Record<string, string>).HERMES_TUI_RESUME).toBeUndefined();
  });

  it('fails closed on session enumeration failure and does not create or launch a TUI', async () => {
    const f = fixture();
    f.controls.enumerationFailure = true;
    await expect(f.manager.open(f.owners[0], f.cards[0], f.deck, 80, 24)).rejects.toThrow('storage failed');
    expect(f.clients[0].requests.map((request) => request.method)).not.toContain('session.create');
    expect(f.spawnPty).not.toHaveBeenCalled();
    expect(f.gateways[0].kill).toHaveBeenCalledOnce();
  });

  it('rejects cross-Card access and shared profiles before terminal transport actions', async () => {
    const f = fixture();
    const state = await f.manager.open(f.owners[0], f.cards[0], f.deck, 80, 24);
    for (const owner of [f.owners[1], { ...f.owners[0], userId: 'foreign' }]) {
      expect(() => f.manager.resize(owner, state.sessionId, 2, 2)).toThrow('session_not_found');
      expect(() => f.manager.stop(owner, state.sessionId)).toThrow('session_not_found');
    }
    expect(f.ptys[0].resize).not.toHaveBeenCalled();
    const duplicate = card('other', 'signal-analyst');
    expect(() => requireAgentTerminalCard(duplicate, f.deck)).toThrow('profile_shared');
  });

  it('accepts Main and Builder as Hermes Cards and still rejects missing profiles', () => {
    for (const selected of [card('card_main_chat', 'liquidaity-main'), card('builder', 'builder')]) {
      const deck = { id: 'd', name: 'd', nodes: [selected], edges: [], promptTemplates: [], version: 1 };
      expect(requireAgentTerminalCard(selected, deck)).toBe(selected.runtime.kind === 'hermes' ? selected.runtime.profile : '');
    }
    const missing = card('other', 'valid');
    missing.runtime = { kind: 'hermes', mode: 'delegate', profile: '' };
    expect(() => requireAgentTerminalCard(missing, { ...frozenDeck(missing) })).toThrow('profile_missing');
  });

  it('materializes reciprocal native rosters and revokes both profiles before stopping demand', async () => {
    const f = fixture();
    const desired = f.cards.map((selected, index) => ({
      owner: f.owners[index], card: selected, deck: f.deck,
    }));
    const projected = f.cards.map((selected, index) => {
      const peer = f.cards[index === 0 ? 1 : 0];
      return {
        owner: f.owners[index],
        card: selected,
        projection: {
          cardId: selected.id,
          cardRevisionId: selected._cardRevisionId || '',
          profile: selected.runtime.kind === 'hermes' ? selected.runtime.profile : '',
          title: selected.title,
          botEnabled: true,
          roster: [peer.runtime.kind === 'hermes' ? peer.runtime.profile : ''],
        },
      };
    });

    await f.manager.reconcile(desired, { cols: 120, rows: 36 }, projected);
    const configured = f.clients.flatMap((client) => client.requests)
      .filter((request) => request.method === 'profiles.configure');
    expect(configured).toEqual(expect.arrayContaining([
      expect.objectContaining({ params: expect.objectContaining({
        name: 'signal-analyst', bot_mode_roster: ['quant-analyst'],
      }) }),
      expect.objectContaining({ params: expect.objectContaining({
        name: 'quant-analyst', bot_mode_roster: ['signal-analyst'],
      }) }),
    ]));

    const revoked = projected.map((target) => ({
      ...target,
      projection: { ...target.projection, roster: [] },
    }));
    await f.manager.reconcile([desired[0]], { cols: 120, rows: 36 }, revoked);
    const quantWrites = f.clients.flatMap((client) => client.requests)
      .filter((request) => request.method === 'profiles.configure'
        && request.params.name === 'quant-analyst');
    expect(quantWrites.some((request) => (
      JSON.stringify(request.params.bot_mode_roster) === '[]'
    ))).toBe(true);
    expect(f.manager.find(f.owners[1])).toBeNull();
  });

  it('does not claim or rewrite an unprojected standalone native Bot profile', async () => {
    const f = fixture(['retired-profile']);
    await f.manager.open(f.owners[0], f.cards[0], f.deck, 80, 24);
    f.clients[0].seedManagedProfile('retired-profile', ['signal-analyst']);
    const currentProfiles = f.cards.map((selected, index) => ({
      owner: f.owners[index],
      card: selected,
      projection: {
        cardId: selected.id,
        cardRevisionId: selected._cardRevisionId || '',
        profile: selected.runtime.kind === 'hermes' ? selected.runtime.profile : '',
        title: selected.title,
        botEnabled: true,
        roster: [],
      },
    }));

    await f.manager.reconcile([
      { owner: f.owners[0], card: f.cards[0], deck: f.deck },
    ], { cols: 120, rows: 36 }, currentProfiles);

    expect(f.clients[0].requests.some((request) => (
      request.method === 'profiles.configure' && request.params.name === 'retired-profile'
    ))).toBe(false);
  });

  it('reconciles the complete desired topology, stopping disconnected Cards and replacing changed authority', async () => {
    const f = fixture();
    const completeTopology = f.cards.map((selected, index) => ({
      owner: f.owners[index], card: selected, deck: f.deck,
    }));
    const [a, b] = await f.manager.reconcile(completeTopology);
    const repeated = await f.manager.reconcile(completeTopology);
    expect(repeated.map((state) => state.sessionId)).toEqual([a.sessionId, b.sessionId]);
    expect(f.spawnGateway).toHaveBeenCalledTimes(2);
    await f.manager.reconcile([{ owner: f.owners[0], card: f.cards[0], deck: f.deck }]);
    expect(f.manager.find(f.owners[0])?.sessionId).toBe(a.sessionId);
    expect(f.manager.find(f.owners[1])).toBeNull();
    expect(f.ptys[1].kill).toHaveBeenCalledOnce();

    const changed = { ...f.cards[0], prompt: 'Changed saved prompt', _cardRevisionId: 'revision-next' };
    const replaced = await f.manager.reconcile([{ owner: f.owners[0], card: changed, deck: { ...f.deck, nodes: [changed, f.cards[1]] } }]);
    expect(replaced[0].sessionId).not.toBe(a.sessionId);
    expect(f.ptys[0].kill).toHaveBeenCalledOnce();
    expect(f.spawnGateway).toHaveBeenCalledTimes(3);
    expect(b.cardId).toBe('quant');
  });

  it('converges a simultaneous disconnected Run start and new wire demand on one Card runtime', async () => {
    const f = fixture();
    const target = { owner: f.owners[0], card: f.cards[0], deck: f.deck, attachTui: true };
    const onDemand = f.manager.open(
      target.owner,
      target.card,
      target.deck,
      120,
      36,
      { attachTui: false },
    );
    const topology = f.manager.reconcile([target]);
    const [direct, [wired]] = await Promise.all([onDemand, topology]);

    expect(wired.gatewayPid).toBe(direct.gatewayPid);
    expect(wired.nativeSessionId).toBe(direct.nativeSessionId);
    expect(wired.storedSessionId).toBe(direct.storedSessionId);
    expect(wired.hermesHome).toBe(direct.hermesHome);
    expect(f.spawnGateway).toHaveBeenCalledOnce();
    expect(f.spawnPty).toHaveBeenCalledOnce();
  });

  it('bounds native PTY replay without inventing terminal content', async () => {
    const f = fixture();
    const first = await f.manager.open(f.owners[0], f.cards[0], f.deck, 80, 24);
    f.ptys[0].data('x'.repeat(2 * 1024 * 1024 + 1));
    const replay = vi.fn();
    f.manager.subscribe(f.owners[0], first.sessionId, 0, replay);
    expect(replay).not.toHaveBeenCalledWith('output', expect.anything());
    expect(f.manager.state(f.owners[0], first.sessionId).replayTruncated).toBe(true);
  });
});

function frozenDeck(selected: AgentCardInstance): DeckDocument {
  return { id: 'd', name: 'd', nodes: [selected], edges: [], promptTemplates: [], version: 1 };
}
