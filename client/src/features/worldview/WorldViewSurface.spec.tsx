// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GodsEyeSourceDescriptor } from '../../components/worldsignal/GodsEyeSurface';
import WorldViewSurface from './WorldViewSurface';

const scope = { projectId: 'project-1', cardId: 'card-worldview' };
const origin = 'http://127.0.0.1:4174';
const source: GodsEyeSourceDescriptor = { id: 'earthquakes', name: 'Earthquakes', provider: 'USGS',
  enabled: true, lifecycleState: 'active', lifecycleUncertain: false,
  feedState: 'ready', available: null, loading: false, refreshing: false,
  count: 4, lastRefreshAt: '2026-09-27T00:00:00Z', error: null };
const layerState = { sourceStateReady: true, enabledLayerIds: ['earthquakes'],
  sourceClocks: { earthquakes: '2026-09-27T00:00:00Z' }, sources: [source] };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function dispatch(frame: HTMLIFrameElement, data: unknown) {
  fireEvent(window, new MessageEvent('message', {
    origin, source: frame.contentWindow, data,
  }));
}

function mount() {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  render(<WorldViewSurface {...scope} />);
  const frame = screen.getByTitle('God’s Eye WorldView globe') as HTMLIFrameElement;
  const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage');
  return { frame, postMessage, fetchMock };
}

function ready(frame: HTMLIFrameElement) {
  dispatch(frame, { schemaVersion: 'gev.embed.ready.v1', ...scope,
    sourceVersion: '0.1.0', agentRuntime: 'supervised',
    nativeAgentAvailable: false, nativeAgentActive: false });
}

function sourceReadback(frame: HTMLIFrameElement, state = layerState) {
  dispatch(frame, { schemaVersion: 'gev.embed.layer-state.v1', ...scope, state });
}

describe('WorldView native source presentation', () => {
  it('fails closed without a saved Card attachment', () => {
    render(<WorldViewSurface projectId="project-1" cardId={null} />);
    expect(screen.getByText('WorldView Card is not connected')).toBeTruthy();
    expect(screen.queryByTitle('God’s Eye WorldView globe')).toBeNull();
  });

  it('never fetches a Card Run or focuses automatically and shows distinct readiness', () => {
    const { frame, postMessage, fetchMock } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Data Sources' }));
    expect(screen.getByText('Embed bridge: Pending')).toBeTruthy();
    expect(screen.getByText('Source state: Pending')).toBeTruthy();
    ready(frame);
    expect(screen.getByText('Embed bridge: Ready')).toBeTruthy();
    expect(screen.getByText('Source state: Pending')).toBeTruthy();
    sourceReadback(frame);
    expect(screen.getByText('Source state: Ready')).toBeTruthy();
    expect(screen.getByText(/Earthquakes · ON/)).toBeTruthy();
    expect(screen.getByText(/Not checked/)).toBeTruthy();
    expect(screen.getByText(/native voice control missing/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ schemaVersion: 'gev.embed.focus.v1' }), expect.any(String));
    expect(screen.getAllByText('Data Sources')).toHaveLength(2);
  });

  it('does not optimistically change ON/OFF and clears pending on native readback', () => {
    const { frame, postMessage } = mount();
    ready(frame);
    sourceReadback(frame);
    fireEvent.click(screen.getByRole('button', { name: 'Data Sources' }));
    const checkbox = screen.getByRole('checkbox', { name: /Earthquakes · ON/ }) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    fireEvent.click(checkbox);
    const request = postMessage.mock.calls.find(([payload]) =>
      (payload as { schemaVersion?: string }).schemaVersion === 'gev.embed.layer-visibility.v1');
    expect(request?.[0]).toMatchObject({ schemaVersion: 'gev.embed.layer-visibility.v1',
      ...scope, layerId: 'earthquakes', enabled: false,
      requestId: expect.any(String) });
    expect(checkbox.checked).toBe(true);
    expect(checkbox.disabled).toBe(true);
    expect(screen.getByText(/Earthquakes · ON/)).toBeTruthy();
    const stateOff = { ...layerState, enabledLayerIds: [],
      sources: [{ ...source, enabled: false }] };
    // Manager snapshots are factual readback, but only the exact correlated
    // result may release this request's pending command lane.
    sourceReadback(frame, stateOff);
    expect((screen.getByRole('checkbox', { name: /Earthquakes · OFF/ }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole('checkbox', { name: /Earthquakes · OFF/ }) as HTMLInputElement).disabled).toBe(true);
    dispatch(frame, {
      schemaVersion: 'gev.embed.layer-visibility.result.v1',
      ...scope,
      requestId: (request?.[0] as { requestId: string }).requestId,
      layerId: 'earthquakes',
      requestedEnabled: false,
      ok: true,
      error: null,
      state: stateOff,
    });
    expect((screen.getByRole('checkbox', { name: /Earthquakes · OFF/ }) as HTMLInputElement).disabled).toBe(false);
    expect(postMessage.mock.calls.filter(([payload]) =>
      (payload as { schemaVersion?: string }).schemaVersion === 'gev.embed.layer-visibility.v1')).toHaveLength(1);
  });

  it('returns native selection and focuses exactly once after the explicit click', () => {
    const { frame, postMessage } = mount();
    ready(frame);
    sourceReadback(frame);
    dispatch(frame, { schemaVersion: 'gev.embed.selection.v1', ...scope,
      selection: { id: 'native-flight-1', type: 'flight', label: 'Flight 1',
        position: { longitude: -97, latitude: 30 } } });
    fireEvent.click(screen.getByRole('button', { name: 'Data Sources' }));
    expect(screen.getByText('Flight 1 · flight')).toBeTruthy();
    expect(postMessage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Focus' }));
    expect(postMessage).toHaveBeenCalledExactlyOnceWith({
      schemaVersion: 'gev.embed.focus.v1', ...scope,
      requestId: expect.any(String), targetId: 'native-flight-1',
      position: { longitude: -97, latitude: 30 },
    }, origin);
    ready(frame);
    expect(postMessage).toHaveBeenCalledTimes(1);
  });

  it('lets an unavailable or refreshing source be explicitly toggled and clears native state on reconnect', () => {
    const { frame, postMessage } = mount();
    ready(frame);
    sourceReadback(frame, {
      ...layerState,
      sources: [{ ...source, available: false, loading: true, refreshing: true }],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Data Sources' }));
    const checkbox = screen.getByRole('checkbox', { name: /Earthquakes · ON/ });
    expect((checkbox as HTMLInputElement).disabled).toBe(false);
    fireEvent.click(checkbox);
    expect(postMessage).toHaveBeenCalledTimes(1);
    dispatch(frame, { schemaVersion: 'gev.embed.bootstrap.v1' });
    expect(screen.getByText('Embed bridge: Pending')).toBeTruthy();
    expect(screen.getByText('Source state: Pending')).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(postMessage).toHaveBeenCalledTimes(2); // fresh host config only
  });
});
