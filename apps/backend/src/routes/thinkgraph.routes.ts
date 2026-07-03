// Read-only ThinkGraph route for the Agent Builder card.
//  - /graph-view : direct bounded projection of stored ThinkGraph records (Resources +
//                  derived CO_OCCURRED_WITH with weight = observation_count + reified
//                  Statements). ThinkGraph is written ONLY by the Harness calling the
//                  ThinkGraph agent card (writer not yet wired — card is honestly empty
//                  until then). No writes here; read failures reported honestly.
import { Router } from 'express';
import { getThinkGraphView } from '../services/thinkgraph/thinkGraphStore';
import { fetchThinkGraphProjection } from '../services/autogen/autogenOrchestratorClient';

const router = Router();

// ── /projection : narrow transport for the Python-owned ThinkGraphProjectionV1 ──
// Validates the project reference, calls the Python graph authority, and returns
// its response UNCHANGED. No AGE query, no node/edge shaping, no kind/predicate
// mapping, no labels, no provenance construction, no graph policy lives here.
router.get('/projection', async (req, res) => {
  const projectId = String(req.query.projectId || '').trim();
  if (!projectId) {
    return res.status(400).json({ error: 'projectId required' });
  }
  const limitRaw = Number(req.query.limit);
  try {
    const projection = await fetchThinkGraphProjection(
      projectId,
      Number.isFinite(limitRaw) ? limitRaw : undefined,
    );
    return res.json(projection);
  } catch (error: any) {
    return res
      .status(502)
      .json({ error: String(error?.message || 'thinkgraph_projection_unavailable') });
  }
});

router.get('/graph-view', async (req, res) => {
  const projectId = String(req.query.projectId || '').trim();
  const limitRaw = Number(req.query.limit);
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 500, 1), 2000);

  if (!projectId) {
    res.json({ ok: true, source: 'thinkgraph-db', projectId: '', nodes: [], edges: [], counts: { nodes: 0, edges: 0, records: 0 }, reason: 'no_project_id' });
    return;
  }

  try {
    const slice = await getThinkGraphView({ projectId, limit });
    const nodes = slice.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      type: n.kind, // 'resource' | 'statement' — storage mechanics, not a taxonomy
      sourceRef: n.turnId || undefined,
      review: n.review || undefined,
      degree: n.degree ?? 0,
    }));
    const edges = slice.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.predicate,
      type: e.predicate,
      weight: e.weight ?? undefined,
    }));
    const isEmpty = nodes.length === 0 && edges.length === 0;
    res.json({
      ok: true,
      source: 'thinkgraph-db',
      projectId,
      nodes,
      edges,
      counts: { nodes: nodes.length, edges: edges.length, records: nodes.length },
      reason: isEmpty ? 'no_thinkgraph_records_for_project' : undefined,
    });
  } catch (error: any) {
    res.json({
      ok: false,
      source: 'unavailable',
      projectId,
      nodes: [],
      edges: [],
      counts: { nodes: 0, edges: 0, records: 0 },
      reason: 'thinkgraph_unavailable',
      blocker: String(error?.message || 'thinkgraph graph-view read failed'),
    });
  }
});

export default router;
