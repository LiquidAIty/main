/**
 * Entity: Project Knowledge Graph
 * Relationship: Defines provider projection contracts and composes exact same-name ThinkGraph and KnowGraph Entities into one joined presentation without merging graph authority.
 *
 * Entity: Graph Presentation
 * Relationship: Supplies stable provider-member render identities and material roles used by the single shared knowledge surface and its focused presentations.
 */

import { GRAPH_THEME, SOLARPUNK_PALETTE } from '../graph/graphVisualTokens';
import {
  isCanonicalEntityDirectory,
  readCanonicalEntityProviderPointers,
  type CanonicalEntityDirectory,
  type CanonicalEntityHeader,
} from './canonicalEntityDirectory';

export type GraphAuthority = 'thinkgraph' | 'knowgraph';

export type GraphSurfaceAuthority = GraphAuthority | 'joined' | 'codegraph';

const GRAPH_NODE_MATERIALS = {
  think: 'THINK_MATERIAL',
  know: 'KNOW_MATERIAL',
  paired: 'PAIRED_SOLARPUNK_MATERIAL',
} as const;

const COMBINED_CYBER_MATERIAL = 'PAIRED_CYBER_MATERIAL' as const;

export type GraphNodeMaterialRole =
  | typeof GRAPH_NODE_MATERIALS[keyof typeof GRAPH_NODE_MATERIALS]
  | typeof COMBINED_CYBER_MATERIAL;

export type SolarpunkColors = {
  think: string;
  know: string;
  thinkRelationship: string;
  knowRelationship: string;
};

export const DEFAULT_SOLARPUNK_COLORS: SolarpunkColors = {
  think: SOLARPUNK_PALETTE.sea,
  know: SOLARPUNK_PALETTE.sun,
  thinkRelationship: SOLARPUNK_PALETTE.sea,
  knowRelationship: SOLARPUNK_PALETTE.sun,
};

export type ReadProviderFocusNeighborhood = (
  authority: GraphAuthority,
  providerId: string,
  signal?: AbortSignal,
) => Promise<GraphProjectionV1>;

// The server-owned graph projection contract rendered by the provider surfaces.

export type GraphProjectionNode = {
  id: string;
  canonicalId?: string;
  canonicalName?: string;
  entityKind?: string;
  label: string;
  title?: string;
  type?: string;
  labels?: string[];
  authority?: string;
  projectId?: string;
  createdAt?: string;
  validFrom?: string;
  validTo?: string | null;
  ingestedAt?: string;
  updatedAt?: string;
  mentionCount?: number;
  lastMentionedAt?: string;
  properties?: Record<string, unknown>;
  degree?: number;
  semantic_mass?: number;
  gravity_mass?: number;
  visual_radius?: number;
  etype?: string;
  anchor_role?: 'global' | 'community' | null;
  system_anchor_id?: string;
  community_id?: string;
  scene_rank?: number;
  material_kind?: 'solarpunk' | 'joined-cyber';
  material_role?: GraphNodeMaterialRole;
  material_blue?: string;
  material_orange?: string;
  material_surface?: string;
  material_think_active?: boolean;
  material_know_active?: boolean;
  material_focus_active?: boolean;
};

export type GraphProjectionEdge = {
  id: string;
  source: string;
  target: string;
  predicate: string;
  relation?: string;
  label?: string;
  mentionCount?: number;
  lastMentionedAt?: string;
  properties?: Record<string, unknown>;
  provenance?: Record<string, unknown>;
  provenanceCount?: number;
  validFrom?: string;
  validTo?: string | null;
  relationship_strength?: number;
  label_confidence?: number;
  strength?: number;
  spring_strength?: number;
  rest_length?: number;
  visual_width?: number;
  layer?: string;
  material_kind?: 'solarpunk' | 'joined-cyber';
  material_authority?: GraphAuthority;
  material_color?: string;
};

export type GraphProjectionV1 = {
  schemaVersion: string;
  authority?: string;
  projectId: string;
  revision?: string;
  analysis?: {
    revision: string;
    communities: Array<{ id: string; memberCount: number; members: string[]; centralNodes: string[]; gateways: string[] }>;
    gaps: Array<{ source: string; target: string; edgeClass: 'derived'; derivedType: string; reason: string }>;
    durationMs: number;
  };
  scene?: { nodes: GraphProjectionNode[]; edges: GraphProjectionEdge[]; [key: string]: unknown };
  embedding?: Record<string, unknown>;
  counts?: { nodes: number; edges: number };
  nodes: GraphProjectionNode[];
  edges: GraphProjectionEdge[];
  canonicalEntityDirectory?: CanonicalEntityDirectory | null;
};

export type JoinedGraphNodeVariant = {
  authority: GraphAuthority;
  node: GraphProjectionNode;
};

export type JoinedGraphEdgeVariant = {
  authority: GraphAuthority;
  edge: GraphProjectionEdge;
};

export type JoinedGraphPresentation = {
  projection: GraphProjectionV1;
  providerProjections: Record<GraphAuthority, GraphProjectionV1>;
  nodeVariants: Map<string, JoinedGraphNodeVariant[]>;
  edgeVariants: Map<string, JoinedGraphEdgeVariant>;
  visualNodeIdByProviderMember: Map<string, string>;
};

export function solarpunkMaterialFields(
  source: 'think' | 'know' | 'paired',
  thinkActive = false,
  knowActive = false,
  colors: SolarpunkColors = DEFAULT_SOLARPUNK_COLORS,
): Pick<GraphProjectionNode,
  | 'material_kind'
  | 'material_role'
  | 'material_blue'
  | 'material_orange'
  | 'material_surface'
  | 'material_think_active'
  | 'material_know_active'> {
  return {
    material_kind: 'solarpunk',
    material_role: GRAPH_NODE_MATERIALS[source],
    material_blue: colors.think,
    material_orange: colors.know,
    material_surface: GRAPH_THEME.surface.base,
    material_think_active: thinkActive,
    material_know_active: knowActive,
  };
}

export function combinedCyberMaterialFields(
  source: 'think' | 'know' | 'paired',
  thinkActive = false,
  knowActive = false,
  colors: SolarpunkColors = DEFAULT_SOLARPUNK_COLORS,
): Pick<GraphProjectionNode,
  | 'material_kind'
  | 'material_role'
  | 'material_blue'
  | 'material_orange'
  | 'material_surface'
  | 'material_think_active'
  | 'material_know_active'> {
  return {
    ...solarpunkMaterialFields(source, thinkActive, knowActive, colors),
    material_kind: 'joined-cyber',
    material_role: source === 'paired' ? COMBINED_CYBER_MATERIAL : GRAPH_NODE_MATERIALS[source],
  };
}

export function providerMemberKey(authority: GraphAuthority, providerId: string): string {
  return `${authority}:${providerId}`;
}

function providerRenderId(authority: GraphAuthority, providerId: string): string {
  return `${authority}:${encodeURIComponent(providerId)}`;
}

export function visualSourceKind(variants: JoinedGraphNodeVariant[]): 'think' | 'know' | 'paired' {
  const authorities = new Set(variants.map(variant => variant.authority));
  return authorities.size > 1 ? 'paired'
    : authorities.has('knowgraph') ? 'know' : 'think';
}

type CanonicalEntityIndex = {
  directory: CanonicalEntityDirectory;
  byProviderId: Record<GraphAuthority, Map<string, CanonicalEntityHeader>>;
};

function canonicalEntityIndex(
  thinkProjection: GraphProjectionV1,
  knowProjection: GraphProjectionV1,
): CanonicalEntityIndex | null {
  const directory = thinkProjection.canonicalEntityDirectory;
  if (!isCanonicalEntityDirectory(directory)
    || !thinkProjection.projectId
    || thinkProjection.projectId !== knowProjection.projectId
    || directory.projectId !== thinkProjection.projectId) return null;

  const byProviderId: CanonicalEntityIndex['byProviderId'] = {
    thinkgraph: new Map(),
    knowgraph: new Map(),
  };
  const counts = { thinkgraph: 0, knowgraph: 0 };
  for (const entity of directory.entities) {
    const pointers = readCanonicalEntityProviderPointers(entity);
    if (!pointers) return null;
    for (const pointer of pointers) {
      if (byProviderId[pointer.authority].has(pointer.entityId)) return null;
      byProviderId[pointer.authority].set(pointer.entityId, entity);
      counts[pointer.authority] += 1;
    }
  }
  if (counts.thinkgraph !== directory.counts.engraphis
    || counts.knowgraph !== directory.counts.graphiti) return null;
  return { directory, byProviderId };
}

function canonicalEntityHeader(
  index: CanonicalEntityIndex | null,
  authority: GraphAuthority,
  node: GraphProjectionNode,
): CanonicalEntityHeader | null {
  const header = index?.byProviderId[authority].get(node.id);
  if (!header
    || node.canonicalName !== header.canonicalName
    || node.label !== header.canonicalName
    || node.projectId !== index!.directory.projectId) return null;
  return header;
}

function presentationNode(
  visualId: string,
  variants: JoinedGraphNodeVariant[],
): GraphProjectionNode {
  const primary = variants.find(variant => variant.authority === 'thinkgraph') || variants[0];
  const sourceKind = visualSourceKind(variants);
  return {
    ...primary.node,
    id: visualId,
    canonicalId: undefined,
    authority: 'joined',
    ...solarpunkMaterialFields(sourceKind, false, false),
    properties: { ...(primary.node.properties || {}) },
  } as GraphProjectionNode;
}

/**
 * Builds one non-authoritative renderer view over the two provider projections.
 * A complete current Entity directory supplies each authority's exact
 * stored canonical name, kind, provider identity, Project, and revision. The
 * single mixed presentation
 * co-covers a name only when exactly one projection record from each authority
 * byte-matches its own header. No label normalization, fuzzy/alias inference,
 * shared provider ID, or persisted cross-graph identity is introduced.
 */

export function composeThinkKnowPresentation(
  thinkProjection: GraphProjectionV1,
  knowProjection: GraphProjectionV1,
): JoinedGraphPresentation {
  const providerProjections = {
    thinkgraph: thinkProjection,
    knowgraph: knowProjection,
  };
  const entityIndex = canonicalEntityIndex(thinkProjection, knowProjection);
  const eligibleByName: Record<GraphAuthority, Map<string, GraphProjectionNode[]>> = {
    thinkgraph: new Map(),
    knowgraph: new Map(),
  };
  const registerEligible = (authority: GraphAuthority, node: GraphProjectionNode) => {
    const header = canonicalEntityHeader(entityIndex, authority, node);
    if (!header) return;
    const records = eligibleByName[authority].get(header.canonicalName) || [];
    records.push(node);
    eligibleByName[authority].set(header.canonicalName, records);
  };
  thinkProjection.nodes.forEach(node => registerEligible('thinkgraph', node));
  knowProjection.nodes.forEach(node => registerEligible('knowgraph', node));
  const pairedNames = new Set([...eligibleByName.thinkgraph.entries()]
    .filter(([name, records]) => records.length === 1
      && eligibleByName.knowgraph.get(name)?.length === 1)
    .map(([name]) => name));
  const nodeVariants = new Map<string, JoinedGraphNodeVariant[]>();
  const visualNodeIdByProviderMember = new Map<string, string>();
  const addNode = (authority: GraphAuthority, node: GraphProjectionNode) => {
    const header = canonicalEntityHeader(entityIndex, authority, node);
    const visualId = header && pairedNames.has(header.canonicalName)
      ? `node-name:${encodeURIComponent(header.canonicalName)}`
      : providerRenderId(authority, node.id);
    const variants = nodeVariants.get(visualId) || [];
    variants.push({ authority, node });
    nodeVariants.set(visualId, variants);
    visualNodeIdByProviderMember.set(providerMemberKey(authority, node.id), visualId);
  };
  thinkProjection.nodes.forEach(node => addNode('thinkgraph', node));
  knowProjection.nodes.forEach(node => addNode('knowgraph', node));

  const nodes = [...nodeVariants.entries()]
    .map(([visualId, variants]) => presentationNode(visualId, variants));
  const visibleNodeIds = new Set(nodes.map(node => node.id));
  for (const [memberKey, visualId] of visualNodeIdByProviderMember) {
    if (!visibleNodeIds.has(visualId)) visualNodeIdByProviderMember.delete(memberKey);
  }
  const edgeVariants = new Map<string, JoinedGraphEdgeVariant>();
  const edges: GraphProjectionEdge[] = [];
  const addEdges = (authority: GraphAuthority, projection: GraphProjectionV1) => {
    for (const edge of projection.edges) {
      const source = visualNodeIdByProviderMember.get(providerMemberKey(authority, edge.source));
      const target = visualNodeIdByProviderMember.get(providerMemberKey(authority, edge.target));
      if (!source || !target || !visibleNodeIds.has(source) || !visibleNodeIds.has(target)) continue;
      const visualId = providerRenderId(authority, edge.id);
      edges.push({
        ...edge,
        id: visualId,
        source,
        target,
        layer: authority,
        properties: {
          ...(edge.properties || {}),
          ...(edge.layer ? { providerSemanticLayer: edge.layer } : {}),
        },
      });
      edgeVariants.set(visualId, { authority, edge });
    }
  };
  addEdges('thinkgraph', thinkProjection);
  addEdges('knowgraph', knowProjection);

  return {
    projection: {
      schemaVersion: 'think-know.presentation.v1',
      authority: 'joined',
      projectId: thinkProjection.projectId || knowProjection.projectId,
      revision: `${thinkProjection.revision || ''}:${knowProjection.revision || ''}`,
      counts: { nodes: nodes.length, edges: edges.length },
      nodes,
      edges,
      ...(entityIndex
        ? { canonicalEntityDirectory: entityIndex.directory }
        : {}),
    },
    providerProjections,
    nodeVariants,
    edgeVariants,
    visualNodeIdByProviderMember,
  };
}
