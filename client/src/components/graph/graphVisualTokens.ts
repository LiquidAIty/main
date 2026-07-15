import type { CSSProperties } from 'react';
import { GRAPH_PAPER, GRAPH_WORKSPACE } from './graphWorkspaceContract';

function withAlpha(hexColor: string, alpha: number): string {
  const hex = String(hexColor || '')
    .replace('#', '')
    .trim();
  if (hex.length !== 6) return `rgba(167, 176, 186, ${alpha})`;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const graphGridMinor = withAlpha(
  GRAPH_PAPER.baseColor,
  GRAPH_PAPER.minorOpacity,
);
const graphGridMajor = withAlpha(
  GRAPH_PAPER.baseColor,
  GRAPH_PAPER.majorOpacity,
);
const graphGridCanvas = withAlpha(
  GRAPH_PAPER.baseColor,
  GRAPH_PAPER.minorOpacity,
);
const graphEdgeThink = 'rgba(55, 173, 170, 0.56)';
const graphEdgeKnow = 'rgba(167, 176, 186, 0.5)';
const graphEdgeMixed = 'rgba(167, 176, 186, 0.42)';

export const GRAPH_THEME = {
  graphPaper: {
    minorStep: GRAPH_PAPER.minorStep,
    majorStep: GRAPH_PAPER.majorStep,
    lineWidth: GRAPH_PAPER.lineWidth,
    baseColor: GRAPH_PAPER.baseColor,
    minorOpacity: GRAPH_PAPER.minorOpacity,
    majorOpacity: GRAPH_PAPER.majorOpacity,
    restingBrightness: GRAPH_PAPER.restingBrightness,
    vignetteOpacity: GRAPH_PAPER.vignetteOpacity,
    worldScale: GRAPH_PAPER.worldScale,
    worldDepth: GRAPH_PAPER.worldDepth,
    worldExtent: GRAPH_PAPER.worldExtent,
  },
  surface: {
    base: '#0B0E12',
    border: 'rgba(167, 176, 186, 0.28)',
    text: '#F5F7FA',
    mutedText: '#A7B0BA',
    shadow: '0 16px 36px rgba(0, 0, 0, 0.28)',
  },
  accent: {
    primary: '#37ADAA',
    primarySoft: 'rgba(55, 173, 170, 0.12)',
    primaryBorder: 'rgba(55, 173, 170, 0.34)',
    primaryGlow: 'rgba(55, 173, 170, 0.18)',
    solar: '#F2A64A',
    solarSoft: 'rgba(242, 166, 74, 0.14)',
    solarGlow: 'rgba(242, 166, 74, 0.16)',
    hover: '#F5F7FA',
    magentic: '#2B8C8A',
    graph: 'rgba(167, 176, 186, 0.78)',
    workflow: '#F2A64A',
    workflowGlow: 'rgba(242, 166, 74, 0.12)',
    memory: '#6E5FAE',
    memorySoft: 'rgba(110, 95, 174, 0.14)',
    think: '#37ADAA',
    know: '#A7B0BA',
    mixed: '#A7B0BA',
  },
  background: {
    agentSurface:
      'radial-gradient(circle at 18% 14%, rgba(55,173,170,0.09), transparent 34%), radial-gradient(circle at 78% 18%, rgba(242,166,74,0.045), transparent 36%), linear-gradient(180deg, rgba(17,22,29,0.96), rgba(11,14,18,0.99))',
    knowledgeSurface:
      'radial-gradient(circle at 18% 14%, rgba(55,173,170,0.09), transparent 34%), radial-gradient(circle at 78% 18%, rgba(242,166,74,0.045), transparent 36%), linear-gradient(180deg, rgba(17,22,29,0.96), rgba(11,14,18,0.99))',
    knowledgePatternSize: 'auto, auto, auto',
    gridMinor: graphGridMinor,
    gridMajor: graphGridMajor,
    grid: graphGridCanvas,
  },
  edge: {
    neutral: 'rgba(167, 176, 186, 0.78)',
    think: graphEdgeThink,
    know: graphEdgeKnow,
    mixed: graphEdgeMixed,
    selected: '#37ADAA',
    hover: '#F5F7FA',
  },
  // Where a node's MEANING came from — distinct from graph TYPE (think/know above).
  // Lets the graph tell repository facts, sourced evidence, and project reasoning
  // apart. Reuses existing accent colors (no new palette). Values map the ThinkGraph
  // node `source` property (codegraph_grounded | knowgraph_grounded | main_authored).
  grounding: {
    code: '#F2A64A', // CodeGraph-grounded repository fact (accent.solar)
    know: '#A7B0BA', // KnowGraph-grounded sourced evidence (accent.know)
    main: '#37ADAA', // Main-authored ThinkGraph reasoning (accent.think)
    unknown: '#6E5FAE', // ungrounded / unknown source (accent.memory)
  },
  edgeMotion: {
    idleDash: '22 18',
    activeDash: '16 12',
    runningDash: '12 9',
    idleDuration: '3.6s',
    activeDuration: '2.8s',
    runningDuration: '2.2s',
    idleGlowExtra: 0.42,
    activeGlowExtra: 0.82,
    runningGlowExtra: 1.08,
    substrateWidthExtra: 0.6,
    runnerRadius: 1.7,
  },
  tooltip: {
    background: 'rgba(11, 14, 18, 0.94)',
    border: '1px solid rgba(167, 176, 186, 0.28)',
    text: '#A7B0BA',
    title: '#F5F7FA',
    shadow: '0 10px 28px rgba(0, 0, 0, 0.28)',
  },
  controls: {
    background: 'rgba(17, 22, 29, 0.94)',
    border: 'rgba(167, 176, 186, 0.24)',
    hoverBackground: 'rgba(22, 30, 37, 0.98)',
    text: '#F5F7FA',
    shadow: '0 16px 36px rgba(0, 0, 0, 0.18)',
  },
  card: {
    glassBackground:
      'radial-gradient(circle at 14% 20%, rgba(55,173,170,0.06), transparent 38%), radial-gradient(circle at 86% 14%, rgba(242,166,74,0.04), transparent 40%), linear-gradient(180deg, rgba(17,22,29,0.84), rgba(11,14,18,0.9))',
    glassMagenticBackground:
      'radial-gradient(circle at 18% 20%, rgba(55,173,170,0.12), transparent 38%), radial-gradient(circle at 80% 16%, rgba(43,140,138,0.14), transparent 36%), radial-gradient(circle at 50% 92%, rgba(242,166,74,0.07), transparent 42%), linear-gradient(180deg, rgba(15,27,30,0.9), rgba(11,20,24,0.92))',
    glassGraphBackground:
      'radial-gradient(circle at 82% 18%, rgba(55,173,170,0.08), transparent 36%), linear-gradient(180deg, rgba(24,30,37,0.82), rgba(17,22,29,0.88))',
    glassBorder: 'rgba(55, 173, 170, 0.2)',
    glassInset: 'inset 0 1px 0 rgba(255,255,255,0.05)',
    glassShadow: '0 14px 30px rgba(0, 0, 0, 0.24)',
    pillBackground: 'rgba(17, 22, 29, 0.82)',
    pillBorder: 'rgba(167, 176, 186, 0.24)',
  },
  // Deep-glass "an object is being inspected" material. A layered shell — NOT a
  // transparent black box — so dense inspector text stays readable while the panel
  // reads as thick glass floating over the canvas. Used by the object/agent inspector
  // shells; intentionally distinct from `card.glass*` (agent cards / world / energy
  // / media keep the lighter card glass).
  inspector: {
    // Dark-but-not-dead fill (~0.84) with a top-right teal lift (light source).
    fill:
      'radial-gradient(circle at 82% 7%, rgba(126,232,226,.16), transparent 42%), ' +
      'radial-gradient(circle at 10% 88%, rgba(55,173,170,.08), transparent 48%), ' +
      'linear-gradient(155deg, rgba(24,36,44,.70), rgba(9,15,21,.66))',
    // Directional edge: bright at top-right, dark at bottom-left.
    edge:
      'linear-gradient(215deg, rgba(255,255,255,.38), rgba(126,232,226,.22) 34%, ' +
      'rgba(167,176,186,.09) 66%, rgba(0,0,0,.18))',
    // Layered inner shadows give glass thickness (dialed DOWN for a dark UI so it
    // never blows out to milky white).
    inset:
      'inset 0 1px 0 rgba(255,255,255,.19), ' +
      'inset 14px 0 30px rgba(126,232,226,.035), ' +
      'inset 0 -18px 26px rgba(0,0,0,.20), ' +
      'inset 0 0 0 1px rgba(55,173,170,.07)',
    // Tinted floating drop shadow (carries the bg hue, not pure black).
    drop: '0 24px 56px rgba(2,9,14,.42), 0 0 28px rgba(55,173,170,.07)',
    blur: 'blur(24px) saturate(165%)',
  },
  drawer: {
    panelBackground: 'rgba(11,14,18,0.92)',
    panelBorder: 'rgba(167,176,186,0.2)',
    panelInset: 'inset 0 1px 0 rgba(255,255,255,0.05)',
    panelShadow: '0 16px 32px rgba(0,0,0,0.24)',
    tabRailBackground: 'rgba(11,14,18,0.72)',
    tabRailBorder: 'rgba(167,176,186,0.24)',
    sectionBackground: 'rgba(167,176,186,0.04)',
    sectionBorder: 'rgba(167,176,186,0.14)',
    inputBackground: 'rgba(167,176,186,0.04)',
    inputBorder: 'rgba(167,176,186,0.16)',
    inputBorderFocus: 'rgba(55, 173, 170, 0.28)',
    inputText: '#F5F7FA',
    inputMuted: '#A7B0BA',
    buttonBackground: 'rgba(55, 173, 170, 0.12)',
    buttonBorder: 'rgba(55,173,170,0.35)',
    buttonShadow: '0 4px 10px rgba(55, 173, 170, 0.08)',
  },
  turboFlow: {
    intelligenceGradientStart: '#37ADAA',
    intelligenceGradientMid: '#2B8C8A',
    intelligenceGradientEnd: '#37ADAA',
    executionGradientStart: 'rgba(55,173,170,0.84)',
    executionGradientMid: 'rgba(242,166,74,0.42)',
    executionGradientEnd: 'rgba(201,124,42,0.34)',
    memoryGradientStart: 'rgba(43,140,138,0.84)',
    memoryGradientMid: '#37ADAA',
    memoryGradientEnd: 'rgba(43,140,138,0.86)',
    markerStroke: 'rgba(55, 173, 170, 0.78)',
    markerHotStroke: 'rgba(242, 166, 74, 0.58)',
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

/**
 * Map a graph node's grounding source to its authority color so repository facts,
 * sourced evidence, and project reasoning are visually distinct. Reuses existing
 * GRAPH_THEME tokens (no new palette). `source` comes from the ThinkGraph node
 * `source` property; unknown/empty falls back to the neutral "unknown" token.
 */
export function graphGroundingColor(source?: string | null): string {
  switch (String(source || '').trim().toLowerCase()) {
    case 'codegraph_grounded':
      return GRAPH_THEME.grounding.code;
    case 'knowgraph_grounded':
      return GRAPH_THEME.grounding.know;
    case 'main_authored':
      return GRAPH_THEME.grounding.main;
    default:
      return GRAPH_THEME.grounding.unknown;
  }
}

/** Human-readable label for a grounding source, for legends and Inspector rows. */
export function graphGroundingLabel(source?: string | null): string {
  switch (String(source || '').trim().toLowerCase()) {
    case 'codegraph_grounded':
      return 'Repository fact (CodeGraph)';
    case 'knowgraph_grounded':
      return 'Sourced evidence (KnowGraph)';
    case 'main_authored':
      return 'Project reasoning (Main)';
    default:
      return 'Ungrounded';
  }
}

export function graphPillButtonStyle(overrides?: CSSProperties): CSSProperties {
  return {
    padding: '7px 10px',
    borderRadius: 999,
    border: `1px solid ${GRAPH_THEME.accent.primaryBorder}`,
    background: GRAPH_THEME.controls.background,
    color: GRAPH_THEME.surface.text,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 600,
    boxShadow: '0 10px 24px rgba(0, 0, 0, 0.16)',
    ...overrides,
  };
}

export function graphControlButtonStyle(
  overrides?: CSSProperties,
): CSSProperties {
  return {
    width: 36,
    height: 36,
    border: `1px solid ${GRAPH_THEME.controls.border}`,
    background: GRAPH_THEME.controls.background,
    color: GRAPH_THEME.controls.text,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
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
    backdropFilter: 'blur(14px) saturate(120%)',
    WebkitBackdropFilter: 'blur(14px) saturate(120%)',
    ...overrides,
  };
}

// Deep-glass material for focused inspector shells (the "object is being inspected"
// surface). Returns only the visual material props (radius / border / background /
// shadow / blur) so callers keep their own layout props. The gradient border is
// drawn via padding-box fill + border-box edge over a transparent 1px border.
export function graphInspectorPanelStyle(
  overrides?: CSSProperties,
): CSSProperties {
  return {
    borderRadius: 14,
    border: '1px solid transparent',
    background: `${GRAPH_THEME.inspector.fill} padding-box, ${GRAPH_THEME.inspector.edge} border-box`,
    boxShadow: `${GRAPH_THEME.inspector.inset}, ${GRAPH_THEME.inspector.drop}`,
    backdropFilter: GRAPH_THEME.inspector.blur,
    WebkitBackdropFilter: GRAPH_THEME.inspector.blur,
    ...overrides,
  };
}

export function graphGlassPillStyle(overrides?: CSSProperties): CSSProperties {
  return {
    padding: '2px 6px',
    borderRadius: 999,
    background: GRAPH_THEME.card.pillBackground,
    border: `1px solid ${GRAPH_THEME.card.pillBorder}`,
    color: GRAPH_THEME.surface.mutedText,
    fontSize: 10,
    lineHeight: 1.04,
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
    ...overrides,
  };
}

export function graphCompanionPanelStyle(
  overrides?: CSSProperties,
): CSSProperties {
  return {
    borderLeft: `1px solid ${GRAPH_THEME.drawer.panelBorder}`,
    background: GRAPH_THEME.drawer.panelBackground,
    ...overrides,
  };
}

export function graphCompanionTabRailStyle(
  overrides?: CSSProperties,
): CSSProperties {
  return {
    background: 'transparent',
    ...overrides,
  };
}

export function graphCompanionTabGroupStyle(
  overrides?: CSSProperties,
): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
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
    padding: '6px 9px',
    borderRadius: 8,
    border: selected
      ? '1px solid rgba(55,173,170,0.42)'
      : '1px solid rgba(167,176,186,0.24)',
    background: selected ? 'rgba(55,173,170,0.12)' : 'rgba(11,14,18,0.64)',
    color: selected ? '#F5F7FA' : '#A7B0BA',
    fontSize: 11,
    fontWeight: 600,
    lineHeight: 1.1,
    cursor: 'pointer',
    boxShadow: selected
      ? 'inset 0 1px 0 rgba(245,247,250,0.06), 0 0 0 1px rgba(55,173,170,0.18)'
      : 'inset 0 1px 0 rgba(245,247,250,0.02)',
    ...overrides,
  };
}

export function graphDrawerSectionStyle(
  overrides?: CSSProperties,
): CSSProperties {
  return {
    borderRadius: 10,
    border: '1px solid rgba(126, 232, 226, 0.13)',
    background: 'linear-gradient(145deg, rgba(29, 43, 52, 0.46), rgba(12, 19, 25, 0.24))',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.07), 0 8px 22px rgba(0,0,0,0.10)',
    ...overrides,
  };
}

export function graphDrawerInputStyle(
  overrides?: CSSProperties,
): CSSProperties {
  return {
    width: '100%',
    padding: '5px 7px',
    borderRadius: 6,
    border: '1px solid rgba(126, 232, 226, 0.16)',
    background: 'linear-gradient(180deg, rgba(29,43,52,0.42), rgba(12,19,25,0.28))',
    color: GRAPH_THEME.drawer.inputText,
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.055)',
    fontSize: 11,
    lineHeight: 1.4,
    ...overrides,
  };
}

export function graphDrawerButtonStyle(
  overrides?: CSSProperties,
): CSSProperties {
  return {
    width: 'auto',
    padding: '5px 7px',
    borderRadius: 6,
    border: `1px solid ${GRAPH_THEME.drawer.buttonBorder}`,
    background: GRAPH_THEME.drawer.buttonBackground,
    color: '#37ADAA',
    boxShadow: `inset 0 1px 0 rgba(255,255,255,0.04), ${GRAPH_THEME.drawer.buttonShadow}`,
    fontWeight: 600,
    fontSize: 11,
    cursor: 'pointer',
    ...overrides,
  };
}

export const graphControlStackStyle: CSSProperties = {
  position: 'absolute',
  left: 16,
  bottom: 16,
  zIndex: 20,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  borderRadius: 12,
  boxShadow: '0 12px 28px rgba(0, 0, 0, 0.18)',
};
