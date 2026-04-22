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
  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: Number((pathOptions as { borderRadius?: number } | undefined)?.borderRadius || 16),
    offset: Number((pathOptions as { offset?: number } | undefined)?.offset || 26),
  });
  const strokeWidth = Math.max(2.25, Number(style?.strokeWidth || 2.25));
  const opacity = Number(style?.opacity ?? 1);
  const isSelected = Boolean(edgeData.isSelected || selected);
  const isActive = Boolean(edgeData.motion === "active" || edgeData.isActive);
  const isMagentic = edgeData.edgeType === "magentic_option";
  // Turbo shell motion is the primary visual signal. Edges stay secondary.
  const stroke = isSelected
    ? GRAPH_THEME.accent.primary
    : isActive
      ? GRAPH_THEME.accent.solar
      : isMagentic
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
      }}
    />
  );
}
