import type { CSSProperties, Dispatch, SetStateAction } from 'react';
import type { Edge, Node } from '@xyflow/react';

import AgentBoard from './AgentBoard';
import type { DeckExecutionPlan } from '../../../components/builder/deckExecution';
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
  taskOverlayNodes?: Node[];
  taskOverlayEdges?: Edge[];
  focusZone?: { zone: 'agents' | 'tasks'; nonce: number } | null;
  onTaskGoGate?: () => void;
  taskGoGateStatus?: string | null;
  onTaskNodePositionChange?: (id: string, x: number, y: number) => void;
};

export default function AgentCanvasPane({
  surfaceRole,
  shellStyle,
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
  taskOverlayNodes,
  taskOverlayEdges,
  focusZone,
  onTaskGoGate,
  taskGoGateStatus = null,
  onTaskNodePositionChange,
}: AgentCanvasPaneProps) {
  return (
    <div
      data-testid={`${surfaceRole}-surface-canvas`}
      style={shellStyle}
    >
      <AgentBoard
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
        taskOverlayNodes={taskOverlayNodes}
        taskOverlayEdges={taskOverlayEdges}
        focusZone={focusZone}
        onTaskGoGate={onTaskGoGate}
        taskGoGateStatus={taskGoGateStatus}
        onTaskNodePositionChange={onTaskNodePositionChange}
      />
    </div>
  );
}
