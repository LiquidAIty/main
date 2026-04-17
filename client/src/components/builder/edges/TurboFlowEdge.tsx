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
};

function resolveGradientId(data: TurboFlowEdgeData): string {
  if (data.edgeType === "magentic_option") return "agent-edge-gradient-memory";
  if (data.isActive || data.isLoopEdge || data.isReturnEdge) return "agent-edge-gradient-execution";
  return "agent-edge-gradient-intelligence";
}

/**
 * TurboFlow-inspired polish: layered stroke + one attached glow (not floating tubes).
 * Motion: calm idle / magentic crawl; stronger coherent pulse only when active.
 */
export default function TurboFlowEdge(props: EdgeProps) {
  const {
    id,
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
  const strokeWidth = Number(style?.strokeWidth || 2);
  const opacity = Number(style?.opacity ?? 1);
  const isSelected = Boolean(edgeData.isSelected);
  const isActive = Boolean(edgeData.isActive);
  const isMagentic = edgeData.edgeType === "magentic_option";
  const isExecutionSkin = Boolean(isActive || edgeData.isLoopEdge || edgeData.isReturnEdge);

  const gradientId = resolveGradientId(edgeData);

  /** Single under-glow, tight to stroke (attached, not a halo cloud). */
  const glowExtra = isActive ? 1.35 : isSelected ? 0.95 : isMagentic ? 0.65 : 0.45;
  const glowWidth = strokeWidth + glowExtra;
  const glowOpacity = isActive
    ? Math.min(0.26, opacity * 0.48)
    : isSelected
      ? Math.min(0.16, opacity * 0.36)
      : isMagentic
        ? Math.min(0.11, opacity * 0.28)
        : Math.min(0.075, opacity * 0.22);
  const glowBlur = isActive ? "blur(1.35px)" : "blur(0.95px)";

  const dashActive = "13 11";
  const dashIdleMagentic = "20 18";
  const animated = Boolean(isActive || isMagentic);
  const dashSpec = isActive ? dashActive : dashIdleMagentic;
  const dashDuration = isActive ? "2.05s" : isMagentic ? "3.45s" : "2.8s";

  const underStrokeOpacity = isActive ? 0.34 : isSelected ? 0.22 : isMagentic ? 0.14 : 0.1;
  const underStrokeWidth = strokeWidth + 0.55;

  const pulseFill = isExecutionSkin
    ? GRAPH_THEME.accent.solar
    : isMagentic
      ? GRAPH_THEME.accent.memory
      : GRAPH_THEME.accent.primary;

  return (
    <>
      <BaseEdge
        id={`${id}-glow`}
        path={edgePath}
        style={{
          stroke: `url(#${gradientId})`,
          strokeWidth: glowWidth,
          opacity: glowOpacity,
          filter: glowBlur,
          pointerEvents: "none",
        }}
      />
      <BaseEdge
        id={`${id}-substrate`}
        path={edgePath}
        style={{
          stroke: `url(#${gradientId})`,
          strokeWidth: underStrokeWidth,
          opacity: underStrokeOpacity * opacity,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          pointerEvents: "none",
        }}
      />
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: `url(#${gradientId})`,
          strokeWidth,
          opacity,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          strokeDasharray: animated ? dashSpec : undefined,
          animation: animated ? `agent-turbo-flow-dash ${dashDuration} linear infinite` : undefined,
        }}
      />
      {isActive ? (
        <circle r={2} fill={pulseFill} opacity={0.88}>
          <animateMotion dur="2.15s" repeatCount="indefinite" path={edgePath} />
          <animate
            attributeName="opacity"
            values="0.15;0.95;0.15"
            dur="2.15s"
            repeatCount="indefinite"
          />
        </circle>
      ) : null}
    </>
  );
}
