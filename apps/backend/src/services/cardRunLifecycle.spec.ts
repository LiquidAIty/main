/**
 * Entity: Card Runs
 * Relationship: Verifies exact preparation, execution, readback, usage, and mismatch-settlement identities across the TypeScript-to-Python Run boundary.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readToolCatalog: vi.fn(),
  requestPythonRailsJson: vi.fn(),
}));

vi.mock('./mcp/toolCatalogMcpClient', () => ({
  readToolCatalog: mocks.readToolCatalog,
}));
vi.mock('./pythonRailsClient', async (importOriginal) => ({
  ...await importOriginal<typeof import('./pythonRailsClient')>(),
  requestPythonRailsJson: mocks.requestPythonRailsJson,
}));

import {
  hermesUsageFields,
  prepareCardRun,
  readCardRun,
} from './cardRunLifecycle';
import type { ProjectCardBinding } from './projectCardAuthority';

const target: ProjectCardBinding = {
  card: {
    id: 'card-helper',
    kind: 'agent',
    templateId: 'template_assist',
    title: 'Helper',
    prompt: 'Help with the task.',
    position: { x: 0, y: 0 },
    runtime: { kind: 'hermes' as const, mode: 'delegate' as const, profile: 'helper' },
  },
  cardRevisionId: 'revision-one',
  profile: 'helper',
  title: 'Helper',
};

beforeEach(() => {
  mocks.readToolCatalog.mockResolvedValue({
    tools: [], state: 'ready', unavailableFamilies: [], toolFailures: {},
  });
  mocks.requestPythonRailsJson.mockReset();
});

describe('Card Run lifecycle identities', () => {
  it('requires every preparation identity to match the submitted Card scope', async () => {
    const prepared = {
      runId: 'run-one',
      correlationId: 'run-one',
      projectId: 'project-one',
      deckId: 'deck-one',
      conversationId: 'conversation-one',
      cardId: 'card-helper',
      cardRevisionId: 'revision-one',
      hermesTransport: {
        cardIdentity: { cardId: 'card-helper' },
        request: {
          runtime: { profile: 'helper' },
          message: 'Do the bounded task.',
        },
      },
    };
    mocks.requestPythonRailsJson.mockResolvedValue(prepared);
    const args = {
      projectId: 'project-one',
      deckId: 'deck-one',
      conversationId: 'conversation-one',
      message: 'Do the bounded task.',
      target,
      dataAnchors: [],
      images: [],
      runId: 'run-one',
    };

    await expect(prepareCardRun(args)).resolves.toMatchObject({ runId: 'run-one' });

    for (const mismatch of [
      { projectId: 'project-other' },
      { deckId: 'deck-other' },
      { conversationId: 'conversation-other' },
      { cardId: 'card-other' },
      { cardRevisionId: 'revision-other' },
    ]) {
      mocks.requestPythonRailsJson.mockResolvedValueOnce({
        ...prepared,
        ...mismatch,
      });
      await expect(prepareCardRun(args)).rejects.toThrow(
        'saved_card_preparation_identity_mismatch',
      );
    }
  });

  it('rejects a same-run readback from another Project', async () => {
    mocks.requestPythonRailsJson.mockResolvedValue({
      ok: true,
      run: {
        runId: 'run-one', projectId: 'project-other', deckId: 'deck-one',
        cardId: 'card-helper', runtimeProfile: 'helper',
      },
    });

    await expect(readCardRun({
      projectId: 'project-one',
      deckId: 'deck-one',
      runId: 'run-one',
      cardId: 'card-helper',
      profile: 'helper',
    })).rejects.toThrow('card_turn_run_identity_mismatch');
  });

  it('settles an accepted Run when Python returns a mismatched transport identity', async () => {
    mocks.requestPythonRailsJson
      .mockResolvedValueOnce({
        runId: 'run-one',
        correlationId: 'run-one',
        projectId: 'project-one',
        deckId: 'deck-one',
        conversationId: 'conversation-one',
        cardId: 'card-other',
        cardRevisionId: 'revision-one',
        hermesTransport: {
          cardIdentity: { cardId: 'card-helper' },
          request: { runtime: { profile: 'helper' }, message: 'task' },
        },
      })
      .mockResolvedValueOnce({ ok: true, runId: 'run-one', state: 'failed' });

    await expect(prepareCardRun({
      projectId: 'project-one',
      deckId: 'deck-one',
      conversationId: 'conversation-one',
      message: 'task',
      target,
      dataAnchors: [],
      images: [],
      runId: 'run-one',
    })).rejects.toThrow('saved_card_preparation_identity_mismatch');

    expect(mocks.requestPythonRailsJson.mock.calls[1]?.[0]).toBe('/domain/runs/finish');
    expect(JSON.parse(String(mocks.requestPythonRailsJson.mock.calls[1]?.[1]?.body)))
      .toMatchObject({
        runId: 'run-one',
        state: 'failed',
        errorCode: 'saved_card_preparation_identity_mismatch',
      });
  });

  it('accepts only nonnegative internally consistent usage', () => {
    expect(hermesUsageFields({
      input: 10,
      prompt: 13,
      output: 5,
      completion: 5,
      total: 18,
      cache_read: 3,
      reasoning: 2,
      cost_usd: 0.25,
    })).toEqual({
      providerInputTokens: 13,
      providerOutputTokens: 5,
      providerCachedTokens: 3,
      providerReasoningTokens: 2,
      providerTotalTokens: 18,
      totalCostUsd: 0.25,
    });
    for (const invalid of [
      { input: -1 },
      { output: Number.NaN },
      { cost_usd: -0.01 },
      { prompt: 10, completion: 5, total: 14 },
      { prompt: 2, cache_read: 3 },
      { completion: 2, reasoning: 3 },
    ]) {
      expect(() => hermesUsageFields(invalid)).toThrow('hermes_usage_invalid');
    }
  });
});
