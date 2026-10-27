/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: Jev Decisions
 * Relationship: This file builds bounded provider neighborhoods, validates Jev focus choices, and projects only the selected real neighbors into transient focus views.
 * Entity: Project Knowledge Graph
 * Relationship: This file composes manual, expanded, and release presentations over the existing shared graph without creating nodes, edges, or another graph authority.
 * Entity: ThinkGraph
 * Relationship: This file carries exact Engraphis provider members and incident relationships into focus candidates without writing ThinkGraph.
 * Entity: KnowGraph
 * Relationship: This file carries exact Graphiti provider members and incident relationships into focus candidates without writing KnowGraph.
 */

import {
  composeThinkKnowPresentation,
  providerMemberKey,
  type GraphAuthority,
  type GraphProjectionEdge,
  type GraphProjectionNode,
  type GraphProjectionV1,
  type JoinedGraphPresentation,
} from './knowledgeGraphProjection';

export type JevFocusIncidentRelationshipView = {
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

export type JevFocusCandidateView = {
  visualId: string;
  authority: 'ThinkGraph' | 'KnowGraph';
  entityId: string;
  title: string;
  description: string | null;
  incidentRelationships: JevFocusIncidentRelationshipView[];
};

export type JevFocusCenterMemberView = {
  authority: 'ThinkGraph' | 'KnowGraph';
  entityId: string;
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
  status: 'success' | 'unavailable' | 'timeout' | 'invalid' | 'error';
  errorCode: string | null;
  candidates: JevFocusDecisionCandidateView[];
};

export type ManualFocusEntry = {
  centerId: string;
  centerTitle: string;
  status: 'reading' | 'loading' | JevFocusDecisionView['status'];
  decision: JevFocusDecisionView | null;
  requestIdentity: number;
  projectionKey: string;
  presentation: JoinedGraphPresentation;
  readWarning: string | null;
};

export type FocusReleaseView = {
  nodeIds: string[];
  edgeIds: string[];
};

export const MAX_JEV_FOCUS_CANDIDATES = 12;

export const FOCUS_RELEASE_MILLISECONDS = 1_400;

export const CALM_FOCUS_GALAXY_SETTINGS = {
  repel: 25,
  gravity: 48,
  damping: 6,
} as const;

export function composeFocusNeighborhoodPresentation(
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

export function finiteUnitInterval(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : null;
}

export function focusRelationshipWeight(edge: GraphProjectionEdge): number | null {
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

export function boundedProviderDescription(node: GraphProjectionNode): string | null {
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
    const source = record.source
      && typeof record.source === 'object'
      && !Array.isArray(record.source)
      ? record.source as Record<string, unknown>
      : {};
    const direction = record.direction
      && typeof record.direction === 'object'
      && !Array.isArray(record.direction)
      ? record.direction as Record<string, unknown>
      : {};
    return [
      record.summary,
      record.observation,
      record.interpretation,
      source.evidence,
      direction.proposition,
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

export function buildJevFocusCandidates(
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

export function selectedFocusCandidates(entry: ManualFocusEntry): JevFocusDecisionCandidateView[] {
  return entry.status === 'success' && entry.decision?.status === 'success'
    ? entry.decision.candidates
      .filter(candidate => candidate.selected)
      .sort((left, right) => left.rank - right.rank
        || left.authority.localeCompare(right.authority)
        || left.entityId.localeCompare(right.entityId))
    : [];
}

export function focusCenterMembers(
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

export function parseJevFocusDecision(
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

export async function requestJevFocus({
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

export function composeFocusReleasePresentation(
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
