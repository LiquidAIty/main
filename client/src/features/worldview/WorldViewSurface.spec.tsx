// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GodsEyeSourceDescriptor } from '../../components/worldsignal/GodsEyeSurface';
import WorldViewSurface from './WorldViewSurface';

// jsdom cannot parse the vendor's container-query stylesheet; visual layout
// belongs to the loaded preview, while these tests verify the control bridge.
vi.mock('virtual:worldview-native-css', () => ({ default: '' }));

const directHost = vi.hoisted(() => ({
  props: null as Record<string, any> | null,
  attachInspectorControls: vi.fn(),
  selectInspectorTab: vi.fn(),
  detachInspectorControls: vi.fn(),
  setLayerVisibility: vi.fn(),
  setSatelliteParams: vi.fn(),
  focusSelection: vi.fn(),
  executeAction: vi.fn(),
  prepareRunImages: vi.fn(),
}));

vi.mock('../../components/worldsignal/GodsEyeSurface', async () => {
  const React = await import('react');
  return {
    default: React.forwardRef((props: Record<string, any>, ref) => {
      directHost.props = props;
      React.useImperativeHandle(ref, () => ({
        attachInspectorControls: directHost.attachInspectorControls,
        selectInspectorTab: directHost.selectInspectorTab,
        setLayerVisibility: directHost.setLayerVisibility,
        setSatelliteParams: directHost.setSatelliteParams,
        focusSelection: directHost.focusSelection,
        executeAction: directHost.executeAction,
        prepareRunImages: directHost.prepareRunImages,
      }), []);
      React.useEffect(() => {
        props.onBridgeUnavailable?.();
      }, [props.cardId, props.projectId]);
      return React.createElement('section', {
        'aria-label': 'WorldView globe',
        'data-project-id': props.projectId,
        'data-card-id': props.cardId,
      });
    }),
  };
});

const inspectorHost = document.createElement('div');
inspectorHost.dataset.testid = 'workspace-inspector-drawer';
const scope = { projectId: 'project-1', cardId: 'card-worldview', inspectorContainer: inspectorHost };
const source: GodsEyeSourceDescriptor = {
  id: 'earthquakes', name: 'Earthquakes', provider: 'USGS',
  enabled: true, lifecycleState: 'active', lifecycleUncertain: false,
  feedState: 'ready', available: null, loading: false, refreshing: false,
  count: 4, lastRefreshAt: '2026-09-27T00:00:00Z', error: null,
};
const layerState = {
  sourceStateReady: true,
  enabledLayerIds: ['earthquakes'],
  sourceClocks: { earthquakes: '2026-09-27T00:00:00Z' },
  sources: [source],
};
let fetchMock: ReturnType<typeof vi.fn>;
const actionStreams: TestActionStream[] = [];

class TestActionStream {
  listeners = new Map<string, (event: MessageEvent) => void>();
  closed = false;
  constructor(readonly url: string) { actionStreams.push(this); }
  addEventListener(name: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(name, listener);
  }
  emit(name: string, data: unknown) {
    this.listeners.get(name)?.({ data: JSON.stringify(data) } as MessageEvent);
  }
  close() { this.closed = true; }
}

function projectResponse(projectId: string, capabilities: unknown[] = []) {
  return new Response(JSON.stringify({
    ok: true,
    projectId,
    defaultEnabled: true,
    capabilities,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function callbacks() {
  if (!directHost.props) throw new Error('direct_host_not_mounted');
  return directHost.props;
}

function openDataSources() {
  expect(screen.getByTestId('workspace-inspector-drawer')).toBeTruthy();
}


function openSelection() {
  fireEvent.click(screen.getByRole('tab', { name: 'Selection' }));
}

function nativeReady(state = layerState) {
  act(() => {
    callbacks().onReady?.('0.1.0');
    callbacks().onLayerStateChange?.(state);
  });
}

beforeEach(() => {
  document.body.appendChild(inspectorHost);
  inspectorHost.dataset.open = 'false';
  inspectorHost.removeAttribute('style');
  actionStreams.length = 0;
  vi.stubGlobal('EventSource', TestActionStream);
  directHost.props = null;
  directHost.attachInspectorControls.mockReset().mockImplementation(() => ({
    detach: directHost.detachInspectorControls,
  }));
  directHost.selectInspectorTab.mockReset().mockReturnValue(true);
  directHost.detachInspectorControls.mockReset();
  directHost.setLayerVisibility.mockReset().mockReturnValue('layer-request-1');
  directHost.setSatelliteParams.mockReset().mockReturnValue('satellite-params-request-1');
  directHost.focusSelection.mockReset().mockReturnValue('focus-request-1');
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const projectMatch = url.match(/\/api\/worldview\/projects\/([^/]+)\/capabilities/);
    const projectId = decodeURIComponent(projectMatch?.[1] || '');
    if ((init?.method || 'GET') === 'GET') return projectResponse(projectId);
    const capabilityId = decodeURIComponent(url.split('/').at(-1) || '');
    const enabled = Boolean(JSON.parse(String(init?.body || '{}')).enabled);
    return new Response(JSON.stringify({
      ok: true,
      projectId,
      capability: {
        capabilityId,
        enabled,
        controlledBy: 'user',
        lastOrigin: 'user',
        mainReason: null,
        updatedAt: '2026-09-27T00:00:00.000Z',
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  inspectorHost.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('WorldView direct source presentation', () => {
  it('fails closed without a saved Card attachment', () => {
    render(<WorldViewSurface projectId="project-1" cardId={null} inspectorContainer={inspectorHost} />);
    expect(screen.getByText('WorldView Card is not connected')).toBeTruthy();
    expect(screen.queryByLabelText('WorldView globe')).toBeNull();
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('attaches the original controls to the existing Inspector without a duplicate layer switch', async () => {
    render(<WorldViewSurface {...scope} />);
    await waitFor(() => expect(directHost.props).toBeTruthy());

    expect(screen.getByLabelText('WorldView globe')).toBeTruthy();
    expect(document.querySelector('iframe')).toBeNull();
    expect(screen.queryByText(/Globe ready/)).toBeNull();
    expect(screen.queryByText(/layers on/)).toBeNull();
    expect(directHost.focusSelection).not.toHaveBeenCalled();

    openDataSources();
    nativeReady();
    const inspector = screen.getByTestId('workspace-inspector-drawer');
    const host = document.getElementById('worldview-inspector-controls');
    expect(screen.getByLabelText('WorldView globe').parentElement?.contains(inspector)).toBe(false);
    expect(inspector.contains(host)).toBe(true);
    expect(directHost.attachInspectorControls).toHaveBeenCalledExactlyOnceWith(host);
    expect(directHost.selectInspectorTab).toHaveBeenCalledWith('data');
    openSelection();
    expect(screen.getByText('No selection.')).toBeTruthy();
    expect(directHost.selectInspectorTab).toHaveBeenCalledWith('selection');
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByText('Data Sources')).toBeNull();
    expect(callbacks().onLayerVisibilityChange).toBeTypeOf('function');
  });

  it('keeps only shared zoom and fit controls on the globe when the Inspector is closed', async () => {
    directHost.executeAction.mockResolvedValue({ ok: true });
    render(<WorldViewSurface {...scope} />);
    expect(screen.queryByRole('button', { name: 'Fit view' })).toBeNull();
    nativeReady();
    const controls = screen.getByTestId('graph-navigation-controls');
    expect(controls.parentElement).toBe(screen.getByLabelText('WorldView globe').parentElement);
    expect(screen.getByTestId('workspace-inspector-drawer').contains(controls)).toBe(false);
    expect(controls.querySelectorAll('button')).toHaveLength(3);
    expect(controls.textContent).not.toMatch(/fit|earth|home/i);
    expect(controls.querySelector('[aria-label^="Pan "]')).toBeNull();
    fireEvent.click(controls.querySelector('[aria-label="Zoom in"]')!);
    fireEvent.click(controls.querySelector('[aria-label="Zoom out"]')!);
    fireEvent.click(controls.querySelector('[aria-label="Fit view"]')!);
    expect(directHost.executeAction).toHaveBeenNthCalledWith(1,
      'adjust_camera_zoom', { direction: 'in', amount: 'little' });
    expect(directHost.executeAction).toHaveBeenNthCalledWith(2,
      'adjust_camera_zoom', { direction: 'out', amount: 'little' });
    expect(directHost.executeAction).toHaveBeenNthCalledWith(3, 'zoom_to_globe', {});
    expect(directHost.setLayerVisibility).not.toHaveBeenCalled();
    expect(directHost.setSatelliteParams).not.toHaveBeenCalled();
  });

  it('fits Earth even with satellites on without changing layer or catalog settings', () => {
    directHost.executeAction.mockResolvedValue({ ok: true });
    render(<WorldViewSurface {...scope} />);
    nativeReady({
      ...layerState,
      enabledLayerIds: ['satellites'],
      sources: [{ ...source, id: 'satellites', name: 'Satellites', enabled: true }],
    });
    const controls = screen.getByTestId('graph-navigation-controls');
    fireEvent.click(controls.querySelector('[aria-label="Fit view"]')!);
    expect(directHost.executeAction).toHaveBeenCalledExactlyOnceWith('zoom_to_globe', {});
    expect(directHost.setLayerVisibility).not.toHaveBeenCalled();
    expect(directHost.setSatelliteParams).not.toHaveBeenCalled();
  });

  it('leaves the Inspector Satellite view unchanged without adding a labeled Earth mode', () => {
    directHost.executeAction.mockResolvedValue({ ok: true });
    render(<WorldViewSurface {...scope} />);
    nativeReady();
    fireEvent.click(screen.getByRole('tab', { name: 'View' }));
    expect(screen.getByRole('button', { name: 'Satellite view' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Earth view' })).toBeNull();
    expect(directHost.executeAction).not.toHaveBeenCalled();
    expect(directHost.setLayerVisibility).not.toHaveBeenCalled();
    expect(directHost.setSatelliteParams).not.toHaveBeenCalled();
  });

  it('keeps navigation inside the exposed globe and clear of an open or moved Inspector', async () => {
    const rect = (left: number, top: number, width: number, height: number) => ({
      left, top, right: left + width, bottom: top + height, width, height,
    }) as DOMRect;
    const { container } = render(<div data-companion-visible-viewport="true">
      <WorldViewSurface {...scope} />
    </div>);
    nativeReady();
    const pane = screen.getByLabelText('WorldView globe').parentElement as HTMLElement;
    const clip = container.firstElementChild as HTMLElement;
    const controls = screen.getByTestId('graph-navigation-controls');
    let drawerRect = rect(680, 48, 308, 540);
    vi.spyOn(pane, 'getBoundingClientRect').mockImplementation(() => rect(0, 0, 1000, 600));
    vi.spyOn(clip, 'getBoundingClientRect').mockImplementation(() => rect(200, 0, 800, 600));
    vi.spyOn(controls, 'getBoundingClientRect').mockImplementation(() => rect(0, 0, 36, 108));
    vi.spyOn(inspectorHost, 'getBoundingClientRect').mockImplementation(() => drawerRect);

    act(() => window.dispatchEvent(new Event('resize')));
    expect(controls.style.right).toBe('16px');
    expect(controls.style.bottom).toBe('16px');

    act(() => { inspectorHost.dataset.open = 'true'; });
    await waitFor(() => expect(controls.style.right).toBe('336px'));
    expect(controls.style.bottom).toBe('16px');

    drawerRect = rect(300, 100, 300, 300);
    act(() => { inspectorHost.style.left = '300px'; });
    await waitFor(() => expect(controls.style.right).toBe('16px'));
    expect(controls.style.bottom).toBe('16px');

    act(() => { inspectorHost.dataset.open = 'false'; });
    await waitFor(() => expect(controls.style.right).toBe('16px'));
  });

  it('frames live satellites after the explicit ON and options requests settle', () => {
    directHost.executeAction.mockResolvedValue({ ok: true, action: 'satellite_overview' });
    render(<WorldViewSurface {...scope} />);
    nativeReady({
      ...layerState,
      enabledLayerIds: ['satellites'],
      sources: [{ ...source, id: 'satellites', name: 'Satellites', enabled: true }],
    });
    fireEvent.click(screen.getByRole('tab', { name: 'View' }));
    fireEvent.click(screen.getByRole('button', { name: 'Satellite view' }));
    expect(directHost.setLayerVisibility).toHaveBeenCalledExactlyOnceWith(
      'satellites', true, { origin: 'user' });
    expect(directHost.setSatelliteParams).not.toHaveBeenCalled();
    act(() => callbacks().onCommandResult?.({
      schemaVersion: 'gev.direct.layer-visibility.result.v1',
      ...scope,
      requestId: 'layer-request-1',
      layerId: 'satellites',
      requestedEnabled: true,
      ok: true,
      error: null,
      state: {
        ...layerState,
        enabledLayerIds: ['satellites'],
        sources: [{ ...source, id: 'satellites', name: 'Satellites', enabled: true }],
      },
    }));
    expect(directHost.setSatelliteParams).toHaveBeenCalledExactlyOnceWith({
      catalog: 'core', showPoints: true, showOrbits: true,
    });
    expect(directHost.executeAction).not.toHaveBeenCalled();
    act(() => callbacks().onCommandResult?.({
      schemaVersion: 'gev.direct.satellite-params.result.v1',
      ...scope,
      requestId: 'satellite-params-request-1',
      layerId: 'satellites',
      requestedParams: { catalog: 'core', showPoints: true, showOrbits: true },
      effectiveParams: { catalog: 'core', showPoints: true, showOrbits: true },
      ok: true,
      error: null,
      state: layerState,
    }));
    expect(directHost.executeAction).toHaveBeenCalledExactlyOnceWith('satellite_overview', {});
  });

  it('does not apply satellite presentation when explicit ON fails', () => {
    render(<WorldViewSurface {...scope} />);
    nativeReady();
    fireEvent.click(screen.getByRole('tab', { name: 'View' }));
    fireEvent.click(screen.getByRole('button', { name: 'Satellite view' }));
    act(() => callbacks().onCommandResult?.({
      schemaVersion: 'gev.direct.layer-visibility.result.v1',
      ...scope,
      requestId: 'layer-request-1',
      layerId: 'satellites',
      requestedEnabled: true,
      ok: false,
      error: 'Satellite layer unavailable',
      state: layerState,
    }));
    expect(directHost.setSatelliteParams).not.toHaveBeenCalled();
    expect(directHost.executeAction).not.toHaveBeenCalled();
    expect(screen.getAllByRole('alert').some((node) =>
      node.textContent?.includes('Satellite layer unavailable'))).toBe(true);
  });

  it('does not move the camera when satellite options fail', () => {
    render(<WorldViewSurface {...scope} />);
    nativeReady();
    fireEvent.click(screen.getByRole('tab', { name: 'View' }));
    fireEvent.click(screen.getByRole('button', { name: 'Satellite view' }));
    act(() => callbacks().onCommandResult?.({
      schemaVersion: 'gev.direct.layer-visibility.result.v1',
      ...scope,
      requestId: 'layer-request-1', layerId: 'satellites',
      requestedEnabled: true, ok: true, error: null, state: layerState,
    }));
    act(() => callbacks().onCommandResult?.({
      schemaVersion: 'gev.direct.satellite-params.result.v1',
      ...scope,
      requestId: 'satellite-params-request-1', layerId: 'satellites',
      requestedParams: { catalog: 'core', showPoints: true, showOrbits: true },
      effectiveParams: { catalog: 'dense', showPoints: true, showOrbits: true },
      ok: false, error: 'Core catalog unavailable', state: layerState,
    }));
    expect(directHost.executeAction).not.toHaveBeenCalled();
    expect(screen.getAllByRole('alert').some((node) =>
      node.textContent?.includes('Core catalog unavailable'))).toBe(true);
  });

  it('persists a settled native ON/OFF event without toggling the layer twice', async () => {
    render(<WorldViewSurface {...scope} />);
    await waitFor(() => expect(directHost.props).toBeTruthy());
    nativeReady();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/worldview/projects/project-1/capabilities', { method: 'GET' },
    ));
    act(() => {
      callbacks().onLayerVisibilityChange?.({ layerId: 'earthquakes', enabled: false });
      callbacks().onLayerStateChange?.({
        ...layerState,
        enabledLayerIds: [],
        sources: [{ ...source, enabled: false }],
      });
    });
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH'))
      .toBe(true));
    const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(patchCall).toEqual([
      '/api/worldview/projects/project-1/capabilities/earthquakes',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ enabled: false }) }),
    ]);
    await waitFor(() => expect(directHost.setLayerVisibility).not.toHaveBeenCalled());
  });

  it('restores the last confirmed Project choice when the native toggle cannot be saved', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method || 'GET') === 'GET') {
        return projectResponse('project-1', [{
          capabilityId: 'earthquakes', enabled: true, controlledBy: 'user',
          lastOrigin: 'user', mainReason: null, updatedAt: '2026-09-27T00:00:00.000Z',
        }]);
      }
      return new Response(JSON.stringify({ ok: false, error: 'write_failed' }), { status: 503 });
    });
    render(<WorldViewSurface {...scope} />);
    await waitFor(() => expect(directHost.props).toBeTruthy());
    nativeReady();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/worldview/projects/project-1/capabilities', { method: 'GET' },
    ));
    act(() => {
      callbacks().onLayerVisibilityChange?.({ layerId: 'earthquakes', enabled: false });
      callbacks().onLayerStateChange?.({
        ...layerState, enabledLayerIds: [], sources: [{ ...source, enabled: false }],
      });
    });
    await waitFor(() => expect(directHost.setLayerVisibility)
      .toHaveBeenCalledWith('earthquakes', true, { origin: 'restore' }));
    openDataSources();
    expect(screen.getByText(/Could not save the layer choice/)).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1);
  });

  it('keeps saved ON distinct from a failed native feed, then accepts the native OFF control', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if ((init?.method || 'GET') === 'GET') {
        return projectResponse('project-1', [{
          capabilityId: 'earthquakes',
          enabled: true,
          controlledBy: 'user',
          lastOrigin: 'user',
          mainReason: null,
          updatedAt: '2026-09-27T00:00:00.000Z',
        }]);
      }
      const enabled = Boolean(JSON.parse(String(init?.body || '{}')).enabled);
      return new Response(JSON.stringify({
        ok: true,
        projectId: 'project-1',
        capability: {
          capabilityId: 'earthquakes',
          enabled,
          controlledBy: 'user',
          lastOrigin: 'user',
          mainReason: null,
          updatedAt: '2026-09-27T00:00:01.000Z',
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    render(<WorldViewSurface {...scope} />);
    await waitFor(() => expect(directHost.props).toBeTruthy());
    nativeReady({
      ...layerState,
      enabledLayerIds: [],
      sources: [{
        ...source,
        enabled: false,
        lifecycleState: 'disabled',
        available: false,
        feedState: 'unavailable',
        error: 'USGS unreachable',
      }],
    });
    openDataSources();
    await waitFor(() => expect(directHost.setLayerVisibility)
      .toHaveBeenCalledWith('earthquakes', true, { origin: 'restore' }));
    act(() => callbacks().onCommandResult?.({
      schemaVersion: 'gev.direct.layer-visibility.result.v1',
      ...scope,
      requestId: 'layer-request-1',
      layerId: 'earthquakes',
      requestedEnabled: true,
      ok: false,
      error: 'Layer did not settle at requested visibility',
      state: {
        ...layerState,
        enabledLayerIds: [],
        sources: [{ ...source, enabled: false }],
      },
    }));

    expect(screen.getAllByRole('alert').some((node) =>
      node.textContent?.includes('Layer did not settle'))).toBe(true);
    act(() => callbacks().onLayerVisibilityChange?.({ layerId: 'earthquakes', enabled: false }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/worldview/projects/project-1/capabilities/earthquakes',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ enabled: false }) }),
    ));
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/worldview/projects/project-1/capabilities/earthquakes',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ enabled: false }) }),
    );
  });

  it('focuses a real native selection only after the explicit user action', async () => {
    render(<WorldViewSurface {...scope} />);
    await waitFor(() => expect(directHost.props).toBeTruthy());
    nativeReady();
    act(() => callbacks().onSelectionChange?.({
      id: 'native-flight-1',
      type: 'flight',
      label: 'Flight 1',
      position: { longitude: -97, latitude: 30 },
    }));
    openDataSources();
    openSelection();

    expect(screen.getByText('Flight 1 · flight')).toBeTruthy();
    expect(directHost.focusSelection).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Focus' }));
    expect(directHost.focusSelection).toHaveBeenCalledExactlyOnceWith({
      id: 'native-flight-1',
      type: 'flight',
      label: 'Flight 1',
      position: { longitude: -97, latitude: 30 },
    });
  });

  it('keeps native layer controls available and clears selection on Project remount', async () => {
    const { rerender } = render(<WorldViewSurface {...scope} />);
    await waitFor(() => expect(directHost.props).toBeTruthy());
    nativeReady({
      ...layerState,
      enabledLayerIds: [],
      sources: [{
        ...source,
        enabled: false,
        lifecycleState: 'disabled',
        available: false,
        loading: true,
        refreshing: true,
      }],
    });
    openDataSources();
    openSelection();
    expect(screen.queryByRole('checkbox')).toBeNull();
    act(() => callbacks().onSelectionChange?.({
      id: 'selected-1', type: 'satellite', label: 'Satellite 1',
      position: { longitude: -97, latitude: 30 },
    }));
    expect(screen.getByText('Satellite 1 · satellite')).toBeTruthy();

    rerender(<WorldViewSurface projectId="project-2" cardId="card-worldview-2" inspectorContainer={inspectorHost} />);
    await waitFor(() => expect(screen.getByText('No selection.')).toBeTruthy());
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(actionStreams.at(-1)?.url).toContain('/api/worldview/projects/project-2/actions/stream');
    expect(actionStreams[0]?.closed).toBe(true);
  });

  it('applies only exact-ID Project overrides and reloads them when the Project changes', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectId = url.includes('/project-2/') ? 'project-2' : 'project-1';
      if ((init?.method || 'GET') !== 'GET') throw new Error('unexpected_write');
      return projectResponse(projectId, projectId === 'project-1' ? [{
        capabilityId: 'earthquakes',
        enabled: false,
        controlledBy: 'user',
        lastOrigin: 'user',
        mainReason: null,
        updatedAt: '2026-09-27T00:00:00.000Z',
      }, {
        capabilityId: 'Earthquakes',
        enabled: false,
        controlledBy: 'main',
        lastOrigin: 'main',
        mainReason: 'Label-shaped ID must not match.',
        updatedAt: '2026-09-27T00:00:00.000Z',
      }] : [{
        capabilityId: 'earthquakes',
        enabled: true,
        controlledBy: 'user',
        lastOrigin: 'user',
        mainReason: null,
        updatedAt: '2026-09-27T00:00:01.000Z',
      }]);
    });
    const { rerender } = render(<WorldViewSurface {...scope} />);
    await waitFor(() => expect(directHost.props).toBeTruthy());
    nativeReady();
    await waitFor(() => expect(directHost.setLayerVisibility)
      .toHaveBeenCalledExactlyOnceWith('earthquakes', false, { origin: 'restore' }));

    act(() => callbacks().onLayerStateChange?.({
      ...layerState,
      enabledLayerIds: [],
      sources: [{ ...source, enabled: false }],
    }));
    act(() => callbacks().onCommandResult?.({
      schemaVersion: 'gev.direct.layer-visibility.result.v1',
      ...scope,
      requestId: 'layer-request-1',
      layerId: 'earthquakes',
      requestedEnabled: false,
      ok: true,
      error: null,
      state: {
        ...layerState,
        enabledLayerIds: [],
        sources: [{ ...source, enabled: false }],
      },
    }));

    directHost.setLayerVisibility.mockClear().mockReturnValue('layer-request-2');
    rerender(<WorldViewSurface projectId="project-2" cardId="card-worldview-2" inspectorContainer={inspectorHost} />);
    await waitFor(() => expect(String(fetchMock.mock.calls.at(-1)?.[0]))
      .toContain('/api/worldview/projects/project-2/capabilities'));
    act(() => {
      callbacks().onReady?.('0.1.0');
      callbacks().onLayerStateChange?.({
        ...layerState,
        enabledLayerIds: [],
        sources: [{ ...source, enabled: false }],
      });
    });
    await waitFor(() => expect(directHost.setLayerVisibility)
      .toHaveBeenCalledExactlyOnceWith('earthquakes', true, { origin: 'restore' }));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/worldview/projects/project-2/capabilities',
      { method: 'GET' },
    );
  });

  it('shows command failures without replacing the playable globe', async () => {
    render(<WorldViewSurface {...scope} />);
    await waitFor(() => expect(directHost.props).toBeTruthy());
    nativeReady();
    openDataSources();

    act(() => callbacks().onCommandResult?.({
      schemaVersion: 'gev.direct.layer-visibility.result.v1',
      ...scope,
      requestId: 'layer-request-1',
      layerId: 'earthquakes',
      requestedEnabled: false,
      ok: false,
      error: 'provider unavailable',
      state: layerState,
    }));
    expect(screen.getAllByRole('alert').some((node) =>
      node.textContent?.includes('provider unavailable'))).toBe(true);
    expect(screen.getByLabelText('WorldView globe')).toBeTruthy();
  });

  it('returns a read-only spatial action from the live mount to the waiting turn', async () => {
    directHost.executeAction.mockResolvedValueOnce({
      ok: true, action: 'get_current_view_state', camera: { longitude: -82.5, latitude: 35.15 },
    });
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ ok: true, capability: null }), { status: 200 });
      }
      return projectResponse('project-1');
    });
    render(<WorldViewSurface {...scope} />);
    await waitFor(() => expect(directHost.props).toBeTruthy());
    nativeReady();
    await waitFor(() => expect(actionStreams).toHaveLength(1));

    act(() => actionStreams[0].emit('action', {
      requestId: 'request-1', name: 'get_current_view_state', arguments: {},
      disabledLayerIds: ['satellites'],
    }));
    await waitFor(() => expect(directHost.executeAction).toHaveBeenCalledWith(
      'get_current_view_state', {},
      expect.objectContaining({ disabledLayerIds: ['satellites'], signal: expect.any(AbortSignal) }),
    ));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/worldview/projects/project-1/actions/result',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          cardId: 'card-worldview', requestId: 'request-1',
          result: {
            ok: true, action: 'get_current_view_state',
            camera: { longitude: -82.5, latitude: 35.15 },
          },
        }),
      }),
    ));
  });

  it('restores the Project choice if a Card layer action settles locally but its save fails', async () => {
    directHost.executeAction.mockResolvedValueOnce({
      ok: true, action: 'set_layer_visibility', layerId: 'earthquakes', enabled: false,
    });
    fetchMock.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => (
      init?.method === 'POST'
        ? new Response(JSON.stringify({ ok: false, error: 'project_worldview_write_failed' }), { status: 503 })
        : projectResponse('project-1')
    ));
    render(<WorldViewSurface {...scope} />);
    await waitFor(() => expect(directHost.props).toBeTruthy());
    nativeReady();
    await waitFor(() => expect(actionStreams).toHaveLength(1));
    act(() => actionStreams[0].emit('action', {
      requestId: 'request-layer-1', name: 'set_layer_visibility',
      arguments: { layerId: 'earthquakes', enabled: false }, disabledLayerIds: [],
    }));
    await waitFor(() => expect(directHost.setLayerVisibility)
      .toHaveBeenCalledWith('earthquakes', true, { origin: 'restore' }));
    openDataSources();
    expect(screen.getByText(/Could not save the layer choice/)).toBeTruthy();
  });
});
