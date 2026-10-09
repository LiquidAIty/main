import {
  combinedCyberMaterialFields,
  visualSourceKind,
  type GraphAuthority,
  type GraphProjectionEdge,
  type GraphProjectionNode,
  type GraphProjectionV1,
  type JoinedGraphPresentation,
  type SolarpunkColors,
} from './joinedKnowledgeGraphProjection';
import type { GraphStyle } from './knowledgeGraphPresentationPreferences';

export function compactProbability(value: unknown): string | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.min(1, numeric)).toFixed(2).replace(/^0/, '');
}

export function withoutSolarpunkMaterial(node: GraphProjectionNode): GraphProjectionNode {
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

export function solarpunkEdgeFields(
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

export function withoutSolarpunkEdgeMaterial(edge: GraphProjectionEdge): GraphProjectionEdge {
  const next = { ...edge };
  delete next.material_kind;
  delete next.material_authority;
  delete next.material_color;
  return next;
}

export function projectKnowledgeRendererData({
  displayProjection,
  activeJoinedPresentation,
  style,
  solarpunkColors,
}: {
  displayProjection: GraphProjectionV1 | null;
  activeJoinedPresentation: JoinedGraphPresentation;
  style: GraphStyle;
  solarpunkColors: SolarpunkColors;
}) {
  const scene = displayProjection?.scene;
  const sceneNodes = Array.isArray(scene?.nodes) ? scene.nodes : displayProjection?.nodes || [];
  const sceneLinks = Array.isArray(scene?.links)
    ? scene.links
    : Array.isArray(scene?.edges)
      ? scene.edges
      : displayProjection?.edges || [];
  const projectionEdgesById = new Map((displayProjection?.edges || []).map(edge => [edge.id, edge]));
  return {
    ...(scene || {}),
    nodes: sceneNodes.map((rawNode) => {
      const node = rawNode as GraphProjectionNode;
      if (style !== 'solarpunk') return withoutSolarpunkMaterial(node);
      const variants = activeJoinedPresentation.nodeVariants.get(node.id) || [];
      const sourceKind = visualSourceKind(variants);
      const thinkActive = typeof node.material_think_active === 'boolean'
        ? node.material_think_active
        : false;
      const knowActive = typeof node.material_know_active === 'boolean'
        ? node.material_know_active
        : false;
      return {
        ...node,
        ...combinedCyberMaterialFields(
          sourceKind, thinkActive, knowActive, solarpunkColors,
        ),
      };
    }),
    links: sceneLinks.map(rawEdge => {
      const edge = rawEdge as GraphProjectionEdge;
      const projected = projectionEdgesById.get(String(edge.id));
      const properties = { ...(edge.properties || {}), ...(projected?.properties || {}) };
      const semanticEdge = { ...edge, ...(projected || {}), properties };
      const edgeAuthority = activeJoinedPresentation
        .edgeVariants.get(String(semanticEdge.id))?.authority;
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
}
