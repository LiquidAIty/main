import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import {
  installHostBridge,
  projectSelection,
  projectSourceState,
  resolveEmbedMode,
  validFocusRequest,
  validHostConfig,
} from './hostBridge.js';

test('distribution startup seals native layers without deleting historical share tokens', async () => {
  const { DataLayerManager } = await import('../data/manager.js');
  const { LAYER_STATE_REGISTRY, decodeLayerStateParams } = await import('../data/layerState.js');
  const source = await readFile(new URL('../main.js', import.meta.url), 'utf8');
  const calls = [...source.matchAll(/^\s*dataManager\.finalizeRegistrations\([\s\S]*?\);/gm)];
  assert.equal(calls.length, 1, 'exercise the actual startup call, not a copied registry adapter');
  const available = LAYER_STATE_REGISTRY.filter((entry) => entry.id !== 'telegeography-submarine-cables');
  const dataManager = new DataLayerManager({});
  for (const entry of available) dataManager.register({ id: entry.id });
  runInNewContext(calls[0][0], { dataManager, LAYER_STATE_REGISTRY });
  assert.equal(dataManager.registrationsFinalized, true);

  const incompleteManager = new DataLayerManager({});
  for (const entry of available.filter((entry) => entry.id !== 'earthquakes')) {
    incompleteManager.register({ id: entry.id });
  }
  assert.throws(() => runInNewContext(calls[0][0], {
    dataManager: incompleteManager, LAYER_STATE_REGISTRY,
  }), /Layer serialization registry mismatch/);
  assert.deepEqual(decodeLayerStateParams(new URLSearchParams('v=2&l=u.e')).enabledLayerIds,
    ['earthquakes', 'telegeography-submarine-cables']);
});

test('embed mode requires supervised host ownership and a loopback origin', () => {
  assert.deepEqual(
    resolveEmbedMode('?embed=1&agentRuntime=supervised&hostOrigin=http%3A%2F%2Flocalhost%3A5173'),
    { enabled: true, hostOrigin: 'http://localhost:5173' },
  );
  assert.equal(resolveEmbedMode('?embed=1&agentRuntime=host').enabled, false);
  assert.equal(
    resolveEmbedMode('?embed=1&agentRuntime=supervised&hostOrigin=https%3A%2F%2Fexample.com').enabled,
    false,
  );
});

test('selection projection preserves only bounded source identity and real coordinates', () => {
  assert.deepEqual(projectSelection({
    id: 'flight-1',
    layerId: 'flights',
    callsign: 'SOURCE 1',
    longitude: -77.03,
    latitude: 38.9,
    updatedAt: Date.parse('2026-09-03T10:00:00Z'),
    entity: { circular: 'not copied' },
  }), {
    id: 'flight-1',
    type: 'flights',
    label: 'SOURCE 1',
    position: { longitude: -77.03, latitude: 38.9 },
    updatedAt: '2026-09-03T10:00:00.000Z',
  });
  assert.equal(projectSelection({ id: 'bad', layerId: 'flights', longitude: 220, latitude: 0 }).position, null);
});

test('host configuration preserves the native agent as explicitly user-initiated', () => {
  assert.equal(validHostConfig({
    schemaVersion: 'gev.embed.host-config.v1',
    projectId: 'project-1',
    cardId: 'card-worldview',
    parentRuntime: 'hermes',
    nativeAgentPolicy: 'user-initiated',
  }), true);
  assert.equal(validHostConfig({
    schemaVersion: 'gev.embed.host-config.v1',
    projectId: 'project-1',
    cardId: 'card-worldview',
    parentRuntime: 'unsupported',
    nativeAgentPolicy: 'always-on',
  }), false);
});

test('evidence flight requires a distinct request ID, target ID, Card scope, and real coordinates', () => {
  const config = {
    schemaVersion: 'gev.embed.host-config.v1',
    projectId: 'project-1',
    cardId: 'card-worldview',
    parentRuntime: 'hermes',
    nativeAgentPolicy: 'user-initiated',
  };
  assert.deepEqual(validFocusRequest({
    schemaVersion: 'gev.embed.focus.v1',
    projectId: 'project-1',
    cardId: 'card-worldview',
    requestId: 'focus-1',
    targetId: 'candidate-1',
    position: { longitude: -97.7431, latitude: 30.2672 },
  }, config), {
    requestId: 'focus-1',
    targetId: 'candidate-1',
    longitude: -97.7431,
    latitude: 30.2672,
  });
  assert.equal(validFocusRequest({
    schemaVersion: 'gev.embed.focus.v1',
    projectId: 'other-project',
    cardId: 'card-worldview',
    position: { longitude: -97.7431, latitude: 30.2672 },
  }, config), null);
  assert.equal(validFocusRequest({
    schemaVersion: 'gev.embed.focus.v1',
    projectId: 'project-1',
    cardId: 'card-worldview',
    requestId: 'focus-1',
    targetId: 'candidate-1',
    position: { longitude: 500, latitude: 30.2672 },
  }, config), null);
  assert.equal(validFocusRequest({
    schemaVersion: 'gev.embed.focus.v1',
    projectId: 'project-1',
    cardId: 'card-worldview',
    targetId: 'candidate-1',
    position: { longitude: -97.7431, latitude: 30.2672 },
  }, config), null);
});

function bridgeHarness({
  sourceStateReady = Promise.resolve(),
  dataManager = null,
  focusPosition = null,
} = {}) {
  const previousWindow = globalThis.window;
  const listeners = new Map();
  const posted = [];
  const parent = { postMessage(payload, origin) { posted.push({ payload, origin }); } };
  const fakeWindow = {
    parent,
    addEventListener(name, listener) {
      const entries = listeners.get(name) || new Set();
      entries.add(listener);
      listeners.set(name, entries);
    },
    removeEventListener(name, listener) { listeners.get(name)?.delete(listener); },
  };
  globalThis.window = fakeWindow;
  const manager = dataManager || {
    getAll: () => [], subscribe: () => () => {},
    getLayerLifecycleState: () => null, setEnabled: async () => false,
  };
  let focusCount = 0;
  const bridge = installHostBridge({
    dataManager: manager,
    sourceStateReady,
    voiceCommands: null,
    mode: { enabled: true, hostOrigin: 'http://localhost:5173' },
    focusPosition: (request) => {
      focusCount += 1;
      return focusPosition?.(request);
    },
    projectCartesianPosition: (position) => position?.x === 1
      ? { longitude: -77, latitude: 38 } : null,
  });
  const send = (payload, { origin = 'http://localhost:5173', source = parent } = {}) => {
    for (const listener of listeners.get('message') || []) listener({ data: payload, origin, source });
  };
  const emit = (name, detail = null) => {
    for (const listener of listeners.get(name) || []) listener({ detail });
  };
  const config = {
    schemaVersion: 'gev.embed.host-config.v1', projectId: 'project-1', cardId: 'card-1',
    parentRuntime: 'hermes', nativeAgentPolicy: 'user-initiated',
  };
  return {
    posted, send, emit, config, manager, bridge,
    focusCount: () => focusCount,
    close() { bridge.destroy(); globalThis.window = previousWindow; },
  };
}

test('native visible rows serialize from manager state, including Set-derived enabled IDs and unknown clocks', async () => {
  const { DataLayerManager } = await import('../data/manager.js');
  const manager = new DataLayerManager({});
  manager.register({ id: 'flights', name: 'Flights', source: 'ADS-B', icon: '', getStats() {
    return { count: 7, lastUpdate: 1_700_000_000_000, available: true };
  } });
  manager.register({ id: 'hidden', name: 'Hidden', source: 'native', showInTogglePanel: false });
  const entry = manager.layers.get('flights');
  entry.initialized = true;
  entry.enabled = true;
  entry.lifecycleState = 'enabled';
  const state = projectSourceState(manager, true);
  assert.deepEqual(state.enabledLayerIds, ['flights']);
  assert.equal(Array.isArray(state.enabledLayerIds), true);
  assert.equal(state.sources.length, 1);
  assert.deepEqual(state.sources[0], {
    id: 'flights', name: 'Flights', provider: 'ADS-B', enabled: true,
    lifecycleState: 'enabled', lifecycleUncertain: false, feedState: 'nominal',
    available: true, loading: false, refreshing: false, count: 7,
    lastRefreshAt: '2023-11-14T22:13:20.000Z', error: null,
  });
  assert.deepEqual(state.sourceClocks, { flights: '2023-11-14T22:13:20.000Z' });
  entry.module.getStats = () => ({ count: 0, lastUpdate: null });
  assert.equal(projectSourceState(manager).sources[0].available, null);
  assert.equal(projectSourceState(manager).sources[0].lastRefreshAt, null);
  assert.deepEqual(projectSourceState(manager).sourceClocks, {});
});

test('bootstrap survives early host config, then bridge and source readiness stay distinct', async () => {
  let settleSources;
  const pending = new Promise((resolve) => { settleSources = resolve; });
  let enabled = false;
  let setCalls = 0;
  const manager = {
    getAll: () => [{ id: 'flights', name: 'Flights', source: 'ADS-B', showInTogglePanel: true, enabled,
      lifecycleState: enabled ? 'enabled' : 'disabled', lifecycleUncertain: false, stats: {} }],
    subscribe: () => () => {},
    getLayerLifecycleState: () => ({ enabled, lifecycleState: enabled ? 'enabled' : 'disabled', uncertain: false }),
    async setEnabled(_id, value) { setCalls += 1; enabled = value; return true; },
  };
  const h = bridgeHarness({ sourceStateReady: pending, dataManager: manager });
  try {
    assert.deepEqual(h.posted[0], {
      payload: { schemaVersion: 'gev.embed.bootstrap.v1' }, origin: 'http://localhost:5173',
    });
    h.send(h.config);
    assert.equal(h.posted.find((item) => item.payload.schemaVersion === 'gev.embed.ready.v1')?.payload.projectId, 'project-1');
    assert.equal(h.posted.find((item) => item.payload.schemaVersion === 'gev.embed.layer-state.v1')?.payload.state.sourceStateReady, false);
    h.send({ schemaVersion: 'gev.embed.layer-visibility.v1', projectId: 'project-1', cardId: 'card-1',
      requestId: 'early-visibility', layerId: 'flights', enabled: true });
    await Promise.resolve();
    assert.equal(setCalls, 0, 'native visibility waits for source-state settlement');
    settleSources();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(setCalls, 1);
    assert.equal(h.posted.filter((item) => item.payload.schemaVersion === 'gev.embed.layer-state.v1').at(-1).payload.state.sourceStateReady, true);
  } finally { h.close(); }
});

test('scoped visible layer command uses native setEnabled and returns fresh readback', async () => {
  let enabled = false;
  const calls = [];
  const manager = {
    getAll: () => [
      { id: 'flights', name: 'Flights', source: 'ADS-B', showInTogglePanel: true, enabled, lifecycleState: enabled ? 'enabled' : 'disabled', lifecycleUncertain: false, stats: { count: 0, lastUpdate: null } },
      { id: 'private', name: 'Private', showInTogglePanel: false, enabled: false, stats: {} },
    ],
    subscribe: () => () => {},
    getLayerLifecycleState: () => ({ enabled, lifecycleState: enabled ? 'enabled' : 'disabled', uncertain: false }),
    async setEnabled(id, value, options) { calls.push([id, value, options]); enabled = value; return true; },
  };
  const h = bridgeHarness({ dataManager: manager });
  try {
    h.send(h.config);
    h.send({ schemaVersion: 'gev.embed.layer-visibility.v1', projectId: 'other', cardId: 'card-1', requestId: 'a', layerId: 'flights', enabled: true });
    h.send({ schemaVersion: 'gev.embed.layer-visibility.v1', projectId: 'project-1', cardId: 'card-1', requestId: 'b', layerId: 'private', enabled: true });
    h.send({ schemaVersion: 'gev.embed.layer-visibility.v1', projectId: 'project-1', cardId: 'card-1', requestId: 'c', layerId: 'flights', enabled: true });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(calls, [['flights', true, { origin: 'user' }]]);
    const results = h.posted.filter((item) => item.payload.schemaVersion === 'gev.embed.layer-visibility.result.v1').map((item) => item.payload);
    assert.equal(results.length, 2);
    assert.equal(results[0].ok, false);
    assert.equal(results[1].ok, true);
    assert.deepEqual(results[1].state.enabledLayerIds, ['flights']);
    assert.equal(results[1].projectId, 'project-1');
  } finally { h.close(); }
});

test('focus is consumed exactly once, rejects foreign scope, and projects/clears awareness selection', async () => {
  const h = bridgeHarness();
  try {
    h.send(h.config);
    const focus = { schemaVersion: 'gev.embed.focus.v1', projectId: 'project-1', cardId: 'card-1', requestId: 'focus-1', targetId: 'flight-1', position: { longitude: -77, latitude: 38 } };
    h.send({ ...focus, projectId: 'other' });
    h.send(focus);
    h.send(focus);
    await Promise.resolve();
    assert.equal(h.focusCount(), 1);
    const results = h.posted.filter((item) => item.payload.schemaVersion === 'gev.embed.focus.result.v1').map((item) => item.payload);
    assert.equal(results.length, 2);
    assert.equal(results.find((item) => item.ok)?.targetId, 'flight-1');
    assert.match(results.find((item) => !item.ok)?.error, /consumed/);
    h.emit('gev:awareness-subject-selected', { id: 'flight-1', layerId: 'flights', label: 'A1', position: { x: 1 } });
    assert.deepEqual(h.posted.at(-1).payload.selection.position, { longitude: -77, latitude: 38 });
    h.emit('gev:awareness-subject-cleared');
    assert.equal(h.posted.at(-1).payload.selection, null);
  } finally { h.close(); }
});

test('focus acknowledgement waits for the camera flight and reports cancellation honestly', async () => {
  let finishFlight;
  const flight = new Promise((resolve, reject) => { finishFlight = { resolve, reject }; });
  const h = bridgeHarness({ focusPosition: () => flight });
  try {
    h.send(h.config);
    h.send({ schemaVersion: 'gev.embed.focus.v1', projectId: 'project-1', cardId: 'card-1',
      requestId: 'focus-delayed', targetId: 'flight-1',
      position: { longitude: -77, latitude: 38 } });
    await Promise.resolve();
    assert.equal(h.posted.some((item) => item.payload.schemaVersion === 'gev.embed.focus.result.v1'), false);
    finishFlight.reject(new Error('Focus flight cancelled'));
    await new Promise((resolve) => setImmediate(resolve));
    const result = h.posted.find((item) => item.payload.schemaVersion === 'gev.embed.focus.result.v1')?.payload;
    assert.equal(result?.ok, false);
    assert.match(result?.error, /cancelled/);
  } finally { h.close(); }
});
