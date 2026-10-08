/**
 * In-process bridge between the WorldSignals app and an embedding host.
 *
 * When the app is mounted directly by a host React application
 * (see mountWorldSignals.tsx) there is no frame boundary, so host commands and
 * app events are plain function calls rather than postMessage traffic.
 *
 * Standalone (Next.js) mode never registers a host, so every emit here is a
 * no-op and the app behaves exactly as it does today.
 */

export type WorldSignalsSelectionRef = {
  id: string;
  type: string;
  label: string | null;
};

export type WorldSignalsFlyToInput = {
  lat: number;
  lng: number;
  zoom?: number;
};

export type WorldSignalsInspectorSection =
  | 'overview'
  | 'selection'
  | 'markets'
  | 'layers'
  | 'research'
  | 'watches'
  | 'timeline'
  | 'knowgraph';

/** Bounded descriptor projected from the one layer catalog (embed/layerCatalog.ts). */
export type WorldSignalsLayerDescriptor = {
  id: string;
  label: string;
  group: string;
  specialist: boolean;
  available: boolean;
};

export type WorldSignalsLayerStateRef = {
  profileId: string;
  profileVersion: number;
  layers: WorldSignalsLayerDescriptor[];
  enabledLayerIds: string[];
};

export type WorldSignalsMarketQuote = {
  symbol: string;
  price: number;
  changePercent: number;
};

/** Bounded projection of the app's own market feed — never the full telemetry store. */
export type WorldSignalsMarketsSnapshot = {
  status: 'ok' | 'empty' | 'backend_offline';
  /** Upstream provider as reported by the backend (e.g. 'finnhub', 'yfinance'). */
  provider: string | null;
  /** true when the backend is running on its limited fallback provider. */
  degraded: boolean;
  quotes: WorldSignalsMarketQuote[];
  /** Backend-reported last data refresh, when available. */
  lastUpdated: string | null;
};

type HostListeners = {
  onSelectionChange?: (selection: WorldSignalsSelectionRef | null) => void;
  onReady?: () => void;
  onInspectorSectionRequest?: (section: WorldSignalsInspectorSection) => void;
  onLayerStateChange?: (state: WorldSignalsLayerStateRef) => void;
};

type AppCommands = {
  flyTo?: (input: WorldSignalsFlyToInput) => void;
  getLayerState?: () => WorldSignalsLayerStateRef;
  setLayerEnabled?: (layerId: string, enabled: boolean) => void;
  resetLayersToWorldIntelligenceDefaults?: () => void;
  getMarketsSnapshot?: () => WorldSignalsMarketsSnapshot;
};

const listeners: HostListeners = {};
const commands: AppCommands = {};

// Host-persisted enabled-layer set to restore on mount, applied by the app's
// layer-state initializer. Unknown/removed ids are ignored there. null = none.
let initialEnabledLayerIds: string[] | null = null;

/** Host side: set before render; cleared on unmount. */
export function setInitialEnabledLayerIds(ids: string[] | null): void {
  initialEnabledLayerIds = ids ? [...ids] : null;
}

/** App side: read once by the layer-state initializer. */
export function getInitialEnabledLayerIds(): string[] | null {
  return initialEnabledLayerIds;
}

/** Host side: called by mountWorldSignals before the app renders. */
export function registerHostListeners(next: HostListeners): () => void {
  Object.assign(listeners, next);
  return () => {
    listeners.onSelectionChange = undefined;
    listeners.onReady = undefined;
    listeners.onInspectorSectionRequest = undefined;
    listeners.onLayerStateChange = undefined;
  };
}

/** App side: the running app publishes the commands it can actually service. */
export function registerAppCommand<K extends keyof AppCommands>(
  name: K,
  handler: NonNullable<AppCommands[K]>,
): () => void {
  commands[name] = handler;
  return () => {
    delete commands[name];
  };
}

/** Host side: invoked by the mount handle. Loud when the app is not mounted. */
export function invokeAppCommand<K extends keyof AppCommands>(
  name: K,
  ...args: Parameters<NonNullable<AppCommands[K]>>
): ReturnType<NonNullable<AppCommands[K]>> {
  const handler = commands[name];
  if (!handler) {
    throw new Error(`worldsignals_command_unavailable: ${String(name)} (app not mounted)`);
  }
  return (handler as (...a: unknown[]) => unknown)(...args) as ReturnType<
    NonNullable<AppCommands[K]>
  >;
}

/** App side. */
export function emitSelectionChange(selection: WorldSignalsSelectionRef | null): void {
  listeners.onSelectionChange?.(selection);
}

/** App side. */
export function emitReady(): void {
  listeners.onReady?.();
}

/** App side: a vendor control asks the host to open an Inspector section. */
export function emitInspectorSectionRequest(section: WorldSignalsInspectorSection): void {
  listeners.onInspectorSectionRequest?.(section);
}

/** App side: layer enable/disable changed (from either side). */
export function emitLayerStateChange(state: WorldSignalsLayerStateRef): void {
  listeners.onLayerStateChange?.(state);
}
