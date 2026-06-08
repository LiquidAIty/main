import { runCypherOnGraph } from '../services/graphService';

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
  const hasProjectField = /project_id/i.test(cypher);
  const hasScopedProjectParam =
    /project_id\s*:\s*\$projectId/i.test(cypher) ||
    /project_id\s*=\s*\$projectId/i.test(cypher) ||
    /coalesce\([^)]*project_id[^)]*\)\s*=\s*\$projectId/i.test(cypher);
  if (!hasProjectField || !hasScopedProjectParam) {
    const err: any = new Error('cypher must scope reads with the current $projectId');
    err.status = 400;
    throw err;
  }

  const rows = await runCypherOnGraph(graphName, cypher, {
    ...(queryParams || {}),
    projectId,
  });
  console.log('[KG_QUERY]', {
    projectId,
    graphName,
    cypher_preview: cypher.slice(0, 120),
    rows_returned: Array.isArray(rows) ? rows.length : 0,
  });
  return rows;
}
