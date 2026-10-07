// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  importWorldViewMount,
  observeWorldViewVisualReadiness,
  WORLDVIEW_CANVAS_SIZE_DEADLINE_MS,
  WORLDVIEW_FIRST_CONTENT_DEADLINE_MS,
  WORLDVIEW_MOUNT_MODULE_URL,
  WORLDVIEW_RENDER_FRAME_DEADLINE_MS,
} from './loadWorldViewRuntime';

vi.mock('virtual:worldview-runtime-css', () => ({ default: '' }));
vi.mock('virtual:worldview-runtime-mount', () => ({
  importWorldViewMount: vi.fn(),
}));

describe('WorldView runtime module doorway', () => {
  it('waits for the dev module server and imports without a machine-path Vite URL', async () => {
    const module = { mountWorldView: vi.fn() };
    const moduleImporter = vi.fn(async () => module);
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    await expect(importWorldViewMount({
      dev: true,
      moduleImporter,
      fetcher,
      attempts: 2,
      retryDelayMs: 0,
    })).resolves.toBe(module);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenLastCalledWith(
      WORLDVIEW_MOUNT_MODULE_URL,
      { method: 'HEAD', cache: 'no-store' },
    );
    expect(moduleImporter).toHaveBeenCalledTimes(1);
    expect(WORLDVIEW_MOUNT_MODULE_URL).not.toContain('/@fs/');
    expect(WORLDVIEW_MOUNT_MODULE_URL).not.toMatch(/[A-Z]:\//);
  });

  it('uses the bundled production module without localhost readiness traffic', async () => {
    const module = { mountWorldView: vi.fn() };
    const moduleImporter = vi.fn(async () => module);
    const fetcher = vi.fn();

    await expect(importWorldViewMount({
      dev: false,
      moduleImporter,
      fetcher,
    })).resolves.toBe(module);

    expect(moduleImporter).toHaveBeenCalledTimes(1);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('fails after the bounded dev readiness window without importing the renderer', async () => {
    const moduleImporter = vi.fn();
    const fetcher = vi.fn(async () => new Response(null, { status: 503 }));

    await expect(importWorldViewMount({
      dev: true,
      moduleImporter,
      fetcher,
      attempts: 2,
      retryDelayMs: 0,
    })).rejects.toThrow('worldview_runtime_module_http_503');

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(moduleImporter).not.toHaveBeenCalled();
  });
});

function runtimeEvent() {
  const listeners = new Set<(...args: any[]) => void>();
  return {
    listeners,
    addEventListener(listener: (...args: any[]) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    removeEventListener(listener: (...args: any[]) => void) {
      listeners.delete(listener);
    },
    raise(...args: any[]) {
      for (const listener of [...listeners]) listener(...args);
    },
  };
}

function fixture({
  width = 800,
  height = 600,
  backingWidth = 1600,
  backingHeight = 1200,
  activeId = 'photoreal',
  withTileset = true,
  tilesLoaded = false,
}: {
  width?: number;
  height?: number;
  backingWidth?: number;
  backingHeight?: number;
  activeId?: string;
  withTileset?: boolean;
  tilesLoaded?: boolean;
} = {}) {
  const postRender = runtimeEvent();
  const renderError = runtimeEvent();
  const tileFailed = runtimeEvent();
  const tileVisible = runtimeEvent();
  const initialTilesLoaded = runtimeEvent();
  const canvas = document.createElement('canvas');
  canvas.width = backingWidth;
  canvas.height = backingHeight;
  vi.spyOn(canvas, 'getBoundingClientRect').mockImplementation(() => ({
    x: 0, y: 0, left: 0, top: 0, right: width, bottom: height,
    width, height, toJSON: () => ({}),
  }));
  let stackId = activeId;
  const setStack = vi.fn(async (next: string) => { stackId = next; });
  const requestRender = vi.fn();
  const setLayerVisibility = vi.fn();
  const components = {
    scene: {
      viewer: { scene: { canvas, postRender, renderError, requestRender } },
      tileset: withTileset
        ? { tilesLoaded, tileFailed, tileVisible, initialTilesLoaded }
        : null,
      mapStackController: {
        getState: () => ({ activeId: stackId }),
        setStack,
      },
    },
  };
  const mounted = {
    getComponents: () => components,
    setLayerVisibility,
  } as any;
  return {
    mounted,
    canvas,
    postRender,
    renderError,
    tileFailed,
    tileVisible,
    initialTilesLoaded,
    setStack,
    setLayerVisibility,
    requestRender,
    setActiveStack(next: string) { stackId = next; },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('WorldView visual readiness', () => {
  it('accepts visible photoreal content after a rendered frame without fallback', () => {
    const f = fixture();
    const states: any[] = [];
    const observer = observeWorldViewVisualReadiness(f.mounted, (state) => states.push(state));

    expect(observer.getState()).toMatchObject({
      phase: 'waiting-for-photoreal-content',
      activeMapStackId: 'photoreal',
      photorealTilesetExists: true,
      canvas: { cssWidth: 800, cssHeight: 600, backingWidth: 1600, backingHeight: 1200, valid: true },
    });
    f.tileVisible.raise({ content: {} });
    expect(observer.getState().firstVisibleContent).toBe(true);
    expect(observer.getState().phase).toBe('waiting-for-photoreal-content');
    f.postRender.raise();

    expect(observer.getState()).toMatchObject({
      phase: 'ready',
      firstPostRender: true,
      firstVisibleContent: true,
      fallback: { attempted: false },
    });
    expect(f.setStack).not.toHaveBeenCalled();
    expect(states.at(-1)?.phase).toBe('ready');
  });

  it('accepts photoreal content that loaded before observer attachment', () => {
    const f = fixture({ tilesLoaded: true });
    const observer = observeWorldViewVisualReadiness(f.mounted);

    expect(observer.getState()).toMatchObject({
      phase: 'waiting-for-photoreal-content',
      firstVisibleContent: true,
      fallback: { attempted: false },
    });
    f.postRender.raise();

    expect(observer.getState()).toMatchObject({
      phase: 'ready',
      firstPostRender: true,
      firstVisibleContent: true,
      fallback: { attempted: false },
    });
    expect(f.setStack).not.toHaveBeenCalled();
  });

  it('switches exactly once to existing OSM when photoreal content misses its deadline', async () => {
    const f = fixture();
    const observer = observeWorldViewVisualReadiness(f.mounted);

    await vi.advanceTimersByTimeAsync(WORLDVIEW_FIRST_CONTENT_DEADLINE_MS);

    expect(f.setStack).toHaveBeenCalledExactlyOnceWith('osm');
    expect(observer.getState()).toMatchObject({
      phase: 'waiting-for-fallback-frame',
      activeMapStackId: 'osm',
      fallback: { attempted: true, reason: 'content_timeout', applied: true, postFallbackFrame: false },
    });
    f.postRender.raise();
    expect(observer.getState()).toMatchObject({
      phase: 'ready',
      activeMapStackId: 'osm',
      fallback: { attempted: true, applied: true, postFallbackFrame: true },
    });
    expect(f.setLayerVisibility).not.toHaveBeenCalled();
  });

  it('does not override a map stack changed before the photoreal deadline', async () => {
    const f = fixture();
    const observer = observeWorldViewVisualReadiness(f.mounted);
    f.setActiveStack('osm');

    await vi.advanceTimersByTimeAsync(WORLDVIEW_FIRST_CONTENT_DEADLINE_MS);

    expect(observer.getState()).toMatchObject({
      phase: 'waiting-for-frame',
      activeMapStackId: 'osm',
      fallback: { attempted: false },
    });
    expect(f.setStack).not.toHaveBeenCalled();
    f.postRender.raise();
    expect(observer.getState().phase).toBe('ready');
  });

  it.each([
    ['renderError', (f: ReturnType<typeof fixture>) => f.renderError.raise(null, new Error('context lost'))],
    ['tileFailed', (f: ReturnType<typeof fixture>) => f.tileFailed.raise({ message: 'tile 503' })],
  ])('uses one OSM fallback for %s and records the decisive cause', async (kind, fail) => {
    const f = fixture();
    const observer = observeWorldViewVisualReadiness(f.mounted);

    fail(f);
    fail(f);
    await Promise.resolve();
    await Promise.resolve();

    expect(f.setStack).toHaveBeenCalledTimes(1);
    expect(observer.getState().activeMapStackId).toBe('osm');
    expect(observer.getState().fallback.reason).toBe(
      kind === 'renderError' ? 'render_error' : 'tile_failed',
    );
    if (kind === 'tileFailed') expect(observer.getState().tileFailure).toBe('tile 503');
  });

  it('fails honestly at zero canvas size without changing map stacks', async () => {
    const f = fixture({ width: 0, height: 0, backingWidth: 0, backingHeight: 0 });
    const observer = observeWorldViewVisualReadiness(f.mounted);
    f.postRender.raise();

    await vi.advanceTimersByTimeAsync(WORLDVIEW_CANVAS_SIZE_DEADLINE_MS);

    expect(observer.getState()).toMatchObject({
      phase: 'unavailable',
      canvas: { valid: false },
      error: { code: 'worldview_canvas_zero_size' },
      fallback: { attempted: false },
    });
    expect(f.setStack).not.toHaveBeenCalled();
  });

  it('requires a post-fallback frame and reports unavailable when it never arrives', async () => {
    const f = fixture();
    const observer = observeWorldViewVisualReadiness(f.mounted);
    f.tileFailed.raise({ message: 'tile failed' });
    await Promise.resolve();
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(WORLDVIEW_RENDER_FRAME_DEADLINE_MS);

    expect(observer.getState()).toMatchObject({
      phase: 'unavailable',
      activeMapStackId: 'osm',
      error: { code: 'worldview_osm_render_unavailable' },
      fallback: { attempted: true, applied: true, postFallbackFrame: false },
    });
  });

  it('cleans listeners and timers on unmount and supports an independent remount', () => {
    const first = fixture();
    const firstObserver = observeWorldViewVisualReadiness(first.mounted);
    expect(first.postRender.listeners.size).toBe(1);
    expect(first.tileVisible.listeners.size).toBe(1);
    firstObserver.dispose();
    expect(first.postRender.listeners.size).toBe(0);
    expect(first.renderError.listeners.size).toBe(0);
    expect(first.tileFailed.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);

    const second = fixture();
    const secondObserver = observeWorldViewVisualReadiness(second.mounted);
    second.initialTilesLoaded.raise();
    second.postRender.raise();
    expect(secondObserver.getState().phase).toBe('ready');
    expect(first.setStack).not.toHaveBeenCalled();
    expect(second.setStack).not.toHaveBeenCalled();
    secondObserver.dispose();
  });

  it('reports the missing component seam without attempting another runtime', () => {
    const observer = observeWorldViewVisualReadiness({ getComponents: () => ({}) } as any);

    expect(observer.getState()).toMatchObject({
      phase: 'unavailable',
      error: { code: 'worldview_visual_components_unavailable' },
      fallback: { attempted: false },
    });
  });
});
