#!/usr/bin/env node
/**
 * Minimal adapter: repo-map.graph.json + repo-graph-overlay.json → Neo4j
 */

import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import neo4j from 'neo4j-driver';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const REPO_GRAPH_PATH = path.join(REPO_ROOT, 'repo-map.graph.json');
const REPO_GRAPH_OVERLAY_PATH = path.join(REPO_ROOT, 'repo-graph-overlay.json');
const PROJECT_ID = process.env.PROJECT_ID || 'local-dev';
const NEO4J_URI = process.env.NEO4J_URI;
const NEO4J_USER = process.env.NEO4J_USER;
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD;
const NEO4J_DATABASE = process.env.NEO4J_DATABASE || undefined;
const OVERLAY_SOURCE_NAME = 'repo-graph-overlay.json';

function requiredEnv(name, value) {
  if (!value || !String(value).trim()) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return String(value).trim();
}

function chunkRows(rows, size = 250) {
  const chunks = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}

async function executeWrite(driver, cypher, params) {
  const session = driver.session(NEO4J_DATABASE ? { database: NEO4J_DATABASE } : undefined);
  try {
    await session.run(cypher, params);
  } finally {
    await session.close();
  }
}

function basename(filePath) {
  return path.posix.basename(String(filePath).replace(/\\/g, '/'));
}

function normalizeStructuralNodes(repoGraph) {
  return (Array.isArray(repoGraph?.nodes) ? repoGraph.nodes : []).map((node) => ({
    id: String(node.id),
    node_type: String(node.type || 'unknown'),
    category: node.category ? String(node.category) : null,
    label: node.label ? String(node.label) : basename(node.id),
  }));
}

function normalizeStructuralEdges(repoGraph) {
  return (Array.isArray(repoGraph?.edges) ? repoGraph.edges : []).map((edge) => ({
    source: String(edge.source),
    target: String(edge.target),
    edge_type: String(edge.type || 'repo_edge'),
  }));
}

function normalizeOverlayRows(repoGraph, overlay) {
  const structuralIds = new Set(
    (Array.isArray(repoGraph?.nodes) ? repoGraph.nodes : []).map((node) => String(node.id)),
  );

  return (Array.isArray(overlay?.files) ? overlay.files : []).map((entry) => ({
    path: String(entry.path),
    label: basename(entry.path),
    overlay_only: !structuralIds.has(String(entry.path)),
    entity: String(entry.entity),
    role: entry.role ? String(entry.role) : null,
    relates_to: Array.isArray(entry.relates_to) ? entry.relates_to.map(String) : [],
    depends_on: Array.isArray(entry.depends_on) ? entry.depends_on.map(String) : [],
    feeds_to: Array.isArray(entry.feeds_to) ? entry.feeds_to.map(String) : [],
  }));
}

const MERGE_REPO_NODES_CYPHER = `
UNWIND $rows AS row
MERGE (node:RepoNode {project_id: $project_id, id: row.id})
ON CREATE SET node.created_at = datetime()
SET node.path = row.id,
    node.node_type = row.node_type,
    node.category = row.category,
    node.label = row.label,
    node.overlay_only = coalesce(node.overlay_only, false),
    node.updated_at = datetime()
`;

const MERGE_REPO_EDGES_CYPHER = `
UNWIND $rows AS row
MERGE (source:RepoNode {project_id: $project_id, id: row.source})
ON CREATE SET source.created_at = datetime(),
              source.path = row.source,
              source.node_type = 'reference',
              source.label = row.source
SET source.updated_at = datetime()
MERGE (target:RepoNode {project_id: $project_id, id: row.target})
ON CREATE SET target.created_at = datetime(),
              target.path = row.target,
              target.node_type = 'reference',
              target.label = row.target,
              target.overlay_only = true
SET target.updated_at = datetime()
MERGE (source)-[rel:REPO_EDGE {
  project_id: $project_id,
  source_id: row.source,
  target_id: row.target,
  edge_type: row.edge_type
}]->(target)
SET rel.updated_at = datetime()
`;

const MERGE_OVERLAY_CYPHER = `
UNWIND $rows AS row
MERGE (file:RepoNode {project_id: $project_id, id: row.path})
ON CREATE SET file.created_at = datetime()
SET file.path = row.path,
    file.node_type = coalesce(file.node_type, 'file'),
    file.category = coalesce(file.category, 'active_mvp'),
    file.label = coalesce(file.label, row.label),
    file.overlay_only = row.overlay_only,
    file.graph_entity = row.entity,
    file.graph_role = row.role,
    file.graph_relates_to = row.relates_to,
    file.graph_depends_on = row.depends_on,
    file.graph_feeds_to = row.feeds_to,
    file.updated_at = datetime()
MERGE (entity:Entity {project_id: $project_id, name: row.entity})
ON CREATE SET entity.created_at = datetime()
SET entity.role = coalesce(row.role, entity.role),
    entity.source_path = row.path,
    entity.updated_at = datetime()
MERGE (file)-[anchor:RELATES_TO]->(entity)
SET anchor.project_id = $project_id,
    anchor.source_name = $overlay_source_name,
    anchor.source_type = 'repo_graph_overlay',
    anchor.graph_anchor = 'entity',
    anchor.updated_at = datetime()
FOREACH (related_entity_name IN row.relates_to |
  MERGE (related:Entity {project_id: $project_id, name: related_entity_name})
  ON CREATE SET related.created_at = datetime()
  SET related.updated_at = datetime()
  MERGE (entity)-[related_rel:RELATES_TO]->(related)
  SET related_rel.project_id = $project_id,
      related_rel.source_name = $overlay_source_name,
      related_rel.source_type = 'repo_graph_overlay',
      related_rel.updated_at = datetime()
)
FOREACH (dependency_name IN row.depends_on |
  MERGE (dependency:Entity {project_id: $project_id, name: dependency_name})
  ON CREATE SET dependency.created_at = datetime()
  SET dependency.updated_at = datetime()
  MERGE (entity)-[depends_rel:DEPENDS_ON]->(dependency)
  SET depends_rel.project_id = $project_id,
      depends_rel.source_name = $overlay_source_name,
      depends_rel.source_type = 'repo_graph_overlay',
      depends_rel.updated_at = datetime()
)
FOREACH (fed_entity_name IN row.feeds_to |
  MERGE (fed:Entity {project_id: $project_id, name: fed_entity_name})
  ON CREATE SET fed.created_at = datetime()
  SET fed.updated_at = datetime()
  MERGE (entity)-[feeds_rel:FEEDS_TO]->(fed)
  SET feeds_rel.project_id = $project_id,
      feeds_rel.source_name = $overlay_source_name,
      feeds_rel.source_type = 'repo_graph_overlay',
      feeds_rel.updated_at = datetime()
)
`;

async function main() {
  const repoGraphRaw = await fs.readFile(REPO_GRAPH_PATH, 'utf-8');
  const repoGraph = JSON.parse(repoGraphRaw);
  const overlayRaw = await fs.readFile(REPO_GRAPH_OVERLAY_PATH, 'utf-8');
  const overlay = JSON.parse(overlayRaw);
  const structuralNodes = normalizeStructuralNodes(repoGraph);
  const structuralEdges = normalizeStructuralEdges(repoGraph);
  const overlayRows = normalizeOverlayRows(repoGraph, overlay);
  const driver = neo4j.driver(
    requiredEnv('NEO4J_URI', NEO4J_URI),
    neo4j.auth.basic(
      requiredEnv('NEO4J_USER', NEO4J_USER),
      requiredEnv('NEO4J_PASSWORD', NEO4J_PASSWORD),
    ),
  );

  console.log(`[INGEST] Loaded ${structuralNodes.length} structural nodes, ${structuralEdges.length} structural edges`);
  console.log(`[INGEST] Loaded ${overlayRows.length} semantic overlay rows from repo-graph-overlay.json`);

  try {
    for (const rows of chunkRows(structuralNodes)) {
      await executeWrite(driver, MERGE_REPO_NODES_CYPHER, {
        project_id: PROJECT_ID,
        rows,
      });
    }

    for (const rows of chunkRows(structuralEdges)) {
      await executeWrite(driver, MERGE_REPO_EDGES_CYPHER, {
        project_id: PROJECT_ID,
        rows,
      });
    }

    for (const rows of chunkRows(overlayRows)) {
      await executeWrite(driver, MERGE_OVERLAY_CYPHER, {
        project_id: PROJECT_ID,
        overlay_source_name: OVERLAY_SOURCE_NAME,
        rows,
      });
    }
  } finally {
    await driver.close();
  }

  const overlayOnlyCount = overlayRows.filter((row) => row.overlay_only).length;
  console.log(
    `[DONE] Imported structural graph + semantic overlay for project=${PROJECT_ID} ` +
      `(overlay_only_files=${overlayOnlyCount})`,
  );
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
