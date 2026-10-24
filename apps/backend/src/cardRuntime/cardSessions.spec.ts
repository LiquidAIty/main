import { describe, expect, it, vi } from 'vitest';

import type { DeckCard, DeckDocument } from '../types';
import {
  CARD_RUNTIME_CONTRACT,
  type CardRuntimeClient,
  type CardRuntimeEvent,
} from '../services/cardRuntimeGateway';
import type { ProjectCardAuthority, ProjectCardBinding } from '../services/projectCardAuthority';

const calls = vi.hoisted(() => [] as string[]);
const profiles = vi.hoisted(() => ({
  ensure: vi.fn(async (_request, _deck: DeckDocument, card: DeckCard) => {
    calls.push(`ensure:${card.runtime.profile}`);
    return {
      name: card.runtime.profile,
      model: { provider: 'openai-codex', default: 'gpt-6.1-sol' },
    };
  }),
  materialize: vi.fn(async (_request, _deck: DeckDocument, card: DeckCard) => {
    calls.push(`materialize:${card.runtime.profile}`);
    return {
      name: card.runtime.profile,
      model: { provider: 'openai-codex', default: 'gpt-6.1-sol' },
    };
  }),
}));

vi.mock('./profileMaterialization', () => ({
  ensureSavedCardProfile: profiles.ensure,
  materializeSavedCardProfile: profiles.materialize,
  savedCardAgentRoster: () => [],
  cardModelSelection: () => ({ provider: 'openai-codex', model: 'gpt-6.1-sol' }),
}));
vi.mock('../services/projectStore', () => ({
  assertCardProfileOwner: vi.fn(async () => undefined),
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

import { resolveCardSession, startProjectCardSessions } from './cardSessions';

function savedCard(id: string, mode: 'main' | 'delegate' | 'magentic_one'): DeckCard {
  return {
    id,
    kind: 'agent',
    templateId: 'template_assist',
    title: id,
    prompt: `${id} prompt`,
    runtime: { kind: CARD_RUNTIME_CONTRACT.kind, mode, profile: id },
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

class FakeClient implements CardRuntimeClient {
  connectionState = 'open';
  requests: Array<{ method: string; params: Record<string, unknown> }> = [];
  constructor(private readonly resumeExisting = false) {}
  connect = vi.fn(async () => undefined);
  close = vi.fn();
  onRequest = vi.fn(() => () => undefined);
  onEvent(_handler: (event: CardRuntimeEvent) => void) { return () => undefined; }
  onState(_handler: (state: string) => void) { return () => undefined; }
  async request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    this.requests.push({ method, params });
    if (method === 'session.resume') {
      if (!this.resumeExisting) throw Object.assign(new Error('missing'), { code: 4007 });
      const profile = String(params.profile);
      return {
        session_id: `live-${profile}`,
        stored_session_id: `stored-${profile}`,
        info: { provider: 'openai-codex', model: 'gpt-6.1-sol' },
      } as T;
    }
    if (method === 'session.create') {
      const profile = String(params.profile);
      return {
        session_id: `live-${profile}`,
        stored_session_id: `stored-${profile}`,
        info: { provider: 'openai-codex', model: 'gpt-6.1-sol' },
      } as T;
    }
    if (method === 'config.set') return { key: 'busy', value: 'steer' } as T;
    throw new Error(`unexpected:${method}`);
  }
}

describe('saved Card session binding', () => {
  it('creates every profile before configuring rosters or starting sessions', async () => {
    calls.length = 0;
    profiles.ensure.mockClear();
    profiles.materialize.mockClear();
    const client = new FakeClient();
    await startProjectCardSessions(client, authority(), {
      projectId: 'project-one', projectSessionId: 'project-one', userId: 'owner-one',
    });
    expect(calls).toEqual([
      'ensure:main', 'ensure:worker', 'ensure:magnetic',
      'materialize:main', 'materialize:worker', 'materialize:magnetic',
    ]);
    expect(client.requests.filter((item) => item.method === 'session.create')).toHaveLength(3);
    expect(client.requests).toContainEqual({
      method: 'session.create',
      params: expect.objectContaining({ profile: 'main', source: 'api_server' }),
    });
    expect(client.requests).toContainEqual({
      method: 'session.create',
      params: expect.objectContaining({ profile: 'worker', source: 'desktop' }),
    });
    expect(client.requests).toContainEqual({
      method: 'config.set',
      params: { profile: 'main', session_id: 'live-main', key: 'busy', value: 'steer' },
    });
  });

  it('delegates exact-title resume without listing or activating sessions', async () => {
    const client = new FakeClient(true);
    const value = authority();
    await expect(resolveCardSession(client, value, value.main, {
      projectId: 'project-one', projectSessionId: 'project-one', userId: 'owner-one',
    })).resolves.toMatchObject({ sessionId: 'stored-main', liveHandle: 'live-main' });
    expect(client.requests).toContainEqual({
      method: 'session.resume',
      params: expect.objectContaining({
        session_id: CARD_RUNTIME_CONTRACT.messageSessionTitle,
        profile: 'main',
        source: 'api_server',
      }),
    });
    expect(client.requests.some((request) => request.method === 'session.list')).toBe(false);
    expect(client.requests.some((request) => request.method === 'session.activate')).toBe(false);
    expect(client.requests.some((request) => request.method === 'session.create')).toBe(false);
  });
});
