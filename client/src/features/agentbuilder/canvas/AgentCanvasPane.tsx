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
  activeCardIds: string[];
  activeEdgeIds: string[];
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
  activeCardIds,
  activeEdgeIds,
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
