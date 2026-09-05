import { describe, expect, it, vi } from 'vitest';

import { runHermesProfileDelegation } from './profileDelegation';

const authority = {
  projectId: 'project-one',
  deckId: 'deck_builder',
  deckRevision: 'revision-one',
  conversationId: 'conversation-one',
  parentRunId: 'parent-run',
  sourceCardId: 'card_main_chat',
  sourceRuntimeMode: 'main' as const,
  parentExecutionContextId: 'root-context',
  profileTargets: [{
    cardId: 'card_hermes_steward',
    cardRevisionId: 'graph-revision-one',
    title: 'Graph Agent',
    profile: 'liquidaity-hermes-steward',
    description: 'Planning, memory, and KnowGraph research',
  }],
};

const currentDeck = {
  deck: {
    id: 'deck_builder', name: 'Builder', version: 1, promptTemplates: [],
    nodes: [{
      id: 'card_main_chat', templateId: 'main', title: 'Main', position: { x: 0, y: 0 },
      runtime: { kind: 'hermes', mode: 'main', profile: 'default' },
      runtimeOptions: { profileDelegationEnabled: true },
    }, {
      id: 'card_hermes_steward', templateId: 'graph', title: 'Graph Agent', position: { x: 1, y: 0 },
      parentGraphId: 'workbench_graph',
      runtime: { kind: 'hermes', mode: 'delegate', profile: 'liquidaity-hermes-steward' },
    }],
    edges: [{
      id: 'edge-main-graph', source: 'card_main_chat', target: 'card_hermes_steward', edgeType: 'flow',
    }],
  },
  meta: { deckRevision: 'revision-one', deckSavedAt: null },
};

describe('native profile delegation host adapter', () => {
  it.each(['controller-off', 'shared-profile', 'reverse-edge'])('rejects %s before any runner call', async (reason) => {
    const deck = structuredClone(currentDeck);
    if (reason === 'controller-off') deck.deck.nodes[0].runtimeOptions!.profileDelegationEnabled = false;
    if (reason === 'shared-profile') deck.deck.nodes[0].runtime.profile = deck.deck.nodes[1].runtime.profile;
    if (reason === 'reverse-edge') {
      const edge = deck.deck.edges[0];
      [edge.source, edge.target] = [edge.target, edge.source];
    }
    const runner = vi.fn();
    await expect(runHermesProfileDelegation(authority, {
      parentExecutionContextId: 'root-context', nativeChildId: 'profile-abcdef123456',
      targetProfile: 'liquidaity-hermes-steward', goal: 'Inspect',
    }, runner as any, vi.fn(async () => deck) as any)).rejects.toThrow('hermes_profile_target_stale');
    expect(runner).not.toHaveBeenCalled();
  });
  it('maps one authorized native profile to the canonical saved-Card tool', async () => {
    const runner = vi.fn(async () => ({
      ok: true,
      result: {
        runId: 'child-run',
        output: 'bounded graph result',
        nativeEvents: [{
          kind: 'tool_result', toolName: 'write_mag_one_instructions', isError: false,
          output: { ok: true, targetCardId: 'card_agent_builder' },
        }],
      },
    }));
    await expect(runHermesProfileDelegation(authority, {
      parentExecutionContextId: 'root-context',
      nativeChildId: 'profile-abcdef123456',
      targetProfile: 'liquidaity-hermes-steward',
      goal: 'Inspect the requested graph.',
      context: 'Return native provenance.',
      dataAnchors: [{
        authority: 'ThinkGraph',
        nativeId: 'memory-project-frame',
        reason: 'Carry the accepted project frame into the receiving Card IDF.',
        priority: 10,
        boundedExpansion: 1,
        resultLimit: 8,
      }],
    }, runner as any, vi.fn(async () => currentDeck) as any)).resolves.toEqual({
      nativeChildId: 'profile-abcdef123456',
      targetProfile: 'liquidaity-hermes-steward',
      runId: 'child-run',
      result: 'bounded graph result',
      nativeEvents: [{
        kind: 'tool_result', toolName: 'write_mag_one_instructions', isError: false,
        output: { ok: true, targetCardId: 'card_agent_builder' },
      }],
    });
    expect(runner).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'system-root', callerCardId: 'card_main_chat', parentRunId: 'parent-run',
        grantedTools: ['card.run_assistant_agent'], presentedTools: [],
      }),
      'card.run_assistant_agent',
      {
        cardId: 'card_hermes_steward',
        cardRevisionId: 'graph-revision-one',
        input: 'Inspect the requested graph.\n\n## Delegated context\nReturn native provenance.',
        dataAnchors: [{
          authority: 'ThinkGraph',
          nativeId: 'memory-project-frame',
          reason: 'Carry the accepted project frame into the receiving Card IDF.',
          priority: 10,
          boundedExpansion: 1,
          resultLimit: 8,
        }],
      },
    );
  });

  it('rejects malformed profile data anchors before calling the Card runner', async () => {
    const runner = vi.fn();
    await expect(runHermesProfileDelegation(authority, {
      parentExecutionContextId: 'root-context',
      nativeChildId: 'profile-abcdef123456',
      targetProfile: 'liquidaity-hermes-steward',
      goal: 'Inspect the requested graph.',
      dataAnchors: 'not-an-array',
    }, runner as any, vi.fn(async () => currentDeck) as any)).rejects.toThrow(
      'hermes_profile_data_anchors_must_be_array',
    );
    expect(runner).not.toHaveBeenCalled();
  });

  it('rejects forged profiles and stale parent identity before execution', async () => {
    const runner = vi.fn();
    await expect(runHermesProfileDelegation(authority, {
      parentExecutionContextId: 'root-context',
      nativeChildId: 'profile-abcdef123456',
      targetProfile: 'unconnected',
      goal: 'Try to bypass the orange edge.',
      context: '',
    }, runner as any)).rejects.toThrow('hermes_profile_target_not_authorized');
    await expect(runHermesProfileDelegation(authority, {
      parentExecutionContextId: 'stale-context',
      nativeChildId: 'profile-abcdef123456',
      targetProfile: 'liquidaity-hermes-steward',
      goal: 'Try stale authority.',
      context: '',
    }, runner as any)).rejects.toThrow('hermes_profile_parent_context_mismatch');
    expect(runner).not.toHaveBeenCalled();
  });

  it('revalidates the current saved target profile and directed flow edge', async () => {
    const runner = vi.fn();
    const staleDeck = structuredClone(currentDeck);
    staleDeck.deck.nodes[1].runtime.profile = 'renamed-profile';
    await expect(runHermesProfileDelegation(authority, {
      parentExecutionContextId: 'root-context',
      nativeChildId: 'profile-abcdef123456',
      targetProfile: 'liquidaity-hermes-steward',
      goal: 'Try stale projected authority.',
      context: '',
    }, runner as any, vi.fn(async () => staleDeck) as any)).rejects.toThrow(
      'hermes_profile_target_stale',
    );
    expect(runner).not.toHaveBeenCalled();
  });
});
