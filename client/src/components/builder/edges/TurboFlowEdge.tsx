import { BaseEdge, getSmoothStepPath, useStore, type EdgeProps } from "@xyflow/react";

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
  sourceIsWallEndpoint?: boolean;
  targetIsWallEndpoint?: boolean;
  wallAnchorY?: number;
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
  const transform = useStore((store) => store.transform);
  const [viewportX, , viewportZoom] = transform;
  const wallFlowX = -viewportX / (viewportZoom || 1);
  const wallFlowY = Number.isFinite(Number(edgeData.wallAnchorY))
    ? Number(edgeData.wallAnchorY)
    : null;
  const sourceXResolved = edgeData.sourceIsWallEndpoint ? wallFlowX : sourceX;
  const targetXResolved = edgeData.targetIsWallEndpoint ? wallFlowX : targetX;
  const sourceYResolved = edgeData.sourceIsWallEndpoint ? (wallFlowY ?? targetY) : sourceY;
  const targetYResolved = edgeData.targetIsWallEndpoint ? (wallFlowY ?? sourceY) : targetY;
  const [edgePath] = getSmoothStepPath({
    sourceX: sourceXResolved,
    sourceY: sourceYResolved,
    sourcePosition,
    targetX: targetXResolved,
    targetY: targetYResolved,
    targetPosition,
    borderRadius: Number((pathOptions as { borderRadius?: number } | undefined)?.borderRadius || 16),
    offset: Number((pathOptions as { offset?: number } | undefined)?.offset || 26),
  });
  const strokeWidth = Number(style?.strokeWidth || 2);
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
        ? "rgba(55,173,170,0.86)"
        : "rgba(143,162,175,0.6)";
  const edgeOpacity = isSelected
    ? Math.min(0.78, opacity)
    : isActive
      ? Math.min(0.66, opacity)
      : Math.min(0.5, opacity);

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
