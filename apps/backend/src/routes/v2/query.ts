import { runCypherOnGraph } from '../../services/graphService';

export async function runKgQuery(params: {
  graphName: string;
  projectId: string;
  cypher: string;
  queryParams?: Record<string, unknown>;
}): Promise<unknown[]> {
  const { graphName, projectId, cypher, queryParams } = params;

  if (!cypher || typeof cypher !== 'string') {
    const err: any = new Error('cypher is required');
    err.status = 400;
    throw err;
  }
  if (!/project_id/i.test(cypher)) {
    const err: any = new Error('cypher must filter by project_id');
    err.status = 400;
    throw err;
  }

  const rows = await runCypherOnGraph(graphName, cypher, queryParams);
  console.log('[KG_QUERY]', {
    projectId,
    graphName,
    cypher_preview: cypher.slice(0, 120),
    rows_returned: Array.isArray(rows) ? rows.length : 0,
  });
  return rows;
}
