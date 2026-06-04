import { useEffect, useState } from 'react';

import type { BuilderCanvasFocusRequest } from '../../../components/builder/BuilderCanvas';
import type {
  PlanMissionNodeData,
  PlanMissionNodeOverrideMap,
} from '../../../components/assist/planMissionModel';
import type { DeckDocument } from '../../../types/agentgraph';

type UseAgentBuilderSelectionArgs = {
  deck: Pick<DeckDocument, 'nodes' | 'edges'>;
};

export default function useAgentBuilderSelection({
  deck,
}: UseAgentBuilderSelectionArgs) {
  const [objectDrawerOpen, setObjectDrawerOpen] = useState(false);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedKnowledgeEntityId, setSelectedKnowledgeEntityId] = useState<
    string | null
  >(null);
  const [selectedKnowledgeRelationshipId, setSelectedKnowledgeRelationshipId] =
    useState<string | null>(null);
  const [planMissionFocus, setPlanMissionFocus] = useState<{
    nodeId: string;
    nodeLabel: string;
    nodeKind: string;
    nodeData: PlanMissionNodeData;
  } | null>(null);
  const [planNodeDrafts, setPlanNodeDrafts] =
    useState<PlanMissionNodeOverrideMap>({});
  const [builderCanvasFocusRequest, setBuilderCanvasFocusRequest] =
    useState<BuilderCanvasFocusRequest | null>(null);
  const [tab, setTab] = useState<string>('Canvas');
  const [openDrawer, setOpenDrawer] = useState<null | 'navigation'>(null);

  useEffect(() => {
    if (!selectedCardId) return;
    if (deck.nodes.some((node) => node.id === selectedCardId)) return;
    setSelectedCardId(null);
  }, [deck.nodes, selectedCardId]);

  useEffect(() => {
    if (!selectedEdgeId) return;
    if (deck.edges.some((edge) => edge.id === selectedEdgeId)) return;
    setSelectedEdgeId(null);
  }, [deck.edges, selectedEdgeId]);

  return {
    objectDrawerOpen,
    setObjectDrawerOpen,
    selectedCardId,
    setSelectedCardId,
    selectedEdgeId,
    setSelectedEdgeId,
    selectedKnowledgeEntityId,
    setSelectedKnowledgeEntityId,
    selectedKnowledgeRelationshipId,
    setSelectedKnowledgeRelationshipId,
    planMissionFocus,
    setPlanMissionFocus,
    planNodeDrafts,
    setPlanNodeDrafts,
    builderCanvasFocusRequest,
    setBuilderCanvasFocusRequest,
    tab,
    setTab,
    openDrawer,
    setOpenDrawer,
  };
}
