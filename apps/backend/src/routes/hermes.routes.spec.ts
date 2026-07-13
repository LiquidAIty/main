// Main Chat ThinkGraph authority route (mcp-bridge/thinkgraph_submit_update):
// the server mints the saved Main Chat card's authority for one compact
// ThinkGraph update. (The fragmented Hermes review/activity routes were removed;
// completed-job review is now a single scaffold + one MCP tool.)
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const thinkGraphStoreMocks = vi.hoisted(() => ({
  applyThinkGraphPatch: vi.fn(),
  readThinkGraphScope: vi.fn(async () => ({ nodes: [], edges: [] })),
}));

const deckStoreMocks = vi.hoisted(() => ({
  getDeckDocument: vi.fn(async () => ({
    deck: { nodes: [{ id: 'card_main_chat', runtimeBinding: 'main_chat' }], edges: [] },
    meta: { deckRevision: null, deckSavedAt: null },
  })),
}));

vi.mock('../services/autogen/autogenOrchestratorClient', () => ({
  orchestrateWithAutoGen: vi.fn(),
  runSingleCardWithAutoGen: vi.fn(),
  fetchToolManifest: vi.fn(),
  fetchThinkGraphProjection: vi.fn(),
}));

vi.mock('../services/thinkgraph/thinkGraphStore', () => ({
  applyThinkGraphPatch: thinkGraphStoreMocks.applyThinkGraphPatch,
  readThinkGraphScope: thinkGraphStoreMocks.readThinkGraphScope,
}));

vi.mock('../decks/store', () => ({
  BUILDER_DECK_ID: 'deck_builder',
  getDeckDocument: deckStoreMocks.getDeckDocument,
}));

vi.mock('../cards/runtime', () => ({
  runConfiguredCard: vi.fn(),
}));

vi.mock('../conversations/store', () => ({
  appendMessage: vi.fn(),
  getConversationMessages: vi.fn(async () => []),
}));

vi.mock('../coder/openclaude/session/grpcChatClient', () => ({
  deriveSessionId: (projectId: string, conversationId: string) => `${projectId}:${conversationId}`,
  startGrpcTurn: vi.fn(),
}));

vi.mock('../services/mcp/pythonAgentMcpClient', () => ({
  callPythonAgentMcpTool: vi.fn(async () => ({ ok: true })),
}));

async function createApiServer(): Promise<{ server: Server; baseUrl: string }> {
  const express = (await import('express')).default;
  const router = (await import('./coder.routes')).default;
  const app = express();
  app.use(express.json());
  app.use('/api/coder', router);
  const server = await new Promise<Server>((resolve) => {
    const nextServer = app.listen(0, '127.0.0.1', () => resolve(nextServer));
  });
  const address = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${address.port}/api/coder` };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

describe('Main Chat ThinkGraph authority route', () => {
  beforeEach(() => {
    thinkGraphStoreMocks.applyThinkGraphPatch.mockReset();
    deckStoreMocks.getDeckDocument.mockClear();
  });

  it('mints a Main Chat authority for one compact ThinkGraph update', async () => {
    thinkGraphStoreMocks.applyThinkGraphPatch.mockResolvedValue({
      ok: true,
      status: 'applied',
      correlationId: 'main_update_test',
      storedResourceIds: ['decision:main-writes-thinkgraph'],
      storedStatementIds: [],
      relationCount: 0,
    });
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/mcp-bridge/thinkgraph_submit_update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'project-1',
          conversationId: 'main',
          resources: [{ id: 'decision:main-writes-thinkgraph', label: 'Main owns ThinkGraph updates' }],
        }),
      });
      expect(response.status).toBe(200);
      expect(thinkGraphStoreMocks.applyThinkGraphPatch).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: 'project-1', cardId: 'card_main_chat', conversationId: 'main' }),
        expect.objectContaining({ resources: [{ id: 'decision:main-writes-thinkgraph', label: 'Main owns ThinkGraph updates' }] }),
      );
    } finally {
      await closeServer(server);
    }
  });
});
