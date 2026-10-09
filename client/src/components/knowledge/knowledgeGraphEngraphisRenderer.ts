import '../../vendor/engraphis/vendor/d3.min.js';
import '../../vendor/engraphis/vendor/force-graph.min.js';
import '../../vendor/engraphis/engraphis-graph.js';

import { GRAPH_THEME } from '../graph/graphVisualTokens';
import type { JevGraphPhysicsProfile } from './jevGraphPhysics';
import type { SolarpunkColors } from './joinedKnowledgeGraphProjection';
import {
  initialPresentationStyle,
  rendererGraphStyle,
  type GraphLayout,
  type GraphPresentationPreferences,
  type GraphStyle,
  type RendererGraphStyle,
} from './knowledgeGraphPresentationPreferences';

export type EngraphisRenderer = {
  setPreset: (name: GraphLayout) => Record<string, number | boolean | string>;
  setStyle: (name: RendererGraphStyle) => void;
  setSettings: (settings: Record<string, number | boolean | string>) => void;
  setData: (data: { nodes: unknown[]; links?: unknown[]; edges?: unknown[] }) => void;
  setHighlight: (id: string | null) => void;
  setThemeColors: (colors: Record<string, string>) => void;
  graphToScreen: (x: number, y: number) => { x: number; y: number };
  fit: () => void;
  resize: () => void;
  focus: (id: string) => boolean;
  clearFocus: () => void;
  freeze: (on: boolean) => void;
  reheat: () => void;
  setCollapse: (mode: boolean | 'auto') => void;
  destroy: () => void;
};

type EngraphisRendererCallbacks = {
  onNodeClick: (node: { id: string }) => void;
  onNodeDoubleClick?: (node: { id: string }) => void;
  onLinkClick: (link: { id: string }) => void;
  onBackgroundClick: () => void;
};

declare global {
  interface Window {
    EngraphisGraph: {
      create: (
        host: HTMLElement,
        options: EngraphisRendererCallbacks,
      ) => EngraphisRenderer;
    };
  }
}
export function createKnowledgeGraphRenderer({
  host,
  callbacks,
  savedPresentation,
  savedPresentationIsCurrent,
}: {
  host: HTMLElement;
  callbacks: EngraphisRendererCallbacks;
  savedPresentation: Partial<GraphPresentationPreferences>;
  savedPresentationIsCurrent: boolean;
}): {
  renderer: EngraphisRenderer;
  layout: GraphLayout;
  style: GraphStyle;
  physicsProfile: JevGraphPhysicsProfile;
  settings: Record<string, number | boolean | string>;
} {
  const renderer = window.EngraphisGraph.create(host, callbacks);
  const layout = savedPresentation.layout || 'compact';
  const style = initialPresentationStyle(
    savedPresentationIsCurrent ? savedPresentation.style : undefined,
  );
  const physicsProfile = savedPresentation.physicsProfile || 'galaxy';
  const defaults = renderer.setPreset(layout);
  const savedSettings = savedPresentationIsCurrent
    ? savedPresentation.settings || {}
    : { ...(savedPresentation.settings || {}), size: 5 };
  const settings: Record<string, number | boolean | string> = {
    ...defaults,
    labels: true,
    ...savedSettings,
  };
  if (!savedPresentationIsCurrent) {
    settings.linkw = Math.max(1, Number(settings.linkw) || 1);
  }
  renderer.setCollapse(false);
  renderer.setStyle(rendererGraphStyle(style));
  renderer.setSettings(settings);
  return { renderer, layout, style, physicsProfile, settings };
}

export function knowledgeGraphRendererThemeColors(
  style: GraphStyle,
  solarpunkColors: SolarpunkColors,
): Record<string, string> {
  return style === 'solarpunk' ? {
    material_blue: solarpunkColors.think,
    material_orange: solarpunkColors.know,
    material_surface: GRAPH_THEME.surface.base,
    accent: solarpunkColors.think,
    solar: solarpunkColors.know,
    surface: GRAPH_THEME.surface.base,
    label: GRAPH_THEME.surface.text,
  } : {};
}

export function observeKnowledgeGraphRendererResize(
  host: HTMLElement,
  renderer: EngraphisRenderer,
): (() => void) | undefined {
  if (typeof ResizeObserver === 'undefined') return undefined;
  let frame = 0;
  const apply = () => {
    frame = 0;
    renderer.resize();
  };
  const schedule = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(apply);
  };
  const observer = new ResizeObserver(schedule);
  observer.observe(host);
  schedule();
  return () => {
    observer.disconnect();
    if (frame) cancelAnimationFrame(frame);
  };
}
