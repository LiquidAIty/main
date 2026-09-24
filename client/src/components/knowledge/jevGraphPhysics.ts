import type {
  GraphProjectionEdge,
  GraphProjectionNode,
  GraphProjectionV1,
} from './NativeAuthorityGraphSurface';

export const JEV_GRAPH_PHYSICS_PROFILES = [
  'balanced',
  'open',
  'clustered',
  'contrast',
  'galaxy',
] as const;

export type JevGraphPhysicsProfile = typeof JEV_GRAPH_PHYSICS_PROFILES[number];

export const JEV_GRAPH_PHYSICS_PROFILE_LABELS: Record<JevGraphPhysicsProfile, string> = {
  balanced: 'Balanced',
  open: 'Open',
  clustered: 'Clustered',
  contrast: 'Contrast',
  galaxy: 'Galaxy',
};

type TransferCurve = {
  edgeWidthBase: number;
  edgeWidthScale: number;
  edgeWidthExponent: number;
  springBase: number;
  springScale: number;
  springExponent: number;
  distanceBase: number;
  distanceScale: number;
  distanceExponent: number;
  nodeRadiusBase: number;
  nodeRadiusScale: number;
};

const TRANSFER_CURVES: Record<JevGraphPhysicsProfile, TransferCurve> = {
  balanced: {
    edgeWidthBase: 0.45, edgeWidthScale: 2.25, edgeWidthExponent: 1,
    springBase: 0.035, springScale: 0.17, springExponent: 1,
    distanceBase: 26, distanceScale: 12, distanceExponent: 1,
    nodeRadiusBase: 2.5, nodeRadiusScale: 3,
  },
  open: {
    edgeWidthBase: 0.4, edgeWidthScale: 1.75, edgeWidthExponent: 1,
    springBase: 0.025, springScale: 0.12, springExponent: 1,
    distanceBase: 34, distanceScale: 12, distanceExponent: 1,
    nodeRadiusBase: 2.5, nodeRadiusScale: 2.6,
  },
  clustered: {
    edgeWidthBase: 0.45, edgeWidthScale: 2.5, edgeWidthExponent: 1,
    springBase: 0.04, springScale: 0.24, springExponent: 1,
    distanceBase: 28, distanceScale: 18, distanceExponent: 1,
    nodeRadiusBase: 2.5, nodeRadiusScale: 3.2,
  },
  contrast: {
    edgeWidthBase: 0.35, edgeWidthScale: 3, edgeWidthExponent: 2,
    springBase: 0.025, springScale: 0.22, springExponent: 2,
    distanceBase: 32, distanceScale: 18, distanceExponent: 2,
    nodeRadiusBase: 2.5, nodeRadiusScale: 3,
  },
  galaxy: {
    edgeWidthBase: 0.35, edgeWidthScale: 2.5, edgeWidthExponent: 1,
    springBase: 0.02, springScale: 0.26, springExponent: 2,
    distanceBase: 38, distanceScale: 24, distanceExponent: 2,
    nodeRadiusBase: 2.5, nodeRadiusScale: 3.5,
  },
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function boundedProbability(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? clamp(numeric, 0, 1) : null;
}

function record(value: unknown): Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

/**
 * The one profile transfer seam. Profiles never change w or m; they only map
 * those authoritative values into transient renderer fields.
 */
export function mapJevGraphPhysics(
  profile: JevGraphPhysicsProfile,
  winnerProbability: number,
  semanticMass: number,
) {
  const curve = TRANSFER_CURVES[profile];
  const w = clamp(winnerProbability, 0, 1);
  const m = Math.max(0, Number.isFinite(semanticMass) ? semanticMass : 0);
  return {
    edgeWidth: curve.edgeWidthBase
      + curve.edgeWidthScale * Math.pow(w, curve.edgeWidthExponent),
    springStrength: curve.springBase
      + curve.springScale * Math.pow(w, curve.springExponent),
    preferredDistance: clamp(
      curve.distanceBase - curve.distanceScale * Math.pow(w, curve.distanceExponent),
      10,
      40,
    ),
    nodeRadius: curve.nodeRadiusBase + curve.nodeRadiusScale * Math.log1p(m),
  };
}

function jevWinnerProbability(edge: GraphProjectionEdge | Record<string, any>): number | null {
  const rawEdge = edge as Record<string, any>;
  const properties = record(edge.properties);
  const jev = Object.keys(record(properties.jev)).length
    ? record(properties.jev)
    : record(rawEdge.jev);
  const distribution = record(jev.distribution);
  const winner = String(jev.winner || edge.predicate || rawEdge.relation || '');
  return winner ? boundedProbability(distribution[winner]) : null;
}

function isCurrentLiveEdge(edge: GraphProjectionEdge | Record<string, any>): boolean {
  const rawEdge = edge as Record<string, any>;
  const properties = record(edge.properties);
  const temporalStatus = String(
    properties.temporalStatus || properties.temporal_status
      || rawEdge.temporalStatus || rawEdge.temporal_status || '',
  ).toLowerCase();
  if (['historical', 'invalidated', 'expired', 'superseded', 'closed'].includes(temporalStatus)) {
    return false;
  }
  return rawEdge.ghost !== true
    && !edge.validTo && !rawEdge.valid_to
    && !rawEdge.invalidAt && !rawEdge.invalid_at
    && !rawEdge.expiredAt && !rawEdge.expired_at
    && !properties.validTo && !properties.valid_to
    && !properties.invalidAt && !properties.invalid_at
    && !properties.expiredAt && !properties.expired_at;
}

function applyToRecords(
  nodes: GraphProjectionNode[],
  edges: GraphProjectionEdge[],
  profile: JevGraphPhysicsProfile,
): { nodes: GraphProjectionNode[]; edges: GraphProjectionEdge[] } {
  const incidentMass = new Map(nodes.map((node) => [node.id, 0]));
  const mappedEdges = edges.map((edge) => {
    const {
      relationship_strength: _oldWeight,
      label_confidence: _oldConfidence,
      strength: _oldStrength,
      spring_strength: _oldSpring,
      rest_length: _oldDistance,
      visual_width: _oldWidth,
      ...unweightedEdge
    } = edge as GraphProjectionEdge & { visual_width?: number };
    const weight = jevWinnerProbability(edge);
    if (weight === null || !isCurrentLiveEdge(edge)) return unweightedEdge;
    incidentMass.set(edge.source, (incidentMass.get(edge.source) || 0) + weight);
    incidentMass.set(edge.target, (incidentMass.get(edge.target) || 0) + weight);
    const transfer = mapJevGraphPhysics(profile, weight, 0);
    return {
      ...unweightedEdge,
      relationship_strength: weight,
      label_confidence: weight,
      strength: weight,
      spring_strength: transfer.springStrength,
      rest_length: transfer.preferredDistance,
      visual_width: transfer.edgeWidth,
      properties: { ...record(edge.properties), relationship_strength: weight },
    };
  });
  const mappedNodes = nodes.map((node) => {
    const semanticMass = incidentMass.get(node.id) || 0;
    return {
      ...node,
      semantic_mass: semanticMass,
      gravity_mass: 1 + (4 * Math.log1p(semanticMass)),
      visual_radius: mapJevGraphPhysics(profile, 0, semanticMass).nodeRadius,
      properties: {
        ...record(node.properties),
        semantic_mass: semanticMass,
        incident_relationship_weight: semanticMass,
      },
    };
  });
  return { nodes: mappedNodes, edges: mappedEdges as GraphProjectionEdge[] };
}

/**
 * Returns a display projection. The native graph projection and persisted Jev
 * metadata are never mutated, and changing profiles performs no I/O.
 */
export function applyJevGraphPhysics(
  value: GraphProjectionV1,
  profile: JevGraphPhysicsProfile = 'balanced',
): GraphProjectionV1 {
  const scene = value.scene as Record<string, any> | undefined;
  const sceneEdges = scene && (Array.isArray(scene.edges)
    ? scene.edges
    : Array.isArray(scene.links) ? scene.links : []);
  if (!value.edges.some(edge => jevWinnerProbability(edge) !== null)
    && !(sceneEdges || []).some((edge: GraphProjectionEdge) => jevWinnerProbability(edge) !== null)) {
    return value;
  }
  const mapped = applyToRecords(value.nodes, value.edges, profile);
  if (!scene) return { ...value, ...mapped };

  const mappedScene = applyToRecords(
    Array.isArray(scene.nodes) ? scene.nodes : [],
    sceneEdges || [],
    profile,
  );
  return {
    ...value,
    ...mapped,
    scene: {
      ...scene,
      nodes: mappedScene.nodes,
      edges: mappedScene.edges,
      ...(Array.isArray(scene.links) ? { links: mappedScene.edges } : {}),
    },
  };
}
