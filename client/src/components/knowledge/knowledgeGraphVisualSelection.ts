import {
  providerMemberKey,
  type GraphAuthority,
  type GraphProjectionV1,
  type JoinedGraphEdgeVariant,
  type JoinedGraphNodeVariant,
  type JoinedGraphPresentation,
} from './joinedKnowledgeGraphProjection';
import { graphitiFactIdentity } from './knowledgeGraphInspectorRecords';

export function deriveKnowledgeGraphVisualSelection({
  displayProjection,
  activeJoinedPresentation,
  selectedId,
  selectedEdgeId,
  selectedAuthority,
  selectedMemberKey,
}: {
  displayProjection: GraphProjectionV1 | null;
  activeJoinedPresentation: JoinedGraphPresentation;
  selectedId: string | null;
  selectedEdgeId: string | null;
  selectedAuthority: GraphAuthority | null;
  selectedMemberKey: string | null;
}) {
  const selectedVisual = displayProjection?.nodes.find(node => node.id === selectedId);
  const selectedNodeVariants: JoinedGraphNodeVariant[] = selectedVisual
    ? activeJoinedPresentation.nodeVariants.get(selectedVisual.id) || []
    : [];
  const directThinkAvailable = selectedNodeVariants.some(variant => (
    variant.authority === 'thinkgraph'
    && Array.isArray(variant.node.properties?.evidence)
    && variant.node.properties.evidence.some((item: unknown) => (
      item !== null && typeof item === 'object' && !Array.isArray(item)
    ))
  ));
  const graphitiEdges = activeJoinedPresentation.providerProjections.knowgraph.edges;
  const directKnowAvailable = selectedNodeVariants.some(variant => (
    variant.authority === 'knowgraph'
    && graphitiEdges.some(edge => (
      (edge.source === variant.node.id || edge.target === variant.node.id)
      && edge.predicate !== 'MENTIONS'
      && graphitiFactIdentity(edge) !== null
      && typeof edge.properties?.fact === 'string'
      && edge.properties.fact.trim().length > 0
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
    ? activeJoinedPresentation.edgeVariants.get(selectedEdgeVisual.id)
    : undefined;
  const selectedEdge = selectedEdgeVariant?.edge;
  const inspectedAuthority = selectedEdgeVariant?.authority || selectedNodeVariant?.authority || null;
  const inspectedProjection = inspectedAuthority
    ? activeJoinedPresentation.providerProjections[inspectedAuthority]
    : null;

  return {
    selectedVisual,
    directThinkAvailable,
    directKnowAvailable,
    selected,
    selectedEdge,
    inspectedAuthority,
    inspectedProjection,
  };
}
