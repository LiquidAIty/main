import React, { useEffect, useRef, useState } from 'react';

import { readLayerPrefs, writeLayerPrefs } from './worldSignalLayerPrefs';

type WorldSignalsHealth = {
  enabled: boolean;
  status: 'ok' | 'offline' | 'error';
  backend: { reachable: boolean; url: string };
  error?: string;
};

// The WorldSignals app is the vendored ShadowBroker frontend, built as a
// self-contained ES module by `npm run build:embed` in
// worldsignal/Shadowbroker-main/frontend. It ships its own React (19) and owns
// its own root inside our container — this shell is React 18, so the two trees
// stay separate and only the typed mount handle crosses between them.
const EMBED_BASE = '/worldsignals';
const EMBED_MODULE_URL = `${EMBED_BASE}/embed.js`;

// Same-origin prefix; client/vite.config.ts proxies it to the WorldSignals
// FastAPI backend. The app prefixes this onto its own /api/... calls.
const WORLDSIGNALS_API_BASE = '/worldsignals-api';

type WorldSignalsSelectionRef = { id: string; type: string; label: string | null };

export type WorldSignalsInspectorSection =
  | 'overview'
  | 'selection'
  | 'markets'
  | 'layers'
  | 'research'
  | 'watches'
  | 'timeline'
  | 'knowgraph';

export type WorldSignalsLayerDescriptor = {
  id: string;
  label: string;
  group: string;
  specialist: boolean;
  available: boolean;
};

export type WorldSignalsLayerState = {
  profileId: string;
  profileVersion: number;
  layers: WorldSignalsLayerDescriptor[];
  enabledLayerIds: string[];
};

export type WorldSignalsMarketsSnapshot = {
  status: 'ok' | 'empty' | 'backend_offline';
  provider: string | null;
  degraded: boolean;
  quotes: { symbol: string; price: number; changePercent: number }[];
  lastUpdated: string | null;
};

/** Narrow adapter the canonical Inspector drives the mounted app through. */
export type WorldSignalsInspectorBridge = {
  getLayerState(): WorldSignalsLayerState;
  setLayerEnabled(layerId: string, enabled: boolean): void;
  resetLayersToWorldIntelligenceDefaults(): void;
  getMarketsSnapshot(): WorldSignalsMarketsSnapshot;
};

type WorldSignalsMountHandle = WorldSignalsInspectorBridge & {
  flyTo(input: { lat: number; lng: number; zoom?: number }): void;
  unmount(): void;
};

type WorldSignalsEmbedModule = {
  mountWorldSignals(
    container: HTMLElement,
    options: {
      apiBaseUrl: string;
      assetBaseUrl?: string;
      projectId?: string;
      initialEnabledLayerIds?: string[];
      onReady?: () => void;
      onSelectionChange?: (selection: WorldSignalsSelectionRef | null) => void;
      onInspectorSectionRequest?: (section: WorldSignalsInspectorSection) => void;
      onLayerStateChange?: (state: WorldSignalsLayerState) => void;
      onError?: (error: { code: string; message: string }) => void;
    },
  ): WorldSignalsMountHandle;
};

// Load the prebuilt embed as a real ES module WITHOUT going through Vite's
// import-analysis: a bare `import(EMBED_MODULE_URL)` in app code gets rewritten
// to `/worldsignals/embed.js?import`, which Vite dev then tries (and fails) to
// transform as one of its own modules. A module-script tag injected at runtime
// carries an import specifier Vite never sees, so the browser fetches the file
// from public/ verbatim — dev and prod alike. Loaded once, cached on window.
let embedModulePromise: Promise<WorldSignalsEmbedModule> | null = null;
function loadEmbedModule(): Promise<WorldSignalsEmbedModule> {
  if (embedModulePromise) return embedModulePromise;
  embedModulePromise = new Promise<WorldSignalsEmbedModule>((resolve, reject) => {
    const w = window as unknown as { __worldSignalsEmbed?: WorldSignalsEmbedModule };
    if (w.__worldSignalsEmbed) return resolve(w.__worldSignalsEmbed);
    const script = document.createElement('script');
    script.type = 'module';
    const done = '__worldSignalsEmbedDone';
    (window as Record<string, unknown>)[done] = (mod: WorldSignalsEmbedModule) => {
      w.__worldSignalsEmbed = mod;
      resolve(mod);
    };
    (window as Record<string, unknown>)[`${done}Err`] = (message: string) =>
      reject(new Error(message || 'worldsignals_embed_load_failed'));
    script.textContent =
      `import(${JSON.stringify(EMBED_MODULE_URL)})` +
      `.then((m) => window.${done}(m))` +
      `.catch((e) => window.${done}Err(String(e && e.message || e)));`;
    script.onerror = () => reject(new Error('worldsignals_embed_script_error'));
    document.head.appendChild(script);
  });
  return embedModulePromise;
}

type WorldSignalSurfaceProps = {
  /** Identity for the temporary per-project/per-card layer persistence. */
  projectId: string | null;
  cardId: string | null;
  /** A vendor control (Markets, Layers) asked for a canonical Inspector section. */
  onInspectorSectionRequest?: (section: WorldSignalsInspectorSection) => void;
  /** Live layer state, fired on mount and on every change. */
  onLayerStateChange?: (state: WorldSignalsLayerState | null) => void;
  /** The mounted app's control adapter; null while unmounted. */
  onBridgeChange?: (bridge: WorldSignalsInspectorBridge | null) => void;
};

export default function WorldSignalSurface({
  projectId,
  cardId,
  onInspectorSectionRequest,
  onLayerStateChange,
  onBridgeChange,
}: WorldSignalSurfaceProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<WorldSignalsMountHandle | null>(null);
  const [health, setHealth] = useState<WorldSignalsHealth | null>(null);
  const [mountError, setMountError] = useState<string | null>(null);

  // Latest-callback refs keep the mount effect stable across host re-renders.
  const callbacksRef = useRef({ onInspectorSectionRequest, onLayerStateChange, onBridgeChange });
  useEffect(() => {
    callbacksRef.current = { onInspectorSectionRequest, onLayerStateChange, onBridgeChange };
  });

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/worldsignal/health', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`worldsignals_health_http_${response.status}`);
        setHealth((await response.json()) as WorldSignalsHealth);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setHealth({
          enabled: true,
          status: 'error',
          backend: { reachable: false, url: WORLDSIGNALS_API_BASE },
          error: error instanceof Error ? error.message : 'worldsignals_health_unavailable',
        });
      });
    return () => controller.abort();
  }, []);

  const backendReachable = health?.backend.reachable === true;

  useEffect(() => {
    if (!backendReachable || !containerRef.current || handleRef.current) return;
    let disposed = false;
    const container = containerRef.current;
    const canPersist = Boolean(projectId && cardId);
    const saved = canPersist ? readLayerPrefs(projectId as string, cardId as string) : null;
    // Guard so a stale profile version triggers at most one reset.
    let resetForNewProfile = false;

    (async () => {
      try {
        const module = await loadEmbedModule();
        if (disposed) return;
        const handle = module.mountWorldSignals(container, {
          apiBaseUrl: WORLDSIGNALS_API_BASE,
          assetBaseUrl: EMBED_BASE,
          initialEnabledLayerIds: saved?.enabledLayerIds,
          onSelectionChange: (selection) => {
            window.dispatchEvent(
              new CustomEvent('worldsignals:selected-object', { detail: selection }),
            );
          },
          onInspectorSectionRequest: (section) => {
            callbacksRef.current.onInspectorSectionRequest?.(section);
          },
          onLayerStateChange: (state) => {
            // A saved set from an older profile version is discarded: reset to
            // the current World Intelligence defaults, which re-fires this
            // handler with a matching version and persists it.
            if (saved && saved.profileVersion !== state.profileVersion && !resetForNewProfile) {
              resetForNewProfile = true;
              handle.resetLayersToWorldIntelligenceDefaults();
              return;
            }
            if (canPersist) {
              writeLayerPrefs(projectId as string, cardId as string, {
                profileVersion: state.profileVersion,
                enabledLayerIds: state.enabledLayerIds,
              });
            }
            callbacksRef.current.onLayerStateChange?.(state);
          },
          onError: (error) => setMountError(`${error.code}: ${error.message}`),
        });
        handleRef.current = handle;
        callbacksRef.current.onBridgeChange?.({
          getLayerState: () => handle.getLayerState(),
          setLayerEnabled: (layerId, enabled) => handle.setLayerEnabled(layerId, enabled),
          resetLayersToWorldIntelligenceDefaults: () =>
            handle.resetLayersToWorldIntelligenceDefaults(),
          getMarketsSnapshot: () => handle.getMarketsSnapshot(),
        });
      } catch (error) {
        if (disposed) return;
        setMountError(error instanceof Error ? error.message : 'worldsignals_mount_failed');
      }
    })();

    return () => {
      disposed = true;
      callbacksRef.current.onBridgeChange?.(null);
      callbacksRef.current.onLayerStateChange?.(null);
      handleRef.current?.unmount();
      handleRef.current = null;
    };
  }, [backendReachable, projectId, cardId]);

  if (mountError) {
    return <Unavailable title="WorldSignals failed to load" detail={mountError} />;
  }

  if (health && !health.enabled) {
    return <Unavailable title="WorldSignals is disabled" detail={health.error} />;
  }

  if (health && !health.backend.reachable) {
    return (
      <Unavailable
        title="WorldSignals is not running"
        detail={health.error || `backend unreachable at ${health.backend.url}`}
      />
    );
  }

  return (
    <section style={styles.root} aria-label="WorldSignals workspace">
      <div ref={containerRef} style={styles.mount} data-testid="worldsignals-mount" />
    </section>
  );
}

function Unavailable({ title, detail }: { title: string; detail?: string }): React.ReactElement {
  return (
    <section style={styles.unavailable} aria-label="WorldSignals unavailable">
      <h2 style={styles.title}>{title}</h2>
      {detail ? <code style={styles.error}>{detail}</code> : null}
    </section>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: { position: 'relative', width: '100%', height: '100%', minHeight: 0, background: '#050b10' },
  // The vendored app is a standalone full-screen dashboard: its root is
  // `position: fixed; inset: 0`, which would escape this panel and cover the
  // whole window. A `transform` here makes this div the containing block for all
  // fixed descendants, so the app's fixed root (and any fixed modals) are
  // trapped inside the companion panel instead of the viewport.
  mount: { position: 'absolute', inset: 0, overflow: 'hidden', transform: 'translateZ(0)' },
  unavailable: {
    display: 'grid',
    placeContent: 'center',
    gap: 10,
    width: '100%',
    height: '100%',
    padding: 32,
    textAlign: 'center',
    color: '#d9f7f2',
    background: '#050b10',
  },
  title: { margin: 0, fontSize: 22, fontWeight: 650 },
  error: { maxWidth: 640, color: '#e5a069', whiteSpace: 'pre-wrap' },
};
