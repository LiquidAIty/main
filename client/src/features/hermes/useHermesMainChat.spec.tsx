// @vitest-environment jsdom
// Entity: Main Chat
// Relationship: Verifies native Bot Chat request/event mapping and Hermes-history author projection against a mocked generated Gateway client.

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const host = vi.hoisted(() => ({
  handlers: new Map<string, (event: any) => void>(),
  stateHandlers: new Set<(state: string) => void>(),
  requestHandler: null as null | ((request: any) => boolean | void),
  request: vi.fn(),
}));

vi.mock('./hermesHost', () => ({
  hermesGateway: async () => ({
    on: (name: string, handler: (event: any) => void) => {
      host.handlers.set(name, handler);
      return () => host.handlers.delete(name);
    },
    onRequest: (handler: (request: any) => boolean | void) => {
      host.requestHandler = handler;
      return () => { if (host.requestHandler === handler) host.requestHandler = null; };
    },
    onState: (handler: (state: string) => void) => {
      host.stateHandlers.add(handler);
      handler('open');
      return () => host.stateHandlers.delete(handler);
    },
    request: host.request,
  }),
}));

import useHermesMainChat, { HERMES_MAIN_SESSION_TITLE } from './useHermesMainChat';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('Hermes Main chat binding', () => {
  beforeEach(() => {
    host.handlers.clear();
    host.stateHandlers.clear();
    host.requestHandler = null;
    host.request.mockReset();
  });

  it('creates the native Bot Chat and sends literal input through prompt.submit', async () => {
    host.request.mockImplementation(async (method: string, params: Record<string, unknown>) => {
      if (method === 'session.list') return { sessions: [] };
      if (method === 'session.create') return { session_id: 'main-session', messages: [] };
      if (method === 'prompt.submit') return { accepted: true };
      throw new Error(`Unexpected method ${method}: ${JSON.stringify(params)}`);
    });

    const { result } = renderHook(() => useHermesMainChat('trading-project'));
    await waitFor(() => expect(result.current.historyLoading).toBe(false));

    expect(host.request).toHaveBeenCalledWith('session.list', expect.objectContaining({
      profile: 'main',
      title: HERMES_MAIN_SESSION_TITLE,
    }));
    expect(host.request).toHaveBeenCalledWith('session.create', expect.objectContaining({
      profile: 'main',
      title: HERMES_MAIN_SESSION_TITLE,
      request_id: expect.stringMatching(UUID_V4),
      source: 'gui',
      hidden: true,
      follow_profile_config: true,
    }));

    await act(async () => {
      expect(await result.current.send('  @KnowGraph exact text  ')).toBe(true);
    });
    expect(host.request).toHaveBeenCalledWith('prompt.submit', expect.objectContaining({
      session_id: 'main-session',
      profile: 'main',
      submission_id: expect.stringMatching(UUID_V4),
      text: '  @KnowGraph exact text  ',
    }));
  });

  it('resumes the same Bot Chat before Send after a Gateway reconnect', async () => {
    host.request.mockImplementation(async (method: string) => {
      if (method === 'session.list') return { sessions: [] };
      if (method === 'session.create') return { session_id: 'main-session', messages: [] };
      if (method === 'session.resume') {
        return { session_id: 'main-session', messages: [], running: false };
      }
      if (method === 'prompt.submit') return { accepted: true };
      throw new Error(`Unexpected method ${method}`);
    });

    const { result } = renderHook(() => useHermesMainChat('trading-project'));
    await waitFor(() => expect(result.current.historyLoading).toBe(false));

    act(() => {
      for (const handler of host.stateHandlers) handler('closed');
      for (const handler of host.stateHandlers) handler('open');
    });
    await waitFor(() => expect(host.request).toHaveBeenCalledWith('session.resume', {
      session_id: 'main-session',
      profile: 'main',
      source: 'gui',
    }));

    await act(async () => {
      expect(await result.current.send('literal after reconnect')).toBe(true);
    });
    const methods = host.request.mock.calls.map(([method]) => method);
    expect(methods.lastIndexOf('session.resume')).toBeLessThan(
      methods.lastIndexOf('prompt.submit'),
    );
  });

  it('gives a voice transcript its own Hermes submission identity', async () => {
    host.request.mockImplementation(async (method: string) => {
      if (method === 'session.list') return { sessions: [] };
      if (method === 'session.create') return { session_id: 'main-session', messages: [] };
      if (method === 'voice.record') return { status: 'recording' };
      if (method === 'prompt.submit') return { accepted: true };
      throw new Error(`Unexpected method ${method}`);
    });

    const { result } = renderHook(() => useHermesMainChat('trading-project'));
    await waitFor(() => expect(result.current.historyLoading).toBe(false));

    await act(async () => {
      expect(await result.current.startVoice('typed draft', { images: [] })).toBe(true);
    });
    act(() => host.handlers.get('voice.transcript')?.({
      type: 'voice.transcript',
      session_id: 'main-session',
      payload: { text: 'spoken words' },
    }));

    await waitFor(() => expect(host.request).toHaveBeenCalledWith(
      'prompt.submit',
      expect.objectContaining({
        session_id: 'main-session',
        profile: 'main',
        submission_id: expect.stringMatching(UUID_V4),
        text: 'typed draft\nspoken words',
        voice_turn: true,
      }),
    ));
  });

  it('resumes Hermes history and retains the author Hermes reports', async () => {
    host.request.mockImplementation(async (method: string) => {
      if (method === 'session.list') {
        return { sessions: [{ id: 'stored-main', resolved_id: 'resolved-main' }] };
      }
      if (method === 'session.resume') {
        return {
          session_id: 'main-session',
          messages: [{
            role: 'user',
            text: 'Message from 🤖 KnowGraph (@knowgraph): KnowGraph result',
            display_kind: 'internal_notification',
          }],
          running: false,
        };
      }
      if (method === 'session.history') {
        return {
          count: 2,
          messages: [{
            role: 'user',
            text: 'Message from 🤖 KnowGraph (@knowgraph): KnowGraph result',
            display_kind: 'internal_notification',
          }, {
            role: 'user',
            text: 'Message from 🤖 KnowGraph (@knowgraph): Later reply',
            display_kind: 'internal_notification',
          }],
        };
      }
      throw new Error(`Unexpected method ${method}`);
    });

    const { result } = renderHook(() => useHermesMainChat('trading-project'));
    await waitFor(() => expect(result.current.historyLoading).toBe(false));
    expect(host.request).toHaveBeenCalledWith('session.resume', {
      session_id: 'resolved-main',
      profile: 'main',
      source: 'gui',
    });
    expect(result.current.messages).toEqual([expect.objectContaining({
      role: 'assistant',
      speaker: 'KnowGraph',
      text: 'KnowGraph result',
    })]);

    act(() => host.handlers.get('message.complete')?.({
      type: 'message.complete',
      session_id: 'main-session',
      payload: { text: 'Later reply', status: 'complete' },
    }));
    await waitFor(() => expect(result.current.messages.at(-1)).toEqual(expect.objectContaining({
      speaker: 'KnowGraph',
      text: 'Later reply',
    })));
  });

  it('does not render process telemetry, tool receipts, or delivery hashes as chat', async () => {
    host.request.mockImplementation(async (method: string) => {
      if (method === 'session.list') {
        return { sessions: [{ id: 'stored-main', resolved_id: 'resolved-main' }] };
      }
      if (method === 'session.resume') {
        return {
          session_id: 'main-session',
          messages: [{
            role: 'assistant',
            text: 'Background Process Finished: python.exe',
            display_kind: 'process_complete',
            display_metadata: { display_text: 'Background Process Finished: python.exe' },
          }, {
            role: 'tool',
            text: '{"status":"queued","delivery_id":"abc123"}',
          }, {
            role: 'user',
            text: 'Do the research.',
          }, {
            role: 'assistant',
            text: 'I will check.',
          }],
          running: false,
        };
      }
      if (method === 'session.history') {
        return { count: 1, messages: [{ role: 'assistant', text: 'I will check.' }] };
      }
      throw new Error(`Unexpected method ${method}`);
    });

    const { result } = renderHook(() => useHermesMainChat('trading-project'));
    await waitFor(() => expect(result.current.historyLoading).toBe(false));
    expect(result.current.messages.map((message) => message.text)).toEqual([
      'Do the research.',
      'I will check.',
    ]);

    act(() => {
      host.handlers.get('message.start')?.({
        type: 'message.start', session_id: 'main-session',
        payload: { display_kind: 'process_complete', turn_id: 'process-one' },
      });
      host.handlers.get('message.delta')?.({
        type: 'message.delta', session_id: 'main-session',
        payload: { text: 'Background Process Finished', turn_id: 'process-one', segment: 0, offset: 0 },
      });
      host.handlers.get('message.complete')?.({
        type: 'message.complete', session_id: 'main-session',
        payload: { text: 'Background Process Finished', status: 'complete' },
      });
    });
    await waitFor(() => expect(result.current.messages.map((message) => message.text))
      .toEqual(['I will check.']));
  });

  it('answers a Hermes approval request on the same generated request channel', async () => {
    host.request.mockImplementation(async (method: string) => {
      if (method === 'session.list') return { sessions: [] };
      if (method === 'session.create') return { session_id: 'main-session', messages: [] };
      throw new Error(`Unexpected method ${method}`);
    });
    const respond = vi.fn();
    const { result } = renderHook(() => useHermesMainChat('trading-project'));
    await waitFor(() => expect(result.current.historyLoading).toBe(false));

    act(() => {
      expect(host.requestHandler?.({
        id: 'approval-1',
        method: 'approval',
        params: {
          session_id: 'main-session',
          command: 'python card.py',
          choices: ['once', 'deny'],
        },
        respond,
        fail: vi.fn(),
      })).toBe(true);
    });
    expect(result.current.pendingRequest).toEqual(expect.objectContaining({
      id: 'approval-1', kind: 'approval', command: 'python card.py',
    }));
    act(() => { expect(result.current.answerApproval('approval-1', 'once')).toBe(true); });
    expect(respond).toHaveBeenCalledWith({ choice: 'once' });
    expect(result.current.pendingRequest).toBeNull();
  });

  it('rejects sessionless events and interactive requests', async () => {
    host.request.mockImplementation(async (method: string) => {
      if (method === 'session.list') return { sessions: [] };
      if (method === 'session.create') return { session_id: 'main-session', messages: [] };
      throw new Error(`Unexpected method ${method}`);
    });
    const respond = vi.fn();
    const { result } = renderHook(() => useHermesMainChat('trading-project'));
    await waitFor(() => expect(result.current.historyLoading).toBe(false));

    act(() => host.handlers.get('message.complete')?.({
      type: 'message.complete',
      payload: { text: 'foreign', status: 'complete' },
    }));
    expect(result.current.messages).toEqual([]);
    expect(host.requestHandler?.({
      id: 'approval-foreign',
      method: 'approval',
      params: { choices: ['once', 'deny'] },
      respond,
      fail: vi.fn(),
    })).toBe(false);
    expect(result.current.pendingRequest).toBeNull();
  });

  it('drops replayed delta bytes by Hermes turn segment and offset', async () => {
    host.request.mockImplementation(async (method: string) => {
      if (method === 'session.list') return { sessions: [] };
      if (method === 'session.create') return { session_id: 'main-session', messages: [] };
      throw new Error(`Unexpected method ${method}`);
    });
    const { result } = renderHook(() => useHermesMainChat('trading-project'));
    await waitFor(() => expect(result.current.historyLoading).toBe(false));

    act(() => {
      host.handlers.get('message.start')?.({
        type: 'message.start', session_id: 'main-session', payload: {},
      });
      host.handlers.get('message.delta')?.({
        type: 'message.delta', session_id: 'main-session',
        payload: { text: 'Hello', turn_id: 'turn-1', segment: 0, offset: 0 },
      });
      host.handlers.get('message.delta')?.({
        type: 'message.delta', session_id: 'main-session',
        payload: { text: 'Hello', turn_id: 'turn-1', segment: 0, offset: 0 },
      });
      host.handlers.get('message.delta')?.({
        type: 'message.delta', session_id: 'main-session',
        payload: { text: ' world', turn_id: 'turn-1', segment: 0, offset: 5 },
      });
    });
    expect(result.current.messages.at(-1)?.text).toBe('Hello world');
  });
});
