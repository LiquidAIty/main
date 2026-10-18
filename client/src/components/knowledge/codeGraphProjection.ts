/**
 * Entity: CodeGraph
 * Relationship: Validates official CBM structural projections, preserves source-owned Feature memberships, and derives non-authoritative filters without duplicating File identity.
 *
 * Entity: Graph Presentation
 * Relationship: Supplies the Code view with fail-closed projection parsing, stable expansion merges, and presentation-only Feature filtering for the shared renderer.
 */

import type {
  GraphProjectionEdge,
  GraphProjectionNode,
  GraphProjectionV1,
} from './knowledgeGraphProjection';

export type CodeGraphReadMode = 'projection' | 'file' | 'source';
export type CodeGraphReadStatus = 'ready' | 'partial' | 'unavailable' | 'not_found';

export type CodeGraphSelectedSymbol = {
  graphSystem: 'cbm';
  cbmQualifiedName: string;
  recordKind: 'symbol';
  type: string;
  title: string;
  content: string;
  properties: {
    project: string;
    file: string;
    startLine?: number | null;
    endLine?: number | null;
    signature?: string | null;
    fingerprint?: string | null;
  };
  relationshipEvidence?: {
    callers?: Record<string, unknown>[];
    callees?: Record<string, unknown>[];
  };
  provenance: Record<string, unknown>;
  asOf: string;
  readOperation: 'cbm.get_code_snippet';
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
  selectedSymbol: CodeGraphSelectedSymbol | null;
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
  if (!['feature', 'file', 'symbol'].includes(recordKind)) return false;
  if (recordKind === 'feature') {
    return typeof node.properties.featureName === 'string'
      && Boolean(node.properties.featureName.trim());
  }
  if (typeof node.properties.filePath !== 'string'
    || !node.properties.filePath.trim()) return false;
  if (recordKind === 'symbol') {
    return typeof node.properties.qualifiedName === 'string'
      && Boolean(node.properties.qualifiedName.trim());
  }
  return typeof node.properties.qualifiedName === 'string'
    && Boolean(node.properties.qualifiedName.trim());
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

function readSelectedSymbol(value: unknown): CodeGraphSelectedSymbol | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)
    || value.graphSystem !== 'cbm'
    || value.recordKind !== 'symbol'
    || typeof value.cbmQualifiedName !== 'string' || !value.cbmQualifiedName
    || typeof value.content !== 'string'
    || !isRecord(value.properties)
    || typeof value.properties.file !== 'string'
    || !isRecord(value.provenance)
    || value.readOperation !== 'cbm.get_code_snippet'
    || typeof value.truncated !== 'boolean') {
    throw new Error('invalid_codegraph_source');
  }
  return value as unknown as CodeGraphSelectedSymbol;
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
  const selectedSymbol = readSelectedSymbol(value.selectedSymbol);
  if ((expected.mode === 'source' && ['ready', 'partial'].includes(String(value.status))
      && !selectedSymbol)
    || (expected.mode !== 'source' && selectedSymbol)
    || (['ready', 'partial'].includes(String(value.status))
      && expected.mode !== 'source' && !projection)) {
    throw new Error('invalid_codegraph_read');
  }
  return {
    ...(value as unknown as CodeGraphReadEnvelope),
    projection,
    selectedSymbol,
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
  const nodes = new Map(base.nodes.map(node => [node.id, node]));
  for (const node of expansion.nodes) {
    const current = nodes.get(node.id);
    nodes.set(node.id, current ? {
      ...current,
      ...node,
      properties: { ...(current.properties || {}), ...(node.properties || {}) },
    } : node);
  }
  const edges = new Map(base.edges.map(edge => [edge.id, edge]));
  expansion.edges.forEach(edge => edges.set(edge.id, edge));
  const expansionMetadata = (expansion as GraphProjectionV1 & {
    metadata?: Record<string, unknown>;
  }).metadata || {};
  const selectedFilePath = typeof expansionMetadata.selectedFilePath === 'string'
    ? expansionMetadata.selectedFilePath
    : '';
  const mergedNodes = [...nodes.values()].map(node => (
    selectedFilePath && node.properties?.filePath === selectedFilePath
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
