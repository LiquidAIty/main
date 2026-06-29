import type { Dispatch, SetStateAction } from 'react';

import BuilderCanvas from '../../../components/builder/BuilderCanvas';
import type { DeckExecutionPlan } from '../../../components/builder/deckExecution';
import type { DeckDocument } from '../../../types/agentgraph';

type AgentBoardProps = {
  document: DeckDocument;
  setDocument: Dispatch<SetStateAction<DeckDocument>>;
  onPersistGraphMutation?: (
    reason: string,
    detail?: Record<string, unknown>,
  ) => void;
  presentationViewportKey?: string | number | null;
  executionPlan: Pick<DeckExecutionPlan, 'simpleOrderCardIds' | 'startCardIds'> | null;
  activeCardIds: string[];
  activeEdgeIds: string[];
  swarmProgressByCardId: Record<string, { completed: number; total: number }>;
  selectedCardId: string | null;
  selectedEdgeId: string | null;
  onSelectCard: (cardId: string | null) => void;
  onSelectEdge: (edgeId: string | null) => void;
  onDeleteSelectedEdge: () => void;
  inspectMode?: boolean;
  focusZone?: { zone: 'agents'; nonce: number } | null;
};

export default function AgentBoard({
  document,
  setDocument,
  onPersistGraphMutation,
  presentationViewportKey = null,
  executionPlan,
  activeCardIds,
  activeEdgeIds,
  swarmProgressByCardId,
  selectedCardId,
  selectedEdgeId,
  onSelectCard,
  onSelectEdge,
  onDeleteSelectedEdge,
  inspectMode = false,
  focusZone,
}: AgentBoardProps) {
  return (
    <div
      style={{
        height: '100%',
      }}
    >
      <div
        style={{
          height: '100%',
          minHeight: 0,
        }}
      >
        <BuilderCanvas
          document={document}
          setDocument={setDocument}
          onPersistGraphMutation={onPersistGraphMutation}
          presentationViewportKey={presentationViewportKey}
          executionPlan={executionPlan}
          activeCardIds={activeCardIds}
          activeEdgeIds={activeEdgeIds}
          swarmProgressByCardId={swarmProgressByCardId}
          selectedCardId={selectedCardId}
          selectedEdgeId={selectedEdgeId}
          onSelectCard={onSelectCard}
          onSelectEdge={onSelectEdge}
          onDeleteSelectedEdge={onDeleteSelectedEdge}
          inspectMode={inspectMode}
          focusZone={focusZone}
        />
      </div>
    </div>
  );
}
