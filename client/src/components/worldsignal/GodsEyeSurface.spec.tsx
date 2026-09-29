// @vitest-environment jsdom

import React, { createRef } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import GodsEyeSurface, { type GodsEyeBridge } from './GodsEyeSurface';

const native = vi.hoisted(() => ({
  load: vi.fn(),
  destroy: vi.fn(),
  attachInspectorControls: vi.fn(),
  selectInspectorTab: vi.fn(),
  detachInspectorControls: vi.fn(),
  setLayerVisibility: vi.fn(),
  setSatelliteParams: vi.fn(),
  focusSelection: vi.fn(),
}));

vi.mock('./loadWorldViewNative', () => ({
  loadWorldViewNative: native.load,
}));

const scope = { projectId: 'project-1', cardId: 'card-worldview' };

function handle() {
  return {
    destroy: native.destroy,
    attachInspectorControls: native.attachInspectorControls,
    selectInspectorTab: native.selectInspectorTab,
    setLayerVisibility: native.setLayerVisibility,
    setSatelliteParams: native.setSatelliteParams,
    focusSelection: native.focusSelection,
  };
}

beforeEach(() => {
  native.destroy.mockReset().mockResolvedValue(undefined);
  native.detachInspectorControls.mockReset();
  native.attachInspectorControls.mockReset().mockImplementation(() => ({
    detach: native.detachInspectorControls,
  }));
  native.selectInspectorTab.mockReset().mockReturnValue(true);
  native.setLayerVisibility.mockReset().mockReturnValue('layer-request-1');
  native.setSatelliteParams.mockReset().mockReturnValue('satellite-params-1');
  native.focusSelection.mockReset().mockReturnValue('focus-request-1');
  native.load.mockReset().mockResolvedValue(handle());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('WorldView direct native mount', () => {
  it('mounts into the React-owned root without an iframe', async () => {
    render(<GodsEyeSurface {...scope} />);
    await waitFor(() => expect(native.load).toHaveBeenCalledTimes(1));
    const [root, config] = native.load.mock.calls[0];
    expect(root).toBe(document.getElementById('worldview-native-root'));
    expect(config).toEqual(expect.objectContaining(scope));
    expect(document.querySelector('iframe')).toBeNull();
    expect(screen.queryByText('Starting WorldView…')).toBeNull();
    expect(screen.getByLabelText('WorldView globe').contains(root)).toBe(true);
  });

  it('does not expose commands until the native lifecycle has settled', async () => {
    let resolveMount!: (value: ReturnType<typeof handle>) => void;
    native.load.mockReturnValue(new Promise((resolve) => { resolveMount = resolve; }));
    const ref = createRef<GodsEyeBridge>();
    render(<GodsEyeSurface ref={ref} {...scope} />);
    await waitFor(() => expect(native.load).toHaveBeenCalledTimes(1));
    expect(ref.current?.setLayerVisibility('earthquakes', true)).toBeNull();
    expect(ref.current?.setSatelliteParams({ catalog: 'dense' })).toBeNull();
    const host = document.createElement('div');
    expect(ref.current?.attachInspectorControls(host)).toBeNull();
    expect(ref.current?.selectInspectorTab('view')).toBe(false);

    await act(async () => resolveMount(handle()));
    expect(ref.current?.attachInspectorControls(host)).toEqual({
      detach: native.detachInspectorControls,
    });
    expect(ref.current?.selectInspectorTab('view')).toBe(true);
    expect(native.attachInspectorControls).toHaveBeenCalledExactlyOnceWith(host);
    expect(native.selectInspectorTab).toHaveBeenCalledExactlyOnceWith('view');
    expect(ref.current?.setLayerVisibility('earthquakes', true, {
      exitIncompatibleContext: true,
    })).toBe('layer-request-1');
    expect(native.setLayerVisibility).toHaveBeenCalledExactlyOnceWith(
      'earthquakes',
      true,
      { exitIncompatibleContext: true },
    );
    expect(ref.current?.setSatelliteParams({ catalog: 'dense', showPoints: true, showOrbits: true }))
      .toBe('satellite-params-1');
    expect(native.setSatelliteParams).toHaveBeenCalledExactlyOnceWith({
      catalog: 'dense', showPoints: true, showOrbits: true,
    });
  });

  it('publishes readiness only after the mounted handle is command-ready', async () => {
    let resolveMount!: (value: ReturnType<typeof handle>) => void;
    native.load.mockReturnValue(new Promise((resolve) => { resolveMount = resolve; }));
    const onReady = vi.fn();
    const ref = createRef<GodsEyeBridge>();
    render(<GodsEyeSurface ref={ref} {...scope} onReady={onReady} />);
    await waitFor(() => expect(native.load).toHaveBeenCalledTimes(1));
    const callbacks = native.load.mock.calls[0][1].callbacks;
    act(() => callbacks.onReady('0.1.1'));
    expect(onReady).not.toHaveBeenCalled();

    await act(async () => resolveMount(handle()));
    expect(onReady).toHaveBeenCalledExactlyOnceWith('0.1.1');
    expect(ref.current?.focusSelection({
      id: 'flight-1', type: 'flight', label: 'Flight',
      position: { longitude: -97, latitude: 30 },
    })).toBe('focus-request-1');
  });

  it('destroys the native lifecycle on React unmount', async () => {
    const view = render(<GodsEyeSurface {...scope} />);
    await waitFor(() => expect(native.load).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(document.getElementById('worldview-native-root')).toBeTruthy());
    view.unmount();
    expect(native.destroy).toHaveBeenCalledTimes(1);
  });

  it('reports mount failure without substituting another runtime', async () => {
    native.load.mockRejectedValue(new Error('webgl unavailable'));
    const onError = vi.fn();
    render(<GodsEyeSurface {...scope} onError={onError} />);
    expect(await screen.findByText('WorldView could not start')).toBeTruthy();
    expect(screen.getByText('webgl unavailable')).toBeTruthy();
    expect(onError).toHaveBeenCalledWith({
      code: 'worldview_native_mount_failed',
      message: 'webgl unavailable',
    });
    expect(document.querySelector('iframe')).toBeNull();
  });
});
