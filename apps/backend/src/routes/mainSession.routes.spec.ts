/**
 * Entity: Main Chat
 * Relationship: This file verifies Main binds only its already-started Project session and classifies Hermes completion, failure, and interruption without inventing a result.
 * Entity: Hermes Card Sessions
 * Relationship: This file verifies a Main request does not restart every Card or construct a duplicate profile-to-session map.
 * Entity: Bot Mode Delegation
 * Relationship: This file verifies the actual message_agent target reported by Hermes maps to one saved Bot identity.
 * Entity: Run Ledger
 * Relationship: This file verifies interrupted and cancelled Hermes completions remain cancellation evidence rather than completed Run results.
 */

import { describe, expect, it, vi } from 'vitest';

import type { DeckCard, DeckDocument } from '../types';
import type { ProjectCardBinding, ProjectCardAuthority } from '../services/projectCardAuthority';
import type { HermesGatewayClient } from '../services/hermesGateway';

const profileMocks = vi.hoisted(() => ({
  ensureSavedCardProfile: vi.fn(async (_request, card: DeckCard) => ({
    name: card.runtime.profile,
    model: { provider: 'openai-codex', default: 'gpt-5.6-sol' },
  })),
  materializeSavedCardProfile: vi.fn(async (_request, card: DeckCard) => ({
    name: card.runtime.profile,
    model: { provider: 'openai-codex', default: 'gpt-5.6-sol' },
  })),
}));

vi.mock('../hermes/profileMaterialization', async () => {
  const actual = await vi.importActual<typeof import('../hermes/profileMaterialization')>(
    '../hermes/profileMaterialization',
  );
  return { ...actual, ...profileMocks };
});

vi.mock('../services/mcp/toolCatalogMcpClient', () => ({
  readToolCatalog: vi.fn(async () => ({
    state: 'available', tools: [], unavailableFamilies: [], toolFailures: {},
  })),
}));

vi.mock('../services/workingDirectories', () => ({
  resolveBuilderProjectCodeDirectory: vi.fn(() => 'C:/Projects/LiquidAIty/main'),
  resolveProductChatWorkingDirectory: vi.fn(() => 'C:/Projects/LiquidAIty/main'),
}));

vi.mock('../services/projectStore', async () => {
  const actual = await vi.importActual<typeof import('../services/projectStore')>(
    '../services/projectStore',
  );
  return {
    ...actual,
    assertHermesProfileOwner: vi.fn(async () => undefined),
  };
});

import {
  cardSession,
  hermesCompletionError,
  messageAgentTargetMatchesCard,
} from './mainSession.routes';

function card(id: string, profile: string, mode: 'main' | 'delegate' = 'delegate'): DeckCard {
  return {
    id,
    title: profile,
    enabled: true,
    runtime: { kind: 'hermes', mode, profile },
    runtimeOptions: {},
  } as DeckCard;
}

function binding(value: DeckCard): ProjectCardBinding {
  return {
    card: value,
    cardRevisionId: `revision-${value.id}`,
    profile: value.runtime.profile,
    title: value.title,
    address: value.title,
  };
}

function gateway(): HermesGatewayClient {
  return {
    connectionState: 'open',
    connect: vi.fn(async () => undefined),
    close: vi.fn(),
    onEvent: vi.fn(() => () => undefined),
    onState: vi.fn(() => () => undefined),
    onRequest: vi.fn(() => () => undefined),
    request: vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
      const profile = String(params.profile || '');
      if (method === 'session.list') {
        return { sessions: [{ resolved_id: `stored-${profile}` }] };
      }
      if (method === 'session.resume' || method === 'session.activate') {
        return {
          session_id: `live-${profile}`,
          stored_session_id: `stored-${profile}`,
          info: {
            provider: 'openai-codex',
            model: 'gpt-5.6-sol',
          },
        };
      }
      throw new Error(`unexpected_gateway_method:${method}`);
    }) as HermesGatewayClient['request'],
  };
}

describe('Main Project-session closure', () => {
  it('binds Main once with the full enabled Bot roster and no duplicate session map', async () => {
    const mainCard = card('card-main', 'main', 'main');
    const signalCard = card('card-signal', 'signal');
    signalCard.runtimeOptions = { orchestrator: true };
    const worldSignalsCard = card('card-worldsignals', 'worldsignals');
    const unrelatedCard = card('card-unrelated', 'unrelated');
    const deck = {
      id: 'deck_builder',
      name: 'Test deck',
      projectId: 'project-1',
      promptTemplates: [],
      nodes: [mainCard, signalCard, worldSignalsCard, unrelatedCard],
      edges: [
        { id: 'main-signal', source: mainCard.id, target: signalCard.id, edgeType: 'flow' },
        { id: 'signal-worldsignals', source: signalCard.id, target: worldSignalsCard.id, edgeType: 'flow' },
        {
          id: 'magnetic-workers',
          source: worldSignalsCard.id,
          target: unrelatedCard.id,
          edgeType: 'magentic_option',
        },
      ],
      version: 1,
    } as DeckDocument;
    const cards = deck.nodes.map(binding);
    const authority: ProjectCardAuthority = {
      deck,
      cards,
      main: cards[0],
    };

    const client = gateway();
    const result = await cardSession(
      client,
      authority,
      authority.main,
      {
        projectId: 'project-1',
        projectSessionId: 'project-1',
        userId: 'user-1',
      },
    );

    expect(Object.keys(result.cardSessions)).toEqual(['main']);
    expect(result.cardSessions.main.botModeRoster).toEqual([
      'signal', 'worldsignals', 'unrelated',
    ]);
    expect(result.cardSessions.main).not.toHaveProperty('botModeSessions');
    const resumeCalls = vi.mocked(client.request).mock.calls
      .filter(([method]) => method === 'session.resume');
    expect(resumeCalls).toHaveLength(1);
    expect(resumeCalls.every(([_method, params]) => params?.eager_build === true)).toBe(true);
    expect(resumeCalls.map(([_method, params]) => params?.profile)).toEqual(['main']);
    expect(resumeCalls[0]?.[1]).not.toHaveProperty('bot_mode_sessions');
    const materializeCalls = profileMocks.materializeSavedCardProfile.mock.calls.length;
    await cardSession(
      client,
      authority,
      authority.main,
      {
        projectId: 'project-1',
        projectSessionId: 'project-1',
        userId: 'user-1',
      },
    );
    expect(profileMocks.materializeSavedCardProfile).toHaveBeenCalledTimes(materializeCalls);
  });

  it('classifies Hermes interruption as cancellation rather than completion', () => {
    expect(hermesCompletionError({ status: 'interrupted', text: 'partial' })?.message)
      .toBe('hermes_turn_cancelled');
    expect(hermesCompletionError({ status: 'cancelled' })?.message)
      .toBe('hermes_turn_cancelled');
    expect(hermesCompletionError({ status: 'complete' })).toBeNull();
    expect(hermesCompletionError({ status: 'failed', error: 'provider_failed' })?.message)
      .toBe('provider_failed');
  });

});

describe('saved Bot event correlation', () => {
  it('recognizes only the exact authorized profile or saved address', () => {
    const target = binding(card('card-world-signals', 'worldsignals'));
    target.address = 'WorldSignals';

    expect(messageAgentTargetMatchesCard('worldsignals', target)).toBe(true);
    expect(messageAgentTargetMatchesCard('@WorldSignals', target)).toBe(true);
    expect(messageAgentTargetMatchesCard('World Signals', target)).toBe(false);
    expect(messageAgentTargetMatchesCard('world', target)).toBe(false);
  });
});
