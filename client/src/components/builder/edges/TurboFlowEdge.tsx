import { BaseEdge, getSmoothStepPath, type EdgeProps } from "@xyflow/react";

import type { DeckEdgeType } from "../../../types/agentgraph";
import { GRAPH_THEME } from "../../graph/graphVisualTokens";

type TurboFlowEdgeData = {
  edgeType?: DeckEdgeType | null;
  isActive?: boolean;
  isSelected?: boolean;
  isHoverConnected?: boolean;
  isLoopEdge?: boolean;
  isReturnEdge?: boolean;
  motion?: "idle" | "active" | "running";
};

export function buildTurboFlowEdgePath({
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  borderRadius,
  offset,
  edgeType,
}: {
  sourceX: number;
  sourceY: number;
  sourcePosition: EdgeProps["sourcePosition"];
  targetX: number;
  targetY: number;
  targetPosition: EdgeProps["targetPosition"];
  borderRadius: number;
  offset: number;
  edgeType?: DeckEdgeType | null;
}): string {
  if (edgeType === "magentic_option" && targetX < sourceX - 24) {
    if (Math.abs(targetY - sourceY) < 1) {
      return `M ${sourceX},${sourceY} L ${targetX},${targetY}`;
    }
    const midX = Math.round(targetX + (sourceX - targetX) / 2);
    return `M ${sourceX},${sourceY} L ${midX},${sourceY} L ${midX},${targetY} L ${targetX},${targetY}`;
  }

  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius,
    offset,
  });
  return edgePath;
}

export default function TurboFlowEdge(props: EdgeProps) {
  const {
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    style,
    markerEnd,
    pathOptions,
    data,
    selected,
  } = props;
  const edgeData = (data || {}) as TurboFlowEdgeData;
  const edgePath = buildTurboFlowEdgePath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: Number((pathOptions as { borderRadius?: number } | undefined)?.borderRadius || 16),
    offset: Number((pathOptions as { offset?: number } | undefined)?.offset || 26),
    edgeType: edgeData.edgeType,
  });
  const strokeWidth = Math.max(2.25, Number(style?.strokeWidth || 2.25));
  const opacity = Number(style?.opacity ?? 1);
  const isSelected = Boolean(edgeData.isSelected || selected);
  const isActive = Boolean(edgeData.motion === "active" || edgeData.isActive);
  const isMagenticWorker = edgeData.edgeType === "magentic_option";
  const isMagenticControl = edgeData.edgeType === "magentic_control";
  // Turbo shell motion is the primary visual signal. Edges stay secondary.
  const stroke = isSelected
    ? GRAPH_THEME.accent.primary
    : isActive
      ? GRAPH_THEME.accent.solar
      : isMagenticControl
        ? "#52DCEB"
        : isMagenticWorker
          ? "#22B8C7"
        : "#E7A18B";
  const edgeOpacity = isSelected
    ? Math.max(0.95, Math.min(1, opacity))
    : isActive
      ? Math.max(0.92, Math.min(1, opacity))
      : Math.max(0.88, Math.min(1, opacity));

  return (
    <BaseEdge
      path={edgePath}
      markerEnd={markerEnd}
      style={{
        stroke,
        strokeWidth,
        opacity: edgeOpacity,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        strokeDasharray: isMagenticControl ? "7 4" : undefined,
      }}
    />
  );
}
