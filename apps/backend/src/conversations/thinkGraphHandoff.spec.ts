/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: ThinkGraph
 * Relationship: Checks saved-pair correlation, the exact saved target and submission/settlement transport without claiming live model proof.
 * Entity: KnowGraph
 * Relationship: Checks that a settled pair produces at most one research delivery and that a disabled preparation produces none.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ authority: vi.fn(), rails: vi.fn(), request: vi.fn(), close: vi.fn(),
  event: null as null | ((event: any) => void), loads: vi.fn(), notify: vi.fn() }));
vi.mock('../routes/thinkGraph.routes', () => ({ notifyThinkGraphChanged: mock.notify }));
vi.mock('../services/projectCardAuthority', () => ({ projectCardAuthority: mock.authority }));
vi.mock('../services/pythonRailsClient', () => ({ requestPythonRailsJson: mock.rails,
  fetchThinkGraphProjection: async () => ({ canonicalEntityDirectory: { entities: [] } }) }));
vi.mock('../services/workingDirectories', () => ({ resolveRepoRoot: () => 'C:/test-repo' }));
vi.mock('node:util', () => ({ promisify: () => async () => ({ stdout: '["ws://test",["test-protocol"]]' }) }));
vi.mock('ws', () => ({ default: class {
  protocol = 'test-protocol';
  on() {}
  once(name: string, callback: () => void) { if (name === 'open') queueMicrotask(callback); }
  send() {}
  close = mock.close;
} }));
vi.mock('tsx/esm/api', () => ({ tsImport: async (file: string) => {
  mock.loads(file);
  return { JsonRpcRequestChannel: class {
    constructor(options: any) { mock.event = options.onEvent; }
    request = mock.request; attach() {} detach() {} startHeartbeat() {} handleFrame() {}
  } };
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
      projectMapContext: { projectId: 'project', text: 'supplied map' },
    };
    return { ok: true, status: 'completed', revisionChanged: true, thinkMemoryIds: ['test-think'] };
  });
  mock.request.mockImplementation(async (method: string, params: any) => {
    if (params.session_id === 'source-session') return { status: 'terminal', outcome: 'completed',
      result: { persisted_turn: { complete: true, user_row_ids: [10], final_assistant_row_id: 20 } } };
    if (method === 'session.resume') return { session_id: 'fresh-think-session' };
    if (method === 'bot_relay.deliver') {
      queueMicrotask(() => mock.event?.({ type: 'message.complete', profile: 'thinkgraph',
        session_id: 'fresh-think-session', admission_id: 'think-admission' }));
      return { admission_id: 'think-admission', session_id: 'fresh-think-session' };
    }
    return { status: 'terminal', outcome: 'completed', admission_id: 'think-admission', ref: { session_id: 'fresh-think-session' },
      result: { final_response: '{"facts":[]}', provider: 'saved-provider', model: 'saved-model' } };
  });
});

describe('stored ThinkGraph prompt handoff', () => {
  it.each([false, true])('admits at most one automatic investigation only when enabled=%s after commitment', async enabled => {
    const authority = await mock.authority();
    mock.authority.mockResolvedValue({ ...authority, cards: [...authority.cards,
      { card: { id: 'card_knowgraph', enabled: true, runtime: { kind: 'hermes' } }, profile: 'knowgraph' }] });
    const rails = mock.rails.getMockImplementation()!;
    let committed = false;
    mock.rails.mockImplementation(async (route: string, init: any) => {
      if (route === '/knowgraph/research/prepare') {
        expect(committed).toBe(true);
        expect(JSON.parse(init.body).thinkId).toBe('first-tagged');
        return { enabled, requestId: 'stable-research-id', message: 'PROJECT_RESEARCH_REQUEST:stable-research-id' };
      }
      if (route.endsWith('/settle')) {
        committed = true;
        return { ok: true, status: 'completed', revisionChanged: true, intakeOperation: 'add', pairReference: 'pair-exact',
          thinks: [{ engraphisMemoryId: 'first-tagged', researchRequested: true }, { engraphisMemoryId: 'second-tagged', researchRequested: true }] };
      }
      return rails(route, init);
    });
    await submitSavedThinkPair(answer);
    const research = mock.request.mock.calls.filter(([method, params]) => method === 'bot_relay.deliver' && params.profile === 'knowgraph');
    expect(research).toHaveLength(enabled ? 1 : 0);
    if (enabled) expect(research[0][1]).toMatchObject({ id: 'stable-research-id', message: 'PROJECT_RESEARCH_REQUEST:stable-research-id' });
    expect(mock.notify).toHaveBeenCalledExactlyOnceWith('project');
  });
  it('submits the exact stored pair once to a fresh invocation of the saved profile', async () => {
    await submitSavedThinkPair(answer);
    const prepares = mock.rails.mock.calls.map(([, init]) => JSON.parse(init.body)).filter(body => body.operation === 'prepare_conversation_pair');
    expect(prepares).toHaveLength(1);
    expect(prepares[0].arguments).toEqual({ conversationId: 'conversation', userMessageIds: ['saved-user'], assistantMessageId: 'saved-answer' });
    const submissions = mock.request.mock.calls.filter(([method]) => method === 'bot_relay.deliver');
    expect(submissions).toHaveLength(1);
    expect(submissions[0][1]).toMatchObject({ profile: 'thinkgraph', session_id: 'fresh-think-session', id: 'pair-exact' });
    expect(submissions[0][1].message).toContain('Actual saved question.');
    expect(submissions[0][1].message).toContain('Actual saved answer.');
    expect(JSON.parse(submissions[0][1].message).projectMapContext.projectId).toBe('project');
    expect(mock.request).toHaveBeenCalledWith('session.resume', { title: 'Bot Chat' });
    const settlement = mock.rails.mock.calls.find(([route]) => route.endsWith('/settle'));
    expect(JSON.parse(settlement![1].body)).toMatchObject({ pairReference: 'pair-exact', structuredOutput: { facts: [] },
      cardRun: { cardId: 'card_thinkgraph', revisionId: 'saved-revision', runId: 'think-admission', profile: 'thinkgraph',
        resolvedProvider: 'saved-provider', resolvedModel: 'saved-model' } });
    expect(mock.request.mock.calls.some(([method]) => /steer|prompt.submit|session.create|session.history|profiles.configure/.test(method))).toBe(false);
    expect(mock.close).toHaveBeenCalledTimes(2);
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
    expect(mock.request.mock.calls.some(([method]) => method === 'bot_relay.deliver')).toBe(false);
  });

  it('refuses incomplete multi-input provenance rather than guessing a pair', async () => {
    mock.request.mockResolvedValue({ status: 'terminal', outcome: 'completed',
      result: { persisted_turn: { complete: false, user_row_ids: [10, 11], final_assistant_row_id: 20 } } });
    await expect(submitSavedThinkPair(answer)).rejects.toThrow('pair_identity_incomplete');
    expect(mock.request.mock.calls.some(([method]) => method === 'bot_relay.deliver')).toBe(false);
  });

  it('accepts exact terminal pair identities when whole-transcript prefix coverage is false', async () => {
    const request = mock.request.getMockImplementation()!;
    mock.request.mockImplementation(async (method: string, params: any) => {
      const receipt = await request(method, params);
      if (params.session_id === 'source-session') receipt.result.persisted_turn.complete = false;
      return receipt;
    });
    await submitSavedThinkPair(answer);
    expect(mock.request.mock.calls.filter(([method]) => method === 'bot_relay.deliver')).toHaveLength(1);
  });

  it('does not invoke an absent saved ThinkGraph target', async () => {
    mock.authority.mockResolvedValue({ cards: [], deck: { edges: [] } });
    await submitSavedThinkPair(answer);
    expect(mock.loads).not.toHaveBeenCalled();
  });
});
