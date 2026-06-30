// Read-only CodeGraph route for the Agent Builder.
//  - /graph-view : a bounded call-graph slice read through the codebase-memory (CBM) MCP — the
//                  SAME 14-tool MCP the Harness uses. This is a thin transport adapter: it calls
//                  the MCP's own `list_projects` + `query_graph` tools and maps the rows to the
//                  source-neutral graph-view shape the canvas already consumes (node.type = symbol
//                  kind, edge.type = CALLS). No reinvented query/projection logic. No writes.
import { Router } from 'express';
import { createCodebaseMemoryMcpCaller } from '../services/graphContext/cbmMcpCaller';

const router = Router();

// One bounded call-graph slice. The agent points at exact symbols via graph_focus/highlight on
// the qualified_name ids returned here.
const CALL_SLICE_CYPHER =
  'MATCH (a:Function)-[r:CALLS]->(b:Function) ' +
  'RETURN a.qualified_name AS from_id, a.name AS from_name, b.qualified_name AS to_id, b.name AS to_name ' +
  'LIMIT 400';

router.get('/graph-view', async (req, res) => {
  const projectId = String(req.query.projectId || '').trim();
  let session: Awaited<ReturnType<typeof createCodebaseMemoryMcpCaller>> | null = null;
  try {
    session = await createCodebaseMemoryMcpCaller(process.cwd());
    const projectList = await session.callTool('list_projects', {});
    const projects = Array.isArray(projectList.projects) ? projectList.projects : [];
    const cbmProject = String(projects[0]?.name || '').trim();
    if (!cbmProject) {
      res.json({ ok: false, source: 'unavailable', projectId, nodes: [], edges: [], counts: { nodes: 0, edges: 0, records: 0 }, reason: 'cbm_no_indexed_project' });
      return;
    }

    const result = await session.callTool('query_graph', { project: cbmProject, query: CALL_SLICE_CYPHER });
    const rows: unknown[] = Array.isArray(result.rows) ? result.rows : [];

    const nodeById = new Map<string, { id: string; label: string; type: string }>();
    const edges: { id: string; source: string; target: string; label: string; type: string }[] = [];
    rows.forEach((row, i) => {
      const r = Array.isArray(row) ? row : [];
      const fromId = String(r[0] ?? '').trim();
      const fromName = String(r[1] ?? '').trim();
      const toId = String(r[2] ?? '').trim();
      const toName = String(r[3] ?? '').trim();
      if (!fromId || !toId) return;
      if (!nodeById.has(fromId)) nodeById.set(fromId, { id: fromId, label: fromName || fromId, type: 'Function' });
      if (!nodeById.has(toId)) nodeById.set(toId, { id: toId, label: toName || toId, type: 'Function' });
      edges.push({ id: `${fromId}|CALLS|${toId}|${i}`, source: fromId, target: toId, label: 'calls', type: 'CALLS' });
    });

    const nodes = Array.from(nodeById.values());
    res.json({
      ok: true,
      source: 'codegraph-cbm',
      projectId,
      cbmProject,
      nodes,
      edges,
      counts: { nodes: nodes.length, edges: edges.length, records: rows.length },
      reason: nodes.length === 0 ? 'no_codegraph_slice' : undefined,
    });
  } catch (error: any) {
    res.json({
      ok: false,
      source: 'unavailable',
      projectId,
      nodes: [],
      edges: [],
      counts: { nodes: 0, edges: 0, records: 0 },
      reason: 'codegraph_unavailable',
      blocker: String(error?.message || 'codebase-memory MCP read failed'),
    });
  } finally {
    await session?.close();
  }
});

export default router;
