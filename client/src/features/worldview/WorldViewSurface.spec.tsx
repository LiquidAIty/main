// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GodsEyeSourceDescriptor } from '../../components/worldsignal/GodsEyeSurface';
import WorldViewSurface from './WorldViewSurface';

const directHost = vi.hoisted(() => ({
  props: null as Record<string, any> | null,
  setLayerVisibility: vi.fn(),
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
        setLayerVisibility: directHost.setLayerVisibility,
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

const scope = { projectId: 'project-1', cardId: 'card-worldview' };
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
  fireEvent.click(screen.getByRole('button', { name: 'Open inspector' }));
}

function nativeReady(state = layerState) {
  act(() => {
    callbacks().onReady?.('0.1.0');
    callbacks().onLayerStateChange?.(state);
  });
}

beforeEach(() => {
  actionStreams.length = 0;
  vi.stubGlobal('EventSource', TestActionStream);
  directHost.props = null;
  directHost.setLayerVisibility.mockReset().mockReturnValue('layer-request-1');
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
        mainReason: null,
        updatedAt: '2026-09-27T00:00:00.000Z',
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('WorldView direct source presentation', () => {
  it('fails closed without a saved Card attachment', () => {
    render(<WorldViewSurface projectId="project-1" cardId={null} />);
    expect(screen.getByText('WorldView Card is not connected')).toBeTruthy();
    expect(screen.queryByLabelText('WorldView globe')).toBeNull();
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('keeps God’s Eye controls on the globe without a duplicate React layer switch', async () => {
    render(<WorldViewSurface {...scope} />);
    await waitFor(() => expect(directHost.props).toBeTruthy());

    expect(screen.getByLabelText('WorldView globe')).toBeTruthy();
    expect(document.querySelector('iframe')).toBeNull();
    expect(screen.queryByText(/Globe ready/)).toBeNull();
    expect(screen.queryByText(/layers on/)).toBeNull();
    expect(directHost.focusSelection).not.toHaveBeenCalled();

    openDataSources();
    expect(screen.getByText('No selection.')).toBeTruthy();
    nativeReady();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByText('Data Sources')).toBeNull();
    expect(callbacks().onLayerVisibilityChange).toBeTypeOf('function');
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

  it('keeps saved ON distinct from a failed native feed, then accepts the native OFF control', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if ((init?.method || 'GET') === 'GET') {
        return projectResponse('project-1', [{
          capabilityId: 'earthquakes',
          enabled: true,
          controlledBy: 'user',
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
      .toHaveBeenCalledWith('earthquakes', true, { origin: 'programmatic' }));
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
    expect(screen.queryByRole('checkbox')).toBeNull();
    act(() => callbacks().onSelectionChange?.({
      id: 'selected-1', type: 'satellite', label: 'Satellite 1',
      position: { longitude: -97, latitude: 30 },
    }));
    expect(screen.getByText('Satellite 1 · satellite')).toBeTruthy();

    rerender(<WorldViewSurface projectId="project-2" cardId="card-worldview-2" />);
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
        mainReason: null,
        updatedAt: '2026-09-27T00:00:00.000Z',
      }, {
        capabilityId: 'Earthquakes',
        enabled: false,
        controlledBy: 'main',
        mainReason: 'Label-shaped ID must not match.',
        updatedAt: '2026-09-27T00:00:00.000Z',
      }] : [{
        capabilityId: 'earthquakes',
        enabled: true,
        controlledBy: 'user',
        mainReason: null,
        updatedAt: '2026-09-27T00:00:01.000Z',
      }]);
    });
    const { rerender } = render(<WorldViewSurface {...scope} />);
    await waitFor(() => expect(directHost.props).toBeTruthy());
    nativeReady();
    await waitFor(() => expect(directHost.setLayerVisibility)
      .toHaveBeenCalledExactlyOnceWith('earthquakes', false, { origin: 'programmatic' }));

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
    rerender(<WorldViewSurface projectId="project-2" cardId="card-worldview-2" />);
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
      .toHaveBeenCalledExactlyOnceWith('earthquakes', true, { origin: 'programmatic' }));
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
});
