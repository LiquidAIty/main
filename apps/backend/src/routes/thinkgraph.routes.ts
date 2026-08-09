import { Router } from 'express';

import {
  fetchThinkGraphProjection,
  projectLiveThinkGraph,
  type LiveThinkGraphProjectionRequest,
  type LiveThinkGraphSource,
} from '../services/autogen/autogenOrchestratorClient';

const router = Router();

// Transport only: Python/Engraphis owns the projection and its graph data.
router.get('/projection', async (req, res) => {
  const projectId = String(req.query.projectId || '').trim();
  if (!projectId) return res.status(400).json({ error: 'projectId required' });
  const limit = Number(req.query.limit);
  try {
    return res.json(await fetchThinkGraphProjection(
      projectId,
      Number.isFinite(limit) ? limit : undefined,
    ));
  } catch (error: any) {
    return res.status(502).json({ error: String(error?.message || 'thinkgraph_projection_unavailable') });
  }
});

const LIVE_SOURCES = new Set<LiveThinkGraphSource>([
  'user',
  'assistant',
  'reasoning',
  'tool',
]);

// Transport only: this endpoint never reads or writes the durable Engraphis store.
router.post('/live-projection', async (req, res) => {
  const body = req.body as Partial<LiveThinkGraphProjectionRequest> | undefined;
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'live projection payload required' });
  }
  const projectId = String(body.projectId || '').trim();
  const conversationId = String(body.conversationId || '').trim();
  const runId = String(body.runId || '').trim();
  const observedAt = String(body.observedAt || '').trim();
  if (!projectId || !conversationId || !runId || !observedAt) {
    return res.status(400).json({
      error: 'projectId, conversationId, runId, and observedAt required',
    });
  }
  if (body.state !== 'active' && body.state !== 'settled') {
    return res.status(400).json({ error: 'state must be active or settled' });
  }
  if (!Array.isArray(body.streams) || body.streams.some((stream) => (
    !stream
    || typeof stream !== 'object'
    || !LIVE_SOURCES.has(stream.source)
    || !String(stream.sourceId || '').trim()
    || typeof stream.text !== 'string'
  ))) {
    return res.status(400).json({ error: 'streams invalid' });
  }
  const payload: LiveThinkGraphProjectionRequest = {
    projectId,
    conversationId,
    runId,
    observedAt,
    state: body.state,
    streams: body.streams.map((stream) => ({
      source: stream.source,
      sourceId: String(stream.sourceId).trim(),
      text: stream.text,
    })),
    ...(Number.isFinite(body.maxNodes) ? { maxNodes: Number(body.maxNodes) } : {}),
    ...(Number.isFinite(body.maxEdges) ? { maxEdges: Number(body.maxEdges) } : {}),
  };
  try {
    return res.json(await projectLiveThinkGraph(payload));
  } catch (error: any) {
    return res.status(502).json({
      error: String(error?.message || 'thinkgraph_live_projection_unavailable'),
    });
  }
});

export default router;
