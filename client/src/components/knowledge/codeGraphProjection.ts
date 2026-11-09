/**
 * Entity: CodeGraph
 * Relationship: This file validates CBM projections and derives source-tagged Feature membership and active structural views without duplicating identity.
 *
 * Entity: Project Knowledge Graph
 * Relationship: This file supplies the shared graph workspace with fail-closed Code view parsing, stable expansion merges, and presentation-only Feature filtering.
 */

import type {
  GraphProjectionEdge,
  GraphProjectionNode,
  GraphProjectionV1,
} from './knowledgeGraphProjection';

export type CodeGraphReadMode = 'projection' | 'file' | 'source';
export type CodeGraphReadStatus = 'ready' | 'partial' | 'unavailable' | 'not_found';

export type CodeGraphFileSource = {
  graphSystem: 'repository';
  sourceReference: string;
  recordKind: 'file';
  type: 'File';
  title: string;
  content: string;
  properties: { project: string; file: string; startLine: number; endLine: number };
  provenance: Record<string, unknown>;
  asOf: string;
  readOperation: 'repository-file';
  truncated: boolean;
};

export type CodeGraphReadEnvelope = {
  schemaVersion: 'codegraph.read.v1';
  status: CodeGraphReadStatus;
  mode: CodeGraphReadMode;
  scope: {
    projectId: string;
    deckId: string;
    cardId: string;
    cardRevisionId?: string;
    cardRevision?: number;
    deckRevision?: string;
    cbmProject: string;
  };
  projection: GraphProjectionV1 | null;
  fileSource: CodeGraphFileSource | null;
  freshness: { status: string; coverage: unknown };
  truncated: boolean;
  errors: Array<{ purpose: string; operation: string; code: string }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function emptyCodeGraphProjection(projectId: string): GraphProjectionV1 {
  return {
    schemaVersion: 'codegraph.projection.v1',
    authority: 'codegraph',
    projectId,
    counts: { nodes: 0, edges: 0 },
    nodes: [],
    edges: [],
  };
}

function codeNodeKind(node: GraphProjectionNode): string {
  return String(node.properties?.recordKind || '').trim();
}

function validCodeNode(node: unknown): node is GraphProjectionNode {
  if (!isRecord(node)
    || typeof node.id !== 'string' || !node.id
    || typeof node.label !== 'string' || !node.label
    || node.authority !== 'codegraph'
    || !isRecord(node.properties)) return false;
  const recordKind = String(node.properties.recordKind || '');
  if (!['feature', 'file'].includes(recordKind)) return false;
  if (recordKind === 'feature') {
    return typeof node.properties.featureName === 'string'
      && Boolean(node.properties.featureName.trim());
  }
  if (typeof node.properties.filePath !== 'string'
    || !node.properties.filePath.trim()) return false;
  return (node.properties.sourceAuthority === 'repository-file'
      && node.properties.sourceReference === node.id)
    || (typeof node.properties.qualifiedName === 'string'
      && Boolean(node.properties.qualifiedName.trim()));
}

function validCodeEdge(edge: unknown): edge is GraphProjectionEdge {
  return isRecord(edge)
    && typeof edge.id === 'string' && Boolean(edge.id)
    && typeof edge.source === 'string' && Boolean(edge.source)
    && typeof edge.target === 'string' && Boolean(edge.target)
    && typeof edge.predicate === 'string' && Boolean(edge.predicate)
    && (!edge.properties || isRecord(edge.properties));
}

export function validateCodeGraphProjection(
  value: unknown,
  projectId: string,
): GraphProjectionV1 {
  if (!isRecord(value)
    || value.schemaVersion !== 'codegraph.projection.v1'
    || value.authority !== 'codegraph'
    || value.projectId !== projectId
    || !Array.isArray(value.nodes)
    || !Array.isArray(value.edges)
    || value.nodes.some(node => !validCodeNode(node))
    || value.edges.some(edge => !validCodeEdge(edge))) {
    throw new Error('invalid_codegraph_projection');
  }
  const nodes = value.nodes as GraphProjectionNode[];
  const edges = value.edges as GraphProjectionEdge[];
  const nodeIds = new Set(nodes.map(node => node.id));
  const edgeIds = new Set(edges.map(edge => edge.id));
  if (nodeIds.size !== nodes.length
    || edgeIds.size !== edges.length
    || edges.some(edge => !nodeIds.has(edge.source) || !nodeIds.has(edge.target))) {
    throw new Error('invalid_codegraph_projection');
  }
  return {
    ...(value as unknown as GraphProjectionV1),
    counts: { nodes: nodes.length, edges: edges.length },
    nodes,
    edges,
  };
}

function readFileSource(value: unknown): CodeGraphFileSource | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value) || value.graphSystem !== 'repository' || value.recordKind !== 'file'
    || value.readOperation !== 'repository-file'
    || !isRecord(value.properties) || typeof value.properties.file !== 'string'
    || value.sourceReference !== 'source-file:' + value.properties.file
    || typeof value.content !== 'string' || !isRecord(value.provenance)
    || typeof value.truncated !== 'boolean') throw new Error('invalid_codegraph_source');
  return value as unknown as CodeGraphFileSource;
}

export function validateCodeGraphReadEnvelope(
  value: unknown,
  expected: { projectId: string; mode: CodeGraphReadMode },
): CodeGraphReadEnvelope {
  if (!isRecord(value)
    || value.schemaVersion !== 'codegraph.read.v1'
    || value.mode !== expected.mode
    || !['ready', 'partial', 'unavailable', 'not_found'].includes(String(value.status))
    || !isRecord(value.scope)
    || value.scope.projectId !== expected.projectId
    || !isRecord(value.freshness)
    || typeof value.truncated !== 'boolean'
    || !Array.isArray(value.errors)
    || value.errors.some(error => !isRecord(error)
      || typeof error.purpose !== 'string'
      || typeof error.operation !== 'string'
      || typeof error.code !== 'string')) {
    throw new Error('invalid_codegraph_read');
  }
  const projection = value.projection === null || value.projection === undefined
    ? null
    : validateCodeGraphProjection(value.projection, expected.projectId);
  const fileSource = readFileSource(value.fileSource);
  if ((expected.mode === 'source' && ['ready', 'partial'].includes(String(value.status))
      && !fileSource)
    || (expected.mode !== 'source' && fileSource)
    || (['ready', 'partial'].includes(String(value.status))
      && expected.mode !== 'source' && !projection)) {
    throw new Error('invalid_codegraph_read');
  }
  return {
    ...(value as unknown as CodeGraphReadEnvelope),
    projection,
    fileSource,
  };
}

export function mergeCodeGraphProjections(
  base: GraphProjectionV1,
  expansion: GraphProjectionV1,
): GraphProjectionV1 {
  if (base.authority !== 'codegraph' || expansion.authority !== 'codegraph'
    || base.projectId !== expansion.projectId) {
    throw new Error('codegraph_projection_merge_scope_mismatch');
  }
  const expansionMetadata = (expansion as GraphProjectionV1 & {
    metadata?: Record<string, unknown>;
  }).metadata || {};
  const selectedFilePaths = new Set(Array.isArray(expansionMetadata.selectedFilePaths)
    ? expansionMetadata.selectedFilePaths.filter((path): path is string => typeof path === 'string')
    : []);
  const nodes = new Map(base.nodes.map(node => [node.id, node]));
  for (const node of expansion.nodes) {
    const current = nodes.get(node.id);
    nodes.set(node.id, current ? {
      ...current,
      ...node,
      properties: { ...(current.properties || {}), ...(node.properties || {}) },
    } : node);
  }
  const refreshedFiles = new Set(expansion.nodes.filter(node => typeof node.properties?.filePath === 'string'
    && selectedFilePaths.has(node.properties.filePath)
    && node.properties?.structuralComplete === true).map(node => node.id));
  const edges = new Map(base.edges
    .filter(edge => !(edge.properties?.recordKind === 'structural-relationship'
      && (refreshedFiles.has(edge.source) || refreshedFiles.has(edge.target))))
    .map(edge => [edge.id, edge]));
  expansion.edges.forEach(edge => edges.set(edge.id, edge));
  const mergedNodes = [...nodes.values()].map(node => (
    typeof node.properties?.filePath === 'string' && selectedFilePaths.has(node.properties.filePath)
      ? {
        ...node,
        properties: { ...(node.properties || {}), structuralLoaded: true },
      }
      : node
  ));
  const mergedEdges = [...edges.values()].filter(edge => (
    nodes.has(edge.source) && nodes.has(edge.target)
  ));
  return {
    ...base,
    revision: `${base.revision || ''}:${expansion.revision || ''}`,
    counts: { nodes: mergedNodes.length, edges: mergedEdges.length },
    nodes: mergedNodes,
    edges: mergedEdges,
    metadata: {
      ...((base as GraphProjectionV1 & { metadata?: Record<string, unknown> }).metadata || {}),
      ...expansionMetadata,

    },
  } as GraphProjectionV1;
}

export function codeGraphFeatures(projection: GraphProjectionV1): GraphProjectionNode[] {
  return projection.nodes
    .filter(node => codeNodeKind(node) === 'feature')
    .sort((left, right) => left.label.localeCompare(right.label));
}


export function codeGraphCategoryProjection(
  projection: GraphProjectionV1,
  featureIds: readonly string[],
): GraphProjectionV1 {
  const selectedIds = new Set(featureIds);
  const categories = new Set(projection.nodes.filter(node => codeNodeKind(node) === 'feature'
    && selectedIds.has(node.id)).map(node => node.properties?.featureName));
  const files = new Map(projection.nodes
    .filter(node => codeNodeKind(node) === 'file').map(node => [node.id, node]));
  const selectedFiles = new Set([...files.values()].filter(node =>
    Array.isArray(node.properties?.features)
    && node.properties.features.some(name => categories.has(name))).map(node => node.id));
  // Keep declared categories for the Entity overview; files are revealed on expansion.
  const structuralEdges = projection.edges.filter(edge =>
    ['CALLS', 'IMPORTS'].includes(edge.predicate)
    && edge.properties?.structuralAuthority === 'cbm'
    && files.has(edge.source) && files.has(edge.target)
    && edge.source !== edge.target);
  const visibleIds = selectedFiles;
  const edges = structuralEdges.filter(edge => visibleIds.has(edge.source) && visibleIds.has(edge.target));
  const nodes = [...projection.nodes.filter(node => codeNodeKind(node) === 'feature' && selectedIds.has(node.id)),
    ...[...files.values()].filter(node => visibleIds.has(node.id))];
  return { ...projection, scene: undefined,
    counts: { nodes: nodes.length, edges: edges.length }, nodes, edges };
}

/** Display-only metrics of the returned CBM file graph, never semantic importance. */
export function applyCodeGraphPhysics(projection: GraphProjectionV1): GraphProjectionV1 {
  const files = new Map(projection.nodes
    .filter(node => node.authority === 'codegraph' && codeNodeKind(node) === 'file')
    .map(node => [node.id, node]));
  if (!files.size) return projection;
  const callers = new Map([...files.keys()].map(id => [id, new Set<string>()]));
  const incoming = new Map([...files.keys()].map(id => [id, new Set<string>()]));
  const outgoing = new Map([...files.keys()].map(id => [id, new Set<string>()]));
  const neighbors = new Map([...files.keys()].map(id => [id, new Set<string>()]));
  for (const edge of projection.edges) {
    if (edge.source === edge.target || !files.has(edge.source) || !files.has(edge.target)
      || !['CALLS', 'IMPORTS'].includes(edge.predicate)
      || edge.properties?.structuralAuthority !== 'cbm') continue;
    neighbors.get(edge.source)!.add(edge.target);
    neighbors.get(edge.target)!.add(edge.source);
    incoming.get(edge.target)!.add(edge.source);
    if (edge.predicate === 'CALLS') {
      callers.get(edge.target)!.add(edge.source);
      outgoing.get(edge.source)!.add(edge.target);
    }
  }
  const nodes = projection.nodes.map(node => {
    if (!files.has(node.id)) return node;
    const incomingCount = incoming.get(node.id)!.size;
    const adjacent = neighbors.get(node.id)!;
    const categories = Array.isArray(node.properties?.features)
      ? node.properties.features.filter((name): name is string => typeof name === 'string') : [];
    const categoryConnections = Object.fromEntries(categories.map(name => [name,
      [...adjacent].filter(id => {
        const memberships = files.get(id)?.properties?.features;
        return Array.isArray(memberships) && memberships.includes(name);
      }).length]));
    return { ...node, degree: adjacent.size,
      visual_radius: 1.4 + 0.7 * Math.log1p(incomingCount),
      gravity_mass: 1 + Math.log1p(adjacent.size),
      properties: { ...node.properties,
        incomingConnectionCount: incomingCount,
        callerFileCount: callers.get(node.id)!.size, calledFileCount: outgoing.get(node.id)!.size,
        connectedFileCount: adjacent.size, connectionCountScope: 'loaded-cbm-neighborhood',
        categoryConnections },
    };
  });
  const byId = new Map(nodes.map(node => [node.id, node]));
  const edges = projection.edges.map(edge => {
    if (!files.has(edge.source) || !files.has(edge.target)
      || edge.properties?.structuralAuthority !== 'cbm') return edge;
    const source = byId.get(edge.source)!, target = byId.get(edge.target)!;
    return { ...edge,
      spring_strength: 0.18 / Math.sqrt(Math.max(1, Math.min(source.degree!, target.degree!))),
      rest_length: 42 + (source.visual_radius || 4) + (target.visual_radius || 4),
      visual_width: edge.predicate === 'CALLS' ? 1 : 0.65,
    };
  });
  return { ...projection, nodes, edges };
}
