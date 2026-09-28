// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GodsEyeSourceDescriptor } from '../../components/worldsignal/GodsEyeSurface';
import WorldViewSurface from './WorldViewSurface';

const directHost = vi.hoisted(() => ({
  props: null as Record<string, any> | null,
  setLayerVisibility: vi.fn(),
  focusSelection: vi.fn(),
}));

vi.mock('../../components/worldsignal/GodsEyeSurface', async () => {
  const React = await import('react');
  return {
    default: React.forwardRef((props: Record<string, any>, ref) => {
      React.useImperativeHandle(ref, () => ({
        setLayerVisibility: directHost.setLayerVisibility,
        focusSelection: directHost.focusSelection,
      }), []);
      React.useEffect(() => {
        directHost.props = props;
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
  fireEvent.click(screen.getByRole('button', { name: 'Open Data Sources' }));
}

function nativeReady(state = layerState) {
  act(() => {
    callbacks().onReady?.('0.1.0');
    callbacks().onNativeAgentState?.({ available: false, active: false });
    callbacks().onLayerStateChange?.(state);
  });
}

beforeEach(() => {
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

  it('keeps operational state in the peripheral Data Sources drawer', async () => {
    render(<WorldViewSurface {...scope} />);
    await waitFor(() => expect(directHost.props).toBeTruthy());

    expect(screen.getByLabelText('WorldView globe')).toBeTruthy();
    expect(document.querySelector('iframe')).toBeNull();
    expect(screen.queryByText(/Globe ready/)).toBeNull();
    expect(screen.queryByText(/layers on/)).toBeNull();
    expect(directHost.focusSelection).not.toHaveBeenCalled();

    openDataSources();
    await waitFor(() => expect(screen.getByText('Project WorldView: Ready')).toBeTruthy());
    expect(screen.getByText('WorldView runtime: Connecting')).toBeTruthy();
    expect(screen.getByText('Source state: Pending')).toBeTruthy();
    nativeReady();
    expect(screen.getByText('WorldView runtime: Ready · 0.1.0')).toBeTruthy();
    expect(screen.getByText('Source state: Ready')).toBeTruthy();
    expect(screen.getByText('1 layers on')).toBeTruthy();
    expect(screen.getByText('Voice control: Unavailable')).toBeTruthy();
    expect(screen.getByText(/Earthquakes · ON/)).toBeTruthy();
    expect(screen.getByText(/Not checked/)).toBeTruthy();
    expect(screen.queryByText(/Embed bridge/)).toBeNull();
    expect(screen.getAllByText('Data Sources')).toHaveLength(1);
  });

  it('uses saved Project ON/OFF while the native layer application settles', async () => {
    render(<WorldViewSurface {...scope} />);
    await waitFor(() => expect(directHost.props).toBeTruthy());
    nativeReady();
    openDataSources();
    await waitFor(() => expect(screen.getByText('Project WorldView: Ready')).toBeTruthy());

    const checkbox = screen.getByRole('checkbox', { name: /Earthquakes · ON/ }) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    fireEvent.click(checkbox);
    expect(screen.getByText('Saving Project setting…')).toBeTruthy();
    await waitFor(() => expect(directHost.setLayerVisibility)
      .toHaveBeenCalledExactlyOnceWith('earthquakes', false));
    const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(patchCall).toEqual([
      '/api/worldview/projects/project-1/capabilities/earthquakes',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ enabled: false }) }),
    ]);
    expect(fetchMock.mock.invocationCallOrder.at(-1))
      .toBeLessThan(directHost.setLayerVisibility.mock.invocationCallOrder[0]);
    expect(screen.getByText('Applying Project OFF to globe…')).toBeTruthy();
    expect(checkbox.checked).toBe(false);
    expect(checkbox.disabled).toBe(true);

    const stateOff = {
      ...layerState,
      enabledLayerIds: [],
      sources: [{ ...source, enabled: false }],
    };
    act(() => callbacks().onLayerStateChange?.(stateOff));
    const offCheckbox = screen.getByRole('checkbox', {
      name: /Earthquakes · OFF/,
    }) as HTMLInputElement;
    expect(offCheckbox.checked).toBe(false);
    expect(offCheckbox.disabled).toBe(true);

    act(() => callbacks().onCommandResult?.({
      schemaVersion: 'gev.direct.layer-visibility.result.v1',
      ...scope,
      requestId: 'layer-request-1',
      layerId: 'earthquakes',
      requestedEnabled: false,
      ok: true,
      error: null,
      state: stateOff,
    }));
    expect((screen.getByRole('checkbox', {
      name: /Earthquakes · OFF/,
    }) as HTMLInputElement).disabled).toBe(false);
    expect(directHost.setLayerVisibility).toHaveBeenCalledTimes(1);
  });

  it('keeps a saved ON source ON when its native feed cannot settle, then lets the user turn it OFF', async () => {
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

    const checkbox = await screen.findByRole('checkbox', { name: /Earthquakes · ON/ });
    expect((checkbox as HTMLInputElement).checked).toBe(true);
    expect((checkbox as HTMLInputElement).disabled).toBe(true);

    await waitFor(() => expect(directHost.setLayerVisibility)
      .toHaveBeenCalledWith('earthquakes', true));
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

    expect((screen.getByRole('checkbox', {
      name: /Earthquakes · ON/,
    }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', {
      name: /Earthquakes · ON/,
    }) as HTMLInputElement).disabled).toBe(false);
    expect(screen.getByText(/ON saved · globe layer: Layer did not settle/)).toBeTruthy();

    directHost.setLayerVisibility.mockClear().mockReturnValue('layer-request-2');
    fireEvent.click(screen.getByRole('checkbox', { name: /Earthquakes · ON/ }));
    await waitFor(() => expect(directHost.setLayerVisibility)
      .toHaveBeenCalledExactlyOnceWith('earthquakes', false));
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
    await waitFor(() => expect(screen.getByText('Project WorldView: Ready')).toBeTruthy());

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

  it('keeps unavailable sources user-controllable and clears native state on remount', async () => {
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
    await waitFor(() => expect(screen.getByText('Project WorldView: Ready')).toBeTruthy());

    const checkbox = screen.getByRole('checkbox', { name: /Earthquakes · OFF/ });
    expect((checkbox as HTMLInputElement).disabled).toBe(false);
    fireEvent.click(checkbox);
    await waitFor(() => expect(directHost.setLayerVisibility).toHaveBeenCalledExactlyOnceWith(
      'earthquakes',
      true,
      { exitIncompatibleContext: true },
    ));

    rerender(<WorldViewSurface projectId="project-2" cardId="card-worldview-2" />);
    await waitFor(() => expect(screen.getByText('WorldView runtime: Connecting')).toBeTruthy());
    expect(screen.getByText('Source state: Pending')).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
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
      .toHaveBeenCalledExactlyOnceWith('earthquakes', false));

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
      .toHaveBeenCalledExactlyOnceWith('earthquakes', true));
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
    await waitFor(() => expect(screen.getByText('Project WorldView: Ready')).toBeTruthy());
    fireEvent.click(screen.getByRole('checkbox', { name: /Earthquakes · ON/ }));

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
});
