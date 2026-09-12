import { describe, expect, it, vi } from 'vitest';
import type { IPty } from 'node-pty';
import { AgentTerminalManager, requireAgentTerminalCard, type AgentTerminalOwner } from './agentTerminal';
import type { AgentCardInstance, DeckDocument } from '../types';

vi.mock('../services/mcp/pythonAgentMcpClient', () => ({
  listPythonAgentMcpCatalog: vi.fn(), resolvePythonAgentMcpServerSpec: vi.fn() }));

function card(id: string, profile: string): AgentCardInstance {
  return { id, title: id, templateId: 'agent', position: { x: 0, y: 0 }, prompt: `Prompt ${id}`,
    runtime: { kind: 'hermes', mode: 'delegate', profile },
    runtimeOptions: { provider: 'openai', modelKey: 'test-model', nativeTools: ['memory'] } };
}
function fixture() {
  const cards = [card('signal', 'signal-analyst'), card('quant', 'quant-analyst')];
  const deck: DeckDocument = { id: 'deck', name: 'Deck', nodes: cards, edges: [], promptTemplates: [], version: 1, workspaceRoot: 'C:\\workspace' };
  const processes: Array<{ write: ReturnType<typeof vi.fn>; resize: ReturnType<typeof vi.fn>; kill: ReturnType<typeof vi.fn>;
    data: (value: string) => void; exit: (value: { exitCode: number }) => void }> = [];
  const spawn = vi.fn(() => {
    const process = { write: vi.fn(), resize: vi.fn(), kill: vi.fn(), data: (_value: string) => {}, exit: (_value: { exitCode: number }) => {} };
    const pty = { pid: 100 + processes.length, write: process.write, resize: process.resize, kill: process.kill,
      onData: (fn: typeof process.data) => { process.data = fn; return { dispose() {} }; },
      onExit: (fn: typeof process.exit) => { process.exit = fn; return { dispose() {} }; } } as unknown as IPty;
    processes.push(process);
    return pty;
  });
  const prepare = vi.fn((_owner, selected, _deck, sessionId) => ({ file: 'hermes.exe', args: ['-p', selected.runtime.profile, 'chat', '--cli'],
    cwd: 'C:\\workspace', profile: selected.runtime.profile, env: { SESSION: sessionId } }));
  const manager = new AgentTerminalManager(spawn, prepare);
  const owners = cards.map((selected): AgentTerminalOwner => ({ userId: 'owner', projectId: 'project', deckId: 'deck', cardId: selected.id }));
  return { manager, spawn, prepare, cards, deck, owners, processes };
}

describe('independent saved Agent terminals', () => {
  it('spawns distinct real transport boundaries lazily and reconnects without another process', () => {
    const f = fixture();
    expect(f.spawn).not.toHaveBeenCalled();
    const a = f.manager.open(f.owners[0], f.cards[0], f.deck, 80, 24);
    const b = f.manager.open(f.owners[1], f.cards[1], f.deck, 100, 30);
    expect(a.pid).not.toBe(b.pid);
    expect(a.ptyId).not.toBe(b.ptyId);
    expect(a.sessionId).not.toBe(b.sessionId);
    expect(a.profile).toBe('signal-analyst');
    expect(b.profile).toBe('quant-analyst');
    expect(f.manager.open(f.owners[0], f.cards[0], f.deck, 80, 24).sessionId).toBe(a.sessionId);
    expect(f.spawn).toHaveBeenCalledTimes(2);
  });
  it('isolates stdin, output, resize, close and replay between Cards', () => {
    const f = fixture();
    const a = f.manager.open(f.owners[0], f.cards[0], f.deck, 80, 24);
    const b = f.manager.open(f.owners[1], f.cards[1], f.deck, 100, 30);
    const aEvents = vi.fn(); const bEvents = vi.fn();
    const detach = f.manager.subscribe(f.owners[0], a.sessionId, 0, aEvents);
    f.manager.subscribe(f.owners[1], b.sessionId, 0, bEvents);
    f.manager.input(f.owners[0], a.sessionId, '/help\r');
    expect(f.processes[0].write).toHaveBeenCalledWith('/help\r');
    expect(f.processes[1].write).not.toHaveBeenCalled();
    f.processes[0].data('native A');
    expect(aEvents).toHaveBeenCalledWith('output', { sequence: 1, data: 'native A' });
    expect(bEvents).not.toHaveBeenCalledWith('output', expect.anything());
    f.manager.resize(f.owners[0], a.sessionId, 70, 20);
    expect(f.processes[0].resize).toHaveBeenCalledWith(70, 20);
    expect(f.processes[1].resize).not.toHaveBeenCalled();
    expect(f.manager.state(f.owners[1], b.sessionId).cols).toBe(100);
    detach();
    expect(f.processes[0].kill).not.toHaveBeenCalled();
    const replay = vi.fn();
    f.manager.subscribe(f.owners[0], a.sessionId, 1, replay);
    expect(replay).not.toHaveBeenCalledWith('output', expect.anything());
    f.manager.stop(f.owners[0], a.sessionId);
    expect(f.processes[0].kill).toHaveBeenCalledOnce();
    expect(f.processes[1].kill).not.toHaveBeenCalled();
    f.processes[0].exit({ exitCode: 0 });
    expect(f.manager.state(f.owners[0], a.sessionId).status).toBe('exited');
    expect(f.manager.state(f.owners[1], b.sessionId).status).toBe('running');
  });
  it('rejects cross-Card and cross-user access before any transport action', () => {
    const f = fixture();
    const a = f.manager.open(f.owners[0], f.cards[0], f.deck, 80, 24);
    for (const owner of [f.owners[1], { ...f.owners[0], userId: 'foreign' }]) {
      expect(() => f.manager.input(owner, a.sessionId, 'x')).toThrow('session_not_found');
      expect(() => f.manager.resize(owner, a.sessionId, 2, 2)).toThrow('session_not_found');
      expect(() => f.manager.stop(owner, a.sessionId)).toThrow('session_not_found');
      expect(() => f.manager.subscribe(owner, a.sessionId, 0, vi.fn())).toThrow('session_not_found');
    }
    expect(f.processes[0].write).not.toHaveBeenCalled();
    expect(f.processes[0].kill).not.toHaveBeenCalled();
  });
  it('does not use the old process after saved configuration changes', () => {
    const f = fixture();
    const a = f.manager.open(f.owners[0], f.cards[0], f.deck, 80, 24);
    const changed = { ...f.cards[0], prompt: 'Changed saved prompt' };
    expect(() => f.manager.open(f.owners[0], changed, f.deck, 80, 24)).toThrow('configuration_changed');
    expect(() => f.manager.verifyConfiguration(f.owners[0], a.sessionId, changed, f.deck)).toThrow('configuration_changed');
    expect(f.spawn).toHaveBeenCalledOnce();
  });
  it('excludes Main and Builder and rejects a shared or absent profile', () => {
    const f = fixture();
    for (const selected of [card('card_main_chat', 'main'), card('builder', 'builder'), card('other', 'default')]) {
      expect(() => requireAgentTerminalCard(selected, f.deck)).toThrow('card_excluded');
    }
    expect(() => requireAgentTerminalCard(card('other', 'signal-analyst'), f.deck)).toThrow('profile_shared');
    expect(() => requireAgentTerminalCard(card('other', ''), f.deck)).toThrow('profile_missing');
    const chatMode = { ...f.cards[0], runtime: { kind: 'hermes' as const, mode: 'main' as const, profile: 'signal-analyst' } };
    expect(requireAgentTerminalCard(chatMode, f.deck)).toBe('signal-analyst');
  });
  it('reports native exit without inventing output and allows a new independent launch', () => {
    const f = fixture();
    const a = f.manager.open(f.owners[0], f.cards[0], f.deck, 80, 24);
    const events = vi.fn();
    f.manager.subscribe(f.owners[0], a.sessionId, 0, events);
    f.processes[0].exit({ exitCode: 7 });
    expect(f.manager.state(f.owners[0], a.sessionId)).toMatchObject({ status: 'failed', exitCode: 7 });
    expect(events).not.toHaveBeenCalledWith('output', expect.anything());
    expect(() => f.manager.input(f.owners[0], a.sessionId, 'x')).toThrow('not_running');
    const next = f.manager.open(f.owners[0], f.cards[0], f.deck, 80, 24);
    expect(next.sessionId).not.toBe(a.sessionId);
  });
  it('bounds replay memory even for one large PTY chunk and expires closed sessions', () => {
    const f = fixture();
    const first = f.manager.open(f.owners[0], f.cards[0], f.deck, 80, 24);
    f.processes[0].data('x'.repeat(2 * 1024 * 1024 + 1));
    const replay = vi.fn();
    const detach = f.manager.subscribe(f.owners[0], first.sessionId, 0, replay);
    expect(replay).not.toHaveBeenCalledWith('output', expect.anything());
    expect(f.manager.state(f.owners[0], first.sessionId).replayTruncated).toBe(true);
    detach();
    f.processes[0].exit({ exitCode: 0 });
    for (let index = 0; index < 40; index++) {
      f.manager.open(f.owners[0], f.cards[0], f.deck, 80, 24);
      f.processes.at(-1)!.exit({ exitCode: 0 });
    }
    expect(() => f.manager.state(f.owners[0], first.sessionId)).toThrow('session_not_found');
  });
});
