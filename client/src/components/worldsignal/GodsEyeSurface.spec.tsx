// @vitest-environment jsdom

import { createRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import GodsEyeSurface, {
  type GodsEyeBridge,
  parseGodsEyeHostMessage,
  resolveGodsEyeEmbedUrl,
} from './GodsEyeSurface';

const scope = { projectId: 'project-1', cardId: 'card-worldview' };
const origin = 'http://127.0.0.1:4174';
afterEach(cleanup);
const sourceState = {
  sourceStateReady: true,
  enabledLayerIds: ['earthquakes'],
  sourceClocks: { earthquakes: '2026-09-27T00:00:00Z' },
  sources: [{
    id: 'earthquakes', name: 'Earthquakes', provider: 'USGS', enabled: true,
    lifecycleState: 'active', lifecycleUncertain: false, feedState: 'ready',
    available: null, loading: false, refreshing: false, count: 4,
    lastRefreshAt: '2026-09-27T00:00:00Z', error: null,
  }],
};

function dispatch(frame: HTMLIFrameElement, data: unknown, eventOrigin = origin) {
  fireEvent(window, new MessageEvent('message', {
    origin: eventOrigin, source: frame.contentWindow, data,
  }));
}

function mount() {
  const ref = createRef<GodsEyeBridge>();
  const onLayerStateChange = vi.fn();
  const onSelectionChange = vi.fn();
  const onCommandResult = vi.fn();
  const onBridgeUnavailable = vi.fn();
  render(<GodsEyeSurface ref={ref} embedUrl={origin} {...scope}
    onLayerStateChange={onLayerStateChange} onSelectionChange={onSelectionChange}
    onCommandResult={onCommandResult} onBridgeUnavailable={onBridgeUnavailable} />);
  const frame = screen.getByTitle('God’s Eye WorldView globe') as HTMLIFrameElement;
  const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage');
  return { ref, frame, postMessage, onLayerStateChange, onSelectionChange,
    onCommandResult, onBridgeUnavailable };
}

describe('GodsEyeSurface supervised host boundary', () => {
  it('accepts only a distinct loopback origin and pins supervised query state', () => {
    const url = resolveGodsEyeEmbedUrl(`${origin}/globe?theme=dark`, 'http://localhost:5173');
    expect(url.searchParams.get('theme')).toBe('dark');
    expect(url.searchParams.get('embed')).toBe('1');
    expect(url.searchParams.get('agentRuntime')).toBe('supervised');
    expect(url.searchParams.get('hostOrigin')).toBe('http://localhost:5173');
    expect(() => resolveGodsEyeEmbedUrl('https://example.com', 'http://localhost:5173'))
      .toThrow('gods_eye_embed_must_be_loopback');
    expect(() => resolveGodsEyeEmbedUrl('http://localhost:5173/globe', 'http://localhost:5173'))
      .toThrow('gods_eye_embed_requires_isolated_origin');
  });

  it('validates scoped source readback and nullable availability', () => {
    expect(parseGodsEyeHostMessage({ schemaVersion: 'gev.embed.layer-state.v1', ...scope,
      state: sourceState })).toEqual({ schemaVersion: 'gev.embed.layer-state.v1', ...scope,
      state: sourceState });
    expect(parseGodsEyeHostMessage({ schemaVersion: 'gev.embed.layer-state.v1', ...scope,
      state: { ...sourceState, sources: [{ ...sourceState.sources[0], available: 'yes' }] } })).toBeNull();
    expect(parseGodsEyeHostMessage({ schemaVersion: 'gev.embed.selection.v1', ...scope,
      selection: { id: 'bad', type: 'flight', label: 'Bad',
        position: { longitude: 240, latitude: 40 } } })).toBeNull();
  });

  it('renders an honest unavailable state without an upstream embed URL', () => {
    render(<GodsEyeSurface embedUrl={null} {...scope} />);
    expect(screen.getByRole('heading', { name: 'God’s Eye embed unavailable' })).toBeTruthy();
    expect(screen.queryByTitle('God’s Eye WorldView globe')).toBeNull();
  });

  it('sends no command before readiness, requires explicit calls, and never replays them', () => {
    const { ref, frame, postMessage } = mount();
    expect(ref.current?.setLayerVisibility('earthquakes', false)).toBeNull();
    expect(ref.current?.focusSelection({ id: 'native-1', type: 'flight', label: 'Flight',
      position: { longitude: -97, latitude: 30 } })).toBeNull();
    expect(postMessage).not.toHaveBeenCalled();
    dispatch(frame, { schemaVersion: 'gev.embed.bootstrap.v1' });
    expect(postMessage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      schemaVersion: 'gev.embed.host-config.v1', ...scope,
    }), origin);
    dispatch(frame, { schemaVersion: 'gev.embed.ready.v1', ...scope,
      sourceVersion: '0.1.0', agentRuntime: 'supervised',
      nativeAgentAvailable: true, nativeAgentActive: false });
    expect(postMessage).toHaveBeenCalledTimes(1);

    const layerRequest = ref.current?.setLayerVisibility('earthquakes', false);
    const focusRequest = ref.current?.focusSelection({ id: 'native-1', type: 'flight', label: 'Flight',
      position: { longitude: -97, latitude: 30 } });
    expect(layerRequest).toBeTruthy();
    expect(focusRequest).toBeTruthy();
    expect(layerRequest).not.toBe(focusRequest);
    expect(postMessage).toHaveBeenCalledWith({
      schemaVersion: 'gev.embed.layer-visibility.v1', ...scope,
      requestId: layerRequest, layerId: 'earthquakes', enabled: false,
    }, origin);
    expect(postMessage).toHaveBeenCalledWith({
      schemaVersion: 'gev.embed.focus.v1', ...scope, requestId: focusRequest,
      targetId: 'native-1', position: { longitude: -97, latitude: 30 },
    }, origin);
    const calls = postMessage.mock.calls.length;
    dispatch(frame, { schemaVersion: 'gev.embed.ready.v1', ...scope,
      sourceVersion: '0.1.0', agentRuntime: 'supervised',
      nativeAgentAvailable: true, nativeAgentActive: false });
    expect(postMessage).toHaveBeenCalledTimes(calls);
    dispatch(frame, { schemaVersion: 'gev.embed.bootstrap.v1' });
    expect(postMessage).toHaveBeenCalledTimes(calls + 1);
    expect(ref.current?.setLayerVisibility('earthquakes', true)).toBeNull();
  });

  it('accepts only native scoped messages and correlated command results', () => {
    const { ref, frame, onLayerStateChange, onSelectionChange, onCommandResult } = mount();
    dispatch(frame, { schemaVersion: 'gev.embed.ready.v1', ...scope,
      sourceVersion: '0.1.0', agentRuntime: 'supervised',
      nativeAgentAvailable: true, nativeAgentActive: false });
    dispatch(frame, { schemaVersion: 'gev.embed.layer-state.v1', ...scope,
      state: sourceState }, 'http://localhost:9999');
    dispatch(frame, { schemaVersion: 'gev.embed.layer-state.v1',
      projectId: 'other', cardId: scope.cardId, state: sourceState });
    expect(onLayerStateChange).not.toHaveBeenCalled();
    dispatch(frame, { schemaVersion: 'gev.embed.layer-state.v1', ...scope, state: sourceState });
    expect(onLayerStateChange).toHaveBeenCalledExactlyOnceWith(sourceState);
    dispatch(frame, { schemaVersion: 'gev.embed.selection.v1', ...scope,
      selection: { id: 'native-1', type: 'flight', label: 'Flight', position: null } });
    expect(onSelectionChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'native-1' }));

    const requestId = ref.current?.setLayerVisibility('earthquakes', false);
    const result = { schemaVersion: 'gev.embed.layer-visibility.result.v1', ...scope,
      requestId, layerId: 'earthquakes', requestedEnabled: false,
      ok: true, error: null, state: { ...sourceState, enabledLayerIds: [],
        sources: [{ ...sourceState.sources[0], enabled: false }] } };
    dispatch(frame, { ...result, requestId: 'unknown' });
    dispatch(frame, { ...result, layerId: 'wrong-layer' });
    dispatch(frame, { ...result, requestedEnabled: true });
    expect(onCommandResult).not.toHaveBeenCalled();
    dispatch(frame, result);
    expect(onCommandResult).toHaveBeenCalledExactlyOnceWith(result);
    expect(onLayerStateChange).toHaveBeenLastCalledWith(result.state);
    dispatch(frame, result);
    expect(onCommandResult).toHaveBeenCalledTimes(1);
  });

  it('remounts the native bridge and completes a fresh handshake when Project/Card scope changes', () => {
    const ref = createRef<GodsEyeBridge>();
    const onReady = vi.fn();
    const { rerender } = render(
      <GodsEyeSurface ref={ref} embedUrl={origin} {...scope} onReady={onReady} />,
    );
    const firstFrame = screen.getByTitle('God’s Eye WorldView globe') as HTMLIFrameElement;
    dispatch(firstFrame, { schemaVersion: 'gev.embed.ready.v1', ...scope,
      sourceVersion: '0.1.0', agentRuntime: 'supervised',
      nativeAgentAvailable: true, nativeAgentActive: false });
    expect(onReady).toHaveBeenCalledTimes(1);

    const nextScope = { projectId: 'project-2', cardId: 'card-worldview-2' };
    rerender(<GodsEyeSurface ref={ref} embedUrl={origin} {...nextScope} onReady={onReady} />);
    const secondFrame = screen.getByTitle('God’s Eye WorldView globe') as HTMLIFrameElement;
    expect(secondFrame).not.toBe(firstFrame);
    const postMessage = vi.spyOn(secondFrame.contentWindow!, 'postMessage');
    dispatch(secondFrame, { schemaVersion: 'gev.embed.bootstrap.v1' });
    expect(postMessage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      schemaVersion: 'gev.embed.host-config.v1', ...nextScope,
    }), origin);
    dispatch(secondFrame, { schemaVersion: 'gev.embed.ready.v1', ...nextScope,
      sourceVersion: '0.1.0', agentRuntime: 'supervised',
      nativeAgentAvailable: true, nativeAgentActive: false });
    expect(onReady).toHaveBeenCalledTimes(2);
    expect(ref.current?.setLayerVisibility('earthquakes', true)).toBeTruthy();
    expect(postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      schemaVersion: 'gev.embed.layer-visibility.v1', ...nextScope,
    }), origin);
  });
});
