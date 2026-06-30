// Read-only ThinkGraph route for the Agent Builder.
//  - /graph-view : the canonical word-first projection of the entity-first :ThinkNode / :THINK_EDGE
//                  model (the ONE store Harness writes via thinkgraph.apply_delta). class -> node type,
//                  typed directional predicate -> edge type. No SLM, no SlmGraphRecord blob, no raw
//                  container view. No writes happen here.
import { Router } from 'express';
import { getThinkGraphSlice } from '../services/thinkgraph/thinkGraphDelta';

const router = Router();

/**
 * GET /api/thinkgraph/graph-view — canonical word-first ThinkGraph projection.
 * Reads the entity-first :ThinkNode / :THINK_EDGE model (written ONLY through
 * thinkgraph.apply_delta) and projects it to the source-neutral graph-view contract the
 * canvas consumes: node.type = the reasoning class, edge.type/label = the typed directional
 * predicate. A read failure is reported honestly as unavailable + blocker — never collapsed
 * into an empty graph (NO fallback).
 */
router.get('/graph-view', async (req, res) => {
  const projectId = String(req.query.projectId || '').trim();
  const limitRaw = Number(req.query.limit);
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 300, 1), 1000);

  if (!projectId) {
    res.json({ ok: true, source: 'thinkgraph-db', projectId: '', nodes: [], edges: [], counts: { nodes: 0, edges: 0, records: 0 }, reason: 'no_project_id' });
    return;
  }

  try {
    const slice = await getThinkGraphSlice({ projectId, limit });
    const nodes = slice.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      type: n.class,
      sourceRef: n.turnId || undefined,
      confidence: n.confidence ?? undefined,
    }));
    const edges = slice.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.predicate,
      type: e.predicate,
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
