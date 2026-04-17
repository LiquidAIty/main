#!/usr/bin/env node
/**
 * APOC verification: load repo-map.graph.json using APOC and validate
 * This proves APOC works with our current graph workflow without replacing it
 */

import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import neo4j from 'neo4j-driver';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const REPO_GRAPH_PATH = path.join(REPO_ROOT, 'repo-map.graph.json');
const PROJECT_ID = process.env.PROJECT_ID || 'local-dev';
const NEO4J_URI = process.env.NEO4J_URI || 'bolt://localhost:7687';
const NEO4J_USER = process.env.NEO4J_USER || 'neo4j';
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD;
const NEO4J_DATABASE = process.env.NEO4J_DATABASE || undefined;

if (!NEO4J_PASSWORD) {
  throw new Error('NEO4J_PASSWORD is required');
}

async function main() {
  const driver = neo4j.driver(
    NEO4J_URI,
    neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD),
  );

  const session = driver.session(NEO4J_DATABASE ? { database: NEO4J_DATABASE } : undefined);

  try {
    // 1. Verify APOC is available
    console.log('[APOC] Verifying APOC availability...');
    const versionResult = await session.run('RETURN apoc.version() AS version');
    const apocVersion = versionResult.records[0].get('version');
    console.log(`[APOC] ✓ APOC version: ${apocVersion}`);

    // 2. Load repo-map.graph.json using APOC
    console.log(`[APOC] Loading ${REPO_GRAPH_PATH} using apoc.load.json...`);
    const graphData = JSON.parse(await fs.readFile(REPO_GRAPH_PATH, 'utf-8'));
    
    // Use APOC to validate JSON structure
    const fileUrl = `file:///${REPO_GRAPH_PATH.replace(/\\/g, '/')}`;
    const loadResult = await session.run(
      `CALL apoc.load.json($fileUrl) YIELD value
       RETURN size(value.nodes) AS nodeCount, size(value.edges) AS edgeCount`,
      { fileUrl }
    );
    
    const record = loadResult.records[0];
    const nodeCount = record.get('nodeCount');
    const edgeCount = record.get('edgeCount');
    
    console.log(`[APOC] ✓ Loaded via APOC: ${nodeCount} nodes, ${edgeCount} edges`);
    console.log(`[APOC] ✓ Direct read: ${graphData.nodes.length} nodes, ${graphData.edges.length} edges`);

    // 3. Use APOC to query existing imported graph data
    console.log(`[APOC] Querying existing RepoNode data for project=${PROJECT_ID}...`);
    const queryResult = await session.run(
      `MATCH (n:RepoNode {project_id: $project_id})
       WITH count(n) AS total
       CALL apoc.when(
         total > 0,
         'MATCH (n:RepoNode {project_id: $project_id}) RETURN count(n) AS nodes, 
          collect(DISTINCT n.node_type)[0..5] AS sampleTypes',
         'RETURN 0 AS nodes, [] AS sampleTypes',
         {project_id: $project_id}
       ) YIELD value
       RETURN value.nodes AS nodes, value.sampleTypes AS sampleTypes`,
      { project_id: PROJECT_ID }
    );

    if (queryResult.records.length > 0) {
      const result = queryResult.records[0];
      const existingNodes = result.get('nodes');
      const sampleTypes = result.get('sampleTypes');
      console.log(`[APOC] ✓ Found ${existingNodes} existing RepoNode records`);
      console.log(`[APOC] ✓ Sample node types: ${sampleTypes.join(', ')}`);
    }

    // 4. Demonstrate APOC utility: batch refactor example (dry-run)
    console.log(`[APOC] Demonstrating APOC batch utility (dry-run)...`);
    const batchResult = await session.run(
      `MATCH (n:RepoNode {project_id: $project_id})
       WHERE n.node_type = 'file'
       WITH collect(n) AS nodes
       RETURN size(nodes) AS fileNodes,
              apoc.coll.sum([n IN nodes | size(coalesce(n.path, ''))]) AS totalPathChars`,
      { project_id: PROJECT_ID }
    );

    if (batchResult.records.length > 0) {
      const fileNodes = batchResult.records[0].get('fileNodes');
      const totalPathChars = batchResult.records[0].get('totalPathChars');
      console.log(`[APOC] ✓ APOC batch analysis: ${fileNodes} file nodes, ${totalPathChars} total path chars`);
    }

    console.log('\n[SUCCESS] APOC is fully functional and integrated with current graph workflow');
    console.log('[NOTE] Current import script (ingest-repo-to-knowgraph.mjs) remains the baseline');
    console.log('[NOTE] APOC can be used for: JSON validation, batch operations, graph refactoring');

  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
