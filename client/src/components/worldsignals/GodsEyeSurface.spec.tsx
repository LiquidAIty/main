// @vitest-environment jsdom

import React, { createRef } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import GodsEyeSurface, { type GodsEyeBridge } from './GodsEyeSurface';

const runtime = vi.hoisted(() => ({
  load: vi.fn(),
  destroy: vi.fn(),
  attachInspectorControls: vi.fn(),
  selectInspectorTab: vi.fn(),
  detachInspectorControls: vi.fn(),
  setLayerVisibility: vi.fn(),
  setSatelliteParams: vi.fn(),
  focusSelection: vi.fn(),
  getVisualReadiness: vi.fn(),
}));

vi.mock('./loadWorldViewRuntime', () => ({
  loadWorldViewRuntime: runtime.load,
}));

const scope = { projectId: 'project-1', cardId: 'card-worldview' };

function handle() {
  return {
    destroy: runtime.destroy,
    attachInspectorControls: runtime.attachInspectorControls,
    selectInspectorTab: runtime.selectInspectorTab,
    setLayerVisibility: runtime.setLayerVisibility,
    setSatelliteParams: runtime.setSatelliteParams,
    focusSelection: runtime.focusSelection,
    getVisualReadiness: runtime.getVisualReadiness,
  };
}

beforeEach(() => {
  runtime.destroy.mockReset().mockResolvedValue(undefined);
  runtime.detachInspectorControls.mockReset();
  runtime.attachInspectorControls.mockReset().mockImplementation(() => ({
    detach: runtime.detachInspectorControls,
  }));
  runtime.selectInspectorTab.mockReset().mockReturnValue(true);
  runtime.setLayerVisibility.mockReset().mockReturnValue('layer-request-1');
  runtime.setSatelliteParams.mockReset().mockReturnValue('satellite-params-1');
  runtime.focusSelection.mockReset().mockReturnValue('focus-request-1');
  runtime.getVisualReadiness.mockReset().mockReturnValue(null);
  runtime.load.mockReset().mockResolvedValue(handle());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('WorldView direct WorldView runtime mount', () => {
  it('mounts into the React-owned root without an iframe', async () => {
    render(<GodsEyeSurface {...scope} />);
    await waitFor(() => expect(runtime.load).toHaveBeenCalledTimes(1));
    const [root, config] = runtime.load.mock.calls[0];
    expect(root).toBe(document.getElementById('worldview-gods-eye-root'));
    expect(config).toEqual(expect.objectContaining(scope));
    expect(document.querySelector('iframe')).toBeNull();
    expect(screen.queryByText('Starting WorldView…')).toBeNull();
    expect(screen.getByText('Loading WorldView map…')).toBeTruthy();
    expect(screen.getByLabelText('WorldView globe').contains(root)).toBe(true);
  });

  it('does not expose commands until the WorldView lifecycle has settled', async () => {
    let resolveMount!: (value: ReturnType<typeof handle>) => void;
    runtime.load.mockReturnValue(new Promise((resolve) => { resolveMount = resolve; }));
    const ref = createRef<GodsEyeBridge>();
    render(<GodsEyeSurface ref={ref} {...scope} />);
    await waitFor(() => expect(runtime.load).toHaveBeenCalledTimes(1));
    expect(ref.current?.setLayerVisibility('earthquakes', true)).toBeNull();
    expect(ref.current?.setSatelliteParams({ catalog: 'dense' })).toBeNull();
    const host = document.createElement('div');
    expect(ref.current?.attachInspectorControls(host)).toBeNull();
    expect(ref.current?.selectInspectorTab('view')).toBe(false);

    await act(async () => resolveMount(handle()));
    expect(ref.current?.attachInspectorControls(host)).toEqual({
      detach: runtime.detachInspectorControls,
    });
    expect(ref.current?.selectInspectorTab('view')).toBe(true);
    expect(runtime.attachInspectorControls).toHaveBeenCalledExactlyOnceWith(host);
    expect(runtime.selectInspectorTab).toHaveBeenCalledExactlyOnceWith('view');
    expect(ref.current?.setLayerVisibility('earthquakes', true, {
      exitIncompatibleContext: true,
    })).toBe('layer-request-1');
    expect(runtime.setLayerVisibility).toHaveBeenCalledExactlyOnceWith(
      'earthquakes',
      true,
      { exitIncompatibleContext: true },
    );
    expect(ref.current?.setSatelliteParams({ catalog: 'dense', showPoints: true, showOrbits: true }))
      .toBe('satellite-params-1');
    expect(runtime.setSatelliteParams).toHaveBeenCalledExactlyOnceWith({
      catalog: 'dense', showPoints: true, showOrbits: true,
    });
  });

  it('publishes readiness only after the mounted handle is command-ready', async () => {
    let resolveMount!: (value: ReturnType<typeof handle>) => void;
    runtime.load.mockReturnValue(new Promise((resolve) => { resolveMount = resolve; }));
    const onReady = vi.fn();
    const ref = createRef<GodsEyeBridge>();
    render(<GodsEyeSurface ref={ref} {...scope} onReady={onReady} />);
    await waitFor(() => expect(runtime.load).toHaveBeenCalledTimes(1));
    const callbacks = runtime.load.mock.calls[0][1].callbacks;
    act(() => callbacks.onReady('0.1.1'));
    expect(onReady).not.toHaveBeenCalled();

    await act(async () => resolveMount(handle()));
    expect(onReady).toHaveBeenCalledExactlyOnceWith('0.1.1');
    expect(ref.current?.focusSelection({
      id: 'flight-1', type: 'flight', label: 'Flight',
      position: { longitude: -97, latitude: 30 },
    })).toBe('focus-request-1');
  });

  it('destroys the WorldView lifecycle on React unmount', async () => {
    const view = render(<GodsEyeSurface {...scope} />);
    await waitFor(() => expect(runtime.load).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(document.getElementById('worldview-gods-eye-root')).toBeTruthy());
    view.unmount();
    expect(runtime.destroy).toHaveBeenCalledTimes(1);
  });

  it('reports mount failure without substituting another runtime', async () => {
    runtime.load.mockRejectedValue(new Error('webgl unavailable'));
    const onError = vi.fn();
    render(<GodsEyeSurface {...scope} onError={onError} />);
    expect(await screen.findByText('WorldView could not start')).toBeTruthy();
    expect(screen.getByText('webgl unavailable')).toBeTruthy();
    expect(onError).toHaveBeenCalledWith({
      code: 'worldview_runtime_mount_failed',
      message: 'webgl unavailable',
    });
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('shows visual fallback progress and fails honestly when no fallback frame arrives', async () => {
    render(<GodsEyeSurface {...scope} />);
    await waitFor(() => expect(runtime.load).toHaveBeenCalledTimes(1));
    const callbacks = runtime.load.mock.calls[0][1].callbacks;

    act(() => callbacks.onVisualReadinessChange({
      phase: 'waiting-for-fallback-frame',
      canvas: { cssWidth: 800, cssHeight: 600, backingWidth: 1600, backingHeight: 1200, valid: true },
      firstPostRender: true,
      activeMapStackId: 'osm',
      photorealTilesetExists: true,
      firstVisibleContent: false,
      tileFailure: 'tile failed',
      fallback: { attempted: true, reason: 'tile_failed', applied: true, postFallbackFrame: false },
      error: null,
    }));
    expect(screen.getByText('Photoreal map unavailable. Loading the standard map…')).toBeTruthy();

    act(() => callbacks.onVisualReadinessChange({
      phase: 'unavailable',
      canvas: { cssWidth: 800, cssHeight: 600, backingWidth: 1600, backingHeight: 1200, valid: true },
      firstPostRender: true,
      activeMapStackId: 'osm',
      photorealTilesetExists: true,
      firstVisibleContent: false,
      tileFailure: 'tile failed',
      fallback: { attempted: true, reason: 'tile_failed', applied: true, postFallbackFrame: false },
      error: {
        code: 'worldview_osm_render_unavailable',
        message: 'The standard map loaded but did not produce a rendered frame.',
      },
    }));
    expect(screen.getByText('WorldView could not start')).toBeTruthy();
    expect(screen.getByText(/worldview_osm_render_unavailable/)).toBeTruthy();
  });
});
