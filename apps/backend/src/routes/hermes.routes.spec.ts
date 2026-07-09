// Hermes review + activity + postflight seams (SPEC: Hermes postflight/manual
// review). Mocks ONLY the rails transports (requestHermesReview /
// requestHermesRunReview), the graph writer, the deck read, and the same heavy
// boundaries coder.routes.spec mocks. Proves: the manual review route relays
// the real Python review and records its real activity; a rails failure is an
// honest 502 plus a blocked activity entry (never a fabricated review); the
// activity route serves exactly what real reviews produced; postflight writes
// run memory ONLY through the canonical patch writer under server-minted
// Hermes-card authority, and blocks honestly without a conversation identity.
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hermesTransportMocks = vi.hoisted(() => ({
  requestHermesReview: vi.fn(),
  requestHermesRunReview: vi.fn(),
}));

const thinkGraphStoreMocks = vi.hoisted(() => ({
  applyThinkGraphPatch: vi.fn(),
  readThinkGraphScope: vi.fn(async () => ({ nodes: [], edges: [] })),
}));

const deckStoreMocks = vi.hoisted(() => ({
  getDeckDocument: vi.fn(async () => ({
    deck: {
      nodes: [
        { id: 'card_magentic', runtimeType: 'magentic_one' },
        { id: 'card_hermes_steward', runtimeBinding: 'hermes_steward', runtimeType: 'assistant_agent' },
      ],
      edges: [],
    },
    latestRun: null,
    runs: [],
    meta: { deckRevision: null, deckSavedAt: null },
  })),
}));

vi.mock('../services/autogen/autogenOrchestratorClient', () => ({
  requestHermesReview: hermesTransportMocks.requestHermesReview,
  requestHermesRunReview: hermesTransportMocks.requestHermesRunReview,
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

import { clearHermesActivityForTest } from '../coder/hermes/hermesActivity';

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

const REVIEW_FIXTURE = {
  verdict: 'blocked',
  activityEvents: [
    {
      id: 'hermes:packet_x:1',
      timestamp: '2026-07-08T00:00:00+00:00',
      type: 'review_started',
      summary: 'Reviewing CoderReport for run packet_x',
      runId: 'packet_x',
    },
    {
      id: 'hermes:packet_x:2',
      timestamp: '2026-07-08T00:00:00+00:00',
      type: 'review_complete',
      summary: 'Run packet_x: verdict=blocked — 0/0 proven',
      runId: 'packet_x',
    },
    // Malformed row: must be DROPPED, never repaired into fake activity.
    { id: '', type: 'review_complete', summary: 'nameless' },
  ],
};

const RUN_REVIEW_FIXTURE = {
  verdict: 'blocked',
  recommendation: 'Run blocked: rails unreachable. Record the blocker before retrying the same run.',
  activityEvents: [
    {
      id: 'hermes:mag_one_run_1:1',
      timestamp: '2026-07-09T00:00:00+00:00',
      type: 'review_started',
      summary: 'Reviewing run result for mag_one_run_1',
      runId: 'mag_one_run_1',
    },
    {
      id: 'hermes:mag_one_run_1:2',
      timestamp: '2026-07-09T00:00:00+00:00',
      type: 'review_complete',
      summary: 'Run mag_one_run_1: verdict=blocked',
      runId: 'mag_one_run_1',
    },
  ],
};

const RUN_PATCH_FIXTURE = {
  resources: [
    { id: 'run:mag_one_run_1', label: 'RunRecord mag_one_run_1', kind: 'RunRecord', properties: {} },
  ],
  statements: [],
};

describe('Hermes review + activity routes', () => {
  beforeEach(() => {
    clearHermesActivityForTest();
    hermesTransportMocks.requestHermesReview.mockReset();
    hermesTransportMocks.requestHermesRunReview.mockReset();
    thinkGraphStoreMocks.applyThinkGraphPatch.mockReset();
    deckStoreMocks.getDeckDocument.mockClear();
  });

  it('relays the real Python review and records its real activity entries', async () => {
    hermesTransportMocks.requestHermesReview.mockResolvedValue({
      ok: true,
      review: REVIEW_FIXTURE,
      thinkgraphPatch: { resources: [], statements: [] },
    });
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/hermes/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coderReport: { coderPacketId: 'packet_x', status: 'blocked' },
          featureId: 'feature.x',
        }),
      });
      const payload = await response.json();
      expect(response.status).toBe(200);
      expect(payload.ok).toBe(true);
      expect(payload.review.verdict).toBe('blocked');
      expect(payload.thinkgraphPatch).toEqual({ resources: [], statements: [] });
      // The transport received the review input untouched.
      expect(hermesTransportMocks.requestHermesReview).toHaveBeenCalledWith(
        expect.objectContaining({
          coderReport: { coderPacketId: 'packet_x', status: 'blocked' },
          featureId: 'feature.x',
        }),
      );

      const activity = await fetch(`${baseUrl}/hermes/activity`).then((r) => r.json());
      expect(activity.ok).toBe(true);
      // Exactly the two well-formed real entries; the malformed row is dropped.
      expect(activity.activity.map((entry: { id: string }) => entry.id)).toEqual([
        'hermes:packet_x:1',
        'hermes:packet_x:2',
      ]);
    } finally {
      await closeServer(server);
    }
  });

  it('reports a rails failure as an honest 502 plus a blocked activity entry', async () => {
    hermesTransportMocks.requestHermesReview.mockResolvedValue({
      ok: false,
      error: 'PYTHON_AUTOGEN_RAILS_UNAVAILABLE',
    });
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/hermes/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coderReport: { coderPacketId: 'packet_y', status: 'succeeded' },
          featureId: 'feature.y',
        }),
      });
      const payload = await response.json();
      expect(response.status).toBe(502);
      expect(payload).toEqual({ ok: false, error: 'PYTHON_AUTOGEN_RAILS_UNAVAILABLE' });

      const activity = await fetch(`${baseUrl}/hermes/activity`).then((r) => r.json());
      expect(activity.activity).toHaveLength(1);
      expect(activity.activity[0].type).toBe('blocked');
      expect(activity.activity[0].summary).toBe(
        'Hermes review blocked: PYTHON_AUTOGEN_RAILS_UNAVAILABLE',
      );
      expect(activity.activity[0].runId).toBe('packet_y');
    } finally {
      await closeServer(server);
    }
  });

  it('rejects a review request without a coderReport object', async () => {
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/hermes/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ featureId: 'feature.x' }),
      });
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe('coderReport_object_required');
      expect(hermesTransportMocks.requestHermesReview).not.toHaveBeenCalled();
    } finally {
      await closeServer(server);
    }
  });

  it('starts with an honest empty activity feed', async () => {
    const { server, baseUrl } = await createApiServer();
    try {
      const activity = await fetch(`${baseUrl}/hermes/activity`).then((r) => r.json());
      expect(activity).toEqual({ ok: true, activity: [] });
    } finally {
      await closeServer(server);
    }
  });

  describe('/hermes/postflight', () => {
    it('reviews a real run result and writes run memory under Hermes-card authority', async () => {
      hermesTransportMocks.requestHermesRunReview.mockResolvedValue({
        ok: true,
        review: RUN_REVIEW_FIXTURE,
        thinkgraphPatch: RUN_PATCH_FIXTURE,
      });
      thinkGraphStoreMocks.applyThinkGraphPatch.mockResolvedValue({
        ok: true,
        status: 'applied',
        correlationId: 'hermes_post_mag_one_run_1',
        storedResourceIds: ['run:mag_one_run_1'],
        storedStatementIds: [],
        relationCount: 0,
      });
      const { server, baseUrl } = await createApiServer();
      try {
        const response = await fetch(`${baseUrl}/hermes/postflight`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: 'project-1',
            conversationId: 'main',
            runId: 'mag_one_run_1',
            status: 'failed',
            failure: 'rails unreachable',
          }),
        });
        const payload = await response.json();
        expect(response.status).toBe(200);
        expect(payload.ok).toBe(true);
        expect(payload.report.runId).toBe('mag_one_run_1');
        expect(payload.report.verdict).toBe('blocked');
        expect(payload.report.thinkGraphWrite).toMatchObject({
          status: 'applied',
          correlationId: 'hermes_post_mag_one_run_1',
          storedResourceIds: ['run:mag_one_run_1'],
        });
        // The write went through the ONE canonical writer with server-minted
        // Hermes-card authority — never model-supplied.
        expect(thinkGraphStoreMocks.applyThinkGraphPatch).toHaveBeenCalledWith(
          {
            projectId: 'project-1',
            cardId: 'card_hermes_steward',
            correlationId: 'hermes_post_mag_one_run_1',
            conversationId: 'main',
          },
          RUN_PATCH_FIXTURE,
        );
        // Real review activity + the write-complete entry landed in the feed.
        const activity = await fetch(`${baseUrl}/hermes/activity`).then((r) => r.json());
        const types = activity.activity.map((entry: { type: string }) => entry.type);
        expect(types).toContain('review_started');
        expect(types).toContain('review_complete');
        expect(types).toContain('thinkgraph_write_complete');
      } finally {
        await closeServer(server);
      }
    });

    it('blocks the memory write honestly when no conversation identity exists', async () => {
      hermesTransportMocks.requestHermesRunReview.mockResolvedValue({
        ok: true,
        review: RUN_REVIEW_FIXTURE,
        thinkgraphPatch: RUN_PATCH_FIXTURE,
      });
      const { server, baseUrl } = await createApiServer();
      try {
        const response = await fetch(`${baseUrl}/hermes/postflight`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: 'project-1', runId: 'mag_one_run_1', status: 'failed' }),
        });
        const payload = await response.json();
        expect(response.status).toBe(200);
        expect(payload.report.thinkGraphWrite.status).toBe('blocked');
        expect(payload.report.thinkGraphWrite.reason).toContain('conversationId_missing');
        expect(thinkGraphStoreMocks.applyThinkGraphPatch).not.toHaveBeenCalled();
      } finally {
        await closeServer(server);
      }
    });

    it('rejects a postflight without a runId — nothing reviewed, nothing written', async () => {
      const { server, baseUrl } = await createApiServer();
      try {
        const response = await fetch(`${baseUrl}/hermes/postflight`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        expect(response.status).toBe(400);
        expect((await response.json()).error).toBe('runId_required');
        expect(hermesTransportMocks.requestHermesRunReview).not.toHaveBeenCalled();
        expect(thinkGraphStoreMocks.applyThinkGraphPatch).not.toHaveBeenCalled();
      } finally {
        await closeServer(server);
      }
    });

    it('reports a rails failure as an honest 502 plus a blocked activity entry', async () => {
      hermesTransportMocks.requestHermesRunReview.mockResolvedValue({
        ok: false,
        error: 'PYTHON_AUTOGEN_RAILS_UNAVAILABLE',
      });
      const { server, baseUrl } = await createApiServer();
      try {
        const response = await fetch(`${baseUrl}/hermes/postflight`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: 'project-1', conversationId: 'main', runId: 'run_z', status: 'completed' }),
        });
        expect(response.status).toBe(502);
        const activity = await fetch(`${baseUrl}/hermes/activity`).then((r) => r.json());
        expect(activity.activity).toHaveLength(1);
        expect(activity.activity[0].type).toBe('blocked');
        expect(activity.activity[0].runId).toBe('run_z');
        expect(thinkGraphStoreMocks.applyThinkGraphPatch).not.toHaveBeenCalled();
      } finally {
        await closeServer(server);
      }
    });
  });
});
