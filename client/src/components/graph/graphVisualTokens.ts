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
  card: {
    glassBackground:
      "radial-gradient(circle at 14% 20%, rgba(140,116,204,0.055), transparent 38%), radial-gradient(circle at 86% 14%, rgba(79,162,173,0.085), transparent 40%), linear-gradient(180deg, rgba(20,24,28,0.78), rgba(13,17,21,0.86))",
    glassMagenticBackground:
      "radial-gradient(circle at 18% 20%, rgba(140,116,204,0.09), transparent 38%), radial-gradient(circle at 80% 16%, rgba(96,194,255,0.14), transparent 36%), radial-gradient(circle at 50% 92%, rgba(223,146,84,0.06), transparent 42%), linear-gradient(180deg, rgba(14,28,35,0.88), rgba(10,18,22,0.9))",
    glassGraphBackground:
      "radial-gradient(circle at 82% 18%, rgba(79,162,173,0.08), transparent 36%), linear-gradient(180deg, rgba(31,34,38,0.82), rgba(18,21,24,0.88))",
    glassBorder: "rgba(79, 162, 173, 0.18)",
    glassInset: "inset 0 1px 0 rgba(255,255,255,0.05)",
    glassShadow: "0 14px 30px rgba(0, 0, 0, 0.24)",
    pillBackground: "rgba(18, 20, 23, 0.84)",
    pillBorder: "rgba(79, 162, 173, 0.24)",
  },
  drawer: {
    panelBackground: "rgba(10,10,13,0.92)",
    panelBorder: "rgba(255,255,255,0.12)",
    panelInset: "inset 0 1px 0 rgba(255,255,255,0.05)",
    panelShadow: "0 16px 32px rgba(0,0,0,0.24)",
    tabRailBackground: "rgba(5,5,8,0.7)",
    tabRailBorder: "rgba(255,255,255,0.12)",
    sectionBackground: "rgba(255,255,255,0.02)",
    sectionBorder: "rgba(255,255,255,0.08)",
    inputBackground: "rgba(255,255,255,0.02)",
    inputBorder: "rgba(255,255,255,0.06)",
    inputBorderFocus: "rgba(79, 162, 173, 0.28)",
    inputText: "rgba(255,255,255,0.82)",
    inputMuted: "rgba(255,255,255,0.62)",
    buttonBackground: "rgba(79, 162, 173, 0.12)",
    buttonBorder: "rgba(79,162,173,0.35)",
    buttonShadow: "0 4px 10px rgba(79, 162, 173, 0.06)",
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

export function graphGlassCardStyle(overrides?: CSSProperties): CSSProperties {
  return {
    borderRadius: 14,
    border: `1px solid ${GRAPH_THEME.card.glassBorder}`,
    background: GRAPH_THEME.card.glassBackground,
    boxShadow: `${GRAPH_THEME.card.glassInset}, ${GRAPH_THEME.card.glassShadow}`,
    backdropFilter: "blur(14px) saturate(120%)",
    WebkitBackdropFilter: "blur(14px) saturate(120%)",
    ...overrides,
  };
}

export function graphGlassPillStyle(overrides?: CSSProperties): CSSProperties {
  return {
    padding: "3px 7px",
    borderRadius: 999,
    background: GRAPH_THEME.card.pillBackground,
    border: `1px solid ${GRAPH_THEME.card.pillBorder}`,
    color: GRAPH_THEME.surface.mutedText,
    fontSize: 10.5,
    lineHeight: 1.05,
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
    ...overrides,
  };
}

export function graphCompanionPanelStyle(overrides?: CSSProperties): CSSProperties {
  return {
    borderLeft: `1px solid ${GRAPH_THEME.drawer.panelBorder}`,
    background: GRAPH_THEME.drawer.panelBackground,
    ...overrides,
  };
}

export function graphCompanionTabRailStyle(overrides?: CSSProperties): CSSProperties {
  return {
    background: "transparent",
    ...overrides,
  };
}

export function graphCompanionTabGroupStyle(overrides?: CSSProperties): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 8,
    background: GRAPH_THEME.drawer.tabRailBackground,
    border: `1px solid ${GRAPH_THEME.drawer.tabRailBorder}`,
    borderRadius: 10,
    padding: 6,
    ...overrides,
  };
}

export function graphCompanionTabButtonStyle(
  selected: boolean,
  overrides?: CSSProperties,
): CSSProperties {
  return {
    padding: "6px 8px",
    borderRadius: 8,
    border: selected
      ? "1px solid rgba(79,162,173,0.45)"
      : "1px solid rgba(255,255,255,0.12)",
    background: selected ? "rgba(79,162,173,0.16)" : "rgba(8,8,8,0.55)",
    color: selected ? "rgba(79,162,173,1)" : "rgba(255,255,255,0.65)",
    fontSize: 11,
    fontWeight: 600,
    lineHeight: 1.1,
    cursor: "pointer",
    ...overrides,
  };
}

export function graphDrawerSectionStyle(overrides?: CSSProperties): CSSProperties {
  return {
    borderRadius: 8,
    border: `1px solid ${GRAPH_THEME.drawer.sectionBorder}`,
    background: GRAPH_THEME.drawer.sectionBackground,
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.02)",
    ...overrides,
  };
}

export function graphDrawerInputStyle(overrides?: CSSProperties): CSSProperties {
  return {
    width: "100%",
    padding: "5px 7px",
    borderRadius: 6,
    border: `1px solid ${GRAPH_THEME.drawer.inputBorder}`,
    background: GRAPH_THEME.drawer.inputBackground,
    color: GRAPH_THEME.drawer.inputText,
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.02)",
    fontSize: 11,
    lineHeight: 1.4,
    ...overrides,
  };
}

export function graphDrawerButtonStyle(overrides?: CSSProperties): CSSProperties {
  return {
    width: "auto",
    padding: "5px 7px",
    borderRadius: 6,
    border: `1px solid ${GRAPH_THEME.drawer.buttonBorder}`,
    background: GRAPH_THEME.drawer.buttonBackground,
    color: "rgba(79,162,173,0.96)",
    boxShadow: `inset 0 1px 0 rgba(255,255,255,0.04), ${GRAPH_THEME.drawer.buttonShadow}`,
    fontWeight: 600,
    fontSize: 11,
    cursor: "pointer",
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
