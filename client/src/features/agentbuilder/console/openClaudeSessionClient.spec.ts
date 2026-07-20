import { afterEach, describe, expect, it, vi } from 'vitest';

import { SessionStreamError, streamSession } from './openClaudeSessionClient';

function sseResponse(frames: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      frames.forEach((frame) => controller.enqueue(encoder.encode(frame)));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('streamSession', () => {
  it('forwards structured Agent progress without interpreting subagent identity', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      `event: tool_start\ndata: ${JSON.stringify({ toolName: 'Agent', toolUseId: 'search-agent-call', argsJson: JSON.stringify({ subagent_type: 'card_research_agent', prompt: 'Find sources.' }) })}\n\n`,
      `event: progress\ndata: ${JSON.stringify({ toolUseId: 'child-delta-1', parentToolUseId: 'search-agent-call', data: { type: 'agent_text_delta', agentId: 'agent-42', agentType: 'card_research_agent', text: 'First source.' } })}\n\n`,
      `event: tool_result\ndata: ${JSON.stringify({ toolName: 'Agent', toolUseId: 'search-agent-call', output: 'First source.', isError: false })}\n\n`,
      'event: done\ndata: {"fullText":"Main final."}\n\nevent: end\ndata: {}\n\n',
    ])));
    const onEvent = vi.fn();
    await expect(streamSession({
      projectId: 'project-1',
      conversationId: 'main',
      message: 'Find sources.',
      onEvent,
    })).resolves.toEqual({ finalText: 'Main final.' });
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'progress',
      parentToolUseId: 'search-agent-call',
      data: expect.objectContaining({ agentType: 'card_research_agent', text: 'First source.' }),
    }));
  });

  it('preserves UTF-8 prompt and response bytes when an em dash is split across stream chunks', async () => {
    const text = 'Harness — Search — café 漢字';
    const encoded = new TextEncoder().encode(
      `event: text\ndata: ${JSON.stringify({ text })}\n\nevent: done\ndata: ${JSON.stringify({ fullText: text })}\n\nevent: end\ndata: {}\n\n`,
    );
    const dashStart = encoded.findIndex((byte, index) => byte === 0xe2 && encoded[index + 1] === 0x80);
    const chunks = [encoded.slice(0, dashStart + 1), encoded.slice(dashStart + 1, dashStart + 2), encoded.slice(dashStart + 2)];
    const onEvent = vi.fn();
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          chunks.forEach((chunk) => controller.enqueue(chunk));
          controller.close();
        },
      });
      expect(JSON.parse(String(init?.body))).toMatchObject({ message: text });
      return new Response(stream, { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(streamSession({
      projectId: 'project-1',
      conversationId: 'main',
      message: text,
      onEvent,
    })).resolves.toEqual({ finalText: text });
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: 'text', text }));
  });

  it('rejects an SSE error frame with the route and correlation evidence', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      'event: error\ndata: {"code":"harness_turn_failed","message":"The chat run failed.","correlationId":"req_123","route":"/api/coder/openclaude/session/chat","status":502}\n\n',
      'event: end\ndata: {}\n\n',
    ])));

    await expect(streamSession({
      projectId: 'project-1',
      conversationId: 'main',
      message: 'hello',
      onEvent: vi.fn(),
    })).rejects.toMatchObject({
      name: 'SessionStreamError',
      code: 'harness_turn_failed',
      correlationId: 'req_123',
      route: '/api/coder/openclaude/session/chat',
      status: 502,
    } satisfies Partial<SessionStreamError>);
  });

  it('carries compact graph object identity without raw nodes, edges, or properties', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        projectId: 'project-1',
        conversationId: 'main',
        selectedGraphObjectRefs: [{
          authority: 'thinkgraph',
          canonicalId: 'run:42',
          selectedThrough: 'thinkgraph',
          displayLabel: 'Selected run',
        }],
      });
      expect(body.graphViews).toBeUndefined();
      expect(body.nodes).toBeUndefined();
      expect(body.edges).toBeUndefined();
      return sseResponse(['event: done\ndata: {"fullText":"done"}\n\nevent: end\ndata: {}\n\n']);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(streamSession({
      projectId: 'project-1',
      conversationId: 'main',
      message: 'Inspect it.',
      selectedGraphObjectRefs: [{ authority: 'thinkgraph', canonicalId: 'run:42', selectedThrough: 'thinkgraph', displayLabel: 'Selected run' }],
      onEvent: vi.fn(),
    })).resolves.toEqual({ finalText: 'done' });
  });

  it('rejects a transport stream that ends without the required end event', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      'event: text\ndata: {"text":"partial"}\n\n',
    ])));

    await expect(streamSession({
      projectId: 'project-1',
      conversationId: 'main',
      message: 'hello',
      onEvent: vi.fn(),
    })).rejects.toMatchObject({ code: 'session_stream_incomplete' });
  });

  it('accepts a completed stream even when it has no final text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      'event: done\ndata: {"fullText":""}\n\n',
      'event: end\ndata: {}\n\n',
    ])));

    await expect(streamSession({
      projectId: 'project-1',
      conversationId: 'main',
      message: 'hello',
      onEvent: vi.fn(),
    })).resolves.toEqual({ finalText: '' });
  });
});
