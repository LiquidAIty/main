/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: ThinkGraph
 * Relationship: Checks saved-pair correlation, the exact saved target and submission/settlement transport without claiming live model proof.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ authority: vi.fn(), rails: vi.fn(), request: vi.fn(), close: vi.fn(),
  event: null as null | ((event: any) => void), loads: vi.fn(), notify: vi.fn() }));
vi.mock('../routes/thinkGraph.routes', () => ({ notifyThinkGraphChanged: mock.notify }));
vi.mock('../services/projectCardAuthority', () => ({ projectCardAuthority: mock.authority }));
vi.mock('../services/pythonRailsClient', () => ({ requestPythonRailsJson: mock.rails,
  fetchThinkGraphProjection: async () => ({ canonicalEntityDirectory: { entities: [] } }) }));
vi.mock('../services/workingDirectories', () => ({ resolveRepoRoot: () => 'C:/test-repo' }));
vi.mock('tsx/esm/api', () => ({ tsImport: async (file: string) => {
  mock.loads(file);
  if (file.endsWith('/api/client.ts')) return { PROMPT_SUBMIT_REQUEST_TIMEOUT_MS: 1000, HermesGateway: class {
    connect = vi.fn(); close = mock.close; request = mock.request;
    onEvent(callback: any) { mock.event = callback; return () => { mock.event = null; }; }
    onState() { return () => {}; }
  } };
  if (file.endsWith('/local-gateway.ts')) return { ensureLocalGateway: async (run: any) => { await run(); return { gatewayEndpoint: {}, baseUrl: 'http://local' }; },
    runGatewayEnsure: vi.fn(), createLocalGatewayDials: () => ({ prepare: vi.fn() }) };
  return { createGatewayTicketResolver: () => async () => 'test-ticket' };
} }));
import { submitSavedThinkPair } from './thinkGraphHandoff';
import type { ConversationMessage } from './store';

const user = { messageId: 'saved-user', role: 'user', status: 'complete', content: 'Actual saved question.', seq: 1,
  providerContinuationRef: 'source-session', providerMessageId: 'hermes:main:admission:source-admission' };
const answer = { messageId: 'saved-answer', projectId: 'project', conversationId: 'conversation', role: 'assistant',
  status: 'complete', content: 'Actual saved answer.', seq: 2, providerContinuationRef: 'source-session',
  providerMessageId: 'hermes:main:row:20', visibleActivities: [{ kind: 'conversation_speaker', profile: 'main' }] } as ConversationMessage;

beforeEach(() => {
  vi.clearAllMocks(); mock.event = null;
  mock.authority.mockResolvedValue({ main: { card: { id: 'main' } },
    cards: [{ card: { id: 'card_thinkgraph', runtime: { kind: 'hermes' } }, profile: 'thinkgraph', cardRevisionId: 'saved-revision' }],
    deck: { edges: [{ source: 'main', target: 'card_thinkgraph', edgeType: 'flow' }] } });
  mock.rails.mockImplementation(async (route: string, init: any) => {
    const body = JSON.parse(init.body);
    if (body.operation === 'conversation') return [user, answer, { ...user, messageId: 'later-user', seq: 3 }];
    if (body.operation === 'prepare_conversation_pair') return {
      source: { projectId: 'project', conversationId: 'conversation', userMessage: user.content, mainResponse: answer.content },
      preparation: { pairReference: 'pair-exact', structuredExtractionRequired: true,
        enrichmentPrompt: `USER:\n${user.content}\nMAIN:\n${answer.content}`, enrichmentSchema: { type: 'object' } },
      projectEntityMap: { entities: [] },
    };
    return { ok: true, status: 'completed', revisionChanged: true, thinkMemoryIds: ['test-think'] };
  });
  mock.request.mockImplementation(async (method: string, params: any) => {
    if (params.profile === 'main') return { status: 'terminal', outcome: 'completed',
      result: { persisted_turn: { complete: true, user_row_ids: [10], final_assistant_row_id: 20 } } };
    if (method === 'session.create') return { session_id: 'fresh-think-session' };
    if (method === 'prompt.submit') {
      queueMicrotask(() => mock.event?.({ type: 'message.complete', profile: 'thinkgraph',
        session_id: 'fresh-think-session', admission_id: 'think-admission' }));
      return { admission_id: 'think-admission' };
    }
    return { status: 'terminal', outcome: 'completed', admission_id: 'think-admission', ref: { session_id: 'fresh-think-session' },
      result: { final_response: '{"facts":[]}', provider: 'saved-provider', model: 'saved-model' } };
  });
});

describe('stored ThinkGraph prompt handoff', () => {
  it('submits the exact stored pair once to a fresh invocation of the saved profile', async () => {
    await submitSavedThinkPair(answer);
    const prepares = mock.rails.mock.calls.map(([, init]) => JSON.parse(init.body)).filter(body => body.operation === 'prepare_conversation_pair');
    expect(prepares).toHaveLength(1);
    expect(prepares[0].arguments).toEqual({ conversationId: 'conversation', userMessageIds: ['saved-user'], assistantMessageId: 'saved-answer' });
    const submissions = mock.request.mock.calls.filter(([method]) => method === 'prompt.submit');
    expect(submissions).toHaveLength(1);
    expect(submissions[0][1]).toMatchObject({ profile: 'thinkgraph', session_id: 'fresh-think-session', submission_id: 'pair-exact' });
    expect(submissions[0][1].text).toContain('Actual saved question.');
    expect(submissions[0][1].text).toContain('Actual saved answer.');
    expect(mock.request).toHaveBeenCalledWith('session.create', { profile: 'thinkgraph', request_id: 'pair-exact',
      source: 'oneshot', hidden: true, follow_profile_config: true });
    const settlement = mock.rails.mock.calls.find(([route]) => route.endsWith('/settle'));
    expect(JSON.parse(settlement![1].body)).toMatchObject({ pairReference: 'pair-exact', structuredOutput: { facts: [] },
      cardRun: { cardId: 'card_thinkgraph', revisionId: 'saved-revision', runId: 'think-admission', profile: 'thinkgraph',
        resolvedProvider: 'saved-provider', resolvedModel: 'saved-model' } });
    expect(mock.request.mock.calls.some(([method]) => /steer|bot_relay|session.history|profiles.configure/.test(method))).toBe(false);
    expect(mock.close).toHaveBeenCalledOnce();
    expect(mock.notify).toHaveBeenCalledExactlyOnceWith('project');
  });

  it('notifies only after the Think/Jev settlement returns its committed change', async () => {
    const rails = mock.rails.getMockImplementation()!;
    let settle!: (value: unknown) => void;
    mock.rails.mockImplementation((route: string, init: any) => route.endsWith('/settle')
      ? new Promise(resolve => { settle = resolve; }) : rails(route, init));
    const pending = submitSavedThinkPair(answer);
    await vi.waitFor(() => expect(settle).toBeTypeOf('function'));
    expect(mock.notify).not.toHaveBeenCalled();
    settle({ ok: true, status: 'completed', revisionChanged: true });
    await pending;
    expect(mock.notify).toHaveBeenCalledExactlyOnceWith('project');
  });

  it.each(['failed', 'noop'])('does not signal a graph change for %s settlement', async state => {
    const rails = mock.rails.getMockImplementation()!;
    mock.rails.mockImplementation((route: string, init: any) => {
      if (!route.endsWith('/settle')) return rails(route, init);
      if (state === 'failed') throw new Error('settlement failed');
      return { ok: true, status: 'completed', revisionChanged: false };
    });
    if (state === 'failed') await expect(submitSavedThinkPair(answer)).rejects.toThrow('settlement failed');
    else await submitSavedThinkPair(answer);
    expect(mock.notify).not.toHaveBeenCalled();
  });

  it('does not submit a partial assistant row or a completion without exact pairing', async () => {
    await submitSavedThinkPair({ ...answer, status: 'streaming' });
    expect(mock.loads).not.toHaveBeenCalled();
    mock.request.mockResolvedValue({ status: 'started' });
    await submitSavedThinkPair(answer);
    expect(mock.request.mock.calls.some(([method]) => method === 'prompt.submit')).toBe(false);
  });

  it('refuses incomplete multi-input provenance rather than guessing a pair', async () => {
    mock.request.mockResolvedValue({ status: 'terminal', outcome: 'completed',
      result: { persisted_turn: { complete: false, user_row_ids: [10, 11], final_assistant_row_id: 20 } } });
    await expect(submitSavedThinkPair(answer)).rejects.toThrow('pair_identity_incomplete');
    expect(mock.request.mock.calls.some(([method]) => method === 'prompt.submit')).toBe(false);
  });

  it('accepts exact terminal pair identities when whole-transcript prefix coverage is false', async () => {
    const request = mock.request.getMockImplementation()!;
    mock.request.mockImplementation(async (method: string, params: any) => {
      const receipt = await request(method, params);
      if (params.profile === 'main') receipt.result.persisted_turn.complete = false;
      return receipt;
    });
    await submitSavedThinkPair(answer);
    expect(mock.request.mock.calls.filter(([method]) => method === 'prompt.submit')).toHaveLength(1);
  });

  it('does not invoke an absent saved ThinkGraph target', async () => {
    mock.authority.mockResolvedValue({ cards: [], deck: { edges: [] } });
    await submitSavedThinkPair(answer);
    expect(mock.loads).not.toHaveBeenCalled();
  });
});
