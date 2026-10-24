import { describe, expect, it, vi } from 'vitest';

import type { DeckCard, DeckDocument } from '../types';
import type { HermesGatewayClient, HermesGatewayEvent } from '../services/hermesGateway';

const profileMocks = vi.hoisted(() => ({
  ensure: vi.fn(async (_request, _deck: DeckDocument, card: DeckCard) => ({
    name: card.runtime.profile,
    model: { provider: 'openai-codex', default: 'gpt-6.1-sol' },
  })),
  materialize: vi.fn(async (_request, _deck: DeckDocument, card: DeckCard) => ({
    name: card.runtime.profile,
    model: { provider: 'openai-codex', default: 'gpt-6.1-sol' },
  })),
  roster: vi.fn((_deck: DeckDocument, card: DeckCard) => (
    card.runtime.mode === 'main' ? ['worker', 'magnetic'] : ['main']
  )),
}));

vi.mock('./profileMaterialization', () => ({
  ensureSavedCardProfile: profileMocks.ensure,
  materializeSavedCardProfile: profileMocks.materialize,
  savedCardBotRoster: profileMocks.roster,
  hermesProfileModelSelection: () => ({ provider: 'openai-codex', model: 'gpt-6.1-sol' }),
}));
vi.mock('../services/projectStore', () => ({
  assertHermesProfileOwner: vi.fn(async () => undefined),
}));
vi.mock('../services/mcp/toolCatalogMcpClient', () => ({
  readToolCatalog: vi.fn(async () => ({
    state: 'ready', tools: [], unavailableFamilies: [], toolFailures: {},
  })),
}));
vi.mock('../services/workingDirectories', () => ({
  resolveBuilderProjectCodeDirectory: () => 'C:/project',
  resolveProductChatWorkingDirectory: () => 'C:/chat',
}));

import {
  executeHermesTurn,
  startProjectCardSessions,
  type ProjectCardSession,
} from './botMode';
import type { ProjectCardAuthority, ProjectCardBinding } from '../services/projectCardAuthority';

function savedCard(id: string, mode: 'main' | 'delegate' | 'magentic_one'): DeckCard {
  return {
    id,
    kind: 'agent',
    templateId: 'template_assist',
    title: id,
    prompt: `${id} prompt`,
    runtime: { kind: 'hermes', mode, profile: id },
    runtimeOptions: {
      provider: 'openai', accessMode: 'chatgpt-account',
      providerModelId: 'gpt-6.1-sol', modelKey: 'gpt-6.1-sol',
    },
    position: { x: 0, y: 0 },
    _cardRevisionId: `revision-${id}`,
  } as DeckCard;
}

function authority(): ProjectCardAuthority {
  const cards = [
    savedCard('main', 'main'),
    savedCard('worker', 'delegate'),
    savedCard('magnetic', 'magentic_one'),
  ].map((card): ProjectCardBinding => ({
    card,
    cardRevisionId: String(card._cardRevisionId),
    profile: card.runtime.profile,
    title: card.title,
    address: card.title,
  }));
  return {
    main: cards[0],
    cards,
    deck: {
      id: 'deck-one', name: 'Deck', promptTemplates: [], version: 1,
      nodes: cards.map((item) => item.card), edges: [],
    },
  };
}

class FakeClient implements HermesGatewayClient {
  connectionState = 'open';
  requests: Array<{ method: string; params: Record<string, unknown> }> = [];
  handlers = new Set<(event: HermesGatewayEvent) => void>();
  stateHandlers = new Set<(state: string) => void>();
  connect = vi.fn(async () => undefined);
  close = vi.fn();
  onRequest = vi.fn(() => () => undefined);
  onEvent(handler: (event: HermesGatewayEvent) => void) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
  onState(handler: (state: string) => void) {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }
  emit(event: HermesGatewayEvent) {
    for (const handler of this.handlers) handler(event);
  }
  async request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    this.requests.push({ method, params });
    if (method === 'session.list') return { sessions: [] } as T;
    if (method === 'session.create') {
      const profile = String(params.profile);
      return {
        session_id: `live-${profile}`,
        stored_session_id: `stored-${profile}`,
        info: { provider: 'openai-codex', model: 'gpt-6.1-sol' },
      } as T;
    }
    if (method === 'session.activate') {
      const profile = String(params.profile);
      return {
        session_id: String(params.session_id),
        stored_session_id: `stored-${profile}`,
        info: { provider: 'openai-codex', model: 'gpt-6.1-sol' },
      } as T;
    }
    if (method === 'session.status') return { running: false } as T;
    if (method === 'config.set') return { key: 'busy', value: 'steer' } as T;
    throw new Error(`unexpected:${method}`);
  }
}

function binding(): ProjectCardSession {
  return {
    sessionId: 'stored-main',
    liveHandle: 'live-main',
    info: { provider: 'openai-codex', model: 'gpt-6.1-sol' },
  };
}

describe('Hermes Bot communication boundary', () => {
  it('starts every saved Hermes Card, including the headless Magnetic Bot', async () => {
    profileMocks.ensure.mockClear();
    const client = new FakeClient();
    await startProjectCardSessions(client, authority(), {
      projectId: 'project-one', projectSessionId: 'project-one', userId: 'owner-one',
    });
    expect(profileMocks.ensure.mock.calls.map((call) => call[2].runtime.profile)).toEqual([
      'main', 'worker', 'magnetic',
    ]);
    expect(client.requests.filter((item) => item.method === 'session.create')).toHaveLength(3);
    expect(client.requests).toContainEqual({
      method: 'config.set',
      params: {
        profile: 'main', session_id: 'live-main', key: 'busy', value: 'steer',
      },
    });
  });

  it('submits only the standard prompt fields and returns a direct completion', async () => {
    const client = new FakeClient();
    client.request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
      client.requests.push({ method, params });
      if (method === 'session.status') return { running: false };
      if (method === 'prompt.submit') {
        queueMicrotask(() => {
          client.emit({ type: 'message.start', session_id: 'live-main', payload: {} });
          client.emit({ type: 'message.delta', session_id: 'live-main', payload: { text: 'Answer' } });
          client.emit({
            type: 'message.complete', session_id: 'live-main',
            payload: { text: 'Answer', status: 'complete', persisted_turn: { submission_id: 'turn-one' } },
          });
        });
        return { status: 'streaming' };
      }
      throw new Error(`unexpected:${method}`);
    }) as HermesGatewayClient['request'];
    const result = await executeHermesTurn({
      client,
      binding: binding(),
      profile: 'main',
      text: 'hello',
      runId: 'run-one',
      onAdmitted: async () => undefined,
      onEvent: () => undefined,
    });
    expect(result.text).toBe('Answer');
    expect(result.providerTurnRef).toBe('turn-one');
    const submit = client.requests.find((item) => item.method === 'prompt.submit');
    expect(submit?.params).toEqual({
      session_id: 'live-main', profile: 'main', text: 'hello',
    });
  });

  it('relays the standard background completion after message_agent queues a Bot reply', async () => {
    const client = new FakeClient();
    const waiting = vi.fn();
    client.request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
      client.requests.push({ method, params });
      if (method === 'session.status') return { running: false };
      if (method === 'prompt.submit') {
        queueMicrotask(() => {
          client.emit({ type: 'message.start', session_id: 'live-main', payload: {} });
          client.emit({
            type: 'tool.complete', session_id: 'live-main',
            payload: {
              name: 'message_agent',
              result: JSON.stringify({ status: 'queued', reply_delivery: 'notification' }),
            },
          });
          client.emit({
            type: 'message.complete', session_id: 'live-main',
            payload: { text: 'I sent it.', status: 'complete' },
          });
          client.emit({
            type: 'message.start', session_id: 'live-main',
            payload: { display_kind: 'process_complete' },
          });
          client.emit({
            type: 'message.delta', session_id: 'live-main',
            payload: { text: 'Sourced result' },
          });
          client.emit({
            type: 'message.complete', session_id: 'live-main',
            payload: { text: 'Sourced result', status: 'complete' },
          });
        });
        return { status: 'streaming' };
      }
      throw new Error(`unexpected:${method}`);
    }) as HermesGatewayClient['request'];
    const result = await executeHermesTurn({
      client,
      binding: binding(),
      profile: 'main',
      text: '@KnowGraph research this',
      runId: 'run-one',
      onAdmitted: async () => undefined,
      onWaitingForBotReply: waiting,
      onEvent: () => undefined,
    });
    expect(waiting).toHaveBeenCalledOnce();
    expect(result.text).toBe('Sourced result');
  });
});
