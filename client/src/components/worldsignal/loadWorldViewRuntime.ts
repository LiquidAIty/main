import worldViewDocument from '../../../../worldsignal/gods-eye-view-main/index.html?raw';
import scopedStyles from 'virtual:worldview-runtime-css';
import { importWorldViewMount as importRuntimeWorldViewMount } from 'virtual:worldview-runtime-mount';

export type WorldViewRuntimeCallbacks = {
  onReady?: (sourceVersion: string) => void;
  onVisualReadinessChange?: (state: WorldViewVisualReadiness) => void;
  onSelectionChange?: (selection: unknown) => void;
  onLayerStateChange?: (state: unknown) => void;
  onLayerVisibilityChange?: (change: { layerId: string; enabled: boolean }) => void;
  onCommandResult?: (result: unknown) => void;
  onError?: (error: { code: string; message: string }) => void;
};

export type WorldViewVisualPhase =
  | 'waiting-for-size'
  | 'waiting-for-frame'
  | 'waiting-for-photoreal-content'
  | 'waiting-for-fallback-frame'
  | 'ready'
  | 'unavailable';

export type WorldViewVisualReadiness = {
  phase: WorldViewVisualPhase;
  canvas: {
    cssWidth: number;
    cssHeight: number;
    backingWidth: number;
    backingHeight: number;
    valid: boolean;
  };
  firstPostRender: boolean;
  activeMapStackId: string | null;
  photorealTilesetExists: boolean;
  firstVisibleContent: boolean;
  tileFailure: string | null;
  fallback: {
    attempted: boolean;
    reason: 'render_error' | 'tile_failed' | 'content_timeout' | 'tileset_missing' | null;
    applied: boolean;
    postFallbackFrame: boolean;
  };
  error: { code: string; message: string } | null;
};

export const WORLDVIEW_CANVAS_SIZE_DEADLINE_MS = 5_000;
export const WORLDVIEW_FIRST_CONTENT_DEADLINE_MS = 8_000;
export const WORLDVIEW_RENDER_FRAME_DEADLINE_MS = 5_000;

export type WorldViewMount = {
  attachInspectorControls: (host: HTMLElement) => { detach: () => void };
  selectInspectorTab: (tab: string) => boolean;
  setLayerVisibility: (
    layerId: string,
    enabled: boolean,
    options?: { exitIncompatibleContext?: boolean; origin?: 'user' | 'restore' },
  ) => string | null;
  setSatelliteParams: (params: {
    catalog?: 'core' | 'dense';
    showPoints?: boolean;
    showOrbits?: boolean;
    labelMode?: 'focus' | 'all';
  }) => string | null;
  focusSelection: (selection: unknown) => string | null;
  executeAction: (
    name: string,
    args?: Record<string, unknown>,
    options?: { disabledLayerIds?: string[]; signal?: AbortSignal },
  ) => Promise<unknown>;
  prepareRunImages: () => Promise<Array<Record<string, unknown>>>;
  getVisualReadiness: () => WorldViewVisualReadiness;
  destroy: () => Promise<void>;
};

type WorldViewMountModule = {
  mountWorldView: (
    root: HTMLElement,
    config: Record<string, unknown>,
  ) => Promise<WorldViewRuntimeMount>;
};

type WorldViewImportOptions = {
  dev?: boolean;
  moduleImporter?: () => Promise<WorldViewMountModule>;
  fetcher?: typeof fetch;
  attempts?: number;
  retryDelayMs?: number;
};

/** Public module doorway owned by the supervised WorldView service. */
export const WORLDVIEW_MOUNT_MODULE_URL =
  'http://127.0.0.1:4174/src/app/mount.js';

const delay = (milliseconds: number) => milliseconds <= 0
  ? Promise.resolve()
  : new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function waitForPublicRuntimeModule({
  fetcher,
  attempts,
  retryDelayMs,
}: Required<Pick<WorldViewImportOptions, 'fetcher' | 'attempts' | 'retryDelayMs'>>) {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetcher(WORLDVIEW_MOUNT_MODULE_URL, {
        method: 'HEAD',
        cache: 'no-store',
      });
      if (response.ok) return;
      lastError = new Error(`worldview_runtime_module_http_${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) await delay(retryDelayMs);
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('worldview_runtime_module_unavailable');
}

/** Dev uses the supervised module server; builds keep the bundled module graph. */
export async function importWorldViewMount({
  dev = import.meta.env.DEV,
  moduleImporter = importRuntimeWorldViewMount,
  fetcher = fetch,
  attempts = 8,
  retryDelayMs = 250,
}: WorldViewImportOptions = {}): Promise<WorldViewMountModule> {
  if (dev) await waitForPublicRuntimeModule({ fetcher, attempts, retryDelayMs });
  return moduleImporter();
}

type RuntimeEventLike = {
  addEventListener?: (listener: (...args: any[]) => void) => (() => void) | void;
  removeEventListener?: (listener: (...args: any[]) => void) => void;
};

type WorldViewRuntimeMount = Omit<WorldViewMount, 'getVisualReadiness'> & {
  getComponents?: () => {
    scene?: {
      viewer?: {
        scene?: {
          canvas?: HTMLCanvasElement;
          postRender?: RuntimeEventLike;
          renderError?: RuntimeEventLike;
          requestRender?: () => void;
        };
      };
      tileset?: {
        tilesLoaded?: boolean;
        tileFailed?: RuntimeEventLike;
        tileVisible?: RuntimeEventLike;
        initialTilesLoaded?: RuntimeEventLike;
      } | null;
      mapStackController?: {
        getState?: () => { activeId?: unknown };
        setStack?: (stackId: string, options?: { silent?: boolean }) => Promise<unknown> | unknown;
      };
    };
  };
};

type VisualReadinessObserver = {
  dispose: () => void;
  getState: () => WorldViewVisualReadiness;
};

function cloneVisualReadiness(
  state: WorldViewVisualReadiness,
): WorldViewVisualReadiness {
  return {
    ...state,
    canvas: { ...state.canvas },
    fallback: { ...state.fallback },
    error: state.error ? { ...state.error } : null,
  };
}

function eventCleanup(event: RuntimeEventLike | undefined, listener: (...args: any[]) => void) {
  if (!event?.addEventListener) return () => {};
  const remove = event.addEventListener(listener);
  if (typeof remove === 'function') return remove;
  return () => event.removeEventListener?.(listener);
}

function errorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (value && typeof value === 'object' && typeof (value as any).message === 'string') {
    return (value as any).message;
  }
  return typeof value === 'string' ? value : 'Unknown visual renderer failure';
}

function isPhotorealStack(stackId: string | null): boolean {
  return stackId === 'photoreal' || stackId === 'photorealistic';
}

/** Observe pixels through the WorldView handle without becoming another viewer or saved-setting owner. */
export function observeWorldViewVisualReadiness(
  mounted: WorldViewRuntimeMount,
  onChange?: (state: WorldViewVisualReadiness) => void,
): VisualReadinessObserver {
  let disposed = false;
  let sizeTimer: ReturnType<typeof setTimeout> | null = null;
  let visualTimer: ReturnType<typeof setTimeout> | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let contentNeedsRenderedFrame = false;
  let fallbackPromise: Promise<void> | null = null;
  const cleanups: Array<() => void> = [];
  let state: WorldViewVisualReadiness = {
    phase: 'waiting-for-size',
    canvas: { cssWidth: 0, cssHeight: 0, backingWidth: 0, backingHeight: 0, valid: false },
    firstPostRender: false,
    activeMapStackId: null,
    photorealTilesetExists: false,
    firstVisibleContent: false,
    tileFailure: null,
    fallback: { attempted: false, reason: null, applied: false, postFallbackFrame: false },
    error: null,
  };

  const emit = () => {
    if (!disposed) onChange?.(cloneVisualReadiness(state));
  };
  const update = (patch: Partial<WorldViewVisualReadiness>) => {
    state = { ...state, ...patch };
    emit();
  };
  const clearTimer = (timer: ReturnType<typeof setTimeout> | null) => {
    if (timer !== null) clearTimeout(timer);
  };
  const clearVisualTimer = () => {
    clearTimer(visualTimer);
    visualTimer = null;
  };
  const unavailable = (code: string, message: string) => {
    if (disposed || state.phase === 'unavailable') return;
    clearTimer(sizeTimer);
    clearVisualTimer();
    update({ phase: 'unavailable', error: { code, message } });
  };

  let components: ReturnType<NonNullable<WorldViewRuntimeMount['getComponents']>> | undefined;
  try {
    components = mounted.getComponents?.();
  } catch (error) {
    unavailable('worldview_visual_components_unavailable', errorMessage(error));
    return {
      dispose: () => { disposed = true; },
      getState: () => cloneVisualReadiness(state),
    };
  }
  const viewer = components?.scene?.viewer;
  const scene = viewer?.scene;
  const canvas = scene?.canvas;
  const tileset = components?.scene?.tileset ?? null;
  const mapStackController = components?.scene?.mapStackController;
  if (!scene || !canvas || !mapStackController?.getState || !mapStackController.setStack) {
    unavailable(
      'worldview_visual_components_unavailable',
      'The mounted WorldView does not expose its viewer and map stack.',
    );
    return {
      dispose: () => { disposed = true; },
      getState: () => cloneVisualReadiness(state),
    };
  }
  const switchToOsm = mapStackController.setStack.bind(mapStackController);

  const readStackId = (): string | null => {
    try {
      const activeId = mapStackController.getState?.().activeId;
      return typeof activeId === 'string' && activeId ? activeId : null;
    } catch {
      return null;
    }
  };
  state = {
    ...state,
    activeMapStackId: readStackId(),
    photorealTilesetExists: Boolean(tileset),
  };

  const requestRender = () => scene.requestRender?.();
  const markReady = (postFallbackFrame = false) => {
    clearTimer(sizeTimer);
    clearVisualTimer();
    update({
      phase: 'ready',
      fallback: postFallbackFrame
        ? { ...state.fallback, postFallbackFrame: true }
        : state.fallback,
      error: null,
    });
  };

  const scheduleFrameDeadline = (fallback: boolean) => {
    clearVisualTimer();
    visualTimer = setTimeout(() => {
      unavailable(
        fallback ? 'worldview_osm_render_unavailable' : 'worldview_first_frame_unavailable',
        fallback
          ? 'The standard map loaded but did not produce a rendered frame.'
          : 'WorldView did not produce a rendered frame.',
      );
    }, WORLDVIEW_RENDER_FRAME_DEADLINE_MS);
  };

  const triggerFallback = (
    reason: NonNullable<WorldViewVisualReadiness['fallback']['reason']>,
    message: string,
  ) => {
    if (disposed || state.fallback.attempted || fallbackPromise) return;
    const activeMapStackId = readStackId();
    update({ activeMapStackId });
    if (!isPhotorealStack(activeMapStackId)) {
      unavailable('worldview_visual_render_failed', message);
      return;
    }
    clearVisualTimer();
    update({
      phase: 'waiting-for-fallback-frame',
      fallback: { attempted: true, reason, applied: false, postFallbackFrame: false },
      error: null,
    });
    fallbackPromise = Promise.resolve(switchToOsm('osm'))
      .then(() => {
        if (disposed) return;
        const nextStackId = readStackId();
        if (nextStackId !== 'osm') {
          unavailable(
            'worldview_osm_fallback_unavailable',
            'Photoreal rendering failed and the standard map could not be activated.',
          );
          return;
        }
        update({
          activeMapStackId: nextStackId,
          fallback: { ...state.fallback, applied: true },
        });
        if (state.canvas.valid) scheduleFrameDeadline(true);
        requestRender();
      })
      .catch((error) => {
        unavailable('worldview_osm_fallback_unavailable', errorMessage(error));
      })
      .finally(() => { fallbackPromise = null; });
  };

  const scheduleVisualDeadline = () => {
    clearVisualTimer();
    if (state.fallback.applied) {
      scheduleFrameDeadline(true);
      return;
    }
    if (isPhotorealStack(state.activeMapStackId)) {
      update({ phase: 'waiting-for-photoreal-content' });
      visualTimer = setTimeout(() => {
        const activeMapStackId = readStackId();
        if (!isPhotorealStack(activeMapStackId)) {
          update({ phase: 'waiting-for-frame', activeMapStackId });
          scheduleFrameDeadline(false);
          requestRender();
          return;
        }
        triggerFallback(
          'content_timeout',
          'Photoreal rendering did not produce visible tile content before the deadline.',
        );
      }, WORLDVIEW_FIRST_CONTENT_DEADLINE_MS);
      return;
    }
    update({ phase: 'waiting-for-frame' });
    scheduleFrameDeadline(false);
  };

  const measureCanvas = () => {
    const rect = canvas.getBoundingClientRect?.();
    const nextCanvas = {
      cssWidth: Math.max(0, Number(rect?.width ?? canvas.clientWidth ?? 0)),
      cssHeight: Math.max(0, Number(rect?.height ?? canvas.clientHeight ?? 0)),
      backingWidth: Math.max(0, Number(canvas.width ?? 0)),
      backingHeight: Math.max(0, Number(canvas.height ?? 0)),
      valid: false,
    };
    nextCanvas.valid = nextCanvas.cssWidth > 0 && nextCanvas.cssHeight > 0
      && nextCanvas.backingWidth > 0 && nextCanvas.backingHeight > 0;
    const becameValid = nextCanvas.valid && !state.canvas.valid;
    const changed = Object.entries(nextCanvas).some(
      ([key, value]) => state.canvas[key as keyof typeof nextCanvas] !== value,
    );
    if (changed) update({ canvas: nextCanvas });
    if (becameValid) {
      clearTimer(sizeTimer);
      sizeTimer = null;
      if (isPhotorealStack(state.activeMapStackId) && !tileset) {
        triggerFallback('tileset_missing', 'The active photoreal map has no tileset.');
      } else {
        scheduleVisualDeadline();
      }
      requestRender();
    }
    return nextCanvas.valid;
  };

  const onPostRender = () => {
    if (disposed || state.phase === 'unavailable' || state.phase === 'ready') return;
    const canvasValid = measureCanvas();
    const activeMapStackId = readStackId();
    update({ firstPostRender: true, activeMapStackId });
    if (!canvasValid) return;
    // The WorldView mount can finish its first photoreal load before this
    // application observer attaches. The authoritative tilesLoaded flag is
    // therefore also a content milestone, but a frame observed by this
    // wrapper is still required before visual readiness is claimed.
    if (!state.firstVisibleContent
      && isPhotorealStack(activeMapStackId)
      && tileset?.tilesLoaded === true) {
      contentNeedsRenderedFrame = true;
      update({ firstVisibleContent: true });
      requestRender();
    }
    if (state.fallback.applied) {
      markReady(true);
      return;
    }
    if (state.fallback.attempted) return;
    if (!isPhotorealStack(activeMapStackId)) {
      markReady();
      return;
    }
    if (state.firstVisibleContent && contentNeedsRenderedFrame) {
      contentNeedsRenderedFrame = false;
      markReady();
    }
  };
  const onVisibleContent = () => {
    if (disposed || state.fallback.attempted || !isPhotorealStack(readStackId())) return;
    contentNeedsRenderedFrame = true;
    update({ firstVisibleContent: true });
    requestRender();
  };
  const onRenderError = (_scene: unknown, error: unknown) => {
    const message = errorMessage(error);
    if (state.fallback.applied) {
      unavailable('worldview_osm_render_failed', message);
      return;
    }
    triggerFallback('render_error', message);
  };
  const onTileFailed = (error: unknown) => {
    const message = errorMessage(error);
    update({ tileFailure: message });
    triggerFallback('tile_failed', message);
  };

  cleanups.push(eventCleanup(scene.postRender, onPostRender));
  cleanups.push(eventCleanup(scene.renderError, onRenderError));
  cleanups.push(eventCleanup(tileset?.tileVisible, onVisibleContent));
  cleanups.push(eventCleanup(tileset?.initialTilesLoaded, onVisibleContent));
  cleanups.push(eventCleanup(tileset?.tileFailed, onTileFailed));
  if (isPhotorealStack(state.activeMapStackId) && tileset?.tilesLoaded === true) {
    contentNeedsRenderedFrame = true;
    state = { ...state, firstVisibleContent: true };
  }
  if (typeof ResizeObserver === 'function') {
    resizeObserver = new ResizeObserver(() => { measureCanvas(); });
    resizeObserver.observe(canvas);
  }
  sizeTimer = setTimeout(() => {
    if (!state.canvas.valid) {
      unavailable(
        'worldview_canvas_zero_size',
        'WorldView canvas did not receive nonzero CSS and backing dimensions.',
      );
    }
  }, WORLDVIEW_CANVAS_SIZE_DEADLINE_MS);
  emit();
  const validAtStart = measureCanvas();
  if (validAtStart && isPhotorealStack(state.activeMapStackId) && !tileset) {
    triggerFallback('tileset_missing', 'The active photoreal map has no tileset.');
  }

  return {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      clearTimer(sizeTimer);
      clearVisualTimer();
      resizeObserver?.disconnect();
      while (cleanups.length) cleanups.pop()?.();
    },
    getState: () => cloneVisualReadiness(state),
  };
}

/** Load the controlled WorldView fork only when its surface is shown. */
export async function loadWorldViewRuntime(
  root: HTMLElement,
  config: {
    projectId: string;
    cardId: string;
    callbacks: WorldViewRuntimeCallbacks;
  },
): Promise<WorldViewMount> {
  const { mountWorldView } = await importWorldViewMount();
  const mounted = await mountWorldView(root, {
    ...config,
    documentMarkup: worldViewDocument,
    scopedStyles,
    runtimeBaseUrl: '/worldview-native/',
    sourceVersion: '0.1.1',
  }) as WorldViewRuntimeMount;
  const visualReadiness = observeWorldViewVisualReadiness(
    mounted,
    config.callbacks.onVisualReadinessChange,
  );
  return {
    attachInspectorControls: (...args) => mounted.attachInspectorControls(...args),
    selectInspectorTab: (...args) => mounted.selectInspectorTab(...args),
    setLayerVisibility: (...args) => mounted.setLayerVisibility(...args),
    setSatelliteParams: (...args) => mounted.setSatelliteParams(...args),
    focusSelection: (...args) => mounted.focusSelection(...args),
    executeAction: (...args) => mounted.executeAction(...args),
    prepareRunImages: () => mounted.prepareRunImages(),
    getVisualReadiness: visualReadiness.getState,
    destroy: async () => {
      visualReadiness.dispose();
      await mounted.destroy();
    },
  };
}
