import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mcpMocks = vi.hoisted(() => ({
  callTool: vi.fn(async () => ({
    content: [{ type: 'text', text: JSON.stringify({ ok: true }) }],
  })),
  close: vi.fn(async () => undefined),
  connect: vi.fn(async () => undefined),
}));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class MockClient {
    callTool = mcpMocks.callTool;
    close = mcpMocks.close;
    connect = mcpMocks.connect;
  },
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: class MockStreamableHTTPClientTransport {},
}));

import {
  callPythonAgentMcpTool,
  callPythonAgentSystemTool,
  closePythonAgentMcpClient,
} from './pythonAgentMcpClient';

describe('Python Agent MCP request deadlines', () => {
  beforeEach(() => {
    process.env.LIQUIDAITY_INTERNAL_MCP_SECRET = '0123456789abcdef0123456789abcdef';
    process.env.LIQUIDAITY_INTERNAL_MCP_URL = 'http://127.0.0.1:8765/mcp';
    mcpMocks.callTool.mockClear();
    mcpMocks.close.mockClear();
    mcpMocks.connect.mockClear();
  });

  afterEach(async () => {
    await closePythonAgentMcpClient();
  });

  it('extends only private system-root execution beyond the SDK default', async () => {
    await callPythonAgentMcpTool('ordinary.tool', { value: 1 });
    expect(mcpMocks.callTool).toHaveBeenNthCalledWith(1, {
      name: 'ordinary.tool',
      arguments: { value: 1 },
    });

    await callPythonAgentSystemTool(
      {
        kind: 'system-root',
        projectId: 'project-1',
        deckId: 'deck-1',
        conversationId: 'conversation-1',
        parentRunId: 'run-1',
        callerCardId: 'card-main',
        callerRuntimeKind: 'hermes',
        callerRuntimeMode: 'main',
        grantedTools: ['card.run_assistant_agent'],
      },
      'card.run_assistant_agent',
      { cardId: 'card-1', input: 'bounded mission' },
    );
    expect(mcpMocks.callTool).toHaveBeenNthCalledWith(
      2,
      {
        name: 'card.run_assistant_agent',
        arguments: { cardId: 'card-1', input: 'bounded mission' },
      },
      undefined,
      { timeout: 310_000 },
    );
  });
});
