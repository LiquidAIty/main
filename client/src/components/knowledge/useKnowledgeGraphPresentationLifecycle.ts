import { useEffect, useRef, useState } from 'react';

import { CALM_FOCUS_GALAXY_SETTINGS, type ReadProviderFocusNeighborhood } from './knowledgeGraphFocusPresentation';
import { projectKnowledgeRendererData } from './knowledgeGraphRendererProjection';
import { createKnowledgeGraphRenderer, knowledgeGraphRendererThemeColors,
  observeKnowledgeGraphRendererResize, type EngraphisRenderer } from './knowledgeGraphEngraphisRenderer';
import {
  initialPresentationStyle, presentationStorageKey, rendererGraphStyle, safePresentationPreferences,
  type GraphLayout, type GraphPresentationPreferences, type GraphStyle,
} from './knowledgeGraphPresentationPreferences';
import {
  DEFAULT_SOLARPUNK_COLORS, type GraphProjectionV1, type JoinedGraphPresentation, type SolarpunkColors,
} from './joinedKnowledgeGraphProjection';
import type { JevGraphPhysicsProfile } from './jevGraphPhysics';
import { useKnowledgeGraphManualFocus } from './useKnowledgeGraphManualFocus';

type PresentationState = Omit<GraphPresentationPreferences, 'schemaVersion' | 'solarpunkColors'>;
type AutomaticPresentation = {
  renderer: EngraphisRenderer | null;
  snapshot: PresentationState;
  manualLayout: boolean; manualStyle: boolean; manualPhysics: boolean;
  manualSettings: Set<string>;
  manualAllSettings: boolean;
};

export function useKnowledgeGraphPresentationLifecycle({
  projection, joinedPresentation, onReadProviderFocusNeighborhood, selectedId,
  onInspectNode, onInspectEdge, onClearSelection,
}: {
  projection: GraphProjectionV1; joinedPresentation: JoinedGraphPresentation;
  onReadProviderFocusNeighborhood?: ReadProviderFocusNeighborhood;
  selectedId: string | null; onInspectNode: (id: string) => void; onInspectEdge: (id: string) => void;
  onClearSelection: () => void;
}) {
  const savedPresentationRef = useRef(safePresentationPreferences());
  const savedPresentation = savedPresentationRef.current;
  const savedPresentationIsCurrent = savedPresentation.schemaVersion === 6;
  const hostRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<EngraphisRenderer | null>(null);
  const callbacksRef = useRef({ onInspectNode, onInspectEdge, onClearSelection });
  callbacksRef.current = { onInspectNode, onInspectEdge, onClearSelection };
  const focusActionRef = useRef<(id: string) => void>(() => undefined);
  const exitFocusRef = useRef<() => void>(() => undefined);
  const [settings, setSettings] = useState<Record<string, number | boolean | string>>(
    savedPresentationIsCurrent ? savedPresentation.settings || {} : { ...(savedPresentation.settings || {}), size: 5 });
  const [layout, setLayout] = useState<GraphLayout>(savedPresentation.layout || 'compact');
  const [style, setStyle] = useState<GraphStyle>(initialPresentationStyle(
    savedPresentationIsCurrent ? savedPresentation.style : undefined));
  const [physicsProfile, setPhysicsProfile] = useState<JevGraphPhysicsProfile>(savedPresentation.physicsProfile || 'galaxy');
  const [solarpunkColors, setSolarpunkColors] = useState<SolarpunkColors>(
    savedPresentationIsCurrent ? savedPresentation.solarpunkColors || DEFAULT_SOLARPUNK_COLORS : DEFAULT_SOLARPUNK_COLORS,
  );
  const [appliedPresetNodeSize, setAppliedPresetNodeSize] = useState<number | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [paperViewport, setPaperViewport] = useState({ x: 0, y: 0, zoom: 1 });
  const cameraRef = useRef<{ x: number; y: number; scale: number } | null>(null);
  const presentationStateRef = useRef<PresentationState>({
    layout: 'compact', style: 'cyber', physicsProfile: 'galaxy', settings: {} });
  const automaticPresentationRef = useRef<AutomaticPresentation | null>(null);
  presentationStateRef.current = { layout, style, physicsProfile, settings };

  const focus = useKnowledgeGraphManualFocus({
    projection, joinedPresentation, physicsProfile, onReadProviderFocusNeighborhood,
  });
  const exitManualFocus = () => {
    if (!focus.focusedEntry && !focus.focusRelease) return;
    const automatic = automaticPresentationRef.current;
    if (automatic) {
      automatic.snapshot.layout = 'compact';
      automatic.snapshot.physicsProfile = 'galaxy';
    }
    focus.exitManualFocus();
  };
  focusActionRef.current = focus.enterManualFocus;
  exitFocusRef.current = exitManualFocus;

  useEffect(() => {
    if (!hostRef.current) return;
    try {
      const mounted = createKnowledgeGraphRenderer({
        host: hostRef.current,
        callbacks: {
          onNodeClick: node => callbacksRef.current.onInspectNode(node.id),
          onNodeDoubleClick: node => {
            callbacksRef.current.onInspectNode(node.id);
            focusActionRef.current(node.id);
          },
          onLinkClick: link => callbacksRef.current.onInspectEdge(String(link.id)),
          onBackgroundClick: () => {
            exitFocusRef.current();
            callbacksRef.current.onClearSelection();
          },
        },
        savedPresentation,
        savedPresentationIsCurrent,
      });
      setLayout(mounted.layout); setStyle(mounted.style); setPhysicsProfile(mounted.physicsProfile);
      setSettings(mounted.settings);
      graphRef.current = mounted.renderer;
      return () => { mounted.renderer.destroy(); graphRef.current = null; };
    } catch (failure) {
      setRenderError(failure instanceof Error ? failure.message : String(failure));
      return undefined;
    }
  }, [savedPresentationIsCurrent]);

  useEffect(() => {
    graphRef.current?.setThemeColors(knowledgeGraphRendererThemeColors(style, solarpunkColors));
  }, [solarpunkColors, style]);

  useEffect(() => {
    try {
      window.localStorage.setItem(presentationStorageKey(), JSON.stringify({
        schemaVersion: 6, layout, style, physicsProfile, settings, solarpunkColors,
      } satisfies GraphPresentationPreferences));
    } catch {
      // Presentation preferences are optional; graph rendering remains authoritative.
    }
  }, [layout, physicsProfile, settings, solarpunkColors, style]);

  useEffect(() => {
    const host = hostRef.current;
    const graph = graphRef.current;
    if (!host || !graph) return undefined;
    return observeKnowledgeGraphRendererResize(host, graph);
  }, []);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    if (focus.blackholePresentationActive) {
      let automatic = automaticPresentationRef.current;
      if (!automatic) {
        automatic = {
          renderer: null,
          snapshot: { ...presentationStateRef.current, settings: { ...presentationStateRef.current.settings } },
          manualLayout: false, manualStyle: false, manualPhysics: false,
          manualSettings: new Set<string>(), manualAllSettings: false,
        };
        automaticPresentationRef.current = automatic;
      }
      if (automatic.renderer !== graph) {
        graph.setPreset('galaxy');
        graph.setStyle('cyber');
        graph.setSettings(CALM_FOCUS_GALAXY_SETTINGS);
        automatic.renderer = graph;
      }
      return;
    }
    const automatic = automaticPresentationRef.current;
    if (!automatic) return;
    const current = presentationStateRef.current;
    if (!automatic.manualLayout) {
      graph.setPreset(automatic.snapshot.layout);
      setLayout(automatic.snapshot.layout);
    }
    const restoredSettings = automatic.manualLayout || automatic.manualAllSettings
      ? { ...current.settings } : { ...automatic.snapshot.settings };
    for (const key of automatic.manualSettings) {
      if (current.settings[key] !== undefined) restoredSettings[key] = current.settings[key];
    }
    graph.setSettings(restoredSettings);
    setSettings(restoredSettings);
    if (!automatic.manualStyle) {
      graph.setStyle(rendererGraphStyle(automatic.snapshot.style));
      setStyle(automatic.snapshot.style);
    }
    if (!automatic.manualPhysics) setPhysicsProfile(automatic.snapshot.physicsProfile);
    automaticPresentationRef.current = null;
  }, [focus.blackholePresentationActive]);

  const recordManualChange = (
    field: 'layout' | 'style' | 'physics' | 'all-settings' | 'setting',
    settingKey?: string,
  ) => {
    const automatic = automaticPresentationRef.current;
    if (!automatic || !focus.blackholePresentationActive) return;
    if (field === 'layout') automatic.manualLayout = true;
    else if (field === 'style') automatic.manualStyle = true;
    else if (field === 'physics') automatic.manualPhysics = true;
    else if (field === 'all-settings') automatic.manualAllSettings = true;
    else if (settingKey) automatic.manualSettings.add(settingKey);
  };

  useEffect(() => {
    // Engraphis retains its layout/evidence fields; Graphiti uses supported aliases.
    graphRef.current?.setData(projectKnowledgeRendererData({
      displayProjection: focus.displayProjection,
      activeJoinedPresentation: focus.activeJoinedPresentation,
      style,
      solarpunkColors,
    }));
    if (focus.successfulFocusedEntry) graphRef.current?.focus(focus.successfulFocusedEntry.centerId);
    else graphRef.current?.clearFocus();
  }, [focus.activeJoinedPresentation, focus.displayProjection, focus.successfulFocusedEntry, solarpunkColors, style]);

  useEffect(() => {
    graphRef.current?.setHighlight(selectedId || focus.successfulFocusedEntry?.centerId || null);
  }, [focus.successfulFocusedEntry?.centerId, selectedId]);

  const syncPaper = () => {
    const graph = graphRef.current;
    if (!graph) return;
    const origin = graph.graphToScreen(0, 0);
    const unit = graph.graphToScreen(1, 0);
    const current = { x: origin.x, y: origin.y, scale: unit.x - origin.x };
    const previous = cameraRef.current;
    cameraRef.current = current;
    if (previous && previous.scale > 0) setPaperViewport(paper => ({
      x: paper.x + current.x - previous.x,
      y: paper.y + current.y - previous.y,
      zoom: paper.zoom * current.scale / previous.scale,
    }));
  };
  const beginCameraGesture = () => { cameraRef.current = null; syncPaper(); };
  const zoom = (key: '+' | '-') => {
    beginCameraGesture();
    const canvas = hostRef.current?.querySelector('canvas');
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true, cancelable: true,
      clientX: bounds.left + bounds.width / 2, clientY: bounds.top + bounds.height / 2,
      deltaY: key === '+' ? -120 : 120,
    }));
  };
  const fit = () => {
    cameraRef.current = null;
    setPaperViewport({ x: 0, y: 0, zoom: 1 });
    graphRef.current?.fit();
  };

  const presentationControls = {
    physicsProfile,
    changePhysicsProfile: (value: JevGraphPhysicsProfile) => {
      recordManualChange('physics'); setPhysicsProfile(value);
    },
    layout,
    changeLayout: (next: GraphLayout) => {
      recordManualChange('layout'); setAppliedPresetNodeSize(null);
      const preset = graphRef.current?.setPreset(next);
      const defaults = preset ? { ...preset, linkw: Math.max(1, Number(preset.linkw) || 1) } : preset;
      setLayout(next); setSettings(current => ({ ...current, ...defaults }));
    },
    style,
    changeStyle: (next: GraphStyle) => {
      recordManualChange('style'); graphRef.current?.setStyle(rendererGraphStyle(next)); setStyle(next);
    },
    solarpunkColors,
    changeSolarpunkColor: (key: keyof SolarpunkColors, value: string) => {
      setSolarpunkColors(current => ({ ...current, [key]: value }));
    },
    settings,
    changeSetting: (key: string, value: number | boolean) => {
      recordManualChange('setting', key); setAppliedPresetNodeSize(null);
      const patch = { [key]: value };
      graphRef.current?.setSettings(patch); setSettings(current => ({ ...current, ...patch }));
    },
    resetPresetDefaults: () => {
      recordManualChange('all-settings');
      const defaults = graphRef.current?.setPreset(layout);
      const nextSettings = {
        ...defaults, labels: true, linkw: Math.max(1, Number(defaults?.linkw) || 1),
      };
      graphRef.current?.setSettings(nextSettings); setSettings(nextSettings);
      setAppliedPresetNodeSize(typeof defaults?.size === 'number' ? defaults.size : null);
    },
    appliedPresetNodeSize,
  };

  return {
    ...focus,
    exitManualFocus,
    hostRef, renderError, paperViewport, layout, style, physicsProfile, presentationControls,
    camera: { beginCameraGesture, syncPaper, zoom, fit },
  };
}
