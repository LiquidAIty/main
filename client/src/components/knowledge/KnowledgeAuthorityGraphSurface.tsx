import { useEffect, useMemo, useRef, useState } from 'react';
import '../../vendor/engraphis/vendor/d3.min.js';
import '../../vendor/engraphis/vendor/force-graph.min.js';
import '../../vendor/engraphis/engraphis-graph.js';

import RightGlassDrawer from '../graph/RightGlassDrawer';
import { GraphNavigationControls, GraphPaperBackground } from '../graph/GraphCanvasChrome';
import { GRAPH_THEME, SOLARPUNK_PALETTE } from '../graph/graphVisualTokens';
import {
  applyJevGraphPhysics,
  JEV_GRAPH_PHYSICS_PROFILE_LABELS,
  JEV_GRAPH_PHYSICS_PROFILES,
  type JevGraphPhysicsProfile,
} from './jevGraphPhysics';
import {
  resolveCanonicalEntityFocusVisualId,
  type CanonicalEntityFocusRequest,
} from '../builder/canonicalEntityLinks';
import {
  isCanonicalEntityDirectory,
  readCanonicalEntityProviderPointers,
  type CanonicalEntityDirectory,
  type CanonicalEntityHeader,
} from './canonicalEntityDirectory';
import './knowledgeAuthorityGraphSurface.css';

type GraphAuthority = 'thinkgraph' | 'knowgraph';
type GraphSurfaceAuthority = GraphAuthority | 'joined';

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

type JoinedGraphNodeVariant = {
  authority: GraphAuthority;
  node: GraphProjectionNode;
};

type JoinedGraphEdgeVariant = {
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

type JevFocusIncidentRelationshipView = {
  edgeId: string;
  relationshipId: string;
  sourceVisualId: string;
  sourceId: string;
  sourceTitle: string;
  targetVisualId: string;
  targetId: string;
  targetTitle: string;
  predicate: string;
  direction: 'incoming' | 'outgoing';
  relationshipWeight: number | null;
};

type JevFocusCandidateView = {
  visualId: string;
  authority: 'ThinkGraph' | 'KnowGraph';
  entityId: string;
  title: string;
  description: string | null;
  incidentRelationships: JevFocusIncidentRelationshipView[];
};

type JevFocusCenterMemberView = {
  authority: 'ThinkGraph' | 'KnowGraph';
  entityId: string;
  title: string;
  description: string | null;
};

type JevFocusDecisionCandidateView = JevFocusCandidateView & {
  choiceId: string;
  probability: number;
  selected: boolean;
  rank: number;
};

type JevFocusDecisionView = {
  status: 'success' | 'unavailable' | 'timeout' | 'invalid' | 'error';
  errorCode: string | null;
  candidates: JevFocusDecisionCandidateView[];
};

type ManualFocusEntry = {
  centerId: string;
  centerTitle: string;
  status: 'reading' | 'loading' | JevFocusDecisionView['status'];
  decision: JevFocusDecisionView | null;
  requestIdentity: number;
  projectionKey: string;
  presentation: JoinedGraphPresentation;
  readWarning: string | null;
};

type FocusReleaseView = {
  nodeIds: string[];
  edgeIds: string[];
};

const MAX_JEV_FOCUS_CANDIDATES = 12;
const FOCUS_RELEASE_MILLISECONDS = 1_400;
const CALM_FOCUS_GALAXY_SETTINGS = {
  repel: 25,
  gravity: 48,
  damping: 6,
} as const;

const GRAPH_NODE_MATERIALS = {
  think: 'THINK_MATERIAL',
  know: 'KNOW_MATERIAL',
  paired: 'PAIRED_SOLARPUNK_MATERIAL',
} as const;

const COMBINED_CYBER_MATERIAL = 'PAIRED_CYBER_MATERIAL' as const;

type GraphNodeMaterialRole =
  | typeof GRAPH_NODE_MATERIALS[keyof typeof GRAPH_NODE_MATERIALS]
  | typeof COMBINED_CYBER_MATERIAL;

function solarpunkMaterialFields(
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

function combinedCyberMaterialFields(
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

function providerMemberKey(authority: GraphAuthority, providerId: string): string {
  return `${authority}:${providerId}`;
}

function providerRenderId(authority: GraphAuthority, providerId: string): string {
  return `${authority}:${encodeURIComponent(providerId)}`;
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

function composeFocusNeighborhoodPresentation(
  base: JoinedGraphPresentation,
  centerId: string,
  reads: Partial<Record<GraphAuthority, GraphProjectionV1[]>>,
): JoinedGraphPresentation {
  const centerVariants = base.nodeVariants.get(centerId) || [];
  const merged = (authority: GraphAuthority): GraphProjectionV1 => {
    const nodes = new Map<string, GraphProjectionNode>();
    for (const variant of centerVariants) {
      if (variant.authority === authority) nodes.set(variant.node.id, variant.node);
    }
    const edges = new Map<string, GraphProjectionEdge>();
    for (const projection of reads[authority] || []) {
      projection.nodes.forEach(node => nodes.set(node.id, node));
      projection.edges.forEach(edge => edges.set(edge.id, edge));
    }
    const visibleIds = new Set(nodes.keys());
    const boundedEdges = [...edges.values()].filter(edge => (
      visibleIds.has(edge.source) && visibleIds.has(edge.target)
    ));
    const revisions = (reads[authority] || []).map(value => value.revision || value.schemaVersion);
    return {
      schemaVersion: `${authority}.jev-focus-neighborhood.v1`,
      authority,
      projectId: base.projection.projectId,
      revision: revisions.length ? revisions.join(':') : 'center-only',
      counts: { nodes: nodes.size, edges: boundedEdges.length },
      nodes: [...nodes.values()],
      edges: boundedEdges,
      ...(authority === 'thinkgraph'
        ? { canonicalEntityDirectory:
          base.providerProjections.thinkgraph.canonicalEntityDirectory }
        : {}),
    };
  };
  return composeThinkKnowPresentation(merged('thinkgraph'), merged('knowgraph'));
}

function visualSourceKind(variants: JoinedGraphNodeVariant[]): 'think' | 'know' | 'paired' {
  const authorities = new Set(variants.map(variant => variant.authority));
  return authorities.size > 1 ? 'paired'
    : authorities.has('knowgraph') ? 'know' : 'think';
}

function finiteUnitInterval(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : null;
}

function focusRelationshipWeight(edge: GraphProjectionEdge): number | null {
  const properties = edge.properties || {};
  const jev = properties.jev && typeof properties.jev === 'object'
    && !Array.isArray(properties.jev)
    ? properties.jev as Record<string, unknown>
    : null;
  const distribution = jev?.distribution && typeof jev.distribution === 'object'
    && !Array.isArray(jev.distribution)
    ? jev.distribution as Record<string, unknown>
    : null;
  const winner = String(jev?.winner || edge.predicate || '');
  const values = [
    distribution?.[winner],
    edge.relationship_strength,
    properties.relationship_strength,
    edge.strength,
    properties.strength,
    edge.label_confidence,
    properties.label_confidence,
  ];
  for (const value of values) {
    const numeric = finiteUnitInterval(value);
    if (numeric !== null) return numeric;
  }
  return null;
}

function boundedProviderDescription(node: GraphProjectionNode): string | null {
  const properties = node.properties || {};
  const evidence = Array.isArray(properties.evidence) ? properties.evidence : [];
  const evidenceText = evidence.flatMap((item): unknown[] => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const record = item as Record<string, any>;
    const idea = record.idea && typeof record.idea === 'object' && !Array.isArray(record.idea)
      ? record.idea as Record<string, unknown>
      : {};
    const counterIdea = record.counterIdea
      && typeof record.counterIdea === 'object'
      && !Array.isArray(record.counterIdea)
      ? record.counterIdea as Record<string, unknown>
      : {};
    return [
      record.summary,
      idea.body,
      idea.detail,
      counterIdea.body,
      counterIdea.detail,
    ];
  });
  for (const value of [
    properties.description,
    properties.summary,
    properties.statement,
    properties.fact,
    properties.content,
    properties.reason,
    ...evidenceText,
    node.title,
  ]) {
    if (typeof value !== 'string') continue;
    const text = value.trim();
    if (text && text !== node.label) return text.slice(0, 1_200);
  }
  return null;
}

/**
 * Builds the complete already-loaded local relationship vocabulary considered
 * for one JevFocus Choice. The caller refuses an oversized or partially read
 * neighborhood instead of silently dropping provider Entities.
 */
function buildJevFocusCandidates(
  projection: GraphProjectionV1,
  presentation: JoinedGraphPresentation,
  centerId: string,
): JevFocusCandidateView[] {
  const centerMembers = presentation.nodeVariants.get(centerId) || [];
  const centerIdsByAuthority: Record<GraphAuthority, Set<string>> = {
    thinkgraph: new Set(centerMembers
      .filter(member => member.authority === 'thinkgraph')
      .map(member => member.node.id)),
    knowgraph: new Set(centerMembers
      .filter(member => member.authority === 'knowgraph')
      .map(member => member.node.id)),
  };
  const candidates = new Map<string, JevFocusCandidateView>();
  for (const edge of projection.edges) {
    if (edge.source !== centerId && edge.target !== centerId) continue;
    const variant = presentation.edgeVariants.get(edge.id);
    if (!variant) continue;
    const centerIds = centerIdsByAuthority[variant.authority];
    const sourceIsCenter = centerIds.has(variant.edge.source);
    const targetIsCenter = centerIds.has(variant.edge.target);
    if (sourceIsCenter === targetIsCenter) continue;
    const providerId = sourceIsCenter ? variant.edge.target : variant.edge.source;
    const providerProjection = presentation.providerProjections[variant.authority];
    const neighbor = providerProjection.nodes.find(node => node.id === providerId);
    const visualId = presentation.visualNodeIdByProviderMember.get(
      providerMemberKey(variant.authority, providerId),
    );
    if (!neighbor || !visualId || visualId === centerId) continue;
    const providerLabel = (id: string) => providerProjection.nodes.find(node => node.id === id)?.label || id;
    const authorityName = variant.authority === 'thinkgraph' ? 'ThinkGraph' : 'KnowGraph';
    const candidateKey = `${authorityName}:${providerId}`;
    const candidate = candidates.get(candidateKey) || {
      visualId,
      authority: authorityName,
      entityId: providerId,
      title: neighbor.label || neighbor.title || neighbor.id,
      description: boundedProviderDescription(neighbor),
      incidentRelationships: [],
    } satisfies JevFocusCandidateView;
    if (!candidate.incidentRelationships.some(item => item.relationshipId === variant.edge.id)) {
      candidate.incidentRelationships.push({
        edgeId: edge.id,
        relationshipId: variant.edge.id,
        sourceVisualId: edge.source,
        sourceId: variant.edge.source,
        sourceTitle: providerLabel(variant.edge.source),
        targetVisualId: edge.target,
        targetId: variant.edge.target,
        targetTitle: providerLabel(variant.edge.target),
        predicate: variant.edge.predicate,
        direction: sourceIsCenter ? 'outgoing' : 'incoming',
        relationshipWeight: focusRelationshipWeight(edge),
      });
    }
    candidates.set(candidateKey, candidate);
  }
  return [...candidates.values()]
    .sort((left, right) => (
      left.authority.localeCompare(right.authority) || left.entityId.localeCompare(right.entityId)
    ))
    .map(candidate => ({
      ...candidate,
      incidentRelationships: [...candidate.incidentRelationships]
        .sort((left, right) => left.relationshipId.localeCompare(right.relationshipId)),
    }));
}

function selectedFocusCandidates(entry: ManualFocusEntry): JevFocusDecisionCandidateView[] {
  return entry.status === 'success' && entry.decision?.status === 'success'
    ? entry.decision.candidates
      .filter(candidate => candidate.selected)
      .sort((left, right) => left.rank - right.rank
        || left.authority.localeCompare(right.authority)
        || left.entityId.localeCompare(right.entityId))
    : [];
}

function focusCenterMembers(
  presentation: JoinedGraphPresentation,
  centerId: string,
): JevFocusCenterMemberView[] {
  return (presentation.nodeVariants.get(centerId) || []).map(variant => ({
    authority: variant.authority === 'thinkgraph' ? 'ThinkGraph' : 'KnowGraph',
    entityId: variant.node.id,
    title: variant.node.label || variant.node.title || variant.node.id,
    description: boundedProviderDescription(variant.node),
  }));
}

/** Render-only focus projection. The center is user-owned; only a successful
 * JevFocus response may promote surrounding real edges and endpoint nodes. */
function composeManualFocusPresentation(
  projection: GraphProjectionV1,
  entry: ManualFocusEntry,
): { projection: GraphProjectionV1; nodeIds: string[]; edgeIds: string[] } {
  const center = projection.nodes.find(node => node.id === entry.centerId);
  if (!center) return { projection, nodeIds: [], edgeIds: [] };
  const selectedCandidates = selectedFocusCandidates(entry);
  const selectedEdgeIds = new Set(selectedCandidates.flatMap(candidate => (
    candidate.incidentRelationships.map(relationship => relationship.edgeId)
  )));
  const selectedEdges = projection.edges.filter(edge => selectedEdgeIds.has(edge.id));
  const nodeIds = new Set<string>([entry.centerId]);
  selectedCandidates.forEach(candidate => nodeIds.add(candidate.visualId));
  const probabilityByNode = new Map<string, number>();
  for (const candidate of selectedCandidates) {
    probabilityByNode.set(candidate.visualId, Math.max(
      probabilityByNode.get(candidate.visualId) || 0,
      finiteUnitInterval(candidate.probability) || 0,
    ));
  }
  const nodes = projection.nodes.filter(node => nodeIds.has(node.id)).map((node) => {
    const isCenter = node.id === entry.centerId;
    const probability = isCenter ? 1 : probabilityByNode.get(node.id) || 0;
    // Manual focus is a calm, local navigation view. Probability remains intact
    // in the decision/inspector; this bounded curve only controls transient paint
    // and gravity so one Entity cannot consume the complete canvas.
    const gravityMass = isCenter ? 7 : 1.5 + (4 * probability);
    const visualRadius = 1.2 * (1.5 + (2 * Math.pow(gravityMass, 2 / 3)));
    return {
      ...node,
      anchor_role: isCenter ? 'global' as const : 'community' as const,
      system_anchor_id: entry.centerId,
      scene_rank: isCenter ? 100 : Math.max(1, Math.round(probability * 90)),
      gravity_mass: gravityMass,
      visual_radius: visualRadius,
      material_focus_active: true,
      properties: {
        ...(node.properties || {}),
        manualFocusPresentation: 'blackhole',
        ...(isCenter ? { manualFocusCenter: true } : { jevFocusProbability: probability }),
      },
    };
  });
  const scene = projection.scene;
  const sceneNodeIds = new Set(nodes.map(node => node.id));
  const mappedNodes = new Map(nodes.map(node => [node.id, node]));
  const projectedScene = scene ? {
    ...scene,
    nodes: (Array.isArray(scene.nodes) ? scene.nodes : [])
      .filter(node => sceneNodeIds.has(node.id))
      .map(node => ({ ...node, ...(mappedNodes.get(node.id) || {}) })),
    edges: selectedEdges,
    ...(Array.isArray((scene as Record<string, unknown>).links) ? { links: selectedEdges } : {}),
  } : undefined;
  return {
    projection: {
      ...projection,
      schemaVersion: `${projection.schemaVersion}.jev-focus`,
      counts: { nodes: nodes.length, edges: selectedEdges.length },
      nodes,
      edges: selectedEdges,
      ...(projectedScene ? { scene: projectedScene } : {}),
    },
    nodeIds: [...nodeIds],
    edgeIds: selectedEdges.map(edge => edge.id),
  };
}

/** Compact view over the last accepted focus result. It reuses the exact same
 * visual nodes and provider relationships without another read or Jev call. */
function composeExpandedFocusPresentation(
  projection: GraphProjectionV1,
  entry: ManualFocusEntry | null,
): GraphProjectionV1 | null {
  if (!entry || entry.status !== 'success' || entry.decision?.status !== 'success') return null;
  const focused = composeManualFocusPresentation(projection, entry);
  const nodeIds = new Set(focused.nodeIds);
  const edgeIds = new Set(focused.edgeIds);
  const nodes = projection.nodes.filter(node => nodeIds.has(node.id));
  const edges = projection.edges.filter(edge => edgeIds.has(edge.id));
  const scene = projection.scene;
  const projectedScene = scene ? {
    ...scene,
    nodes: (Array.isArray(scene.nodes) ? scene.nodes : []).filter(node => nodeIds.has(node.id)),
    edges,
    ...(Array.isArray((scene as Record<string, unknown>).links) ? { links: edges } : {}),
  } : undefined;
  return {
    ...projection,
    schemaVersion: `${projection.schemaVersion}.jev-focus-expanded`,
    counts: { nodes: nodes.length, edges: edges.length },
    nodes,
    edges,
    ...(projectedScene ? { scene: projectedScene } : {}),
  };
}

function parseJevFocusDecision(
  value: unknown,
  expected: JevFocusCandidateView[],
  expectedSourceRevision: string,
): JevFocusDecisionView {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('jev_focus_response_invalid');
  }
  const raw = value as Record<string, unknown>;
  const status = String(raw.status || '') as JevFocusDecisionView['status'];
  if (raw.schemaVersion !== 'jev-focus.v1'
    || raw.sourceRevision !== expectedSourceRevision
    || !['success', 'unavailable', 'timeout', 'invalid', 'error'].includes(status)) {
    throw new Error('jev_focus_response_invalid');
  }
  if (status !== 'success') {
    if ((raw.candidates && Array.isArray(raw.candidates) && raw.candidates.length)
      || (raw.distribution && typeof raw.distribution === 'object'
        && Object.keys(raw.distribution as object).length)) {
      throw new Error('jev_focus_fallback_must_not_claim_distribution');
    }
    return {
      status,
      errorCode: typeof raw.errorCode === 'string' ? raw.errorCode : 'jev_focus_unavailable',
      candidates: [],
    };
  }
  const rawCandidates = Array.isArray(raw.candidates) ? raw.candidates : [];
  const candidateKey = (candidate: Pick<JevFocusCandidateView, 'authority' | 'entityId'>) => (
    `${candidate.authority}:${candidate.entityId}`
  );
  const expectedByProviderMember = new Map(expected.map(candidate => [candidateKey(candidate), candidate]));
  const candidates: JevFocusDecisionCandidateView[] = rawCandidates.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('jev_focus_response_invalid');
    }
    const candidate = item as Record<string, unknown>;
    const authority = String(candidate.authority || '') as JevFocusCandidateView['authority'];
    const entityId = String(candidate.entityId || '');
    const source = expectedByProviderMember.get(`${authority}:${entityId}`);
    const probability = Number(candidate.probability);
    const rank = Number(candidate.rank);
    if (!source || typeof candidate.choiceId !== 'string' || !candidate.choiceId
      || !Number.isFinite(probability) || probability < 0 || probability > 1
      || !Number.isInteger(rank) || rank < 1) {
      throw new Error('jev_focus_response_invalid');
    }
    return {
      ...source,
      choiceId: candidate.choiceId,
      probability,
      selected: candidate.selected === true,
      rank,
    };
  });
  if (candidates.length !== expected.length
    || new Set(candidates.map(candidate => candidateKey(candidate))).size !== expected.length
    || new Set(candidates.map(candidate => candidate.choiceId)).size !== expected.length) {
    throw new Error('jev_focus_response_invalid');
  }
  const distribution = raw.distribution && typeof raw.distribution === 'object'
    && !Array.isArray(raw.distribution)
    ? raw.distribution as Record<string, unknown>
    : {};
  const choiceIds = new Set(candidates.map(candidate => candidate.choiceId));
  if (Object.keys(distribution).length !== choiceIds.size
    || Object.keys(distribution).some(choiceId => !choiceIds.has(choiceId))) {
    throw new Error('jev_focus_response_invalid');
  }
  const normalizedDistribution: Record<string, number> = {};
  for (const choiceId of choiceIds) {
    const probability = Number(distribution[choiceId]);
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
      throw new Error('jev_focus_response_invalid');
    }
    normalizedDistribution[choiceId] = probability;
  }
  const probabilityValues = Object.values(normalizedDistribution);
  const roundingHalfStep = 0.005;
  const roundedTotalCanEqualOne = probabilityValues.some(probability => probability !== 0)
    && probabilityValues.reduce(
      (sum, probability) => sum + Math.max(0, probability - roundingHalfStep), 0,
    ) <= 1 + Number.EPSILON
    && probabilityValues.reduce(
      (sum, probability) => sum + Math.min(1, probability + roundingHalfStep), 0,
    ) >= 1 - Number.EPSILON;
  const ranked = [...candidates].sort((left, right) => (
    right.probability - left.probability
      || left.authority.localeCompare(right.authority)
      || left.entityId.localeCompare(right.entityId)
  ));
  const ranks = new Set(candidates.map(candidate => candidate.rank));
  const selectedVisualIds = new Set<string>();
  for (const candidate of ranked) {
    if (selectedVisualIds.size >= 8) break;
    selectedVisualIds.add(candidate.visualId);
  }
  const decisionId = typeof raw.decisionId === 'string' ? raw.decisionId.trim() : '';
  if (!roundedTotalCanEqualOne
    || !decisionId
    || ranks.size !== candidates.length
    || candidates.some(candidate => candidate.rank < 1 || candidate.rank > candidates.length)
    || ranked.some((candidate, index) => candidate.rank !== index + 1)
    || candidates.some(candidate => (
      Math.abs(candidate.probability - normalizedDistribution[candidate.choiceId]) > 0.000001
      || candidate.selected !== selectedVisualIds.has(candidate.visualId)
    ))) {
    throw new Error('jev_focus_response_invalid');
  }
  return {
    status: 'success',
    errorCode: null,
    candidates,
  };
}

async function requestJevFocus({
  projectId,
  centerId,
  centerTitle,
  centerProviderMembers,
  sourceRevision,
  candidates,
  signal,
}: {
  projectId: string;
  centerId: string;
  centerTitle: string;
  centerProviderMembers: JevFocusCenterMemberView[];
  sourceRevision: string;
  candidates: JevFocusCandidateView[];
  signal: AbortSignal;
}): Promise<JevFocusDecisionView> {
  if (!candidates.length) {
    return {
      status: 'unavailable', errorCode: 'jev_focus_no_connected_candidates', candidates: [],
    };
  }
  const response = await fetch('/api/graph/jev-focus', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      schemaVersion: 'jev-focus.request.v1',
      projectId,
      sourceRevision,
      center: { visualId: centerId, title: centerTitle, providerMembers: centerProviderMembers },
      candidates,
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(String(payload?.error || 'jev_focus_request_failed'));
  return parseJevFocusDecision(payload, candidates, sourceRevision);
}

function composeFocusReleasePresentation(
  projection: GraphProjectionV1,
  release: FocusReleaseView | null,
): GraphProjectionV1 {
  if (!release) return projection;
  const elevated = new Set(release.nodeIds);
  return {
    ...projection,
    nodes: projection.nodes.map(node => elevated.has(node.id) ? {
      ...node,
      material_focus_active: true,
      properties: { ...(node.properties || {}), focusRelease: true },
    } : node),
    edges: projection.edges.map(edge => release.edgeIds.includes(edge.id) ? {
      ...edge,
      properties: { ...(edge.properties || {}), focusRelease: true },
    } : edge),
  };
}

export function JoinedKnowledgeGraphSurface({
  projections,
  statuses,
  errors,
  onReadProviderFocusNeighborhood,
  onRemoveThinkGraphEvidence,
  onRemoveKnowGraphEvidence,
  entityFocusRequest,
}: {
  projections: Record<GraphAuthority, GraphProjectionV1>;
  statuses?: Partial<Record<GraphAuthority, 'idle' | 'loading' | 'ready' | 'error'>>;
  errors?: Partial<Record<GraphAuthority, string>>;
  onReadProviderFocusNeighborhood?: ReadProviderFocusNeighborhood;
  onRemoveThinkGraphEvidence?: (memoryId: string) => Promise<void>;
  onRemoveKnowGraphEvidence?: (episodeId: string) => Promise<void>;
  entityFocusRequest?: CanonicalEntityFocusRequest | null;
}) {
  const presentation = useMemo(
    () => composeThinkKnowPresentation(
      projections.thinkgraph,
      projections.knowgraph,
    ),
    [projections.knowgraph, projections.thinkgraph],
  );
  const visibleAuthorities = ['thinkgraph', 'knowgraph'] as const;
  const visibleStatuses = visibleAuthorities.map(authority => (
    errors?.[authority] ? 'error' : statuses?.[authority] || 'ready'
  ));
  const authorityErrors = visibleAuthorities.flatMap(authority => errors?.[authority]
    ? [`${authority === 'thinkgraph' ? 'ThinkGraph' : 'KnowGraph'} unavailable: ${errors[authority]}`]
    : []);
  const status = visibleStatuses.every(value => value === 'error')
    ? 'error'
    : visibleStatuses.some(value => value === 'ready')
      ? 'ready'
      : visibleStatuses.some(value => value === 'loading')
        ? 'loading'
        : 'idle';
  const error = status === 'error'
    ? authorityErrors.join(' · ')
    : null;
  const warning = status !== 'error' && authorityErrors.length
    ? authorityErrors.join(' · ')
    : null;
  return (
    <KnowledgeGraphProjectionSurface
      authority="joined"
      canonicalEntityDirectory={
        projections.thinkgraph.canonicalEntityDirectory
      }
      entityFocusRequest={entityFocusRequest}
      projection={presentation.projection}
      joinedPresentation={presentation}
      onReadProviderFocusNeighborhood={onReadProviderFocusNeighborhood}
      status={status}
      error={error}
      warning={warning}
      onRemoveEvidence={onRemoveThinkGraphEvidence}
      onRemoveKnowEvidence={onRemoveKnowGraphEvidence}
    />
  );
}

type RendererLayout = 'compact' | 'original' | 'communities' | 'radial' | 'galaxy';
type PresentationStyle = 'classic' | 'cyber' | 'galaxy' | 'solar' | 'solarpunk';
type RendererStyle = Exclude<PresentationStyle, 'solarpunk'>;
type SolarpunkColors = {
  think: string;
  know: string;
  thinkRelationship: string;
  knowRelationship: string;
};
type GraphPresentationPreferences = {
  schemaVersion: 2 | 3 | 4 | 5 | 6;
  layout: RendererLayout;
  style: PresentationStyle;
  physicsProfile: JevGraphPhysicsProfile;
  settings: Record<string, number | boolean | string>;
  solarpunkColors: SolarpunkColors;
};

const DEFAULT_SOLARPUNK_COLORS: SolarpunkColors = {
  think: SOLARPUNK_PALETTE.sea,
  know: SOLARPUNK_PALETTE.sun,
  thinkRelationship: SOLARPUNK_PALETTE.sea,
  knowRelationship: SOLARPUNK_PALETTE.sun,
};
const RENDERER_LAYOUTS = new Set<RendererLayout>([
  'compact', 'original', 'communities', 'radial', 'galaxy',
]);
const PRESENTATION_STYLES = new Set<PresentationStyle>([
  'classic', 'cyber', 'galaxy', 'solar', 'solarpunk',
]);
const JEV_PHYSICS = new Set<JevGraphPhysicsProfile>(JEV_GRAPH_PHYSICS_PROFILES);
const SOLARPUNK_HEX = /^#[0-9a-f]{6}$/i;
const PRESENTATION_SETTING_BOUNDS = {
  size: [1, 12],
  font: [6, 24],
  linkw: [0.1, 2],
  labelDensity: [1, 100],
  repel: [0, 400],
  link: [4, 80],
  gravity: [0, 400],
} as const;

export function knowEvidenceIdentity(item: Record<string, unknown>): string | null {
  const providerEpisodeId = typeof item.graphitiEpisodeId === 'string'
    ? item.graphitiEpisodeId.trim()
    : '';
  return providerEpisodeId || null;
}

function safePresentationSettings(value: unknown): Record<string, number | boolean | string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const settings: Record<string, number | boolean | string> = {};
  if (typeof source.labels === 'boolean') settings.labels = source.labels;
  for (const [key, [minimum, maximum]] of Object.entries(PRESENTATION_SETTING_BOUNDS)) {
    const candidate = source[key];
    if (typeof candidate === 'number' && Number.isFinite(candidate)
      && candidate >= minimum && candidate <= maximum) {
      settings[key] = candidate;
    }
  }
  return settings;
}

function presentationStorageKey(authority: GraphSurfaceAuthority): string {
  return `liquidaity.graph.${authority}.presentation.v1`;
}

function safePresentationPreferences(
  authority: GraphSurfaceAuthority,
): Partial<GraphPresentationPreferences> {
  if (typeof window === 'undefined') return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(presentationStorageKey(authority)) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const settings = safePresentationSettings(parsed.settings);
    const rawColors = parsed.solarpunkColors && typeof parsed.solarpunkColors === 'object'
      ? parsed.solarpunkColors as Partial<SolarpunkColors>
      : {};
    const defaultColors = DEFAULT_SOLARPUNK_COLORS;
    const legacyThinkColor = /^(?:#6e5fae|#3979e8)$/i.test(String(rawColors.think || ''));
    const legacyThinkEdgeColor = /^#3979e8$/i.test(
      String(rawColors.thinkRelationship || ''),
    );
    return {
      ...([2, 3, 4, 5, 6].includes(parsed.schemaVersion)
        ? { schemaVersion: parsed.schemaVersion as 2 | 3 | 4 | 5 | 6 }
        : {}),
      ...(RENDERER_LAYOUTS.has(parsed.layout) ? { layout: parsed.layout } : {}),
      ...(PRESENTATION_STYLES.has(parsed.style) ? { style: parsed.style } : {}),
      ...(JEV_PHYSICS.has(parsed.physicsProfile) ? { physicsProfile: parsed.physicsProfile } : {}),
      ...(settings ? { settings } : {}),
      solarpunkColors: {
        think: !legacyThinkColor && SOLARPUNK_HEX.test(String(rawColors.think || ''))
          ? String(rawColors.think) : defaultColors.think,
        know: SOLARPUNK_HEX.test(String(rawColors.know || ''))
          ? String(rawColors.know) : defaultColors.know,
        thinkRelationship: !legacyThinkEdgeColor
          && SOLARPUNK_HEX.test(String(rawColors.thinkRelationship || ''))
          ? String(rawColors.thinkRelationship) : defaultColors.thinkRelationship,
        knowRelationship: SOLARPUNK_HEX.test(String(rawColors.knowRelationship || ''))
          ? String(rawColors.knowRelationship) : defaultColors.knowRelationship,
      },
    };
  } catch {
    return {};
  }
}

function rendererStyle(style: PresentationStyle): RendererStyle {
  return style === 'solarpunk' ? 'cyber' : style;
}

function withoutSolarpunkMaterial(node: GraphProjectionNode): GraphProjectionNode {
  const next = { ...node };
  delete next.material_kind;
  delete next.material_role;
  delete next.material_blue;
  delete next.material_orange;
  delete next.material_surface;
  delete next.material_think_active;
  delete next.material_know_active;
  delete next.material_focus_active;
  return next;
}

function solarpunkEdgeFields(
  authority: GraphAuthority,
  colors: SolarpunkColors,
): Pick<GraphProjectionEdge, 'material_kind' | 'material_authority' | 'material_color'> {
  return {
    material_kind: 'solarpunk',
    material_authority: authority,
    material_color: authority === 'knowgraph'
      ? colors.knowRelationship
      : colors.thinkRelationship,
  };
}

function withoutSolarpunkEdgeMaterial(edge: GraphProjectionEdge): GraphProjectionEdge {
  const next = { ...edge };
  delete next.material_kind;
  delete next.material_authority;
  delete next.material_color;
  return next;
}

type EngraphisRenderer = {
  setPreset: (name: RendererLayout) => Record<string, number | boolean | string>;
  setStyle: (name: RendererStyle) => void;
  setSettings: (settings: Record<string, number | boolean | string>) => void;
  setData: (data: { nodes: unknown[]; links?: unknown[]; edges?: unknown[] }) => void;
  setHighlight: (id: string | null) => void;
  setThemeColors: (colors: Record<string, string>) => void;
  graphToScreen: (x: number, y: number) => { x: number; y: number };
  fit: () => void;
  resize: () => void;
  focus: (id: string) => boolean;
  clearFocus: () => void;
  freeze: (on: boolean) => void;
  reheat: () => void;
  setCollapse: (mode: boolean | 'auto') => void;
  destroy: () => void;
};

declare global {
  interface Window {
    EngraphisGraph: { create: (host: HTMLElement, options: {
      onNodeClick: (node: { id: string }) => void;
      onNodeDoubleClick?: (node: { id: string }) => void;
      onLinkClick: (link: { id: string }) => void;
      onBackgroundClick: () => void;
    }) => EngraphisRenderer };
  }
}

type SourceLinkView = {
  url: string;
  label: string;
  publisher: string;
  fingerprint: string | null;
};

const SECRET_CITATION_QUERY_KEY = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|authorization)/i;

function safeSourceUrl(value: string): URL | null {
  if (value.length > 2048 || value.includes('\\')
    || [...value].some(character => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || !parsed.hostname
      || parsed.username || parsed.password
      || [...parsed.searchParams.keys()].some(key => SECRET_CITATION_QUERY_KEY.test(key))) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function sourcePathLabel(url: URL): string {
  const finalSegment = decodeURIComponent(
    url.pathname.split('/').filter(Boolean).at(-1) || '',
  ).replace(/\.[a-z0-9]+$/i, '');
  const readable = finalSegment.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return readable
    ? readable.charAt(0).toUpperCase() + readable.slice(1)
    : url.hostname;
}

export function sourceLinks(candidate: Record<string, unknown>): SourceLinkView[] {
  const rawUrls: unknown[] = [candidate.source_url, candidate.url];
  const described = candidate.source_description ?? candidate.sourceDescription;
  if (Array.isArray(described)) rawUrls.push(...described);
  else if (typeof described === 'string' && described.trim()) {
    try {
      const parsed = JSON.parse(described);
      if (Array.isArray(parsed)) rawUrls.push(...parsed);
      else rawUrls.push(described);
    } catch {
      rawUrls.push(described);
    }
  }
  const validUrls = new Map<string, URL>();
  for (const rawUrl of rawUrls) {
    if (typeof rawUrl !== 'string') continue;
    const url = rawUrl.trim();
    const parsed = safeSourceUrl(url);
    if (parsed) validUrls.set(url, parsed);
  }
  const fingerprint = validUrls.size === 1
    ? String(
      candidate.content_fingerprint
      || candidate.source_fingerprint
      || candidate.document_fingerprint
      || '',
    ).trim() || null
    : null;
  const explicitLabel = validUrls.size === 1
    ? String(candidate.source_title || candidate.title || '').trim()
    : '';
  const links = new Map<string, SourceLinkView>();
  for (const [url, parsed] of validUrls) {
    const item = {
      url,
      label: explicitLabel || sourcePathLabel(parsed),
      publisher: String(candidate.publisher || parsed.hostname),
      fingerprint,
    };
    links.set(fingerprint ? `fingerprint:${fingerprint}` : `url:${url}`, item);
  }
  return [...links.values()];
}

function graphEntryTime(value: unknown): { dateTime: string; label: string } | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'object' && !Array.isArray(value)) {
    const parts = value as Record<string, unknown>;
    const year = Number(parts.year);
    const month = Number(parts.month);
    const day = Number(parts.day);
    if (Number.isInteger(year) && Number.isInteger(month) && Number.isInteger(day)) {
      const milliseconds = Date.UTC(
        year,
        month - 1,
        day,
        Number(parts.hour || 0),
        Number(parts.minute || 0),
        Number(parts.second || 0),
        Math.floor(Number(parts.nanosecond || 0) / 1_000_000),
      ) - Number(parts.timeZoneOffsetSeconds || 0) * 1_000;
      const date = new Date(milliseconds);
      if (!Number.isNaN(date.getTime())) {
        return { dateTime: date.toISOString(), label: date.toLocaleString() };
      }
    }
  }
  const numeric = Number(value);
  const milliseconds = Number.isFinite(numeric)
    ? numeric * (Math.abs(numeric) < 10_000_000_000 ? 1_000 : 1)
    : Date.parse(String(value));
  if (!Number.isFinite(milliseconds)) return null;
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) return null;
  return { dateTime: date.toISOString(), label: date.toLocaleString() };
}

function probabilityLabel(value: unknown): string | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return `${(Math.max(0, Math.min(1, numeric)) * 100).toFixed(1)}%`;
}

function compactProbability(value: unknown): string | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.min(1, numeric)).toFixed(2).replace(/^0/, '');
}

function thinkRelationships(item: Record<string, any>): string[] {
  const metadata = item.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return [];
  const structured = metadata.structured_extraction;
  const raw = structured && typeof structured === 'object' && !Array.isArray(structured)
    ? structured.relations
    : metadata.relations;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value): string[] => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const relation = value as Record<string, unknown>;
    const source = typeof relation.source === 'string' ? relation.source.trim() : '';
    const predicate = typeof relation.relation === 'string' ? relation.relation.trim() : '';
    const target = typeof relation.target === 'string' ? relation.target.trim() : '';
    return source && predicate && target ? [`${source} ${predicate} ${target}`] : [];
  });
}

function ThinkRecordCard({
  item,
  heading,
  removing = false,
  onRemove,
}: {
  item: Record<string, any>;
  heading: string;
  removing?: boolean;
  onRemove?: () => void;
}) {
  const entryTime = graphEntryTime(item.ingestedAt);
  const summary = typeof item.summary === 'string' && item.summary.trim()
    ? item.summary
    : typeof item.content === 'string' && item.content.trim()
      ? item.content
      : null;
  const relationships = thinkRelationships(item);
  return <section className="graph-note graph-think" data-memory-id={item.id}>
    <div className="graph-think-heading">
      <h4>{String(item.title || heading)}</h4>
    </div>
    {entryTime ? <p className="graph-record-time"><time dateTime={entryTime.dateTime}>
      {entryTime.label}
    </time></p> : null}
    {summary ? <p>{summary}</p> : null}
    {relationships.length ? <section className="graph-think-section">
      <h5>Relationships</h5>
      <ul>{relationships.map(value => <li key={value}>{value}</li>)}</ul>
    </section> : null}
    {onRemove ? <button type="button" aria-label="Delete record" disabled={removing}
      style={{ width: 'fit-content', padding: '3px 8px', fontSize: 11 }} onClick={() => {
      if (window.confirm('Delete this record?')) onRemove();
    }}>
      {removing ? 'Deleting…' : 'Delete'}
    </button> : null}
  </section>;
}

type KnowInspectorRecord = {
  episodeId: string;
  know: Record<string, any>;
  episode: Record<string, any>;
};

const INSPECTOR_RECORD_LIMIT = 2;

function uniqueRecordSources(records: KnowInspectorRecord[]): SourceLinkView[] {
  const sources = new Map<string, SourceLinkView>();
  for (const record of records) {
    const candidates: Record<string, unknown>[] = [record.episode];
    for (const sideKey of ['idea', 'counterIdea'] as const) {
      const side = record.episode[sideKey];
      if (!side || typeof side !== 'object' || Array.isArray(side)) continue;
      const citations = (side as Record<string, unknown>).citations;
      if (!Array.isArray(citations)) continue;
      for (const citation of citations) {
        if (citation && typeof citation === 'object' && !Array.isArray(citation)) {
          candidates.push(citation as Record<string, unknown>);
        }
      }
    }
    for (const candidate of candidates) {
      for (const link of sourceLinks(candidate)) {
        sources.set(
          link.fingerprint ? `fingerprint:${link.fingerprint}` : `url:${link.url}`,
          link,
        );
      }
    }
  }
  return [...sources.values()];
}

function KnowSide({
  label,
  side,
}: {
  label: 'For' | 'Against';
  side: Record<string, unknown>;
}) {
  const body = typeof side.body === 'string' ? side.body.trim() : '';
  if (!body) return null;
  const detail = typeof side.detail === 'string' ? side.detail.trim() : '';
  const citations = Array.isArray(side.citations)
    ? side.citations.flatMap((candidate): Array<{
        link: SourceLinkView;
        supports: string;
      }> => {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
        const citation = candidate as Record<string, unknown>;
        return sourceLinks(citation).map(link => ({
          link,
          supports: typeof citation.supports === 'string' ? citation.supports.trim() : '',
        }));
      })
    : [];
  return <div className="graph-know-side">
    <strong>{label}</strong>
    <p>{body}</p>
    {detail && detail !== body ? <details>
      <summary>More</summary>
      <p>{detail}</p>
    </details> : null}
    {citations.length ? <ul className="graph-know-citations">
      {citations.map(({ link, supports }, index) => <li key={`${link.url}:${index}`}>
        <a href={link.url} target="_blank" rel="noopener noreferrer">{link.label}</a>
        <small>{link.publisher}</small>
        {supports ? <p>{supports}</p> : null}
      </li>)}
    </ul> : null}
  </div>;
}

function KnowGraphKnow({
  record,
  heading,
  removing = false,
  onRemove,
}: {
  record: KnowInspectorRecord;
  heading: string;
  removing?: boolean;
  onRemove?: () => void;
}) {
  const { episodeId, know } = record;
  const entryTime = graphEntryTime(know.observedAt);
  const sourceDate = graphEntryTime(know.sourceDate);
  return <section className="graph-note graph-know" data-episode-id={episodeId}>
    <div className="graph-think-heading"><h5>{String(know.title || heading)}</h5></div>
    <KnowSide label="For" side={know.idea || {}} />
    <KnowSide label="Against" side={know.counterIdea || {}} />
    {entryTime ? <p className="graph-record-time"><span>Observed</span>{' '}<time dateTime={entryTime.dateTime}>{entryTime.label}</time></p> : null}
    {sourceDate ? <p className="graph-record-time"><span>Source date</span>{' '}<time dateTime={sourceDate.dateTime}>{sourceDate.label}</time></p> : null}
    {onRemove ? <button
      type="button"
      aria-label="Delete record"
      disabled={removing}
      style={{ width: 'fit-content', padding: '3px 8px', fontSize: 11 }}
      onClick={() => {
        if (window.confirm('Delete this record?')) onRemove();
      }}
    >{removing ? 'Deleting…' : 'Delete'}</button> : null}
  </section>;
}

function KnowSourceList({
  records,
}: {
  records: KnowInspectorRecord[];
}) {
  const sources = uniqueRecordSources(records);
  if (!sources.length) return null;
  return <section className="knowgraph-sources graph-entity-sources">
    <h4>Sources</h4>
    {sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">
      <span>{source.label}</span>
      <small>{source.publisher}</small>
    </a>)}
  </section>;
}

export function KnowledgeGraphProjectionSurface({
  projection,
  status,
  error,
  warning,
  authority = 'knowgraph',
  joinedPresentation,
  onReadProviderFocusNeighborhood,
  onRemoveEvidence,
  onRemoveKnowEvidence,
  canonicalEntityDirectory,
  entityFocusRequest,
}: {
  projection: GraphProjectionV1 | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  warning?: string | null;
  authority?: GraphSurfaceAuthority;
  joinedPresentation?: JoinedGraphPresentation;
  onReadProviderFocusNeighborhood?: ReadProviderFocusNeighborhood;
  onRemoveEvidence?: (memoryId: string) => Promise<void>;
  onRemoveKnowEvidence?: (episodeId: string) => Promise<void>;
  canonicalEntityDirectory?: CanonicalEntityDirectory | null;
  entityFocusRequest?: CanonicalEntityFocusRequest | null;
}) {
  const savedPresentationRef = useRef(safePresentationPreferences(authority));
  const savedPresentation = savedPresentationRef.current;
  const savedPresentationIsCurrent = savedPresentation.schemaVersion === 6;
  const hostRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<EngraphisRenderer | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedAuthority, setSelectedAuthority] = useState<GraphAuthority | null>(null);
  const [selectedMemberKey, setSelectedMemberKey] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [settings, setSettings] = useState<Record<string, number | boolean | string>>(
    savedPresentationIsCurrent
      ? savedPresentation.settings || {}
      : { ...(savedPresentation.settings || {}), size: 5 },
  );
  const [layout, setLayout] = useState<RendererLayout>(savedPresentation.layout || 'compact');
  const [style, setStyle] = useState<PresentationStyle>(
    savedPresentationIsCurrent ? savedPresentation.style || 'solarpunk' : 'solarpunk',
  );
  const [physicsProfile, setPhysicsProfile] = useState<JevGraphPhysicsProfile>(
    savedPresentation.physicsProfile || 'galaxy',
  );
  const [solarpunkColors, setSolarpunkColors] = useState<SolarpunkColors>(
    savedPresentationIsCurrent
      ? savedPresentation.solarpunkColors || DEFAULT_SOLARPUNK_COLORS
      : DEFAULT_SOLARPUNK_COLORS,
  );
  const [appliedPresetNodeSize, setAppliedPresetNodeSize] = useState<number | null>(null);
  const [focusTrail, setFocusTrail] = useState<ManualFocusEntry[]>([]);
  const [expandedFocusResult, setExpandedFocusResult] = useState<ManualFocusEntry | null>(null);
  const [focusRelease, setFocusRelease] = useState<FocusReleaseView | null>(null);
  const focusRequestControllersRef = useRef(new Map<number, AbortController>());
  const focusRequestIdentityRef = useRef(0);
  const focusProjectionKeyRef = useRef('');
  const focusReleaseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusActionRef = useRef<(id: string) => void>(() => undefined);
  const exitFocusRef = useRef<() => void>(() => undefined);
  const inspectNodeRef = useRef<(id: string) => void>(() => undefined);
  const consumedEntityFocusRequestRef = useRef<number | null>(null);
  const presentationStateRef = useRef<{
    layout: RendererLayout;
    style: PresentationStyle;
    physicsProfile: JevGraphPhysicsProfile;
    settings: Record<string, number | boolean | string>;
  }>({ layout: 'compact', style: 'cyber', physicsProfile: 'galaxy', settings: {} });
  const automaticPresentationRef = useRef<{
    renderer: EngraphisRenderer | null;
    snapshot: typeof presentationStateRef.current;
    manualLayout: boolean;
    manualStyle: boolean;
    manualPhysics: boolean;
    manualSettings: Set<string>;
    manualAllSettings: boolean;
  } | null>(null);
  const panelBodyRef = useRef<HTMLDivElement>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [paperViewport, setPaperViewport] = useState({ x: 0, y: 0, zoom: 1 });
  const cameraRef = useRef<{ x: number; y: number; scale: number } | null>(null);
  presentationStateRef.current = { layout, style, physicsProfile, settings };
  const focusedEntry = focusTrail.length ? focusTrail[focusTrail.length - 1] : null;
  const successfulFocusedEntry = focusedEntry?.status === 'success'
    && focusedEntry.decision?.status === 'success'
    ? focusedEntry
    : null;
  const focusRequestPending = focusedEntry?.status === 'reading' || focusedEntry?.status === 'loading';
  const activeJoinedPresentation = successfulFocusedEntry?.presentation
    || expandedFocusResult?.presentation
    || joinedPresentation;
  const localDisplayProjection = useMemo(
    () => projection ? applyJevGraphPhysics(projection, physicsProfile) : null,
    [physicsProfile, projection],
  );
  const manualProjectionSource = useMemo(
    () => authority === 'joined' && activeJoinedPresentation
      ? applyJevGraphPhysics(activeJoinedPresentation.projection, physicsProfile)
      : localDisplayProjection,
    [activeJoinedPresentation, authority, localDisplayProjection, physicsProfile],
  );
  const focusProjectionKey = useMemo(() => {
    if (authority !== 'joined' || !joinedPresentation) return '';
    const projectionIdentity = (value: GraphProjectionV1) => {
      const material = JSON.stringify({
        authority: value.authority,
        projectId: value.projectId,
        revision: value.revision || '',
        nodes: value.nodes.map(node => [node.id, node.canonicalId || '', node.label]).sort(),
        edges: value.edges.map(edge => [
          edge.id, edge.source, edge.target, edge.predicate || '',
        ]).sort(),
      });
      let fingerprint = 2166136261;
      for (let index = 0; index < material.length; index += 1) {
        fingerprint ^= material.charCodeAt(index);
        fingerprint = Math.imul(fingerprint, 16777619);
      }
      return `${value.authority}:${value.nodes.length}:${value.edges.length}:${(fingerprint >>> 0).toString(16)}`;
    };
    return [
      joinedPresentation.projection.projectId,
      projectionIdentity(joinedPresentation.providerProjections.thinkgraph),
      projectionIdentity(joinedPresentation.providerProjections.knowgraph),
    ].join('|');
  }, [authority, joinedPresentation]);
  focusProjectionKeyRef.current = focusProjectionKey;
  const manualNavigationActive = focusedEntry !== null || expandedFocusResult !== null;
  const blackholePresentationActive = successfulFocusedEntry !== null;
  const manualFocusPresentation = useMemo(
    () => manualProjectionSource && successfulFocusedEntry
      ? composeManualFocusPresentation(manualProjectionSource, successfulFocusedEntry)
      : null,
    [manualProjectionSource, successfulFocusedEntry],
  );
  const expandedFocusPresentation = useMemo(
    () => manualProjectionSource
      ? composeExpandedFocusPresentation(manualProjectionSource, expandedFocusResult)
      : null,
    [expandedFocusResult, manualProjectionSource],
  );
  const displayProjection = useMemo(
    () => manualFocusPresentation?.projection
      || (expandedFocusPresentation || localDisplayProjection
        ? composeFocusReleasePresentation(
          expandedFocusPresentation || localDisplayProjection!,
          focusRelease,
        )
        : null),
    [expandedFocusPresentation, focusRelease, localDisplayProjection, manualFocusPresentation],
  );
  const selectedVisual = displayProjection?.nodes.find(node => node.id === selectedId);
  const selectedNodeVariants: JoinedGraphNodeVariant[] = selectedVisual
    ? activeJoinedPresentation?.nodeVariants.get(selectedVisual.id)
      || (authority !== 'joined' ? [{ authority, node: selectedVisual }] : [])
    : [];
  const directThinkAvailable = selectedNodeVariants.some(variant => (
    variant.authority === 'thinkgraph'
    && Array.isArray(variant.node.properties?.evidence)
    && variant.node.properties.evidence.some((item: unknown) => (
      item !== null && typeof item === 'object' && !Array.isArray(item)
    ))
  ));
  const directKnowAvailable = selectedNodeVariants.some(variant => (
    variant.authority === 'knowgraph'
    && Array.isArray(variant.node.properties?.evidence)
    && variant.node.properties.evidence.some((item: unknown) => (
      item !== null && typeof item === 'object' && !Array.isArray(item)
      && knowEvidenceIdentity(item as Record<string, unknown>) !== null
    ))
  ));
  const defaultSelectedAuthority = directThinkAvailable
    ? 'thinkgraph'
    : directKnowAvailable ? 'knowgraph' : null;
  const inspectedNodeAuthority = selectedAuthority
    && ((selectedAuthority === 'thinkgraph' && directThinkAvailable)
      || (selectedAuthority === 'knowgraph' && directKnowAvailable))
    ? selectedAuthority
    : defaultSelectedAuthority;
  const selectedAuthorityVariants = selectedNodeVariants.filter(
    variant => variant.authority === inspectedNodeAuthority,
  );
  const selectedNodeVariant = selectedAuthorityVariants.find(
    variant => providerMemberKey(variant.authority, variant.node.id) === selectedMemberKey,
  ) || selectedAuthorityVariants[0];
  const selected = selectedNodeVariant?.node;
  const selectedEdgeVisual = displayProjection?.edges.find(edge => edge.id === selectedEdgeId);
  const selectedEdgeVariant: JoinedGraphEdgeVariant | undefined = selectedEdgeVisual
    ? activeJoinedPresentation?.edgeVariants.get(selectedEdgeVisual.id)
      || (authority !== 'joined' ? { authority, edge: selectedEdgeVisual } : undefined)
    : undefined;
  const selectedEdge = selectedEdgeVariant?.edge;
  const inspectedAuthority = selectedEdgeVariant?.authority || selectedNodeVariant?.authority || null;
  const inspectedProjection = authority === 'joined' && inspectedAuthority
    ? activeJoinedPresentation?.providerProjections[inspectedAuthority] || null
    : displayProjection;
  const selectedProperties = selected?.properties || {};
  const openNodeInspector = (visualNodeId: string) => {
    setControlsOpen(false);
    setRemoveError(null);
    setSelectedMemberKey(null);
    setSelectedId(visualNodeId);
    setSelectedEdgeId(null);
    setInspectorOpen(true);
  };
  inspectNodeRef.current = openNodeInspector;
  const syncPaper = () => {
    const graph = graphRef.current;
    if (!graph) return;
    const origin = graph.graphToScreen(0, 0);
    const unit = graph.graphToScreen(1, 0);
    const current = { x: origin.x, y: origin.y, scale: unit.x - origin.x };
    const previous = cameraRef.current;
    cameraRef.current = current;
    if (previous && previous.scale > 0) setPaperViewport(paper => ({
      x: paper.x + current.x - previous.x, y: paper.y + current.y - previous.y,
      zoom: paper.zoom * current.scale / previous.scale,
    }));
  };
  const beginCameraGesture = () => { cameraRef.current = null; syncPaper(); };
  const zoom = (key: '+' | '-') => {
    beginCameraGesture();
    const canvas = hostRef.current?.querySelector('canvas');
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true,
      clientX: bounds.left + bounds.width / 2, clientY: bounds.top + bounds.height / 2,
      deltaY: key === '+' ? -120 : 120 }));
  };

  const beginFocusRelease = (entry: ManualFocusEntry | null) => {
    if (!entry || !manualProjectionSource) {
      setFocusRelease(null);
      return;
    }
    const focused = composeManualFocusPresentation(manualProjectionSource, entry);
    setFocusRelease({
      nodeIds: focused.nodeIds,
      edgeIds: focused.edgeIds,
    });
    if (focusReleaseTimeoutRef.current) clearTimeout(focusReleaseTimeoutRef.current);
    const reducedMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) {
      setFocusRelease(null);
      return;
    }
    focusReleaseTimeoutRef.current = setTimeout(() => {
      focusReleaseTimeoutRef.current = null;
      setFocusRelease(null);
    }, FOCUS_RELEASE_MILLISECONDS);
  };

  const exitManualFocus = () => {
    const current = focusTrail.length ? focusTrail[focusTrail.length - 1] : null;
    if (!current && !focusRelease) return;
    for (const controller of focusRequestControllersRef.current.values()) controller.abort();
    focusRequestControllersRef.current.clear();
    focusRequestIdentityRef.current += 1;
    if (current?.status === 'success' && current.decision?.status === 'success') {
      setExpandedFocusResult(current);
      beginFocusRelease(current);
    } else {
      setFocusRelease(null);
    }
    const automatic = automaticPresentationRef.current;
    if (automatic) {
      automatic.snapshot.layout = 'compact';
      automatic.snapshot.physicsProfile = 'galaxy';
    }
    setFocusTrail([]);
  };

  const enterManualFocus = (centerId: string) => {
    if (authority !== 'joined' || !activeJoinedPresentation || !manualProjectionSource) return;
    const center = manualProjectionSource.nodes.find(node => node.id === centerId);
    if (!center || (focusedEntry?.centerId === centerId
      && ['reading', 'loading', 'success'].includes(focusedEntry.status))) return;
    const sourcePresentation = activeJoinedPresentation;
    const centerProviderMembers = focusCenterMembers(sourcePresentation, centerId);
    if (!centerProviderMembers.length) return;
    if (focusReleaseTimeoutRef.current) {
      clearTimeout(focusReleaseTimeoutRef.current);
      focusReleaseTimeoutRef.current = null;
    }
    for (const pending of focusRequestControllersRef.current.values()) pending.abort();
    focusRequestControllersRef.current.clear();
    setFocusRelease(null);
    const requestIdentity = focusRequestIdentityRef.current + 1;
    focusRequestIdentityRef.current = requestIdentity;
    const entry: ManualFocusEntry = {
      centerId,
      centerTitle: center.label || center.title || center.id,
      status: 'reading',
      decision: null,
      requestIdentity,
      projectionKey: focusProjectionKey,
      presentation: sourcePresentation,
      readWarning: null,
    };
    setFocusTrail([entry]);
    const controller = new AbortController();
    focusRequestControllersRef.current.set(requestIdentity, controller);
    const stale = () => controller.signal.aborted
      || focusProjectionKeyRef.current !== entry.projectionKey;
    const failedDecision = (
      status: Exclude<JevFocusDecisionView['status'], 'success'>,
      errorCode: string,
    ): JevFocusDecisionView => ({
      status, errorCode, candidates: [],
    });
    void (async () => {
      if (!onReadProviderFocusNeighborhood) {
        if (stale()) return;
        const decision = failedDecision('unavailable', 'jev_focus_provider_reader_unavailable');
        setFocusTrail(history => history.map(item => item.requestIdentity === requestIdentity
          ? { ...item, status: decision.status, decision }
          : item));
        return;
      }
      const settled = await Promise.allSettled(centerProviderMembers.map(async member => ({
        authority: member.authority === 'ThinkGraph' ? 'thinkgraph' as const : 'knowgraph' as const,
        projection: await onReadProviderFocusNeighborhood(
          member.authority === 'ThinkGraph' ? 'thinkgraph' : 'knowgraph',
          member.entityId,
          controller.signal,
        ),
      })));
      if (stale()) return;
      const reads: Partial<Record<GraphAuthority, GraphProjectionV1[]>> = {};
      const failures: string[] = [];
      for (let index = 0; index < settled.length; index += 1) {
        const result = settled[index];
        if (result.status === 'fulfilled') {
          const list = reads[result.value.authority] || [];
          list.push(result.value.projection);
          reads[result.value.authority] = list;
        } else {
          const member = centerProviderMembers[index];
          failures.push(`${member.authority} ${member.entityId}`);
        }
      }
      if (!Object.values(reads).some(values => values?.length)) {
        const decision = failedDecision('unavailable', 'jev_focus_provider_read_unavailable');
        setFocusTrail(history => history.map(item => item.requestIdentity === requestIdentity
          ? { ...item, status: decision.status, decision, readWarning: failures.join(' · ') }
          : item));
        return;
      }
      const focusPresentation = composeFocusNeighborhoodPresentation(
        sourcePresentation,
        centerId,
        reads,
      );
      const candidates = buildJevFocusCandidates(
        focusPresentation.projection,
        focusPresentation,
        centerId,
      );
      const readWarning = failures.length
        ? `Provider neighborhood partial: ${failures.join(' · ')}`
        : null;
      if (failures.length || candidates.length > MAX_JEV_FOCUS_CANDIDATES) {
        const decision = failedDecision(
          'unavailable',
          failures.length
            ? 'jev_focus_provider_read_partial'
            : 'jev_focus_candidate_limit',
        );
        setFocusTrail(history => history.map(item => item.requestIdentity === requestIdentity
          ? {
            ...item,
            presentation: focusPresentation,
            status: decision.status,
            decision,
            readWarning: readWarning || (
              `Provider neighborhood has ${candidates.length} Entities; `
              + `JevFocus accepts at most ${MAX_JEV_FOCUS_CANDIDATES}.`
            ),
          }
          : item));
        return;
      }
      setFocusTrail(history => history.map(item => item.requestIdentity === requestIdentity
        ? { ...item, presentation: focusPresentation, status: 'loading', readWarning }
        : item));
      const decision = await requestJevFocus({
        projectId: focusPresentation.projection.projectId,
        centerId,
        centerTitle: entry.centerTitle,
        centerProviderMembers: focusCenterMembers(focusPresentation, centerId),
        sourceRevision: entry.projectionKey,
        candidates,
        signal: controller.signal,
      });
      if (stale()) return;
      setFocusTrail(history => history.map(item => item.requestIdentity === requestIdentity
        ? { ...item, status: decision.status, decision }
        : item));
    })().catch((failure: unknown) => {
      if (stale()) return;
      const decision = failedDecision(
        'error',
        failure instanceof Error ? failure.message : 'jev_focus_request_failed',
      );
      setFocusTrail(history => history.map(item => item.requestIdentity === requestIdentity
        ? { ...item, status: 'error', decision }
        : item));
    }).finally(() => {
      focusRequestControllersRef.current.delete(requestIdentity);
    });
  };
  focusActionRef.current = enterManualFocus;
  exitFocusRef.current = exitManualFocus;

  useEffect(() => {
    if (!hostRef.current) return;
    try {
      const inspectNode = (node: { id: string }) => {
        inspectNodeRef.current(node.id);
      };
      const graph = window.EngraphisGraph.create(hostRef.current, {
        onNodeClick: inspectNode,
        ...(authority === 'joined' ? {
          onNodeDoubleClick: (node: { id: string }) => {
            inspectNode(node);
            focusActionRef.current(node.id);
          },
        } : {}),
        onLinkClick: link => {
          setControlsOpen(false);
          setRemoveError(null);
          setSelectedMemberKey(null);
          setSelectedId(null);
          setSelectedEdgeId(String(link.id));
          setInspectorOpen(true);
        },
        onBackgroundClick: () => {
          exitFocusRef.current();
          setSelectedMemberKey(null);
          setSelectedId(null);
          setSelectedEdgeId(null);
          setInspectorOpen(false);
          setControlsOpen(false);
        },
      });
      const restoredLayout = savedPresentation.layout || 'compact';
      const restoredStyle = savedPresentationIsCurrent
        ? savedPresentation.style || 'solarpunk'
        : 'solarpunk';
      const restoredPhysics = savedPresentation.physicsProfile || 'galaxy';
      const defaults = graph.setPreset(restoredLayout);
      const savedSettings = savedPresentationIsCurrent
        ? savedPresentation.settings || {}
        : { ...(savedPresentation.settings || {}), size: 5 };
      const upgradingLegacyPresentation = !savedPresentationIsCurrent;
      const restoredSettings: Record<string, number | boolean | string> = {
        ...defaults,
        labels: true,
        ...savedSettings,
      };
      if (upgradingLegacyPresentation) {
        restoredSettings.linkw = Math.max(1, Number(restoredSettings.linkw) || 1);
      }
      graph.setCollapse(false);
      setLayout(restoredLayout); setStyle(restoredStyle); setPhysicsProfile(restoredPhysics);
      graph.setStyle(rendererStyle(restoredStyle));
      graph.setSettings(restoredSettings);
      setSettings(restoredSettings);
      graphRef.current = graph;
      return () => { graph.destroy(); graphRef.current = null; };
    } catch (failure) {
      setRenderError(failure instanceof Error ? failure.message : String(failure));
      return undefined;
    }
  }, [authority, savedPresentationIsCurrent]);

  useEffect(() => {
    graphRef.current?.setThemeColors(style === 'solarpunk' ? {
      material_blue: solarpunkColors.think,
      material_orange: solarpunkColors.know,
      material_surface: GRAPH_THEME.surface.base,
      accent: solarpunkColors.think,
      solar: solarpunkColors.know,
      surface: GRAPH_THEME.surface.base,
      label: GRAPH_THEME.surface.text,
    } : {});
  }, [authority, solarpunkColors, style]);

  useEffect(() => {
    try {
      window.localStorage.setItem(presentationStorageKey(authority), JSON.stringify({
        schemaVersion: 6, layout, style, physicsProfile, settings, solarpunkColors,
      } satisfies GraphPresentationPreferences));
    } catch {
      // Presentation preferences are optional; graph rendering remains authoritative.
    }
  }, [authority, layout, physicsProfile, settings, solarpunkColors, style]);

  useEffect(() => {
    const host = hostRef.current;
    const graph = graphRef.current;
    if (!host || !graph || typeof ResizeObserver === 'undefined') return undefined;
    let frame = 0;
    const apply = () => {
      frame = 0;
      graph.resize();
    };
    const schedule = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(apply);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(host);
    schedule();
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    if (!controlsOpen) return;
    const scrollHost = panelBodyRef.current?.parentElement;
    if (scrollHost) scrollHost.scrollTop = 0;
  }, [controlsOpen]);

  useEffect(() => () => {
    for (const controller of focusRequestControllersRef.current.values()) controller.abort();
    focusRequestControllersRef.current.clear();
    if (focusReleaseTimeoutRef.current) clearTimeout(focusReleaseTimeoutRef.current);
  }, []);

  useEffect(() => {
    for (const controller of focusRequestControllersRef.current.values()) controller.abort();
    focusRequestControllersRef.current.clear();
    focusRequestIdentityRef.current += 1;
    if (focusReleaseTimeoutRef.current) {
      clearTimeout(focusReleaseTimeoutRef.current);
      focusReleaseTimeoutRef.current = null;
    }
    setFocusRelease(null);
    setExpandedFocusResult(null);
    setFocusTrail(history => history.length ? [] : history);
  }, [focusProjectionKey]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    if (blackholePresentationActive) {
      let automatic = automaticPresentationRef.current;
      if (!automatic) {
        automatic = {
          renderer: null,
          snapshot: {
            ...presentationStateRef.current,
            settings: { ...presentationStateRef.current.settings },
          },
          manualLayout: false,
          manualStyle: false,
          manualPhysics: false,
          manualSettings: new Set<string>(),
          manualAllSettings: false,
        };
        automaticPresentationRef.current = automatic;
      }
      if (automatic.renderer !== graph) {
        graph.setPreset('galaxy');
        graph.setStyle('cyber');
        graph.setSettings(CALM_FOCUS_GALAXY_SETTINGS);
        automatic.renderer = graph;
      }
      return;
    }

    const automatic = automaticPresentationRef.current;
    if (!automatic) return;
    const current = presentationStateRef.current;
    if (!automatic.manualLayout) {
      graph.setPreset(automatic.snapshot.layout);
      setLayout(automatic.snapshot.layout);
    }
    const restoredSettings = automatic.manualLayout || automatic.manualAllSettings
      ? { ...current.settings }
      : { ...automatic.snapshot.settings };
    for (const key of automatic.manualSettings) {
      if (current.settings[key] !== undefined) restoredSettings[key] = current.settings[key];
    }
    graph.setSettings(restoredSettings);
    setSettings(restoredSettings);
    if (!automatic.manualStyle) {
      graph.setStyle(rendererStyle(automatic.snapshot.style));
      setStyle(automatic.snapshot.style);
    }
    if (!automatic.manualPhysics) setPhysicsProfile(automatic.snapshot.physicsProfile);
    automaticPresentationRef.current = null;
  }, [blackholePresentationActive]);

  const recordManualPresentationChange = (
    field: 'layout' | 'style' | 'physics' | 'all-settings' | 'setting',
    settingKey?: string,
  ) => {
    const automatic = automaticPresentationRef.current;
    if (!automatic || !blackholePresentationActive) return;
    if (field === 'layout') automatic.manualLayout = true;
    else if (field === 'style') automatic.manualStyle = true;
    else if (field === 'physics') automatic.manualPhysics = true;
    else if (field === 'all-settings') automatic.manualAllSettings = true;
    else if (settingKey) automatic.manualSettings.add(settingKey);
  };

  useEffect(() => {
    // Engraphis scenes retain all engine-owned layout and evidence fields.
    // Graphiti uses the renderer's supported field aliases; no graph is inferred here.
    const scene = displayProjection?.scene;
    const sceneNodes = Array.isArray(scene?.nodes) ? scene.nodes : displayProjection?.nodes || [];
    const sceneLinks = Array.isArray(scene?.links)
      ? scene.links
      : Array.isArray(scene?.edges)
        ? scene.edges
        : displayProjection?.edges || [];
    const projectionEdgesById = new Map((displayProjection?.edges || []).map(edge => [edge.id, edge]));
    const data = {
      ...(scene || {}),
      nodes: sceneNodes.map((rawNode) => {
        const node = rawNode as GraphProjectionNode;
        if (style !== 'solarpunk') return withoutSolarpunkMaterial(node);
        const combinedCyber = authority === 'joined';
        const variants = authority === 'joined'
          ? activeJoinedPresentation?.nodeVariants.get(node.id) || []
          : [{ authority, node }] as JoinedGraphNodeVariant[];
        const sourceKind = authority === 'joined'
          ? visualSourceKind(variants)
          : authority === 'knowgraph' ? 'know' : 'think';
        const thinkActive = typeof node.material_think_active === 'boolean'
          ? node.material_think_active
          : false;
        const knowActive = typeof node.material_know_active === 'boolean'
          ? node.material_know_active
          : false;
        return {
          ...node,
          ...(combinedCyber
            ? combinedCyberMaterialFields(
              sourceKind, thinkActive, knowActive, solarpunkColors,
            )
            : solarpunkMaterialFields(
              sourceKind, thinkActive, knowActive, solarpunkColors,
            )),
        };
      }),
      links: sceneLinks.map(rawEdge => {
        const edge = rawEdge as GraphProjectionEdge;
        const projected = projectionEdgesById.get(String(edge.id));
        const properties = { ...(edge.properties || {}), ...(projected?.properties || {}) };
        const semanticEdge = { ...edge, ...(projected || {}), properties };
        const edgeAuthority = authority === 'joined'
          ? activeJoinedPresentation?.edgeVariants.get(String(semanticEdge.id))?.authority
          : authority;
        const materialEdge = style === 'solarpunk' && edgeAuthority
          ? { ...semanticEdge, ...solarpunkEdgeFields(edgeAuthority, solarpunkColors) }
          : withoutSolarpunkEdgeMaterial(semanticEdge);
        if (edgeAuthority !== 'thinkgraph') {
          return {
            ...materialEdge,
            relation: materialEdge.predicate,
            label: '',
            hover_label: materialEdge.predicate,
          };
        }
        const jev = materialEdge.properties?.jev;
        const distribution = jev && typeof jev === 'object' && !Array.isArray(jev)
          && (jev as Record<string, unknown>).distribution
          && typeof (jev as Record<string, unknown>).distribution === 'object'
          ? (jev as Record<string, any>).distribution as Record<string, unknown>
          : null;
        const winner = jev && typeof jev === 'object' && !Array.isArray(jev)
          ? String((jev as Record<string, unknown>).winner || materialEdge.predicate)
          : materialEdge.predicate;
        const probability = compactProbability(
          distribution?.[winner]
            ?? materialEdge.properties?.relationship_strength
            ?? materialEdge.relationship_strength,
        );
        return {
          ...materialEdge,
          relation: materialEdge.predicate,
          label: '',
          hover_label: `${winner}${probability ? ` · ${probability}` : ''}`,
          directional_arrow_length: 3,
          directional_arrow_rel_pos: 0.9,
        };
      }),
    };
    const graph = graphRef.current;
    graph?.setData(data);
    if (successfulFocusedEntry) graph?.focus(successfulFocusedEntry.centerId);
    else graph?.clearFocus();
  }, [
    activeJoinedPresentation,
    authority,
    displayProjection,
    solarpunkColors,
    style,
    successfulFocusedEntry,
  ]);

  useEffect(() => {
    graphRef.current?.setHighlight(selectedId || successfulFocusedEntry?.centerId || null);
  }, [selectedId, successfulFocusedEntry?.centerId]);

  useEffect(() => {
    if (!entityFocusRequest
      || consumedEntityFocusRequestRef.current === entityFocusRequest.requestId
      || !displayProjection
      || authority !== 'joined') return;
    const baseProjection = joinedPresentation?.projection;
    if (!baseProjection) return;
    const visualNodeId = resolveCanonicalEntityFocusVisualId({
      projection: baseProjection,
      joinedPresentation,
      directory: canonicalEntityDirectory,
      request: entityFocusRequest,
    });
    if (!visualNodeId) return;
    if (!displayProjection.nodes.some(node => node.id === visualNodeId)) {
      if (manualNavigationActive) exitFocusRef.current();
      return;
    }
    consumedEntityFocusRequestRef.current = entityFocusRequest.requestId;
    inspectNodeRef.current(visualNodeId);
  }, [
    authority,
    canonicalEntityDirectory,
    displayProjection,
    joinedPresentation,
    manualNavigationActive,
    projection,
    entityFocusRequest,
  ]);

  useEffect(() => {
    if (selectedId && !displayProjection?.nodes.some(node => node.id === selectedId)) {
      setSelectedId(null);
      setInspectorOpen(false);
      setControlsOpen(true);
    }
    if (selectedEdgeId && !displayProjection?.edges.some(edge => edge.id === selectedEdgeId)) {
      setSelectedEdgeId(null);
      setInspectorOpen(false);
      setControlsOpen(true);
    }
  }, [displayProjection, selectedId, selectedEdgeId]);

  useEffect(() => {
    if (inspectorOpen || controlsOpen) {
      if (inspectorOpen && panelBodyRef.current) panelBodyRef.current.scrollTop = 0;
      panelBodyRef.current?.querySelector<HTMLElement>('[tabindex="-1"], select')?.focus();
    }
  }, [controlsOpen, inspectorOpen, selectedAuthority, selectedEdgeId, selectedId, selectedMemberKey]);

  const closePanel = () => {
    setInspectorOpen(false);
    setControlsOpen(false);
  };
  const deleteThink = async (memoryId: string) => {
    if (!onRemoveEvidence) return;
    setRemovingId(memoryId);
    setRemoveError(null);
    try { await onRemoveEvidence(memoryId); }
    catch (failure) { setRemoveError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setRemovingId(null); }
  };
  const deleteKnow = async (episodeId: string) => {
    if (!onRemoveKnowEvidence) return;
    setRemovingId(episodeId);
    setRemoveError(null);
    try {
      await onRemoveKnowEvidence(episodeId);
      if (selectedVisual) inspectNodeRef.current(selectedVisual.id);
    } catch (failure) {
      setRemoveError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setRemovingId(null);
    }
  };

  const allNodes = displayProjection?.nodes.length ?? 0;
  const selectedEvidence = (selectedEdge?.properties || selectedProperties).evidence;
  const evidenceRecords = Array.isArray(selectedEvidence) ? selectedEvidence.filter((item): item is Record<string, any> =>
    item !== null && typeof item === 'object' && typeof item.id === 'string') : [];
  const directThinks = inspectedAuthority === 'thinkgraph' && selected && !selectedEdge
    ? evidenceRecords
    : [];
  const thinks = directThinks.map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const leftTime = graphEntryTime(left.item.ingestedAt)?.dateTime || '';
      const rightTime = graphEntryTime(right.item.ingestedAt)?.dateTime || '';
      return rightTime.localeCompare(leftTime) || left.index - right.index;
    })
    .map(({ item }) => item);
  const visibleThinks = thinks.slice(0, INSPECTOR_RECORD_LIMIT);
  const entryTitle = selected?.label || (selectedEdge ? selectedEdge.predicate : '');
  const providerNodeLabel = (id: string) => inspectedProjection?.nodes.find(node => node.id === id)?.label || id;
  const directKnowItems: KnowInspectorRecord[] = inspectedAuthority === 'knowgraph' && selected && !selectedEdge
    ? evidenceRecords.flatMap((item): KnowInspectorRecord[] => {
        const episodeId = knowEvidenceIdentity(item);
        if (!episodeId) return [];
        const idea = item.idea && typeof item.idea === 'object' && !Array.isArray(item.idea)
          ? item.idea as Record<string, unknown>
          : {};
        const counterIdea = item.counterIdea
          && typeof item.counterIdea === 'object'
          && !Array.isArray(item.counterIdea)
          ? item.counterIdea as Record<string, unknown>
          : {};
        const ideaBody = typeof idea.body === 'string' ? idea.body.trim() : '';
        const counterBody = typeof counterIdea.body === 'string'
          ? counterIdea.body.trim()
          : '';
        if (!ideaBody && !counterBody) return [];
        const properties = item.properties
          && typeof item.properties === 'object'
          && !Array.isArray(item.properties)
          ? item.properties as Record<string, unknown>
          : {};
        return [{
          episodeId,
          know: {
            title: String(item.title || properties.name || 'Know'),
            idea,
            counterIdea,
            observedAt: item.ingestedAt ?? properties.created_at,
            sourceDate: item.validFrom ?? properties.valid_at,
          },
          episode: { ...properties, ...item },
        }];
      }).sort((left, right) => {
          const leftTime = graphEntryTime(left.know.observedAt)?.dateTime || '';
          const rightTime = graphEntryTime(right.know.observedAt)?.dateTime || '';
          return rightTime.localeCompare(leftTime) || left.episodeId.localeCompare(right.episodeId);
        })
    : [];
  const visibleKnowItems = directKnowItems.slice(0, INSPECTOR_RECORD_LIMIT);
  const jev = selectedEdge?.properties?.jev
    && typeof selectedEdge.properties.jev === 'object'
    && !Array.isArray(selectedEdge.properties.jev)
    ? selectedEdge.properties.jev as Record<string, unknown>
    : null;
  const jevDistribution = jev?.distribution
    && typeof jev.distribution === 'object'
    ? Object.entries(jev.distribution as Record<string, unknown>)
      .filter((entry): entry is [string, number] => Number.isFinite(Number(entry[1])))
      .sort((left, right) => Number(right[1]) - Number(left[1]))
    : [];
  const jevWinner = jev ? String(jev.winner || selectedEdge?.predicate || '') : '';
  const naturalRelationship = jev && typeof jev.natural_relationship === 'string'
    ? jev.natural_relationship
    : '';
  const jevWinnerProbability = probabilityLabel(
    jevDistribution.find(([choice]) => choice === jevWinner)?.[1],
  );
  const availableNodeAuthorities = (['thinkgraph', 'knowgraph'] as const)
    .filter(candidate => candidate === 'thinkgraph' ? directThinkAvailable : directKnowAvailable);
  const visualNodeIdForProvider = (providerId: string) => inspectedAuthority
    ? activeJoinedPresentation?.visualNodeIdByProviderMember.get(
      providerMemberKey(inspectedAuthority, providerId),
    ) || providerId
    : providerId;
  return (
    <div data-testid={`knowledge-${authority}-surface`} className="knowledge-authority-graph" data-layout={layout} data-style={style} data-physics-profile={physicsProfile} data-focus-phase={successfulFocusedEntry ? 'manual_blackhole_focus' : focusRequestPending ? 'focus_preparing' : focusRelease ? 'focus_release' : 'local_relational'} data-panel-open={controlsOpen || inspectorOpen} aria-busy={status === 'loading'}
      onKeyDown={event => {
        if (event.key !== 'Escape') return;
        if (focusedEntry) {
          event.stopPropagation();
          exitManualFocus();
          closePanel();
        } else if (inspectorOpen || controlsOpen) {
          event.stopPropagation();
          closePanel();
        }
      }}>
      <GraphPaperBackground viewport={paperViewport} />
      <div className="knowledge-authority-canvas">
        <div ref={hostRef} className="knowledge-authority-network graph-canvas"
          data-renderer="engraphis-1.7.1"
          onWheelCapture={beginCameraGesture}
          onWheel={syncPaper}
          onPointerDown={beginCameraGesture}
          onPointerMove={event => { if (event.buttons) syncPaper(); }}
          onKeyDownCapture={beginCameraGesture}
          onKeyDown={syncPaper}
        />
        <GraphNavigationControls
          onZoomIn={() => zoom('+')}
          onZoomOut={() => zoom('-')}
          onFit={() => {
            cameraRef.current = null;
            setPaperViewport({ x: 0, y: 0, zoom: 1 });
            graphRef.current?.fit();
          }}
        />
        {focusedEntry ? (
          <div
            data-testid="jev-focus-toolbar"
            role="status"
            style={{
              position: 'absolute', left: 16, top: 16, zIndex: 5,
              display: 'flex', alignItems: 'center', gap: 8,
              padding: 8, borderRadius: 12,
              background: 'rgba(11, 14, 18, 0.88)',
              border: `1px solid ${GRAPH_THEME.accent.primaryBorder}`,
              color: GRAPH_THEME.surface.text,
            }}
          >
            <span title={focusedEntry.readWarning || focusedEntry.decision?.errorCode || undefined}>
              {focusedEntry.status === 'reading'
                ? 'Focus · reading neighborhood…'
                : focusedEntry.status === 'loading'
                  ? 'Focus · reranking…'
                : focusedEntry.status === 'success'
                  ? `Focus · ${new Set(selectedFocusCandidates(focusedEntry).map(candidate => candidate.visualId)).size} neighbors`
                  : 'Focus unavailable · local view kept'}
            </span>
          </div>
        ) : focusRelease ? (
          <div
            data-testid="focus-release-status"
            role="status"
            style={{ position: 'absolute', left: 16, top: 16, zIndex: 5, color: GRAPH_THEME.surface.mutedText }}
          >
            Focus release
          </div>
        ) : null}
        {status === 'error' || renderError ? <div className="knowledge-authority-empty">Graph failed: {renderError || error}</div> : null}
        {status !== 'error' && !renderError && warning ? (
          <div
            role="status"
            data-testid="knowledge-authority-warning"
            style={{
              position: 'absolute', top: 48, left: 12, zIndex: 5,
              maxWidth: 'min(520px, calc(100% - 96px))', padding: '6px 9px', borderRadius: 7,
              background: 'rgba(74, 35, 45, 0.9)', color: '#fecdd3', fontSize: 11,
            }}
          >
            {warning}
          </div>
        ) : null}
        {status === 'ready' && allNodes === 0 ? <div className="knowledge-authority-empty">No knowledge yet.</div> : null}
      </div>
        <RightGlassDrawer
          isOpen={controlsOpen || inspectorOpen}
          title={inspectorOpen ? (selectedEdge ? '' : entryTitle) : 'Graph settings'}
          onClose={closePanel}
          onOpen={() => {
            const reopenInspector = Boolean(selectedId || selectedEdgeId);
            setControlsOpen(!reopenInspector);
            setInspectorOpen(reopenInspector);
          }}
          collapsedLabel={null}
          openAriaLabel="Open graph settings"
          movable
          defaultWidth={340} minWidth={280} maxWidth={520}
          storageKey={`liquidaity.drawer.${authority}.width`}
          top={48} right={12} bottom={12} zIndex={6}
        >
          {!inspectorOpen ? <div ref={panelBodyRef} className="knowledge-authority-controls">
            <label>Physics profile<select aria-label="Physics profile" value={physicsProfile} onChange={event => {
              recordManualPresentationChange('physics');
              setPhysicsProfile(event.target.value as JevGraphPhysicsProfile);
            }}>
              {JEV_GRAPH_PHYSICS_PROFILES.map(profile => <option key={profile} value={profile}>
                {JEV_GRAPH_PHYSICS_PROFILE_LABELS[profile]}
              </option>)}
            </select></label>
            <label>Layout<select aria-label="Layout" value={layout} onChange={event => {
              recordManualPresentationChange('layout');
              setAppliedPresetNodeSize(null);
              const next = event.target.value as RendererLayout;
              const preset = graphRef.current?.setPreset(next);
              const defaults = preset
                ? { ...preset, linkw: Math.max(1, Number(preset.linkw) || 1) }
                : preset;
              setLayout(next); setSettings(current => ({ ...current, ...defaults }));
            }}>
              <option value="compact">Compact</option><option value="original">Original</option>
              <option value="communities">Communities</option><option value="radial">Radial</option>
              <option value="galaxy">Galaxy gravity</option>
            </select></label>
            <label>Style<select aria-label="Style" value={style} onChange={event => {
              recordManualPresentationChange('style');
              const next = event.target.value as PresentationStyle;
              graphRef.current?.setStyle(rendererStyle(next)); setStyle(next);
            }}>
              <option value="classic">Classic</option><option value="cyber">Cyberpunk</option>
              <option value="solarpunk">Solarpunk</option><option value="galaxy">Galaxy</option>
              <option value="solar">Solar</option>
            </select></label>
            {style === 'solarpunk'
              ? <fieldset aria-label="Solarpunk colors" style={{ display: 'grid', gap: 6 }}>
              <legend>Solarpunk colors</legend>
              {([['Think nodes', 'think'], ['Know nodes', 'know'],
                ['Think edges', 'thinkRelationship'],
                ['Know edges', 'knowRelationship']] as const)
                .map(([label, key]) => <label key={key}>
                  <span>{label}</span>
                  <input type="color" aria-label={label} value={solarpunkColors[key]}
                    onChange={event => {
                      const value = event.target.value;
                      if (!SOLARPUNK_HEX.test(value)) return;
                      setSolarpunkColors(current => ({ ...current, [key]: value }));
                    }} />
                  </label>)}
            </fieldset> : null}
            <label><input type="checkbox" checked={settings.labels === true} onChange={event => {
              recordManualPresentationChange('setting', 'labels');
              setAppliedPresetNodeSize(null);
              const patch = { labels: event.target.checked };
              graphRef.current?.setSettings(patch);
              setSettings(current => ({ ...current, ...patch }));
            }} />Entity labels</label>
            {([
              ['Node size', 'size', 1, 12, 1], ['Text size', 'font', 6, 24, 1],
              ['Line width', 'linkw', 0.1, 2, 0.01], ['Label density', 'labelDensity', 1, 100, 1],
              ['Repel force', 'repel', 0, 400, 1], ['Link distance', 'link', 4, 80, 1],
              ['Center gravity', 'gravity', 0, 400, 1],
            ] as const).map(([label, key, min, max, step]) => <label key={key}>
              <span>{label}</span>
              <input aria-label={label} type="range" min={min} max={max} step={step}
                value={Number(settings[key] ?? min)} onChange={event => {
                  recordManualPresentationChange('setting', key);
                  setAppliedPresetNodeSize(null);
                  const patch = { [key]: Number(event.target.value) };
                  graphRef.current?.setSettings(patch);
                  setSettings(current => ({ ...current, ...patch }));
                }} />
              <output>{settings[key]}</output>
            </label>)}
            <button type="button" aria-label="Reset to preset defaults" onClick={() => {
              recordManualPresentationChange('all-settings');
              const defaults = graphRef.current?.setPreset(layout);
              const nextSettings = {
                ...defaults,
                labels: true,
                linkw: Math.max(1, Number(defaults?.linkw) || 1),
              };
              graphRef.current?.setSettings(nextSettings);
              setSettings(nextSettings);
              setAppliedPresetNodeSize(typeof defaults?.size === 'number' ? defaults.size : null);
            }}>{appliedPresetNodeSize === null
                ? 'Reset to preset defaults'
                : `Preset defaults applied · node size ${appliedPresetNodeSize}`}</button>
          </div> : (selected || selectedEdge) ? <div ref={panelBodyRef} className="knowledge-authority-controls" role="region" aria-label={`${entryTitle} details`}>
        {authority === 'joined' && selectedVisual ? (
          <div className="knowledge-authority-actions">
            <button
              type="button"
              disabled={focusRequestPending}
              onClick={() => {
                if (successfulFocusedEntry) exitFocusRef.current();
                else focusActionRef.current(selectedVisual.id);
              }}
            >
              {successfulFocusedEntry ? 'Expand' : 'Focus'}
            </button>
          </div>
        ) : null}
        {authority === 'joined' && selected && availableNodeAuthorities.length ? (
          <div role="tablist" aria-label={`${selected.label} graph evidence`} style={{ display: 'flex', gap: 6 }}>
            {availableNodeAuthorities.map(candidate => (
              <button
                key={candidate}
                type="button"
                role="tab"
                aria-selected={candidate === inspectedAuthority}
                onClick={() => { setSelectedAuthority(candidate); setSelectedMemberKey(null); }}
                style={{
                  minWidth: 72,
                  padding: '6px 12px',
                  borderRadius: 8,
                  border: `1px solid ${candidate === inspectedAuthority
                    ? GRAPH_THEME.accent.primaryBorder
                    : GRAPH_THEME.drawer.inputBorder}`,
                  background: candidate === inspectedAuthority
                    ? GRAPH_THEME.accent.primarySoft
                    : GRAPH_THEME.drawer.inputBackground,
                  color: candidate === inspectedAuthority
                    ? GRAPH_THEME.surface.text
                    : GRAPH_THEME.drawer.inputMuted,
                  fontWeight: 700,
                }}
              >
                {candidate === 'thinkgraph' ? 'Think' : 'Know'}
              </button>
            ))}
          </div>
        ) : null}
        {selected ? <span className="graph-inspector-entity" tabIndex={-1} aria-hidden="true"
          data-testid={`${inspectedAuthority}-node-inspector`} data-provider-id={selected.id}>
          {selected.label}
        </span> : null}
        {visibleThinks.length ? <section className="graph-inspector-records" data-testid="knowledge-think-records">
          <h4>{visibleThinks.length > 1 ? 'Recent Thinks' : 'Recent Think'}</h4>
          {visibleThinks.map(item => <ThinkRecordCard
            key={item.id}
            item={item}
            heading="Think"
            removing={removingId === item.id}
            onRemove={inspectedAuthority === 'thinkgraph' && onRemoveEvidence
              ? () => { void deleteThink(item.id); }
              : undefined}
          />)}
        </section> : null}
        {visibleKnowItems.length ? <section className="graph-inspector-records" data-testid="knowledge-know-records">
          <h4>{visibleKnowItems.length > 1 ? 'Current Knows' : 'Current Know'}</h4>
          {visibleKnowItems.map((record, index) => <KnowGraphKnow
            key={record.episodeId}
            record={record}
            heading={visibleKnowItems.length > 1 ? `Know ${index + 1}` : 'Know'}
            removing={removingId === record.episodeId}
            onRemove={onRemoveKnowEvidence
              ? () => { void deleteKnow(record.episodeId); }
              : undefined}
          />)}
        </section> : null}
        {inspectedAuthority === 'knowgraph' && selected && !selectedEdge
          ? <KnowSourceList records={directKnowItems} />
          : null}
        {selectedEdge ? <article data-testid={`${inspectedAuthority}-edge-inspector`} data-provider-id={selectedEdge.id}>
          <h4 tabIndex={-1}>{providerNodeLabel(selectedEdge.source)} → {selectedEdge.predicate} → {providerNodeLabel(selectedEdge.target)}</h4>
          {(['fact', 'summary', 'reason'] as const).map(key => typeof selectedEdge.properties?.[key] === 'string'
            && selectedEdge.properties[key] ? <p key={key}>{String(selectedEdge.properties[key])}</p> : null)}
          <button type="button" onClick={() => {
            const visualId = visualNodeIdForProvider(selectedEdge.source);
            inspectNodeRef.current(visualId);
            setSelectedAuthority(inspectedAuthority);
            setSelectedMemberKey(inspectedAuthority
              ? providerMemberKey(inspectedAuthority, selectedEdge.source)
              : null);
          }}>{providerNodeLabel(selectedEdge.source)}</button>
          <button type="button" onClick={() => {
            const visualId = visualNodeIdForProvider(selectedEdge.target);
            inspectNodeRef.current(visualId);
            setSelectedAuthority(inspectedAuthority);
            setSelectedMemberKey(inspectedAuthority
              ? providerMemberKey(inspectedAuthority, selectedEdge.target)
              : null);
          }}>{providerNodeLabel(selectedEdge.target)}</button>
        </article> : null}
        {selectedEdge ? <dl className="graph-record-fields graph-edge-meaning">
          <div><dt>Direction</dt><dd>{providerNodeLabel(selectedEdge.source)} → {providerNodeLabel(selectedEdge.target)}</dd></div>
          {jevWinner ? <div><dt>Jev winner</dt><dd>{jevWinner}</dd></div> : null}
          {jevWinnerProbability ? <div><dt>Probability</dt><dd>{jevWinnerProbability}</dd></div> : null}
          {naturalRelationship ? <div><dt>Natural extracted relationship</dt><dd>{naturalRelationship}</dd></div> : null}
        </dl> : null}
        {jevDistribution.length ? <details className="graph-jev-distribution" open>
          <summary>Jev relationship probabilities</summary>
          <dl>{jevDistribution.map(([choice, probability]) => {
            const probabilityText = probabilityLabel(probability) || '0.0%';
            return <div key={choice} data-winner={choice === jevWinner}>
              <dt>{choice}</dt><dd>
                <span className="graph-jev-probability-track" aria-hidden="true">
                  <span className="graph-jev-probability-fill" style={{ width: probabilityText }} />
                </span>
                <span>{probabilityText}</span>
              </dd>
            </div>;
          })}</dl>
        </details> : null}
        {removeError ? <p role="alert">{removeError}</p> : null}
      </div> : null}
        </RightGlassDrawer>
    </div>
  );
}
