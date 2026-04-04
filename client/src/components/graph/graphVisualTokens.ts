import type { CSSProperties } from "react";
import { GRAPH_WORKSPACE } from "./graphWorkspaceContract";

const graphGridMinor = "rgba(73, 82, 91, 0.24)";
const graphGridMajor = "rgba(92, 104, 115, 0.34)";
const graphGridCanvas = "rgba(73, 82, 91, 0.34)";
const graphEdgeThink = "rgba(109, 152, 157, 0.52)";
const graphEdgeKnow = "rgba(131, 147, 170, 0.48)";
const graphEdgeMixed = "rgba(156, 165, 174, 0.42)";

export const GRAPH_THEME = {
  surface: {
    base: "#0b1015",
    border: "rgba(63, 72, 80, 0.92)",
    text: "#f6fafc",
    mutedText: "rgba(214, 222, 228, 0.76)",
    shadow: "0 16px 36px rgba(0, 0, 0, 0.24)",
  },
  accent: {
    primary: "rgba(79, 162, 173, 0.98)",
    primarySoft: "rgba(79, 162, 173, 0.12)",
    primaryBorder: "rgba(79, 162, 173, 0.32)",
    primaryGlow: "rgba(79, 162, 173, 0.18)",
    hover: "rgba(214, 222, 228, 0.96)",
    magentic: "rgba(96, 194, 255, 0.94)",
    graph: "rgba(156, 165, 174, 0.78)",
    workflow: "rgba(224, 145, 89, 0.94)",
    workflowGlow: "rgba(224, 145, 89, 0.18)",
    think: "#6d989d",
    know: "#8393aa",
    mixed: "#adb8c0",
  },
  background: {
    agentSurface:
      "radial-gradient(circle at 18% 14%, rgba(79,162,173,0.05), transparent 30%), linear-gradient(180deg, rgba(14,18,22,0.96), rgba(10,14,18,0.98))",
    knowledgeSurface:
      "radial-gradient(circle at 18% 16%, rgba(79,162,173,0.06), transparent 34%), radial-gradient(circle at 82% 18%, rgba(131,147,170,0.06), transparent 38%), linear-gradient(180deg, rgba(12,16,20,0.98), rgba(9,13,17,1))",
    knowledgePatternSize: "auto, auto, auto",
    gridMinor: graphGridMinor,
    gridMajor: graphGridMajor,
    grid: graphGridCanvas,
  },
  edge: {
    neutral: "rgba(156, 165, 174, 0.78)",
    think: graphEdgeThink,
    know: graphEdgeKnow,
    mixed: graphEdgeMixed,
    selected: "rgba(79, 162, 173, 0.98)",
    hover: "rgba(214, 222, 228, 0.96)",
  },
  tooltip: {
    background: "rgba(9, 13, 18, 0.94)",
    border: "1px solid rgba(115, 124, 132, 0.28)",
    text: "#dde4ea",
    title: "#f8fafc",
    shadow: "0 10px 28px rgba(0, 0, 0, 0.28)",
  },
  controls: {
    background: "rgba(16, 19, 22, 0.94)",
    border: "rgba(63, 72, 80, 0.92)",
    hoverBackground: "rgba(29, 34, 39, 0.98)",
    text: "#e6edf2",
    shadow: "0 16px 36px rgba(0, 0, 0, 0.18)",
  },
  nav: {
    minZoom: GRAPH_WORKSPACE.minZoom,
    maxZoom: GRAPH_WORKSPACE.maxZoom,
    fitMaxZoom: GRAPH_WORKSPACE.fitMaxZoom,
    focusMaxZoom: GRAPH_WORKSPACE.focusMaxZoom,
    fitPadding: GRAPH_WORKSPACE.fitPadding,
    fitDurationMs: GRAPH_WORKSPACE.fitDurationMs,
    focusDurationMs: GRAPH_WORKSPACE.focusDurationMs,
    zoomStep: GRAPH_WORKSPACE.zoomStep,
    zoomDurationMs: GRAPH_WORKSPACE.zoomDurationMs,
    wheelDelta: GRAPH_WORKSPACE.wheelDelta,
  },
} as const;

export function graphPillButtonStyle(overrides?: CSSProperties): CSSProperties {
  return {
    padding: "7px 10px",
    borderRadius: 999,
    border: `1px solid ${GRAPH_THEME.accent.primaryBorder}`,
    background: GRAPH_THEME.controls.background,
    color: GRAPH_THEME.surface.text,
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 600,
    boxShadow: GRAPH_THEME.controls.shadow,
    ...overrides,
  };
}

export function graphControlButtonStyle(overrides?: CSSProperties): CSSProperties {
  return {
    width: 38,
    height: 38,
    border: `1px solid ${GRAPH_THEME.controls.border}`,
    background: GRAPH_THEME.controls.background,
    color: GRAPH_THEME.controls.text,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    fontSize: 18,
    lineHeight: 1,
    ...overrides,
  };
}

export const graphControlStackStyle: CSSProperties = {
  position: "absolute",
  left: 16,
  bottom: 16,
  zIndex: 20,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  borderRadius: 10,
  boxShadow: GRAPH_THEME.controls.shadow,
};
