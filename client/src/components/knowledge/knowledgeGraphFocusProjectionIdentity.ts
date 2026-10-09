import type {
  GraphProjectionV1,
  JoinedGraphPresentation,
} from './joinedKnowledgeGraphProjection';

function projectionIdentity(value: GraphProjectionV1): string {
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
}

export function knowledgeGraphFocusProjectionIdentity(
  joinedPresentation: JoinedGraphPresentation,
): string {
  return [
    joinedPresentation.projection.projectId,
    projectionIdentity(joinedPresentation.providerProjections.thinkgraph),
    projectionIdentity(joinedPresentation.providerProjections.knowgraph),
  ].join('|');
}
