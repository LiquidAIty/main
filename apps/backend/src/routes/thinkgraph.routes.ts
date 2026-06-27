// Read-only ThinkGraph routes for the Agent Builder.
//  - /graph-view : the existing :SlmGraphRecord projection (kept, unchanged).
//  - /graph      : a FAITHFUL read of the actual Apache AGE graph `thinkgraph_liq` — real stored node
//                  labels, real stored node properties, real stored edge types + properties, exactly
//                  as stored. No inference, no renaming, no projection. graph_liq is corrupt — never read.
// No writes happen here.
import { Router } from 'express';
import { readRecentThinkGraphSemanticRecords } from '../services/thinkgraph/thinkgraphMemory';
import { buildThinkGraphGraphViewResponse } from '../slmGraph/thinkGraphRecordToGraphView';
import { runCypherOnGraph } from '../services/graphService';

const router = Router();

const THINKGRAPH_GRAPH_NAME = 'thinkgraph_liq';

function parseRow(raw: unknown): Record<string, any> | null {
  const v = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : raw;
  return v && typeof v === 'object' ? (v as Record<string, any>) : null;
}

/**
 * GET /api/thinkgraph/graph — faithful, project-scoped, READ-ONLY view of Apache AGE `thinkgraph_liq`.
 * Returns nodes (real label + real stored properties) and edges (real type + real stored properties).
 */
router.get('/graph', async (req, res) => {
  const projectId = String(req.query.projectId || req.query.project_id || '').trim();
  if (!projectId) {
    return res.status(400).json({ ok: false, source: 'thinkgraph_liq', nodes: [], edges: [], error: 'projectId is required' });
  }
  try {
    const nodeRows = await runCypherOnGraph(
      THINKGRAPH_GRAPH_NAME,
      `MATCH (n) WHERE n.project_id = $projectId
       RETURN { id: n.id, label: label(n), props: properties(n) } AS row
       LIMIT 1000`,
      { projectId },
    );
    const edgeRows = await runCypherOnGraph(
      THINKGRAPH_GRAPH_NAME,
      `MATCH (a)-[r]->(b) WHERE a.project_id = $projectId AND b.project_id = $projectId
       RETURN { from: a.id, to: b.id, type: type(r), props: properties(r) } AS row
       LIMIT 4000`,
      { projectId },
    );
    const nodes = nodeRows.map(parseRow).filter((r): r is Record<string, any> => Boolean(r?.id)).map((r) => ({
      id: String(r.id),
      label: String(r.label || 'Node'),            // the REAL stored AGE vertex label
      properties: (r.props && typeof r.props === 'object') ? r.props : {},  // the REAL stored properties
    }));
    const seen = new Set(nodes.map((n) => n.id));
    const edges = edgeRows.map(parseRow).filter((r): r is Record<string, any> => Boolean(r?.from && r?.to))
      .filter((r) => seen.has(String(r.from)) && seen.has(String(r.to)))
      .map((r, i) => ({
        id: `${r.from}|${r.type}|${r.to}|${i}`,
        from: String(r.from), to: String(r.to),
        type: String(r.type || 'RELATED_TO'),       // the REAL stored edge type
        properties: (r.props && typeof r.props === 'object') ? r.props : {},
      }));
    // Real label/type tallies (actual counts) for the raw visibility filters.
    const nodeLabelCounts: Record<string, number> = {};
    for (const n of nodes) nodeLabelCounts[n.label] = (nodeLabelCounts[n.label] || 0) + 1;
    const edgeTypeCounts: Record<string, number> = {};
    for (const e of edges) edgeTypeCounts[e.type] = (edgeTypeCounts[e.type] || 0) + 1;
    return res.json({ ok: true, source: 'thinkgraph_liq', projectId, nodes, edges, counts: { nodes: nodes.length, edges: edges.length, nodeLabels: nodeLabelCounts, edgeTypes: edgeTypeCounts } });
  } catch (error: any) {
    return res.json({ ok: false, source: 'thinkgraph_liq', nodes: [], edges: [], error: String(error?.message || 'thinkgraph_liq read failed') });
  }
});

router.get('/graph-view', async (req, res) => {
  const projectId = String(req.query.projectId || '').trim();
  const limitRaw = Number(req.query.limit);
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 25, 1), 50);

  if (!projectId) {
    res.json({ ok: true, source: 'thinkgraph-db', projectId: '', nodes: [], edges: [], counts: { nodes: 0, edges: 0, records: 0 }, reason: 'no_project_id' });
    return;
  }

  const result = await readRecentThinkGraphSemanticRecords({ projectId, limit });
  res.json(buildThinkGraphGraphViewResponse(projectId, result));
});

export default router;
