/**
 * Entity: Main Chat
 * Relationship: This file verifies Main uses the saved Project session closure and classifies Hermes completion, failure, and interruption without inventing a result.
 * Entity: Hermes Card Sessions
 * Relationship: This file verifies only Main, an explicitly addressed recipient, and that recipient's downstream orange closure receive resumed Project sessions.
 * Entity: Bot Mode Delegation
 * Relationship: This file verifies explicit @Card routing accepts only the exact orange roster and requires a complete direct Hermes delivery receipt.
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
  directRecipientSubmissionId,
  explicitlyAddressedCard,
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
  it('restores an addressed orchestrator and its downstream orange closure only', async () => {
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
      ],
      version: 1,
    } as DeckDocument;
    const cards = deck.nodes.map(binding);
    const authority: ProjectCardAuthority = {
      deck,
      cards,
      main: cards[0],
    };

    const result = await cardSession(
      gateway(),
      authority,
      authority.main,
      {
        projectId: 'project-1',
        projectSessionId: 'project-1',
        userId: 'user-1',
      },
      cards[1],
    );

    expect(Object.keys(result.cardSessions).sort()).toEqual([
      'main', 'signal', 'worldsignals',
    ]);
    expect(result.cardSessions.main.botModeRoster).toEqual(['signal']);
    expect(result.cardSessions.main.botModeSessions).toEqual({
      signal: 'stored-signal',
    });
    expect(result.cardSessions.signal.botModeRoster).toEqual(['worldsignals']);
    expect(result.cardSessions.signal.botModeSessions).toEqual({
      worldsignals: 'stored-worldsignals',
    });
    expect(result.cardSessions.worldsignals.botModeRoster).toEqual([]);
    expect(result.cardSessions).not.toHaveProperty('unrelated');
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

describe('direct saved-Card delivery correlation', () => {
  it('rejects an explicit address that is absent from the exact orange roster', () => {
    const target = binding(card('card-builder', 'builder'));
    target.address = 'Builder';

    expect(explicitlyAddressedCard('normal Main question', [target])).toBeNull();
    expect(explicitlyAddressedCard('@Builder make this precise', [target])).toBe(target);
    expect(() => explicitlyAddressedCard('@Trader compare these', [target]))
      .toThrow('main_address_not_authorized:trader');
  });

  it('recognizes only the exact authorized profile or saved address', () => {
    const target = binding(card('card-world-signals', 'worldsignals'));
    target.address = 'WorldSignals';

    expect(messageAgentTargetMatchesCard('worldsignals', target)).toBe(true);
    expect(messageAgentTargetMatchesCard('@WorldSignals', target)).toBe(true);
    expect(messageAgentTargetMatchesCard('World Signals', target)).toBe(false);
    expect(messageAgentTargetMatchesCard('world', target)).toBe(false);
  });

  it('accepts only a complete direct Hermes admission receipt', () => {
    expect(directRecipientSubmissionId({
      delivery_id: 'delivery-one',
      process_id: 'process-one',
      reply_delivery: 'direct',
    })).toBe('__bot_dm__delivery-one');

    for (const invalid of [
      { delivery_id: '', process_id: 'process-one', reply_delivery: 'direct' },
      { delivery_id: 'delivery-one', process_id: '', reply_delivery: 'direct' },
      { delivery_id: 'delivery-one', process_id: 'process-one', reply_delivery: 'notification' },
      { delivery_id: 'delivery-one', process_id: 'process-one', reply_delivery: 'direct', notification_error: 'failed' },
    ]) {
      expect(() => directRecipientSubmissionId(invalid))
        .toThrow('hermes_addressed_delivery_correlation_missing');
    }
  });
});
