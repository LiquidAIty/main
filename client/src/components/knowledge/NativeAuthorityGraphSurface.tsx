import { lazy, useEffect, useMemo, useRef, useState } from 'react';
import '../../vendor/engraphis/vendor/d3.min.js';
import '../../vendor/engraphis/vendor/force-graph.min.js';
import '../../vendor/engraphis/engraphis-graph.js';

import type { GraphData } from '../../vendor/codebase-memory-ui/src/lib/types';
import RightGlassDrawer from '../graph/RightGlassDrawer';
import { GraphNavigationControls, GraphPaperBackground } from '../graph/GraphCanvasChrome';
import { GRAPH_THEME } from '../graph/graphVisualTokens';
import {
  applyJevGraphPhysics,
  JEV_GRAPH_PHYSICS_PROFILE_LABELS,
  JEV_GRAPH_PHYSICS_PROFILES,
  mapJevAttentionProminence,
  type JevGraphPhysicsProfile,
} from './jevGraphPhysics';
import './nativeAuthorityGraphSurface.css';

const CbmGraphTab = lazy(async () => {
  const { GraphTab } = await import('../../vendor/codebase-memory-ui/src/components/GraphTab');
  return { default: GraphTab };
});

type GraphAuthority = 'thinkgraph' | 'knowgraph';
type GraphSurfaceAuthority = GraphAuthority | 'combined';

export type ReadNativeFocusNeighborhood = (
  authority: GraphAuthority,
  nativeId: string,
  signal?: AbortSignal,
) => Promise<GraphProjectionV1>;

export type ContextualNodeNativeMember = {
  authority: 'ThinkGraph' | 'KnowGraph';
  nativeId: string;
};

export type ContextualNodeDataAnchor = {
  authority: 'ThinkGraph' | 'KnowGraph';
  nativeId: string;
  reason: string;
  order: number;
  boundedExpansion: number;
  resultLimit: number;
  required: boolean;
};

export type ContextualNodeReadSide = {
  status: 'selected' | 'partial' | 'none_relevant' | 'empty' | 'missing' | 'context_unavailable'
    | 'context_limit' | 'retrieval_failed' | 'limit' | 'unavailable' | 'timeout'
    | 'invalid' | 'error' | 'hydration_failed';
  candidateCount?: number;
  errorCode?: string;
  selectedNativeIds?: string[];
  hydrationFailedNativeIds?: string[];
  items?: Array<{
    nativeId: string;
    block: Record<string, any>;
    dataAnchor: ContextualNodeDataAnchor;
    reference: Record<string, any>;
  }>;
};

export type ContextualNodeReadView = {
  schemaVersion: 'contextual-node-read.v1';
  status: 'success' | 'partial' | 'context_unavailable' | 'unavailable' | 'missing' | 'empty';
  sourceRevision: string;
  clientContextRevision: string;
  operationId: string | null;
  contextLabel: string;
  requestCount: number;
  questionCount: number;
  provider: string;
  requestedModel: string;
  resolvedModel: string;
  usage: Record<string, unknown>;
  sides: { think: ContextualNodeReadSide; know: ContextualNodeReadSide };
  dataAnchors: ContextualNodeDataAnchor[];
  selectedReferences: Array<Record<string, any>>;
  modelContext: string;
};

export type ReadContextualNode = (
  request: {
    sourceRevision: string;
    clientContextRevision: string;
    nativeMembers: ContextualNodeNativeMember[];
  },
  signal?: AbortSignal,
) => Promise<ContextualNodeReadView>;

// The server-owned graph projection contract rendered by the native surfaces.
export type GraphProjectionNode = {
  id: string;
  canonicalId?: string;
  label: string;
  title?: string;
  type?: string;
  labels?: string[];
  authority?: string;
  projectId?: string;
  conversationId?: string;
  episodeId?: string;
  jobId?: string;
  runId?: string;
  goalId?: string;
  memoryType?: string;
  currentState?: string;
  createdAt?: string;
  validFrom?: string;
  validTo?: string | null;
  ingestedAt?: string;
  updatedAt?: string;
  mentionCount?: number;
  lastMentionedAt?: string;
  properties?: Record<string, unknown>;
  provenance?: Record<string, unknown>;
  provenanceCount?: number;
  degree?: number;
  semantic_mass?: number;
  gravity_mass?: number;
  visual_radius?: number;
  etype?: string;
  anchor_role?: 'global' | 'community' | null;
  system_anchor_id?: string;
  community_id?: string;
  scene_rank?: number;
  turn_heat_active?: boolean;
  turn_heat?: number;
  cardId?: string;
  correlationId?: string;
  codeGraphRef?: string;
  knowGraphRef?: string;
  artifactRef?: string;
  trustState?: string;
  qualityState?: string;
  productionPath?: string;
  retrievalReason?: string;
  material_kind?: 'solarpunk';
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
};

export type CombinedGraphNodeVariant = {
  authority: GraphAuthority;
  node: GraphProjectionNode;
};

export type CombinedGraphEdgeVariant = {
  authority: GraphAuthority;
  edge: GraphProjectionEdge;
};

export type CombinedGraphPresentation = {
  projection: GraphProjectionV1;
  nativeProjections: Record<GraphAuthority, GraphProjectionV1>;
  nodeVariants: Map<string, CombinedGraphNodeVariant[]>;
  edgeVariants: Map<string, CombinedGraphEdgeVariant>;
  visualNodeIdByNativeMember: Map<string, string>;
};

export type JevAttentionVisualSubjectView = {
  choiceId: string;
  authority: 'ThinkGraph' | 'KnowGraph';
  nativeId: string;
  title: string;
  probability: number;
  hydrated: boolean;
  resolution: 'resolving' | 'resolved' | 'unavailable';
};

export type JevAttentionVisualDescriptorView = {
  decisionId: string;
  runId: string;
  phase: 'attention_space' | 'local_relational';
  active: boolean;
  distribution: Record<string, number>;
  selectedSubjects: JevAttentionVisualSubjectView[];
};

export type JevFocusIncidentRelationshipView = {
  edgeId: string;
  nativeEdgeId: string;
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

export type JevFocusCandidateView = {
  visualId: string;
  authority: 'ThinkGraph' | 'KnowGraph';
  nativeId: string;
  title: string;
  description: string | null;
  incidentRelationships: JevFocusIncidentRelationshipView[];
};

export type JevFocusCenterMemberView = {
  authority: 'ThinkGraph' | 'KnowGraph';
  nativeId: string;
  title: string;
  description: string | null;
};

export type JevFocusDecisionCandidateView = JevFocusCandidateView & {
  choiceId: string;
  probability: number;
  selected: boolean;
  rank: number;
};

export type JevFocusDecisionView = {
  schemaVersion: 'jev-focus.v1';
  sourceRevision: string;
  status: 'success' | 'unavailable' | 'timeout' | 'invalid' | 'error';
  decisionId: string | null;
  errorCode: string | null;
  distribution: Record<string, number>;
  candidates: JevFocusDecisionCandidateView[];
};

export type ManualFocusEntry = {
  centerId: string;
  centerTitle: string;
  candidates: JevFocusCandidateView[];
  status: 'reading' | 'loading' | JevFocusDecisionView['status'];
  decision: JevFocusDecisionView | null;
  requestIdentity: number;
  projectionKey: string;
  presentation: CombinedGraphPresentation;
  readWarning: string | null;
};

type ContextualNodeReadState = {
  visualNodeId: string;
  requestIdentity: number;
  sourceRevision: string;
  contextRevision: string;
  status: 'loading' | 'ready' | 'error';
  result: ContextualNodeReadView | null;
  error: string | null;
};

type FocusReleaseView = {
  centerId: string;
  nodeIds: string[];
  edgeIds: string[];
};

const MAX_TURN_LOCAL_VISUAL_NODES = 24;
const MAX_JEV_FOCUS_CANDIDATES = 12;
const FOCUS_RELEASE_MILLISECONDS = 1_400;
const CALM_FOCUS_GALAXY_SETTINGS = {
  repel: 25,
  gravity: 48,
  damping: 6,
} as const;

export const GRAPH_NODE_MATERIALS = {
  think: 'THINK_MATERIAL',
  know: 'KNOW_MATERIAL',
  paired: 'PAIRED_SOLARPUNK_MATERIAL',
} as const;

export type GraphNodeMaterialRole = typeof GRAPH_NODE_MATERIALS[keyof typeof GRAPH_NODE_MATERIALS];

function materialRole(source: 'think' | 'know' | 'paired'): GraphNodeMaterialRole {
  return GRAPH_NODE_MATERIALS[source];
}

function solarpunkMaterialFields(
  source: 'think' | 'know' | 'paired',
  thinkActive = false,
  knowActive = false,
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
    material_role: materialRole(source),
    material_blue: GRAPH_THEME.accent.primary,
    material_orange: GRAPH_THEME.accent.solar,
    material_surface: GRAPH_THEME.surface.base,
    material_think_active: thinkActive,
    material_know_active: knowActive,
  };
}

function nativeMemberKey(authority: GraphAuthority, nativeId: string): string {
  return `${authority}:${nativeId}`;
}

function nativeRenderId(authority: GraphAuthority, nativeId: string): string {
  return `${authority}:${encodeURIComponent(nativeId)}`;
}

function labelledRenderId(label: string): string {
  return `entity-label:${encodeURIComponent(label)}`;
}

function isAttentionActive(node: GraphProjectionNode): boolean {
  const renderNode = node as GraphProjectionNode & {
    turn_heat_active?: boolean;
    turn_heat?: number;
  };
  return renderNode.turn_heat_active === true
    || node.properties?.turnHeatActive === true
    || node.properties?.attentionActive === true;
}

function attentionHeat(node: GraphProjectionNode): number {
  const renderNode = node as GraphProjectionNode & { turn_heat?: number };
  for (const value of [renderNode.turn_heat, node.properties?.turnHeat]) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  return isAttentionActive(node) ? 1 : 0;
}

function presentationNode(
  visualId: string,
  variants: CombinedGraphNodeVariant[],
): GraphProjectionNode {
  const primary = variants.find(variant => variant.authority === 'thinkgraph') || variants[0];
  const active = variants.filter(variant => isAttentionActive(variant.node));
  const sourceKind = visualSourceKind(variants);
  const thinkActive = active.some(variant => variant.authority === 'thinkgraph');
  const knowActive = active.some(variant => variant.authority === 'knowgraph');
  const activeProperties = active[0]?.node.properties || {};
  const heat = active.reduce(
    (maximum, variant) => Math.max(maximum, attentionHeat(variant.node)),
    0,
  );
  return {
    ...primary.node,
    id: visualId,
    canonicalId: undefined,
    authority: 'combined',
    ...solarpunkMaterialFields(sourceKind, thinkActive, knowActive),
    properties: {
      ...(primary.node.properties || {}),
      attentionActive: active.length > 0,
      ...(typeof activeProperties.attentionActorColor === 'string'
        ? { attentionActorColor: activeProperties.attentionActorColor }
        : {}),
    },
    turn_heat_active: active.length > 0,
    turn_heat: heat,
  } as GraphProjectionNode;
}

/**
 * Builds one non-authoritative renderer view over the two native projections.
 * Exact, non-empty node labels are the only visual join key. Native records and
 * relationships remain authority-qualified side-map entries and are never mutated.
 */
export function composeThinkKnowPresentation(
  thinkProjection: GraphProjectionV1,
  knowProjection: GraphProjectionV1,
): CombinedGraphPresentation {
  const nativeProjections = {
    thinkgraph: thinkProjection,
    knowgraph: knowProjection,
  };
  const nodeVariants = new Map<string, CombinedGraphNodeVariant[]>();
  const visualNodeIdByNativeMember = new Map<string, string>();
  const addNode = (authority: GraphAuthority, node: GraphProjectionNode) => {
    const visualId = node.label ? labelledRenderId(node.label) : nativeRenderId(authority, node.id);
    const variants = nodeVariants.get(visualId) || [];
    variants.push({ authority, node });
    nodeVariants.set(visualId, variants);
    visualNodeIdByNativeMember.set(nativeMemberKey(authority, node.id), visualId);
  };
  thinkProjection.nodes.forEach(node => addNode('thinkgraph', node));
  knowProjection.nodes.forEach(node => addNode('knowgraph', node));

  const nodes = [...nodeVariants.entries()]
    .map(([visualId, variants]) => presentationNode(visualId, variants));
  const visibleNodeIds = new Set(nodes.map(node => node.id));
  const edgeVariants = new Map<string, CombinedGraphEdgeVariant>();
  const edges: GraphProjectionEdge[] = [];
  const addEdges = (authority: GraphAuthority, projection: GraphProjectionV1) => {
    for (const edge of projection.edges) {
      const source = visualNodeIdByNativeMember.get(nativeMemberKey(authority, edge.source));
      const target = visualNodeIdByNativeMember.get(nativeMemberKey(authority, edge.target));
      if (!source || !target || !visibleNodeIds.has(source) || !visibleNodeIds.has(target)) continue;
      const visualId = nativeRenderId(authority, edge.id);
      edges.push({
        ...edge,
        id: visualId,
        source,
        target,
        layer: authority,
        properties: {
          ...(edge.properties || {}),
          ...(edge.layer ? { nativeSemanticLayer: edge.layer } : {}),
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
      authority: 'combined',
      projectId: thinkProjection.projectId || knowProjection.projectId,
      revision: `${thinkProjection.revision || ''}:${knowProjection.revision || ''}`,
      counts: { nodes: nodes.length, edges: edges.length },
      nodes,
      edges,
    },
    nativeProjections,
    nodeVariants,
    edgeVariants,
    visualNodeIdByNativeMember,
  };
}

export function composeFocusNeighborhoodPresentation(
  base: CombinedGraphPresentation,
  centerId: string,
  reads: Partial<Record<GraphAuthority, GraphProjectionV1[]>>,
): CombinedGraphPresentation {
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
    };
  };
  return composeThinkKnowPresentation(merged('thinkgraph'), merged('knowgraph'));
}

function visualSourceKind(variants: CombinedGraphNodeVariant[]): 'think' | 'know' | 'paired' {
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

function boundedNativeDescription(node: GraphProjectionNode): string | null {
  const properties = node.properties || {};
  const evidence = Array.isArray(properties.evidence) ? properties.evidence : [];
  const evidenceText = evidence.flatMap((item): unknown[] => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const record = item as Record<string, any>;
    const think = record.metadata?.structured_extraction?.think;
    return [think?.summary, think?.observation, record.summary, record.content];
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
 * neighborhood instead of silently dropping native subjects.
 */
export function buildJevFocusCandidates(
  projection: GraphProjectionV1,
  presentation: CombinedGraphPresentation,
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
    const nativeId = sourceIsCenter ? variant.edge.target : variant.edge.source;
    const nativeProjection = presentation.nativeProjections[variant.authority];
    const neighbor = nativeProjection.nodes.find(node => node.id === nativeId);
    const visualId = presentation.visualNodeIdByNativeMember.get(
      nativeMemberKey(variant.authority, nativeId),
    );
    if (!neighbor || !visualId || visualId === centerId) continue;
    const nativeLabel = (id: string) => nativeProjection.nodes.find(node => node.id === id)?.label || id;
    const authorityName = variant.authority === 'thinkgraph' ? 'ThinkGraph' : 'KnowGraph';
    const candidateKey = `${authorityName}:${nativeId}`;
    const candidate = candidates.get(candidateKey) || {
      visualId,
      authority: authorityName,
      nativeId,
      title: neighbor.label || neighbor.title || neighbor.id,
      description: boundedNativeDescription(neighbor),
      incidentRelationships: [],
    } satisfies JevFocusCandidateView;
    if (!candidate.incidentRelationships.some(item => item.nativeEdgeId === variant.edge.id)) {
      candidate.incidentRelationships.push({
        edgeId: edge.id,
        nativeEdgeId: variant.edge.id,
        sourceVisualId: edge.source,
        sourceId: variant.edge.source,
        sourceTitle: nativeLabel(variant.edge.source),
        targetVisualId: edge.target,
        targetId: variant.edge.target,
        targetTitle: nativeLabel(variant.edge.target),
        predicate: variant.edge.predicate,
        direction: sourceIsCenter ? 'outgoing' : 'incoming',
        relationshipWeight: focusRelationshipWeight(edge),
      });
    }
    candidates.set(candidateKey, candidate);
  }
  return [...candidates.values()]
    .sort((left, right) => (
      left.authority.localeCompare(right.authority) || left.nativeId.localeCompare(right.nativeId)
    ))
    .map(candidate => ({
      ...candidate,
      incidentRelationships: [...candidate.incidentRelationships]
        .sort((left, right) => left.nativeEdgeId.localeCompare(right.nativeEdgeId)),
    }));
}

function selectedFocusCandidates(entry: ManualFocusEntry): JevFocusDecisionCandidateView[] {
  return entry.status === 'success' && entry.decision?.status === 'success'
    ? entry.decision.candidates
      .filter(candidate => candidate.selected)
      .sort((left, right) => left.rank - right.rank
        || left.authority.localeCompare(right.authority)
        || left.nativeId.localeCompare(right.nativeId))
    : [];
}

function focusCenterMembers(
  presentation: CombinedGraphPresentation,
  centerId: string,
): JevFocusCenterMemberView[] {
  return (presentation.nodeVariants.get(centerId) || []).map(variant => ({
    authority: variant.authority === 'thinkgraph' ? 'ThinkGraph' : 'KnowGraph',
    nativeId: variant.node.id,
    title: variant.node.label || variant.node.title || variant.node.id,
    description: boundedNativeDescription(variant.node),
  }));
}

/** Render-only focus projection. The center is user-owned; only a successful
 * JevFocus response may promote surrounding real edges and endpoint nodes. */
export function composeManualFocusPresentation(
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
    // and gravity so one subject cannot consume the complete canvas.
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
 * visual nodes and native relationships without another read or Jev call. */
export function composeExpandedFocusPresentation(
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
      schemaVersion: 'jev-focus.v1',
      sourceRevision: expectedSourceRevision,
      status,
      decisionId: null,
      errorCode: typeof raw.errorCode === 'string' ? raw.errorCode : 'jev_focus_unavailable',
      distribution: {},
      candidates: [],
    };
  }
  const rawCandidates = Array.isArray(raw.candidates) ? raw.candidates : [];
  const candidateKey = (candidate: Pick<JevFocusCandidateView, 'authority' | 'nativeId'>) => (
    `${candidate.authority}:${candidate.nativeId}`
  );
  const expectedByNativeMember = new Map(expected.map(candidate => [candidateKey(candidate), candidate]));
  const candidates: JevFocusDecisionCandidateView[] = rawCandidates.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('jev_focus_response_invalid');
    }
    const candidate = item as Record<string, unknown>;
    const authority = String(candidate.authority || '') as JevFocusCandidateView['authority'];
    const nativeId = String(candidate.nativeId || '');
    const source = expectedByNativeMember.get(`${authority}:${nativeId}`);
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
      || left.nativeId.localeCompare(right.nativeId)
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
    schemaVersion: 'jev-focus.v1',
    sourceRevision: expectedSourceRevision,
    status: 'success',
    decisionId,
    errorCode: null,
    distribution: normalizedDistribution,
    candidates,
  };
}

async function requestJevFocus({
  projectId,
  centerId,
  centerTitle,
  centerNativeMembers,
  sourceRevision,
  candidates,
  signal,
}: {
  projectId: string;
  centerId: string;
  centerTitle: string;
  centerNativeMembers: JevFocusCenterMemberView[];
  sourceRevision: string;
  candidates: JevFocusCandidateView[];
  signal: AbortSignal;
}): Promise<JevFocusDecisionView> {
  if (!candidates.length) {
    return {
      schemaVersion: 'jev-focus.v1', status: 'unavailable', decisionId: null,
      sourceRevision,
      errorCode: 'jev_focus_no_connected_candidates', distribution: {}, candidates: [],
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
      center: { visualId: centerId, title: centerTitle, nativeMembers: centerNativeMembers },
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

/**
 * Derives one bounded turn-local renderer projection from the combined native
 * view. It never mutates native graph records, invents relationship edges, or
 * persists this turn's JevAttention probability.
 */
export function composeJevAttentionPresentation(
  presentation: CombinedGraphPresentation,
  visual: JevAttentionVisualDescriptorView | null | undefined,
): GraphProjectionV1 {
  if (!visual?.selectedSubjects.length) return presentation.projection;

  const subjectsByVisualId = new Map<string, JevAttentionVisualSubjectView[]>();
  for (const subject of visual.selectedSubjects) {
    const authority: GraphAuthority = subject.authority === 'ThinkGraph'
      ? 'thinkgraph' : 'knowgraph';
    const visualId = presentation.visualNodeIdByNativeMember.get(
      nativeMemberKey(authority, subject.nativeId),
    );
    if (!visualId) continue;
    const subjects = subjectsByVisualId.get(visualId) || [];
    subjects.push(subject);
    subjectsByVisualId.set(visualId, subjects);
  }
  if (!subjectsByVisualId.size) {
    return {
      ...presentation.projection,
      schemaVersion: `${presentation.projection.schemaVersion}.turn-local`,
      counts: { nodes: 0, edges: 0 },
      nodes: [],
      edges: [],
    };
  }

  const selectedVisualIds = new Set(subjectsByVisualId.keys());
  const localNodeIds = new Set(selectedVisualIds);
  for (const edge of presentation.projection.edges) {
    if (localNodeIds.size >= MAX_TURN_LOCAL_VISUAL_NODES) break;
    if (selectedVisualIds.has(edge.source)) localNodeIds.add(edge.target);
    if (localNodeIds.size >= MAX_TURN_LOCAL_VISUAL_NODES) break;
    if (selectedVisualIds.has(edge.target)) localNodeIds.add(edge.source);
  }
  const localEdges = presentation.projection.edges.filter(
    edge => localNodeIds.has(edge.source) && localNodeIds.has(edge.target),
  );
  const rankedSubjects = [...subjectsByVisualId.entries()].sort((left, right) => {
    const leftProbability = Math.max(...left[1].map(subject => subject.probability));
    const rightProbability = Math.max(...right[1].map(subject => subject.probability));
    return rightProbability - leftProbability || left[0].localeCompare(right[0]);
  });
  const centerVisualId = rankedSubjects[0]?.[0] || null;
  const rankByVisualId = new Map(rankedSubjects.map(([visualId], index) => [visualId, index]));

  const nodes = presentation.projection.nodes
    .filter(node => localNodeIds.has(node.id))
    .map((node) => {
      const variants = presentation.nodeVariants.get(node.id) || [];
      const sourceKind = visualSourceKind(variants);
      const subjects = subjectsByVisualId.get(node.id) || [];
      const selected = subjects.length > 0;
      const probability = selected
        ? Math.max(...subjects.map(subject => subject.probability)) : 0;
      const activated = subjects.some(subject => subject.hydrated
        && subject.resolution === 'resolved');
      const hydrated = subjects.some(subject => subject.hydrated);
      const thinkActive = selected
        ? subjects.some(subject => subject.authority === 'ThinkGraph'
          && subject.hydrated && subject.resolution === 'resolved')
        : variants.some(variant => variant.authority === 'thinkgraph'
          && isAttentionActive(variant.node));
      const knowActive = selected
        ? subjects.some(subject => subject.authority === 'KnowGraph'
          && subject.hydrated && subject.resolution === 'resolved')
        : variants.some(variant => variant.authority === 'knowgraph'
          && isAttentionActive(variant.node));
      const sourceFields = {
        ...solarpunkMaterialFields(sourceKind, thinkActive, knowActive),
        community_id: `jev-source-${sourceKind}`,
        properties: {
          ...(node.properties || {}),
          jevAttentionSource: sourceKind,
          ...(selected ? {
            jevAttentionProbability: probability,
            jevAttentionSelected: true,
            jevAttentionHydrated: hydrated,
            jevAttentionNativeMembers: subjects.map(subject => ({
              authority: subject.authority,
              nativeId: subject.nativeId,
              hydrated: subject.hydrated,
              resolution: subject.resolution,
            })),
          } : {}),
        },
      };
      if (visual.phase !== 'attention_space') return { ...node, ...sourceFields };
      const prominence = mapJevAttentionProminence(probability);
      return {
        ...node,
        ...sourceFields,
        anchor_role: node.id === centerVisualId
          ? 'global' as const
          : selected ? 'community' as const : null,
        system_anchor_id: centerVisualId || undefined,
        scene_rank: selected ? 100 - (rankByVisualId.get(node.id) || 0) : 0,
        gravity_mass: selected ? prominence.gravityMass : 1,
        visual_radius: selected ? prominence.visualRadius : 4.2,
        turn_heat_active: activated,
        turn_heat: activated ? Math.max(probability, Number(node.turn_heat) || 0) : 0,
        properties: {
          ...sourceFields.properties,
          attentionActive: activated,
          jevAttentionPresentation: 'attention_space',
        },
      };
    });

  return {
    ...presentation.projection,
    schemaVersion: `${presentation.projection.schemaVersion}.turn-local`,
    counts: { nodes: nodes.length, edges: localEdges.length },
    nodes,
    edges: localEdges,
  };
}

export function NativeKnowGraphSurface({
  projection,
  status = 'ready',
  error,
  onExpand,
  onUseAsContext,
}: {
  projection: GraphProjectionV1;
  status?: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  onExpand: (node: GraphProjectionNode) => Promise<void>;
  onUseAsContext?: (node: GraphProjectionNode) => void;
}) {
  return (
    <NativeGraphProjectionSurface
      projection={projection}
      status={error ? 'error' : status}
      error={error}
      authority="knowgraph"
      onExpand={onExpand}
      onUseAsContext={onUseAsContext}
    />
  );
}

export function NativeThinkGraphSurface({
  projection,
  status = 'ready',
  error,
  onExpand,
  onUseAsContext,
  onRemoveEvidence,
}: {
  projection: GraphProjectionV1;
  status?: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  onExpand: (node: GraphProjectionNode) => Promise<void>;
  onUseAsContext?: (node: GraphProjectionNode) => void;
  onRemoveEvidence?: (memoryId: string) => Promise<void>;
}) {
  return (
    <NativeGraphProjectionSurface
      projection={projection}
      status={error ? 'error' : status}
      error={error}
      authority="thinkgraph"
      onExpand={onExpand}
      onUseAsContext={onUseAsContext}
      onRemoveEvidence={onRemoveEvidence}
    />
  );
}

export function NativeCombinedGraphSurface({
  projections,
  statuses,
  errors,
  jevAttentionVisual,
  onReadNativeFocusNeighborhood,
  onReadContextualNode,
  contextualReaderRevision,
  onExpand,
  onUseAsContext,
  onUseContextualNodeRead,
  onRemoveThinkGraphEvidence,
}: {
  projections: Record<GraphAuthority, GraphProjectionV1>;
  statuses?: Partial<Record<GraphAuthority, 'idle' | 'loading' | 'ready' | 'error'>>;
  errors?: Partial<Record<GraphAuthority, string>>;
  jevAttentionVisual?: JevAttentionVisualDescriptorView | null;
  onReadNativeFocusNeighborhood?: ReadNativeFocusNeighborhood;
  onReadContextualNode?: ReadContextualNode;
  contextualReaderRevision?: string;
  onExpand: (authority: GraphAuthority, node: GraphProjectionNode) => Promise<void>;
  onUseAsContext?: (authority: GraphAuthority, node: GraphProjectionNode) => void;
  onUseContextualNodeRead?: (
    result: ContextualNodeReadView,
    node: GraphProjectionNode,
  ) => void;
  onRemoveThinkGraphEvidence?: (memoryId: string) => Promise<void>;
}) {
  const presentation = useMemo(
    () => composeThinkKnowPresentation(
      projections.thinkgraph,
      projections.knowgraph,
    ),
    [projections.knowgraph, projections.thinkgraph],
  );
  const turnLocalProjection = useMemo(
    () => composeJevAttentionPresentation(presentation, jevAttentionVisual),
    [jevAttentionVisual, presentation],
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
    <NativeGraphProjectionSurface
      authority="combined"
      projection={turnLocalProjection}
      combinedPresentation={presentation}
      attentionVisualPhase={jevAttentionVisual?.phase || null}
      onReadNativeFocusNeighborhood={onReadNativeFocusNeighborhood}
      onReadContextualNode={onReadContextualNode}
      contextualReaderRevision={contextualReaderRevision}
      status={status}
      error={error}
      warning={warning}
      onExpandNative={onExpand}
      onUseAsContextNative={onUseAsContext}
      onUseContextualNodeRead={onUseContextualNodeRead}
      onRemoveEvidence={onRemoveThinkGraphEvidence}
    />
  );
}

function toCodeGraphData(projection: GraphProjectionV1): GraphData {
  const indexById = new Map(projection.nodes.map((node, index) => [node.id, index + 1]));
  const count = Math.max(1, projection.nodes.length);
  const nodes = projection.nodes.map((node, index) => {
    const y = 1 - (2 * (index + 0.5)) / count;
    const radial = Math.sqrt(Math.max(0, 1 - y * y));
    const angle = index * Math.PI * (3 - Math.sqrt(5));
    const properties = node.properties || {};
    return {
      id: index + 1,
      x: Math.cos(angle) * radial * 180,
      y: y * 180,
      z: Math.sin(angle) * radial * 180,
      label: String(node.type || 'Symbol'),
      name: String(node.label || node.title || node.id),
      file_path: typeof properties.file_path === 'string' ? properties.file_path : undefined,
      size: 10,
      color: String(properties.attentionActorColor || '#37ADAA'),
      native_id: node.id,
      canonical_id: node.canonicalId || node.id,
      authority: 'codegraph',
      actor_card_id: typeof properties.attentionActorCardId === 'string' ? properties.attentionActorCardId : undefined,
      actor_color: typeof properties.attentionActorColor === 'string' ? properties.attentionActorColor : undefined,
      tool_name: typeof properties.attentionToolName === 'string' ? properties.attentionToolName : undefined,
      properties,
      provenance: node.provenance,
    };
  });
  const edges = projection.edges.flatMap((edge) => {
    const source = indexById.get(edge.source);
    const target = indexById.get(edge.target);
    return source && target ? [{ source, target, type: edge.predicate }] : [];
  });
  return { nodes, edges, total_nodes: nodes.length };
}

export function NativeCodeGraphSurface({
  project,
  projection,
  onExpand,
  onUseAsContext,
}: {
  project: string | null;
  projection: GraphProjectionV1;
  onExpand: (node: GraphProjectionNode) => Promise<void>;
  onUseAsContext?: (node: GraphProjectionNode) => void;
}) {
  const attentionData = useMemo(() => toCodeGraphData(projection), [projection]);
  return (
    <div data-testid="native-codegraph-surface" className="cbm-native-surface h-full w-full min-h-0 bg-background text-foreground">
      <CbmGraphTab
        project={project}
        attentionData={attentionData}
        onExpand={async (node) => {
          const native = projection.nodes.find((candidate) => candidate.id === node.native_id);
          if (native) await onExpand(native);
        }}
        onUseAsContext={(node) => {
          const native = projection.nodes.find((candidate) => candidate.id === node.native_id);
          if (native) onUseAsContext?.(native);
        }}
      />
    </div>
  );
}

type NativeLayout = 'compact' | 'original' | 'communities' | 'radial' | 'galaxy';
type NativeStyle = 'classic' | 'cyber' | 'galaxy' | 'solar';
type EngraphisRenderer = {
  setPreset: (name: NativeLayout) => Record<string, number | boolean | string>;
  setStyle: (name: NativeStyle) => void;
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

function sourceDocument(node: GraphProjectionNode) {
  const properties = node.properties || {};
  let body: Record<string, unknown> = {};
  if (typeof properties.content === 'string') {
    try {
      const parsed = JSON.parse(properties.content);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed;
    } catch { /* Plain-text episodes keep their original content. */ }
  }
  const candidates = [properties, body, ...(Array.isArray(body.sources) ? body.sources : []), ...(Array.isArray(body.findings) ? body.findings : [])];
  const links = new Map<string, { url: string; label: string }>();
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const url = candidate.source_url || candidate.url;
    if (typeof url !== 'string') continue;
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) continue;
      links.set(url, { url, label: String(candidate.source_title || candidate.title || candidate.publisher || parsed.hostname) });
    } catch { /* Invalid URLs are not clickable citations. */ }
  }
  return { links: [...links.values()], summary: typeof body.summary === 'string' ? body.summary : null };
}

function nativeEntryTime(value: unknown): { dateTime: string; label: string } | null {
  if (value === null || value === undefined || value === '') return null;
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

function thinkMetadata(item: Record<string, any>): Record<string, any> {
  const metadata = item.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  const structured = metadata.structured_extraction;
  if (!structured || typeof structured !== 'object' || Array.isArray(structured)) return {};
  const think = structured.think;
  return think && typeof think === 'object' && !Array.isArray(think) ? think : {};
}

function thinkStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function ThinkGraphThink({
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
  const think = thinkMetadata(item);
  const metadata = item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata)
    ? item.metadata as Record<string, unknown>
    : {};
  const entryTime = nativeEntryTime(item.ingestedAt);
  const summary = typeof think.summary === 'string' && think.summary.trim()
    ? think.summary
    : typeof item.summary === 'string' && item.summary.trim()
      ? item.summary
      : typeof item.content === 'string' && item.content.trim()
        ? item.content
        : null;
  const keywords = thinkStrings(metadata.keywords);
  const concepts = thinkStrings(think.concepts);
  const semanticSections = ([
    ['Propositions', thinkStrings(think.propositions)],
    ['Questions', thinkStrings(think.questions)],
    ['Predictions', thinkStrings(think.predictions)],
    ['Assumptions', thinkStrings(think.assumptions)],
    ['Preferences', thinkStrings(think.preferences)],
    ['Corrections', thinkStrings(think.corrections)],
    ['Uncertainty', thinkStrings(think.uncertainty)],
    ['Relationship observations', thinkStrings(think.relationship_observations)],
  ] as const).filter(([, values]) => values.length > 0);
  const properties = Array.isArray(think.properties)
    ? think.properties.filter((property: unknown): property is { name: string; value: unknown } => {
      if (!property || typeof property !== 'object' || Array.isArray(property)) return false;
      const candidate = property as Record<string, unknown>;
      return typeof candidate.name === 'string' && candidate.name.trim().length > 0
        && candidate.value !== null && candidate.value !== undefined && String(candidate.value).trim().length > 0;
    })
    : [];
  const importance = Number(think.importance);
  return <section className="graph-note graph-think" data-memory-id={item.id}>
    <div className="graph-think-heading">
      <h4>{heading}</h4>
      {typeof think.kind === 'string' && think.kind ? <span>{think.kind}</span> : null}
    </div>
    {entryTime ? <time dateTime={entryTime.dateTime}>{entryTime.label}</time> : null}
    {summary ? <p>{summary}</p> : null}
    {Number.isFinite(importance) ? <dl className="graph-think-fields">
      <div><dt>Importance</dt><dd>{String(importance)}</dd></div>
    </dl> : null}
    {properties.length ? <section className="graph-think-section">
      <h5>Properties</h5>
      <dl>{properties.map(property => <div key={`${property.name}:${String(property.value)}`}>
        <dt>{property.name}</dt><dd>{String(property.value)}</dd>
      </div>)}</dl>
    </section> : null}
    {semanticSections.map(([label, values]) => <section className="graph-think-section" key={label}>
      <h5>{label}</h5><ul>{values.map(value => <li key={value}>{value}</li>)}</ul>
    </section>)}
    {keywords.length ? <section className="graph-think-section">
      <h5>Keywords</h5><p>{keywords.join(' · ')}</p>
    </section> : null}
    {concepts.length ? <section className="graph-think-section">
      <h5>Concepts</h5><p>{concepts.join(' · ')}</p>
    </section> : null}
    {onRemove ? <button type="button" disabled={removing} onClick={onRemove}>
      {removing ? 'Removing…' : 'Remove Think'}
    </button> : null}
  </section>;
}

export function NativeGraphProjectionSurface({
  projection,
  status,
  error,
  warning,
  authority = 'knowgraph',
  combinedPresentation,
  attentionVisualPhase,
  onReadNativeFocusNeighborhood,
  onReadContextualNode,
  contextualReaderRevision = '',
  onExpand,
  onUseAsContext,
  onExpandNative,
  onUseAsContextNative,
  onUseContextualNodeRead,
  onRemoveEvidence,
}: {
  projection: GraphProjectionV1 | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  warning?: string | null;
  authority?: GraphSurfaceAuthority;
  combinedPresentation?: CombinedGraphPresentation;
  attentionVisualPhase?: JevAttentionVisualDescriptorView['phase'] | null;
  onReadNativeFocusNeighborhood?: ReadNativeFocusNeighborhood;
  onReadContextualNode?: ReadContextualNode;
  contextualReaderRevision?: string;
  onExpand?: (node: GraphProjectionNode) => Promise<void>;
  onUseAsContext?: (node: GraphProjectionNode) => void;
  onExpandNative?: (authority: GraphAuthority, node: GraphProjectionNode) => Promise<void>;
  onUseAsContextNative?: (authority: GraphAuthority, node: GraphProjectionNode) => void;
  onUseContextualNodeRead?: (
    result: ContextualNodeReadView,
    node: GraphProjectionNode,
  ) => void;
  onRemoveEvidence?: (memoryId: string) => Promise<void>;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<EngraphisRenderer | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedAuthority, setSelectedAuthority] = useState<GraphAuthority | null>(null);
  const [selectedMemberKey, setSelectedMemberKey] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [settings, setSettings] = useState<Record<string, number | boolean | string>>({});
  const [layout, setLayout] = useState<NativeLayout>('compact');
  const [style, setStyle] = useState<NativeStyle>('cyber');
  const [physicsProfile, setPhysicsProfile] = useState<JevGraphPhysicsProfile>('galaxy');
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
  const contextualNodeRequestRef = useRef<{
    identity: number;
    controller: AbortController;
  } | null>(null);
  const contextualNodeRequestIdentityRef = useRef(0);
  const contextualSnapshotRef = useRef({ sourceRevision: '', contextRevision: '' });
  const [contextualNodeReadState, setContextualNodeReadState] =
    useState<ContextualNodeReadState | null>(null);
  const presentationStateRef = useRef<{
    layout: NativeLayout;
    style: NativeStyle;
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
  const [expanding, setExpanding] = useState(false);
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
  const activeCombinedPresentation = successfulFocusedEntry?.presentation
    || expandedFocusResult?.presentation
    || combinedPresentation;
  const localDisplayProjection = useMemo(
    () => projection ? applyJevGraphPhysics(projection, physicsProfile) : null,
    [physicsProfile, projection],
  );
  const manualProjectionSource = useMemo(
    () => authority === 'combined' && activeCombinedPresentation
      ? applyJevGraphPhysics(activeCombinedPresentation.projection, physicsProfile)
      : localDisplayProjection,
    [activeCombinedPresentation, authority, localDisplayProjection, physicsProfile],
  );
  const focusProjectionKey = useMemo(() => {
    if (authority !== 'combined' || !combinedPresentation) return '';
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
      combinedPresentation.projection.projectId,
      projectionIdentity(combinedPresentation.nativeProjections.thinkgraph),
      projectionIdentity(combinedPresentation.nativeProjections.knowgraph),
    ].join('|');
  }, [authority, combinedPresentation]);
  focusProjectionKeyRef.current = focusProjectionKey;
  contextualSnapshotRef.current = {
    sourceRevision: focusProjectionKey,
    contextRevision: contextualReaderRevision,
  };
  const manualNavigationActive = focusedEntry !== null || expandedFocusResult !== null;
  const blackholePresentationActive = successfulFocusedEntry !== null
    || (!manualNavigationActive && attentionVisualPhase === 'attention_space');
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
  const selectedNodeVariants: CombinedGraphNodeVariant[] = selectedVisual
    ? activeCombinedPresentation?.nodeVariants.get(selectedVisual.id)
      || (authority !== 'combined' ? [{ authority, node: selectedVisual }] : [])
    : [];
  const defaultSelectedAuthority = selectedNodeVariants.some(variant => variant.authority === 'thinkgraph')
    ? 'thinkgraph'
    : selectedNodeVariants[0]?.authority || null;
  const inspectedNodeAuthority = selectedAuthority
    && selectedNodeVariants.some(variant => variant.authority === selectedAuthority)
    ? selectedAuthority
    : defaultSelectedAuthority;
  const selectedAuthorityVariants = selectedNodeVariants.filter(
    variant => variant.authority === inspectedNodeAuthority,
  );
  const selectedNodeVariant = selectedAuthorityVariants.find(
    variant => nativeMemberKey(variant.authority, variant.node.id) === selectedMemberKey,
  ) || selectedAuthorityVariants[0];
  const selected = selectedNodeVariant?.node;
  const selectedEdgeVisual = displayProjection?.edges.find(edge => edge.id === selectedEdgeId);
  const selectedEdgeVariant: CombinedGraphEdgeVariant | undefined = selectedEdgeVisual
    ? activeCombinedPresentation?.edgeVariants.get(selectedEdgeVisual.id)
      || (authority !== 'combined' ? { authority, edge: selectedEdgeVisual } : undefined)
    : undefined;
  const selectedEdge = selectedEdgeVariant?.edge;
  const inspectedAuthority = selectedEdgeVariant?.authority || selectedNodeVariant?.authority || null;
  const inspectedProjection = authority === 'combined' && inspectedAuthority
    ? activeCombinedPresentation?.nativeProjections[inspectedAuthority] || null
    : displayProjection;
  const selectedProperties = selected?.properties || {};
  const openNodeInspector = (visualNodeId: string) => {
    setControlsOpen(false);
    setRemoveError(null);
    setSelectedAuthority(null);
    setSelectedMemberKey(null);
    setSelectedId(visualNodeId);
    setSelectedEdgeId(null);
    setInspectorOpen(true);
    if (authority !== 'combined') return;

    contextualNodeRequestRef.current?.controller.abort();
    contextualNodeRequestRef.current = null;
    const requestIdentity = contextualNodeRequestIdentityRef.current + 1;
    contextualNodeRequestIdentityRef.current = requestIdentity;
    const sourceRevision = focusProjectionKey;
    const contextRevision = contextualReaderRevision;
    const variants = activeCombinedPresentation?.nodeVariants.get(visualNodeId) || [];
    const nativeMembers = variants.map((variant): ContextualNodeNativeMember => ({
      authority: variant.authority === 'thinkgraph' ? 'ThinkGraph' : 'KnowGraph',
      nativeId: String(variant.node.canonicalId || variant.node.id),
    })).filter((member, index, all) => all.findIndex(candidate => (
      candidate.authority === member.authority && candidate.nativeId === member.nativeId
    )) === index);
    if (!onReadContextualNode || !nativeMembers.length || !sourceRevision) {
      setContextualNodeReadState({
        visualNodeId,
        requestIdentity,
        sourceRevision,
        contextRevision,
        status: 'error',
        result: null,
        error: !onReadContextualNode
          ? 'Contextual node reader unavailable.'
          : 'This visual node has no exact native members.',
      });
      return;
    }
    const controller = new AbortController();
    contextualNodeRequestRef.current = { identity: requestIdentity, controller };
    setContextualNodeReadState({
      visualNodeId,
      requestIdentity,
      sourceRevision,
      contextRevision,
      status: 'loading',
      result: null,
      error: null,
    });
    void onReadContextualNode({
      sourceRevision,
      clientContextRevision: contextRevision,
      nativeMembers,
    }, controller.signal).then((result) => {
      const pending = contextualNodeRequestRef.current;
      const snapshot = contextualSnapshotRef.current;
      if (
        controller.signal.aborted
        || pending?.identity !== requestIdentity
        || snapshot.sourceRevision !== sourceRevision
        || snapshot.contextRevision !== contextRevision
      ) return;
      setContextualNodeReadState({
        visualNodeId,
        requestIdentity,
        sourceRevision,
        contextRevision,
        status: 'ready',
        result,
        error: null,
      });
    }).catch((failure: unknown) => {
      if (controller.signal.aborted
        || contextualNodeRequestRef.current?.identity !== requestIdentity) return;
      setContextualNodeReadState({
        visualNodeId,
        requestIdentity,
        sourceRevision,
        contextRevision,
        status: 'error',
        result: null,
        error: failure instanceof Error
          ? failure.message
          : 'Contextual node read failed.',
      });
    }).finally(() => {
      if (contextualNodeRequestRef.current?.identity === requestIdentity) {
        contextualNodeRequestRef.current = null;
      }
    });
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
      centerId: entry.centerId,
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
    if (authority !== 'combined' || !activeCombinedPresentation || !manualProjectionSource) return;
    const center = manualProjectionSource.nodes.find(node => node.id === centerId);
    if (!center || (focusedEntry?.centerId === centerId
      && ['reading', 'loading', 'success'].includes(focusedEntry.status))) return;
    const sourcePresentation = activeCombinedPresentation;
    const centerNativeMembers = focusCenterMembers(sourcePresentation, centerId);
    if (!centerNativeMembers.length) return;
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
      candidates: [],
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
      schemaVersion: 'jev-focus.v1', sourceRevision: entry.projectionKey,
      status, decisionId: null, errorCode, distribution: {}, candidates: [],
    });
    void (async () => {
      if (!onReadNativeFocusNeighborhood) {
        if (stale()) return;
        const decision = failedDecision('unavailable', 'jev_focus_native_reader_unavailable');
        setFocusTrail(history => history.map(item => item.requestIdentity === requestIdentity
          ? { ...item, status: decision.status, decision }
          : item));
        return;
      }
      const settled = await Promise.allSettled(centerNativeMembers.map(async member => ({
        authority: member.authority === 'ThinkGraph' ? 'thinkgraph' as const : 'knowgraph' as const,
        projection: await onReadNativeFocusNeighborhood(
          member.authority === 'ThinkGraph' ? 'thinkgraph' : 'knowgraph',
          member.nativeId,
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
          const member = centerNativeMembers[index];
          failures.push(`${member.authority} ${member.nativeId}`);
        }
      }
      if (!Object.values(reads).some(values => values?.length)) {
        const decision = failedDecision('unavailable', 'jev_focus_native_read_unavailable');
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
        ? `Native neighborhood partial: ${failures.join(' · ')}`
        : null;
      if (failures.length || candidates.length > MAX_JEV_FOCUS_CANDIDATES) {
        const decision = failedDecision(
          'unavailable',
          failures.length
            ? 'jev_focus_native_read_partial'
            : 'jev_focus_candidate_limit',
        );
        setFocusTrail(history => history.map(item => item.requestIdentity === requestIdentity
          ? {
            ...item,
            presentation: focusPresentation,
            candidates,
            status: decision.status,
            decision,
            readWarning: readWarning || (
              `Native neighborhood has ${candidates.length} subjects; `
              + `JevFocus accepts at most ${MAX_JEV_FOCUS_CANDIDATES}.`
            ),
          }
          : item));
        return;
      }
      setFocusTrail(history => history.map(item => item.requestIdentity === requestIdentity
        ? { ...item, presentation: focusPresentation, candidates, status: 'loading', readWarning }
        : item));
      const decision = await requestJevFocus({
        projectId: focusPresentation.projection.projectId,
        centerId,
        centerTitle: entry.centerTitle,
        centerNativeMembers: focusCenterMembers(focusPresentation, centerId),
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
        ...(authority === 'combined' ? {
          onNodeDoubleClick: (node: { id: string }) => {
            inspectNode(node);
            focusActionRef.current(node.id);
          },
        } : {}),
        onLinkClick: link => {
          contextualNodeRequestRef.current?.controller.abort();
          contextualNodeRequestRef.current = null;
          contextualNodeRequestIdentityRef.current += 1;
          setContextualNodeReadState(null);
          setControlsOpen(false);
          setRemoveError(null);
          setSelectedAuthority(null);
          setSelectedMemberKey(null);
          setSelectedId(null);
          setSelectedEdgeId(String(link.id));
          setInspectorOpen(true);
        },
        onBackgroundClick: () => {
          contextualNodeRequestRef.current?.controller.abort();
          contextualNodeRequestRef.current = null;
          contextualNodeRequestIdentityRef.current += 1;
          setContextualNodeReadState(null);
          exitFocusRef.current();
          setSelectedAuthority(null);
          setSelectedMemberKey(null);
          setSelectedId(null);
          setSelectedEdgeId(null);
          setInspectorOpen(false);
          setControlsOpen(false);
        },
      });
      const defaults = graph.setPreset('compact');
      graph.setCollapse(false);
      setLayout('compact'); setStyle('cyber'); setPhysicsProfile('galaxy');
      graph.setStyle('cyber');
      graph.setThemeColors({
        accent: GRAPH_THEME.accent.primary,
        solar: GRAPH_THEME.accent.solar,
        surface: GRAPH_THEME.surface.base,
        label: GRAPH_THEME.surface.text,
      });
      graph.setSettings({ labels: true });
      setSettings({ ...defaults, labels: true });
      graphRef.current = graph;
      return () => { graph.destroy(); graphRef.current = null; };
    } catch (failure) {
      setRenderError(failure instanceof Error ? failure.message : String(failure));
      return undefined;
    }
  }, [authority]);

  useEffect(() => () => {
    for (const controller of focusRequestControllersRef.current.values()) controller.abort();
    focusRequestControllersRef.current.clear();
    contextualNodeRequestRef.current?.controller.abort();
    contextualNodeRequestRef.current = null;
    if (focusReleaseTimeoutRef.current) clearTimeout(focusReleaseTimeoutRef.current);
  }, []);

  useEffect(() => {
    contextualNodeRequestRef.current?.controller.abort();
    contextualNodeRequestRef.current = null;
    contextualNodeRequestIdentityRef.current += 1;
    setContextualNodeReadState(null);
  }, [contextualReaderRevision, focusProjectionKey]);

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
        const defaults = graph.setPreset('galaxy');
        graph.setStyle('cyber');
        graph.setSettings(CALM_FOCUS_GALAXY_SETTINGS);
        setLayout('galaxy');
        setStyle('cyber');
        setPhysicsProfile('galaxy');
        setSettings(current => ({ ...current, ...defaults, ...CALM_FOCUS_GALAXY_SETTINGS }));
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
      graph.setStyle(automatic.snapshot.style);
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
        const variants = authority === 'combined'
          ? activeCombinedPresentation?.nodeVariants.get(node.id) || []
          : [{ authority, node }] as CombinedGraphNodeVariant[];
        const sourceKind = authority === 'combined'
          ? visualSourceKind(variants)
          : authority === 'knowgraph' ? 'know' : 'think';
        const thinkActive = typeof node.material_think_active === 'boolean'
          ? node.material_think_active
          : variants.some(variant => variant.authority === 'thinkgraph'
            && isAttentionActive(variant.node));
        const knowActive = typeof node.material_know_active === 'boolean'
          ? node.material_know_active
          : variants.some(variant => variant.authority === 'knowgraph'
            && isAttentionActive(variant.node));
        return {
          ...node,
          ...solarpunkMaterialFields(sourceKind, thinkActive, knowActive),
        };
      }),
      links: sceneLinks.map(rawEdge => {
        const edge = rawEdge as GraphProjectionEdge;
        const projected = projectionEdgesById.get(String(edge.id));
        const properties = { ...(edge.properties || {}), ...(projected?.properties || {}) };
        const semanticEdge = { ...edge, ...(projected || {}), properties };
        const edgeAuthority = authority === 'combined'
          ? activeCombinedPresentation?.edgeVariants.get(String(semanticEdge.id))?.authority
          : authority;
        if (edgeAuthority !== 'thinkgraph') return { ...semanticEdge, relation: semanticEdge.predicate };
        const jev = semanticEdge.properties?.jev;
        const distribution = jev && typeof jev === 'object' && !Array.isArray(jev)
          && (jev as Record<string, unknown>).distribution
          && typeof (jev as Record<string, unknown>).distribution === 'object'
          ? (jev as Record<string, any>).distribution as Record<string, unknown>
          : null;
        const winner = jev && typeof jev === 'object' && !Array.isArray(jev)
          ? String((jev as Record<string, unknown>).winner || semanticEdge.predicate)
          : semanticEdge.predicate;
        const probability = compactProbability(
          distribution?.[winner]
            ?? semanticEdge.properties?.relationship_strength
            ?? semanticEdge.relationship_strength,
        );
        return {
          ...semanticEdge,
          relation: semanticEdge.predicate,
          label: probability,
          hover_label: `${winner}${probability ? ` · ${probability}` : ''}`,
          label_min_scale: 0.01,
          directional_arrow_length: 3,
          directional_arrow_rel_pos: 0.9,
        };
      }),
    };
    const graph = graphRef.current;
    graph?.setData(data);
    if (successfulFocusedEntry) graph?.focus(successfulFocusedEntry.centerId);
    else graph?.clearFocus();
  }, [activeCombinedPresentation, authority, displayProjection, successfulFocusedEntry]);

  useEffect(() => {
    graphRef.current?.setHighlight(selectedId || successfulFocusedEntry?.centerId || null);
  }, [selectedId, successfulFocusedEntry?.centerId]);

  useEffect(() => {
    if (selectedId && !displayProjection?.nodes.some(node => node.id === selectedId)) {
      contextualNodeRequestRef.current?.controller.abort();
      contextualNodeRequestRef.current = null;
      contextualNodeRequestIdentityRef.current += 1;
      setContextualNodeReadState(null);
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
      panelBodyRef.current?.querySelector<HTMLElement>('[tabindex="-1"], select')?.focus();
    }
  }, [controlsOpen, inspectorOpen, selectedAuthority, selectedEdgeId, selectedId, selectedMemberKey]);

  const closePanel = () => {
    contextualNodeRequestRef.current?.controller.abort();
    contextualNodeRequestRef.current = null;
    contextualNodeRequestIdentityRef.current += 1;
    setContextualNodeReadState(null);
    setSelectedAuthority(null);
    setSelectedMemberKey(null);
    setSelectedId(null);
    setSelectedEdgeId(null);
    setInspectorOpen(false);
    setControlsOpen(false);
  };

  const allNodes = displayProjection?.nodes.length ?? 0;
  const selectedNative = inspectedProjection?.nodes.find(node => node.id === selected?.id);
  const selectedSource = selectedNative ? sourceDocument(selectedNative) : null;
  const evidenceIds = new Set<string>(selected ? [selected.id] : []);
  for (const edge of selectedEdge ? [selectedEdge] : []) {
    for (const value of [edge.properties?.episodes, edge.properties?.supportingEpisodeUuids]) {
      for (const id of Array.isArray(value) ? value : typeof value === 'string' ? [value] : []) {
        evidenceIds.add(String(id));
      }
    }
    if (edge.predicate === 'MENTIONS') evidenceIds.add(edge.source);
  }
  const evidence = (inspectedProjection?.nodes || []).filter(node => evidenceIds.has(node.id)).map(node => ({ node, ...sourceDocument(node) })).filter(item => item.links.length);
  const selectedEvidence = (selectedEdge?.properties || selectedProperties).evidence;
  const evidenceRecords = Array.isArray(selectedEvidence) ? selectedEvidence.filter((item): item is Record<string, any> =>
    item !== null && typeof item === 'object' && typeof item.id === 'string') : [];
  const contextualRead = authority === 'combined'
    && selectedId
    && contextualNodeReadState?.visualNodeId === selectedId
    ? contextualNodeReadState
    : null;
  const contextualResult = contextualRead?.status === 'ready'
    ? contextualRead.result
    : null;
  const contextualSide = inspectedAuthority === 'thinkgraph'
    ? contextualResult?.sides.think
    : inspectedAuthority === 'knowgraph'
      ? contextualResult?.sides.know
      : null;
  const contextualItems = contextualSide?.items || [];
  const contextualThinks = inspectedAuthority === 'thinkgraph'
    ? contextualItems.map(item => ({
        id: String(item.block.nativeId || item.nativeId),
        title: item.block.title,
        content: item.block.content,
        metadata: item.block.metadata,
        provenance: item.block.provenance,
        ingestedAt: item.block.properties?.ingestedAt,
      }))
    : [];
  const thinks = authority === 'combined'
    ? contextualThinks
    : inspectedAuthority === 'thinkgraph' && selected && !selectedEdge
      ? evidenceRecords.filter(item => item.metadata !== null
        && typeof item.metadata === 'object'
        && item.metadata.structured_extraction !== null
        && typeof item.metadata.structured_extraction === 'object'
        && item.metadata.structured_extraction.think !== null
        && typeof item.metadata.structured_extraction.think === 'object')
      : evidenceRecords;
  const latestThink = inspectedAuthority === 'thinkgraph' && selected && !selectedEdge
    ? thinks[0] : null;
  const entryTitle = selected?.label || (selectedEdge ? selectedEdge.predicate : '');
  const nativeLabel = (id: string) => inspectedProjection?.nodes.find(node => node.id === id)?.label || id;
  const relationshipStrength = probabilityLabel(selectedEdge?.properties?.relationship_strength);
  const labelConfidence = probabilityLabel(selectedEdge?.properties?.label_confidence);
  const portableKnow = inspectedAuthority === 'knowgraph'
    && selectedEdge?.properties?.portableKind === 'know'
    ? selectedEdge.properties
    : null;
  const contextualKnowItems = inspectedAuthority === 'knowgraph'
    ? contextualItems.flatMap((item) => {
        const know = item.block.know;
        if (!know || typeof know !== 'object' || Array.isArray(know)) return [];
        const episodes = Array.isArray(know.supportingEpisodes)
          ? know.supportingEpisodes.filter((episode: unknown): episode is Record<string, any> => (
            Boolean(episode) && typeof episode === 'object' && !Array.isArray(episode)
          ))
          : [];
        return [{ nativeId: item.nativeId, block: item.block, know, episodes }];
      })
    : [];
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
    .filter(candidate => selectedNodeVariants.some(variant => variant.authority === candidate));
  const activeSelectedVariants = selectedNodeVariants.filter(
    variant => isAttentionActive(variant.node),
  );
  const visualNodeIdForNative = (nativeId: string) => inspectedAuthority
    ? activeCombinedPresentation?.visualNodeIdByNativeMember.get(
      nativeMemberKey(inspectedAuthority, nativeId),
    ) || nativeId
    : nativeId;
  return (
    <div data-testid={`native-${authority}-surface`} className="native-authority-graph" data-layout={layout} data-style={style} data-physics-profile={physicsProfile} data-attention-visual-phase={attentionVisualPhase || 'ordinary'} data-focus-phase={successfulFocusedEntry ? 'manual_blackhole_focus' : focusRequestPending ? 'focus_preparing' : focusRelease ? 'focus_release' : 'local_relational'} data-panel-open={controlsOpen || inspectorOpen} aria-busy={status === 'loading'}
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
      <div className="native-authority-canvas">
        <div ref={hostRef} className="native-authority-network graph-canvas"
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
        {status === 'error' || renderError ? <div className="native-authority-empty">Graph failed: {renderError || error}</div> : null}
        {status !== 'error' && !renderError && warning ? (
          <div
            role="status"
            data-testid="native-authority-warning"
            style={{
              position: 'absolute', top: 48, left: 12, zIndex: 5,
              maxWidth: 'min(520px, calc(100% - 96px))', padding: '6px 9px', borderRadius: 7,
              background: 'rgba(74, 35, 45, 0.9)', color: '#fecdd3', fontSize: 11,
            }}
          >
            {warning}
          </div>
        ) : null}
        {status === 'ready' && allNodes === 0 ? <div className="native-authority-empty">No knowledge yet.</div> : null}
      </div>
        <RightGlassDrawer
          isOpen={controlsOpen || inspectorOpen}
          title={inspectorOpen ? (selectedEdge ? '' : entryTitle) : 'Graph settings'}
          onClose={closePanel}
          onOpen={() => { setSelectedAuthority(null); setSelectedMemberKey(null); setSelectedId(null); setSelectedEdgeId(null); setControlsOpen(true); setInspectorOpen(false); }}
          collapsedLabel={null}
          openAriaLabel="Open graph settings"
          movable
          defaultWidth={340} minWidth={280} maxWidth={520}
          storageKey={`liquidaity.drawer.${authority}.width`}
          top={48} right={12} bottom={12} zIndex={6}
        >
          {!inspectorOpen ? <div ref={panelBodyRef} className="native-authority-controls">
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
              const next = event.target.value as NativeLayout;
              const defaults = graphRef.current?.setPreset(next);
              setLayout(next); setSettings(current => ({ ...current, ...defaults }));
            }}>
              <option value="compact">Compact</option><option value="original">Original</option>
              <option value="communities">Communities</option><option value="radial">Radial</option>
              <option value="galaxy">Galaxy gravity</option>
            </select></label>
            <label>Style<select aria-label="Style" value={style} onChange={event => {
              recordManualPresentationChange('style');
              const next = event.target.value as NativeStyle;
              graphRef.current?.setStyle(next); setStyle(next);
            }}>
              <option value="classic">Classic</option><option value="cyber">Cyberpunk</option>
              <option value="galaxy">Galaxy</option><option value="solar">Solar</option>
            </select></label>
            <label><input type="checkbox" checked={settings.labels === true} onChange={event => {
              recordManualPresentationChange('setting', 'labels');
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
                  const patch = { [key]: Number(event.target.value) };
                  graphRef.current?.setSettings(patch);
                  setSettings(current => ({ ...current, ...patch }));
                }} />
              <output>{settings[key]}</output>
            </label>)}
            <button type="button" onClick={() => {
              recordManualPresentationChange('all-settings');
              const defaults = graphRef.current?.setPreset(layout);
              graphRef.current?.setSettings({ labels: true });
              setSettings({ ...defaults, labels: true });
            }}>Reset to preset defaults</button>
          </div> : (selected || selectedEdge) ? <div ref={panelBodyRef} className="native-authority-controls" role="region" aria-label={`${entryTitle} details`}>
        {authority === 'combined' && selectedVisual ? (
          <div className="native-authority-actions">
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
            <button
              type="button"
              disabled={contextualRead?.status === 'loading'}
              onClick={() => inspectNodeRef.current(selectedVisual.id)}
            >
              {contextualRead?.status === 'loading' ? 'Reading…' : 'Reread contents'}
            </button>
          </div>
        ) : null}
        {authority === 'combined' && selected && availableNodeAuthorities.length ? (
          <div role="tablist" aria-label={`${selected.label} graph evidence`} style={{ display: 'flex', gap: 6 }}>
            {availableNodeAuthorities.map(candidate => (
              <button
                key={candidate}
                type="button"
                role="tab"
                aria-selected={candidate === inspectedAuthority}
                onClick={() => { setSelectedAuthority(candidate); setSelectedMemberKey(null); }}
              >
                {candidate === 'thinkgraph' ? 'Think' : 'Know'}
              </button>
            ))}
          </div>
        ) : null}
        {authority === 'combined' && selected && selectedAuthorityVariants.length > 1 ? (
          <label>
            {inspectedAuthority === 'thinkgraph' ? 'Think native member' : 'Know native member'}
            <select
              aria-label={inspectedAuthority === 'thinkgraph' ? 'Think native member' : 'Know native member'}
              value={selectedNodeVariant
                ? nativeMemberKey(selectedNodeVariant.authority, selectedNodeVariant.node.id)
                : ''}
              onChange={event => setSelectedMemberKey(event.target.value)}
            >
              {selectedAuthorityVariants.map((variant) => (
                <option
                  key={nativeMemberKey(variant.authority, variant.node.id)}
                  value={nativeMemberKey(variant.authority, variant.node.id)}
                >
                  {`${inspectedAuthority === 'thinkgraph' ? 'Think' : 'Know'} · ${variant.node.id}`}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {authority === 'combined' && selected && activeSelectedVariants.length ? (
          <section data-testid="combined-attention-members">
            <h4>Attention</h4>
            <ul>
              {activeSelectedVariants.map(variant => (
                <li key={nativeMemberKey(variant.authority, variant.node.id)}>
                  {`${variant.authority === 'thinkgraph' ? 'ThinkGraph' : 'KnowGraph'} · ${variant.node.id}`}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {authority === 'combined' && selected && contextualRead?.status === 'loading' ? (
          <p role="status" data-testid="contextual-node-read-loading">
            Selecting the most useful native {inspectedAuthority === 'thinkgraph' ? 'Think' : 'Know'}…
          </p>
        ) : null}
        {authority === 'combined' && selected && contextualRead?.status === 'error' ? (
          <p role="alert" data-testid="contextual-node-read-error">
            {contextualRead.error || 'Contextual node read unavailable.'}
          </p>
        ) : null}
        {authority === 'combined' && selected && contextualResult?.contextLabel ? (
          <p className="graph-note" data-testid="contextual-node-read-for">
            <strong>For:</strong> {contextualResult.contextLabel}
          </p>
        ) : null}
        {authority === 'combined' && selected && contextualSide
          && contextualSide.status !== 'selected' && contextualSide.status !== 'partial' ? (
            <p role="status" data-testid={`contextual-node-${inspectedAuthority}-status`}>
              {contextualSide.status === 'none_relevant'
                ? `No supplied native ${inspectedAuthority === 'thinkgraph' ? 'Think' : 'Know'} is relevant to this request.`
                : contextualSide.status === 'empty' || contextualSide.status === 'missing'
                  ? `No native ${inspectedAuthority === 'thinkgraph' ? 'Think' : 'Know'} is attached to this node.`
                  : contextualSide.status === 'context_unavailable'
                    ? 'A current question or task is required for this contextual read.'
                    : contextualSide.status === 'limit' || contextualSide.status === 'context_limit'
                      ? 'This node is too large for one complete contextual selection.'
                      : `Contextual ${inspectedAuthority === 'thinkgraph' ? 'Think' : 'Know'} unavailable (${contextualSide.status}).`}
            </p>
          ) : null}
        {authority === 'combined' && selected && contextualSide?.status === 'partial' ? (
          <p role="status" data-testid={`contextual-node-${inspectedAuthority}-status`}>
            Some selected native content could not be hydrated; only the exact hydrated items below are usable.
          </p>
        ) : null}
        {authority === 'combined' && selectedVisual && contextualResult
          && contextualResult.dataAnchors.length && onUseContextualNodeRead ? (
            <div className="native-authority-actions">
              <button type="button" onClick={() => (
                onUseContextualNodeRead(contextualResult, selectedVisual)
              )}>Use selected in chat</button>
            </div>
          ) : null}
        {selected ? <article data-testid={`${inspectedAuthority}-node-inspector`} data-native-id={selected.id}>
          <h4 tabIndex={-1}>{selected.label}</h4>
          {authority !== 'combined' && inspectedAuthority === 'knowgraph' ? (['statement', 'fact', 'content', 'summary', 'reason'] as const).map(key => selectedProperties[key])
            .filter((value, index, values): value is string => typeof value === 'string' && !!value && values.indexOf(value) === index)
            .map(value => <p key={value}>{value}</p>) : null}
          {authority !== 'combined' && inspectedAuthority === 'knowgraph' && selectedSource?.summary ? <p>{selectedSource.summary}</p> : null}
        </article> : null}
        {authority === 'combined' ? thinks.map((item, index) => <ThinkGraphThink
          key={item.id}
          item={item}
          heading={thinks.length > 1 ? `Selected Think ${index + 1}` : 'Selected Think'}
        />) : latestThink ? <ThinkGraphThink
          item={latestThink}
          heading="Latest Think"
          removing={removingId === latestThink.id}
          onRemove={inspectedAuthority === 'thinkgraph' && onRemoveEvidence ? async () => {
            setRemovingId(latestThink.id); setRemoveError(null);
            try { await onRemoveEvidence(latestThink.id); }
            catch (failure) { setRemoveError(failure instanceof Error ? failure.message : String(failure)); }
            finally { setRemovingId(null); }
          } : undefined}
        /> : null}
        {authority !== 'combined' && thinks.length > 1 ? <details className="graph-think-history">
          <summary>Earlier Thinks ({thinks.length - 1})</summary>
          <div>{thinks.slice(1).map((item, index) => <ThinkGraphThink
            key={item.id}
            item={item}
            heading={`Earlier Think ${index + 1}`}
          />)}</div>
        </details> : null}
        {contextualKnowItems.length ? <section className="graph-note" data-testid="contextual-selected-know">
          <h4>{contextualKnowItems.length > 1 ? 'Selected Knows' : 'Selected Know'}</h4>
          {contextualKnowItems.map(({ nativeId, block, know, episodes }, index) => (
            <article key={nativeId} data-native-id={nativeId}>
              {contextualKnowItems.length > 1 ? <h5>{`Know ${index + 1}`}</h5> : null}
              {typeof know.fact === 'string' && know.fact
                ? <p>{know.fact}</p>
                : typeof block.content === 'string' && block.content
                  ? <p>{block.content}</p>
                  : null}
              <dl className="graph-record-fields">
                {([
                  ['Native fact', know.nativeFactUuid],
                  ['Native relation', know.nativeRelation],
                  ['Recorded', know.createdAt],
                  ['Reference time', know.referenceTime],
                  ['Valid from', know.validAt],
                  ['Invalid from', know.invalidAt],
                  ['Expired', know.expiredAt],
                ] as const).map(([label, value]) => value
                  ? <div key={label}><dt>{label}</dt><dd>{String(value)}</dd></div>
                  : null)}
              </dl>
              {episodes.length ? <section className="knowgraph-sources">
                <h5>Sources</h5>
                {episodes.map((episode) => {
                  const url = String(episode.source_url || episode.url || '').trim();
                  const label = String(
                    episode.name || episode.source_name || episode.uuid || 'Source',
                  );
                  return <div key={String(episode.uuid || url || label)}>
                    {url ? <a href={url} target="_blank" rel="noreferrer">{label}</a> : <span>{label}</span>}
                    {episode.valid_at ? <time dateTime={String(episode.valid_at)}>
                      {String(episode.valid_at)}
                    </time> : null}
                    {episode.content_preview ? <p>{String(episode.content_preview)}</p> : null}
                  </div>;
                })}
              </section> : null}
            </article>
          ))}
        </section> : null}
        {selectedEdge ? <article data-testid={`${inspectedAuthority}-edge-inspector`} data-native-id={selectedEdge.id}>
          <h4 tabIndex={-1}>{nativeLabel(selectedEdge.source)} → {selectedEdge.predicate} → {nativeLabel(selectedEdge.target)}</h4>
          {(['fact', 'summary', 'reason'] as const).map(key => typeof selectedEdge.properties?.[key] === 'string'
            && selectedEdge.properties[key] ? <p key={key}>{String(selectedEdge.properties[key])}</p> : null)}
          <button type="button" onClick={() => {
            const visualId = visualNodeIdForNative(selectedEdge.source);
            inspectNodeRef.current(visualId);
            setSelectedAuthority(inspectedAuthority);
            setSelectedMemberKey(inspectedAuthority
              ? nativeMemberKey(inspectedAuthority, selectedEdge.source)
              : null);
          }}>{nativeLabel(selectedEdge.source)}</button>
          <button type="button" onClick={() => {
            const visualId = visualNodeIdForNative(selectedEdge.target);
            inspectNodeRef.current(visualId);
            setSelectedAuthority(inspectedAuthority);
            setSelectedMemberKey(inspectedAuthority
              ? nativeMemberKey(inspectedAuthority, selectedEdge.target)
              : null);
          }}>{nativeLabel(selectedEdge.target)}</button>
        </article> : null}
        {selectedEdge ? <dl className="graph-record-fields graph-edge-meaning">
          <div><dt>Direction</dt><dd>{nativeLabel(selectedEdge.source)} → {nativeLabel(selectedEdge.target)}</dd></div>
          {jevWinner ? <div><dt>Jev winner</dt><dd>{jevWinner}</dd></div> : null}
          {jevWinnerProbability ? <div><dt>Probability</dt><dd>{jevWinnerProbability}</dd></div> : null}
          {naturalRelationship ? <div><dt>Natural extracted relationship</dt><dd>{naturalRelationship}</dd></div> : null}
          {!jevWinnerProbability && relationshipStrength ? <div><dt>Relationship strength</dt><dd>{relationshipStrength}</dd></div> : null}
          {!jevWinnerProbability && labelConfidence ? <div><dt>Label confidence</dt><dd>{labelConfidence}</dd></div> : null}
        </dl> : null}
        {portableKnow ? <section className="graph-note" data-testid="portable-know">
          <h4>{portableKnow.temporalStatus === 'historical' ? 'Historical Know' : 'Current Know'}</h4>
          {typeof portableKnow.fact === 'string' && portableKnow.fact
            ? <p>{portableKnow.fact}</p> : null}
          <dl className="graph-record-fields">
            {portableKnow.nativeRelation ? <div><dt>Native Graphiti relation</dt><dd>{String(portableKnow.nativeRelation)}</dd></div> : null}
            {jev?.status === 'success' && jev.winner ? <div><dt>Jev canonical relation</dt><dd>{String(jev.winner)}</dd></div> : null}
            {jev?.status && jev.status !== 'success' ? <div><dt>Jev classification</dt><dd>{String(jev.status)}</dd></div> : null}
            {([
              ['Learned', portableKnow.createdAt],
              ['Reference time', portableKnow.referenceTime],
              ['Valid from', portableKnow.validAt],
              ['Invalid from', portableKnow.invalidAt],
              ['Expired', portableKnow.expiredAt],
            ] as const).map(([label, value]) => value
              ? <div key={label}><dt>{label}</dt><dd>{String(value)}</dd></div>
              : null)}
          </dl>
        </section> : null}
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
        {evidence.length ? <section className="knowgraph-sources"><h4>Sources</h4>{evidence.map(({ node, links }) =>
          <details key={node.id}>
            <summary>{node.label}</summary>
            {links.map(link => <a key={link.url} href={link.url} target="_blank" rel="noreferrer">{link.label}</a>)}
            {typeof node.properties?.content === 'string' ? <pre>{node.properties.content}</pre> : null}
          </details>)}</section> : null}
        {inspectedAuthority === 'knowgraph' && selected ? <div className="native-authority-actions">
          {onExpand || onExpandNative ? <button type="button" disabled={expanding} onClick={() => {
            setExpanding(true);
            const pending = onExpandNative
              ? onExpandNative('knowgraph', selected)
              : onExpand!(selected);
            void pending.finally(() => setExpanding(false));
          }}>{expanding ? (authority === 'combined' ? 'Loading…' : 'Expanding…')
            : authority === 'combined' ? 'Load' : 'Expand'}</button> : null}
          {authority !== 'combined' && (onUseAsContext || onUseAsContextNative) ? <button type="button" onClick={() => {
            if (onUseAsContextNative) onUseAsContextNative('knowgraph', selected);
            else onUseAsContext?.(selected);
          }}>Use in chat</button> : null}
        </div> : null}
      </div> : null}
        </RightGlassDrawer>
    </div>
  );
}
