import type { CSSProperties } from "react";
import { GRAPH_WORKSPACE } from "./graphWorkspaceContract";

const graphGridMinor = "rgba(73, 82, 91, 0.18)";
const graphGridMajor = "rgba(92, 104, 115, 0.26)";
const graphGridCanvas = "rgba(73, 82, 91, 0.26)";
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
    solar: "rgba(223, 146, 84, 0.96)",
    solarSoft: "rgba(223, 146, 84, 0.14)",
    solarGlow: "rgba(223, 146, 84, 0.18)",
    hover: "rgba(214, 222, 228, 0.96)",
    magentic: "rgba(96, 194, 255, 0.94)",
    graph: "rgba(156, 165, 174, 0.78)",
    workflow: "rgba(224, 145, 89, 0.94)",
    workflowGlow: "rgba(224, 145, 89, 0.18)",
    memory: "rgba(140, 116, 204, 0.78)",
    memorySoft: "rgba(140, 116, 204, 0.14)",
    think: "#6d989d",
    know: "#8393aa",
    mixed: "#adb8c0",
  },
  background: {
    agentSurface:
      "radial-gradient(circle at 18% 14%, rgba(79,162,173,0.065), transparent 32%), radial-gradient(circle at 78% 18%, rgba(140,116,204,0.045), transparent 36%), linear-gradient(180deg, rgba(15,18,21,0.96), rgba(10,13,17,0.985))",
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
    background: "rgba(18, 20, 23, 0.94)",
    border: "rgba(63, 72, 80, 0.84)",
    hoverBackground: "rgba(34, 29, 26, 0.98)",
    text: "#e6edf2",
    shadow: "0 16px 36px rgba(0, 0, 0, 0.18)",
  },
  turboFlow: {
    /** Core flow: cyan → blue-green → deep teal (intelligence / selection identity). */
    intelligenceGradientStart: "#9ee6ec",
    intelligenceGradientMid: "#4FA2AD",
    intelligenceGradientEnd: "#2a4f58",
    /** Active execution paths: teal-led with purple depth; orange reserved for motion accents in-component. */
    executionGradientStart: "#4FA2AD",
    executionGradientMid: "#6f6aa4",
    executionGradientEnd: "#2d5f68",
    /** Magentic / memory-adjacent: purple depth anchoring back to teal. */
    memoryGradientStart: "#a090d8",
    memoryGradientMid: "#5c7c8a",
    memoryGradientEnd: "#3d8a94",
    markerStroke: "rgba(79, 162, 173, 0.72)",
    markerHotStroke: "rgba(223, 146, 84, 0.78)",
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
    boxShadow: "0 10px 24px rgba(0, 0, 0, 0.16)",
    ...overrides,
  };
}

export function graphControlButtonStyle(overrides?: CSSProperties): CSSProperties {
  return {
    width: 36,
    height: 36,
    border: `1px solid ${GRAPH_THEME.controls.border}`,
    background: GRAPH_THEME.controls.background,
    color: GRAPH_THEME.controls.text,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    fontSize: 17,
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
  borderRadius: 12,
  boxShadow: "0 12px 28px rgba(0, 0, 0, 0.18)",
};
