// Minimal observable store for the shared Graph Explorer: selection, hover, pinned nodes, and which
// owner-graph layers are active. Framework-agnostic (no Zustand dep); a tiny useSyncExternalStore
// hook exposes it to React. Selection/camera survive layer toggles by design.

import { useSyncExternalStore } from 'react';
import type { OwnerGraph } from './graphViewAdapter';

export type GraphSelection = {
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  hoverNodeId: string | null;
  pinnedNodeIds: string[];
  activeLayers: OwnerGraph[];
};

const initial: GraphSelection = {
  selectedNodeId: null,
  selectedEdgeId: null,
  hoverNodeId: null,
  pinnedNodeIds: [],
  activeLayers: ['know', 'think'],
};

let state: GraphSelection = initial;
const listeners = new Set<() => void>();
function emit() { for (const l of listeners) l(); }

export const graphSelection = {
  get: (): GraphSelection => state,
  subscribe(fn: () => void) { listeners.add(fn); return () => listeners.delete(fn); },
  selectNode(id: string | null) { state = { ...state, selectedNodeId: id, selectedEdgeId: null }; emit(); },
  selectEdge(id: string | null) { state = { ...state, selectedEdgeId: id, selectedNodeId: null }; emit(); },
  setHover(id: string | null) { if (id !== state.hoverNodeId) { state = { ...state, hoverNodeId: id }; emit(); } },
  togglePin(id: string) {
    const has = state.pinnedNodeIds.includes(id);
    state = { ...state, pinnedNodeIds: has ? state.pinnedNodeIds.filter((x) => x !== id) : [...state.pinnedNodeIds, id] };
    emit();
  },
  toggleLayer(layer: OwnerGraph) {
    const has = state.activeLayers.includes(layer);
    state = { ...state, activeLayers: has ? state.activeLayers.filter((l) => l !== layer) : [...state.activeLayers, layer] };
    emit();
  },
  setLayers(layers: OwnerGraph[]) { state = { ...state, activeLayers: layers }; emit(); },
  reset() { state = { ...initial }; emit(); },
};

export function useGraphSelection(): GraphSelection {
  return useSyncExternalStore(graphSelection.subscribe, graphSelection.get, graphSelection.get);
}
