/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: Agent Builder
 * Relationship: This file owns Agent Builder's workspace tab, drawer, Card, edge, and canvas-focus selection state.
 * Entity: Card Topology
 * Relationship: This file clears selected Card and edge identities when the current saved topology no longer contains them.
 */

import { useEffect, useState } from 'react';

import type { BuilderCanvasFocusRequest } from '../../../components/builder/BuilderCanvas';
import type { DeckDocument } from '../../../types/agentgraph';

type UseAgentBuilderSelectionArgs = {
  deck: Pick<DeckDocument, 'nodes' | 'edges'>;
};

export default function useAgentBuilderSelection({
  deck,
}: UseAgentBuilderSelectionArgs) {
  const [inspectorDrawerOpen, setInspectorDrawerOpen] = useState(false);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
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
    inspectorDrawerOpen,
    setInspectorDrawerOpen,
    selectedCardId,
    setSelectedCardId,
    selectedEdgeId,
    setSelectedEdgeId,
    builderCanvasFocusRequest,
    setBuilderCanvasFocusRequest,
    tab,
    setTab,
    openDrawer,
    setOpenDrawer,
  };
}
