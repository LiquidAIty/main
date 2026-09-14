import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import type { IPty, IPtyForkOptions, IWindowsPtyForkOptions } from 'node-pty';
import {
  AgentTerminalManager,
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

  constructor(
    private readonly index: number,
    private readonly durableByTitle: Map<string, string>,
    private readonly controls: { enumerationFailure: boolean },
  ) {}

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
    for (const handler of this.handlers) handler(event);
  }

  async request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    this.requests.push({ method, params });
    if (method === 'session.list') {
      if (this.controls.enumerationFailure) throw new Error('storage failed');
      const title = String(params.title || '');
      const durable = this.durableByTitle.get(title);
      return { sessions: durable ? [{ id: durable, resolved_id: durable, title }] : [] } as T;
    }
    if (method === 'session.create') {
      const title = String(params.title || '');
      const durable = `stored-${this.durableByTitle.size + 1}`;
      this.durableByTitle.set(title, durable);
      return { session_id: `live-${this.index}-created`, stored_session_id: durable } as T;
    }
    if (method === 'session.resume') {
      const durable = String(params.session_id || '');
      return { session_id: `live-${this.index}-resumed`, stored_session_id: durable } as T;
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
    if (method === 'session.interrupt') return { ok: true } as T;
    if (method === 'session.append_native_team_result') return { appended: true } as T;
    throw new Error(`unexpected fake gateway request:${method}`);
  }
}

function fixture() {
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
  const controls = { enumerationFailure: false };
  const clients: FakeGatewayClient[] = [];
  const createGatewayClient = vi.fn(async () => {
    const client = new FakeGatewayClient(clients.length + 1, durableByTitle, controls);
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
  const materialize = vi.fn(async () => ({ native: {} }));
  const manager = new AgentTerminalManager(
    spawnPty,
    prepare,
    onExit,
    spawnGateway,
    createGatewayClient,
    materialize as never,
  );
  const owners = cards.map((selected): AgentTerminalOwner => ({
    userId: 'owner', projectId: 'project', deckId: 'deck', cardId: selected.id,
  }));
  return {
    manager, spawnPty, spawnGateway, prepare, materialize, cards, deck, owners,
    ptys, gateways, clients, durableByTitle, controls, onExit,
  };
}

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
    expect(() => f.manager.input(f.owners[0], headless.sessionId, 'x')).toThrow('tui_not_attached');

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

  it('detaches only the native TUI and preserves the Gateway-owned Card session', async () => {
    const f = fixture();
    const state = await f.manager.open(f.owners[0], f.cards[0], f.deck, 80, 24);
    const detached = f.manager.detachTui(f.owners[0], state.sessionId);
    expect(detached.status).toBe('running');
    expect(detached.ptyId).toBeNull();
    expect(detached.tuiPid).toBeNull();
    expect(f.ptys[0].kill).toHaveBeenCalledOnce();
    expect(f.gateways[0].kill).not.toHaveBeenCalled();
    expect(f.manager.state(f.owners[0], state.sessionId).nativeSessionId).toBe(state.nativeSessionId);
  });

  it('isolates raw terminal input, output, resize, close, and replay between Cards', async () => {
    const f = fixture();
    const a = await f.manager.open(f.owners[0], f.cards[0], f.deck, 80, 24);
    const b = await f.manager.open(f.owners[1], f.cards[1], f.deck, 100, 30);
    const aEvents = vi.fn();
    const bEvents = vi.fn();
    const detach = f.manager.subscribe(f.owners[0], a.sessionId, 0, aEvents);
    f.manager.subscribe(f.owners[1], b.sessionId, 0, bEvents);
    f.manager.input(f.owners[0], a.sessionId, '/help\r');
    expect(f.ptys[0].write).toHaveBeenCalledWith('/help\r');
    expect(f.ptys[1].write).not.toHaveBeenCalled();
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
      f.manager.submit(f.owners[0], state.sessionId, 'first'),
      f.manager.submit(f.owners[0], state.sessionId, 'second'),
    ]);
    expect(first.text).toBe('reply:first');
    expect(second.text).toBe('reply:second');
    const submits = f.clients[0].requests.filter((request) => request.method === 'prompt.submit');
    expect(submits.map((request) => request.params)).toEqual([
      { session_id: state.nativeSessionId, text: 'first', profile: state.profile },
      { session_id: state.nativeSessionId, text: 'second', profile: state.profile },
    ]);
    expect(terminalEvents).not.toHaveBeenCalledWith('output', expect.anything());
  });

  it('appends a native Team completion through the exact Card Gateway session', async () => {
    const f = fixture();
    const state = await f.manager.open(
      f.owners[0], f.cards[0], f.deck, 80, 24, { attachTui: false },
    );

    await f.manager.appendNativeTeamResult(f.owners[0], state.sessionId, {
      sessionId: state.storedSessionId,
      taskId: 'native-team-task',
      result: 'Measured native Team result',
      state: 'completed',
    });

    expect(f.clients[0].requests.at(-1)).toEqual({
      method: 'session.append_native_team_result',
      params: {
        session_id: state.nativeSessionId,
        stored_session_id: state.storedSessionId,
        profile: state.profile,
        task_id: 'native-team-task',
        result: 'Measured native Team result',
        terminal_state: 'completed',
      },
    });
    expect(f.spawnGateway).toHaveBeenCalledOnce();
    expect(f.spawnPty).not.toHaveBeenCalled();
  });

  it('resolves recovered Team completion by exact saved Card identity and profile', async () => {
    const f = fixture();
    const state = await f.manager.open(
      f.owners[0], f.cards[0], f.deck, 80, 24, { attachTui: false },
    );
    const delivery = {
      projectId: f.owners[0].projectId,
      deckId: f.owners[0].deckId,
      cardId: f.owners[0].cardId,
      profile: state.profile,
      sessionId: state.storedSessionId,
      taskId: 'native-team-recovered',
      result: 'Recovered native Team result',
      state: 'completed' as const,
    };

    await f.manager.appendRecoveredNativeTeamResult(delivery);
    expect(f.clients[0].requests.at(-1)).toMatchObject({
      method: 'session.append_native_team_result',
      params: {
        session_id: state.nativeSessionId,
        stored_session_id: state.storedSessionId,
        profile: state.profile,
        task_id: 'native-team-recovered',
      },
    });
    await expect(f.manager.appendRecoveredNativeTeamResult({
      ...delivery, profile: 'foreign-profile',
    })).rejects.toThrow('agent_terminal_team_result_profile_mismatch');
    await expect(f.manager.appendRecoveredNativeTeamResult({
      ...delivery, cardId: 'missing-card',
    })).rejects.toThrow('agent_terminal_card_runtime_not_running');
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
    expect((f.ptys[1].options.env as Record<string, string>).HERMES_TUI_RESUME).toBe(first.storedSessionId);
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
      expect(() => f.manager.input(owner, state.sessionId, 'x')).toThrow('session_not_found');
      expect(() => f.manager.resize(owner, state.sessionId, 2, 2)).toThrow('session_not_found');
      expect(() => f.manager.stop(owner, state.sessionId)).toThrow('session_not_found');
    }
    expect(f.ptys[0].write).not.toHaveBeenCalled();
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
