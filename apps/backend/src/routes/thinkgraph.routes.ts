// Read-only ThinkGraph graph-view route for the Agent Builder ThinkGraph tab. Surfaces the
// accepted :SlmGraphRecord graphPayloads (written by writeAcceptedMagOneGraphPayloadToThinkGraph
// -> recordThinkGraphSemanticRecord) for the SELECTED project, projected to canvas nodes/edges.
// Honest empty vs honest unavailable — a DB failure is never collapsed into an empty graph.
// No writes happen here.
import { Router } from 'express';
import { readRecentThinkGraphSemanticRecords } from '../services/thinkgraph/thinkgraphMemory';
import { buildThinkGraphGraphViewResponse } from '../slmGraph/thinkGraphRecordToGraphView';

const router = Router();

router.get('/graph-view', async (req, res) => {
  const projectId = String(req.query.projectId || '').trim();
  const limitRaw = Number(req.query.limit);
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 25, 1), 50);

  if (!projectId) {
    // Honest: no project selected. Not a DB failure, not faked data.
    res.json({
      ok: true,
      source: 'thinkgraph-db',
      projectId: '',
      nodes: [],
      edges: [],
      counts: { nodes: 0, edges: 0, records: 0 },
      reason: 'no_project_id',
    });
    return;
  }

  const result = await readRecentThinkGraphSemanticRecords({ projectId, limit });
  res.json(buildThinkGraphGraphViewResponse(projectId, result));
});

export default router;
