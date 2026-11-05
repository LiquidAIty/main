// Entity: Card Topology
// Relationship: This file embeds the shared Card-and-connection canvas in large or companion workspace shells and forwards topology selection and persistence actions.
// Entity: Saved Cards
// Relationship: This file supplies the current deck, selected identity, Hermes runtime activity, and document updater to the one canvas implementation.

import type { CSSProperties, Dispatch, SetStateAction } from 'react';

import BuilderCanvas from '../../../components/builder/BuilderCanvas';
import type { DeckDocument } from '../../../types/agentgraph';

type AgentCanvasPaneProps = {
  surfaceRole: 'large' | 'companion';
  shellStyle: CSSProperties;
  document: DeckDocument;
  setDocument: Dispatch<SetStateAction<DeckDocument>>;
  onPersistGraphMutation?: (
    reason: string,
    detail?: Record<string, unknown>,
  ) => void;
  activeEdgeIds: string[];
  activeCardIds?: string[];
  activeAgentCounts?: Record<string, number>;
  selectedCardId: string | null;
  selectedEdgeId: string | null;
  onSelectCard: (cardId: string | null) => void;
  onSelectEdge: (edgeId: string | null) => void;
  onDeleteSelectedEdge: () => void;
  inspectMode?: boolean;
  focusZone?: { zone: 'agents'; nonce: number } | null;
};

export default function AgentCanvasPane({
  surfaceRole,
  shellStyle,
  document,
  setDocument,
  onPersistGraphMutation,
  activeEdgeIds,
  activeCardIds,
  activeAgentCounts,
  selectedCardId,
  selectedEdgeId,
  onSelectCard,
  onSelectEdge,
  onDeleteSelectedEdge,
  inspectMode = false,
  focusZone,
}: AgentCanvasPaneProps) {
  return (
    <div
      data-testid={`${surfaceRole}-surface-canvas`}
      style={shellStyle}
    >
      <BuilderCanvas
        document={document}
        setDocument={setDocument}
        onPersistGraphMutation={onPersistGraphMutation}
        activeCardIds={activeCardIds}
        activeAgentCounts={activeAgentCounts}
        activeEdgeIds={activeEdgeIds}
        selectedCardId={selectedCardId}
        selectedEdgeId={selectedEdgeId}
        onSelectCard={onSelectCard}
        onSelectEdge={onSelectEdge}
        onDeleteSelectedEdge={onDeleteSelectedEdge}
        inspectMode={inspectMode}
        focusZone={focusZone}
      />
    </div>
  );
}
