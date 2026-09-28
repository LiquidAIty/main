import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import {
  createDirectHostBridge,
  projectSelection,
  projectSourceState,
} from './directBridge.js';

test('distribution startup seals native layers without deleting historical share tokens', async () => {
  const { DataLayerManager } = await import('../data/manager.js');
  const { LAYER_STATE_REGISTRY, decodeLayerStateParams } = await import('../data/layerState.js');
  const source = await readFile(new URL('./directApplication.js', import.meta.url), 'utf8');
  const calls = [...source.matchAll(/^\s*dataManager\.finalizeRegistrations\([\s\S]*?\);/gm)];
  assert.equal(calls.length, 1, 'exercise the native startup registry seal');
  const available = LAYER_STATE_REGISTRY.filter(
    (entry) => entry.id !== 'telegeography-submarine-cables',
  );
  const manager = new DataLayerManager({});
  for (const entry of available) manager.register({ id: entry.id });
  runInNewContext(calls[0][0], { dataManager: manager, LAYER_STATE_REGISTRY });
  assert.equal(manager.registrationsFinalized, true);

  const incomplete = new DataLayerManager({});
  for (const entry of available.filter((entry) => entry.id !== 'earthquakes')) {
    incomplete.register({ id: entry.id });
  }
  assert.throws(() => runInNewContext(calls[0][0], {
    dataManager: incomplete,
    LAYER_STATE_REGISTRY,
  }), /Layer serialization registry mismatch/);
  assert.deepEqual(
    decodeLayerStateParams(new URLSearchParams('v=2&l=u.e')).enabledLayerIds,
    ['earthquakes', 'telegeography-submarine-cables'],
  );
});

test('selection projection preserves bounded native identity and real coordinates', () => {
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
  assert.equal(
    projectSelection({ id: 'bad', layerId: 'flights', longitude: 220, latitude: 0 }).position,
    null,
  );
});

test('visible native rows project exact state, clocks, and availability', async () => {
  const { DataLayerManager } = await import('../data/manager.js');
  const manager = new DataLayerManager({});
  manager.register({
    id: 'flights', name: 'Flights', source: 'ADS-B', icon: '',
    getStats: () => ({ count: 7, lastUpdate: 1_700_000_000_000, available: true }),
  });
  manager.register({ id: 'hidden', name: 'Hidden', source: 'native', showInTogglePanel: false });
  const entry = manager.layers.get('flights');
  entry.initialized = true;
  entry.enabled = true;
  entry.lifecycleState = 'enabled';
  const state = projectSourceState(manager, true);
  assert.deepEqual(state.enabledLayerIds, ['flights']);
  assert.equal(state.sources.length, 1);
  assert.deepEqual(state.sources[0], {
    id: 'flights', name: 'Flights', provider: 'ADS-B', enabled: true,
    lifecycleState: 'enabled', lifecycleUncertain: false, feedState: 'nominal',
    available: true, loading: false, refreshing: false, count: 7,
    lastRefreshAt: '2023-11-14T22:13:20.000Z', error: null,
  });
  assert.deepEqual(state.sourceClocks, { flights: '2023-11-14T22:13:20.000Z' });
});

function bridgeHarness({
  sourceStateReady = Promise.resolve(),
  dataManager = null,
  contextController = null,
  focusPosition = async () => {},
} = {}) {
  const previousWindow = globalThis.window;
  const listeners = new Map();
  globalThis.window = {
    addEventListener(name, listener) {
      const bucket = listeners.get(name) || new Set();
      bucket.add(listener);
      listeners.set(name, bucket);
    },
    removeEventListener(name, listener) { listeners.get(name)?.delete(listener); },
  };
  const manager = dataManager || {
    getAll: () => [],
    subscribe: () => () => {},
    getLayerLifecycleState: () => null,
    setEnabled: async () => false,
  };
  const events = { ready: [], agents: [], layers: [], selections: [], results: [] };
  const bridge = createDirectHostBridge({
    dataManager: manager,
    contextController,
    sourceStateReady,
    voiceCommands: null,
    projectId: 'project-1',
    cardId: 'card-1',
    focusPosition,
    projectCartesianPosition: (position) => position?.x === 1
      ? { longitude: -77, latitude: 38 }
      : null,
    callbacks: {
      onReady: (value) => events.ready.push(value),
      onNativeAgentState: (value) => events.agents.push(value),
      onLayerStateChange: (value) => events.layers.push(value),
      onSelectionChange: (value) => events.selections.push(value),
      onCommandResult: (value) => events.results.push(value),
    },
  });
  return {
    bridge,
    events,
    emit(name, detail = null) {
      for (const listener of listeners.get(name) || []) listener({ detail });
    },
    close() {
      bridge.destroy();
      globalThis.window = previousWindow;
    },
  };
}

test('direct readiness and source readiness remain distinct', async () => {
  let settleSources;
  const sourcePromise = new Promise((resolve) => { settleSources = resolve; });
  const manager = {
    getAll: () => [],
    subscribe: () => () => {},
  };
  const h = bridgeHarness({ sourceStateReady: sourcePromise, dataManager: manager });
  try {
    await Promise.resolve();
    assert.deepEqual(h.events.ready, ['0.1.1']);
    assert.equal(h.events.layers.at(-1).sourceStateReady, false);
    settleSources();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(h.events.layers.at(-1).sourceStateReady, true);
  } finally { h.close(); }
});

test('direct layer command waits for source settlement and returns native readback', async () => {
  let settleSources;
  const sourcePromise = new Promise((resolve) => { settleSources = resolve; });
  let enabled = false;
  const calls = [];
  const manager = {
    getAll: () => [{
      id: 'flights', name: 'Flights', source: 'ADS-B', showInTogglePanel: true,
      enabled, lifecycleState: enabled ? 'enabled' : 'disabled',
      lifecycleUncertain: false, stats: {},
    }],
    subscribe: () => () => {},
    getLayerLifecycleState: () => ({
      enabled, lifecycleState: enabled ? 'enabled' : 'disabled', uncertain: false,
    }),
    async setEnabled(id, value, options) {
      calls.push([id, value, options]);
      enabled = value;
      return true;
    },
  };
  const h = bridgeHarness({ sourceStateReady: sourcePromise, dataManager: manager });
  try {
    const requestId = h.bridge.setLayerVisibility('flights', true);
    assert.ok(requestId);
    await Promise.resolve();
    assert.equal(calls.length, 0);
    settleSources();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(calls, [['flights', true, { origin: 'user' }]]);
    const result = h.events.results.at(-1);
    assert.equal(result.schemaVersion, 'gev.direct.layer-visibility.result.v1');
    assert.equal(result.requestId, requestId);
    assert.equal(result.ok, true);
    assert.deepEqual(result.state.enabledLayerIds, ['flights']);
  } finally { h.close(); }
});

test('direct focus waits for camera completion and reports cancellation honestly', async () => {
  let rejectFlight;
  const flight = new Promise((_resolve, reject) => { rejectFlight = reject; });
  const h = bridgeHarness({ focusPosition: () => flight });
  try {
    const requestId = h.bridge.focusSelection({
      id: 'flight-1', position: { longitude: -77, latitude: 38 },
    });
    assert.ok(requestId);
    await Promise.resolve();
    assert.equal(h.events.results.length, 0);
    rejectFlight(new Error('Focus flight cancelled'));
    await new Promise((resolve) => setImmediate(resolve));
    const result = h.events.results.at(-1);
    assert.equal(result.schemaVersion, 'gev.direct.focus.result.v1');
    assert.equal(result.ok, false);
    assert.match(result.error, /cancelled/);
  } finally { h.close(); }
});

test('native selection events project and clear through direct callbacks', async () => {
  const h = bridgeHarness();
  try {
    h.emit('gev:entity-selected', {
      id: 'native-1', layerId: 'flights', label: 'Flight', position: { x: 1 },
    });
    assert.deepEqual(h.events.selections.at(-1), {
      id: 'native-1', type: 'flights', label: 'Flight',
      position: { longitude: -77, latitude: 38 }, updatedAt: null,
    });
    h.emit('gev:entity-selection-cleared');
    assert.equal(h.events.selections.at(-1), null);
  } finally { h.close(); }
});

test('Project source enable exits incompatible Context only when explicitly requested', async () => {
  let enabled = false;
  let contextMode = 'space-missions';
  const calls = [];
  const manager = {
    getAll: () => [{
      id: 'earthquakes', name: 'Earthquakes', source: 'USGS', showInTogglePanel: true,
      enabled, lifecycleState: enabled ? 'enabled' : 'disabled',
      lifecycleUncertain: false, stats: { available: true },
    }],
    subscribe: () => () => {},
    getLayerLifecycleState: () => ({
      enabled, lifecycleState: enabled ? 'enabled' : 'disabled', uncertain: false,
    }),
    async setEnabled(id, value, options) {
      calls.push([id, value, options]);
      enabled = value;
      return true;
    },
  };
  const contextController = {
    getContextModeState: () => ({ mode: contextMode }),
    async setContextMode(mode) {
      assert.equal(mode, 'off');
      contextMode = null;
      return { ok: true, mode: null };
    },
  };
  const h = bridgeHarness({ dataManager: manager, contextController });
  try {
    h.bridge.setLayerVisibility('earthquakes', true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(h.events.results.at(-1).ok, false);
    assert.match(h.events.results.at(-1).error, /Space Missions isolates replay data/);
    assert.deepEqual(calls, []);

    h.bridge.setLayerVisibility('earthquakes', true, { exitIncompatibleContext: true });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(h.events.results.at(-1).ok, true);
    assert.deepEqual(calls, [['earthquakes', true, { origin: 'user' }]]);
    assert.equal(contextMode, null);
  } finally { h.close(); }
});

test('direct mount keeps native controls and removes the iframe protocol', async () => {
  const [css, application, mount, bridge] = await Promise.all([
    readFile(new URL('../../style.css', import.meta.url), 'utf8'),
    readFile(new URL('./directApplication.js', import.meta.url), 'utf8'),
    readFile(new URL('./mount.js', import.meta.url), 'utf8'),
    readFile(new URL('./directBridge.js', import.meta.url), 'utf8'),
  ]);
  assert.match(css, /html\.supervised-embed #title-bar/);
  assert.match(application, /dataManager\.buildTogglePanel\(requiredElement\(root, '#data-toggles'\)\)/);
  assert.match(application, /initGevVoiceCommands\(\{/);
  assert.match(application, /createDirectHostBridge\(\{/);
  assert.match(mount, /createWorldViewApplication\(\{/);
  assert.doesNotMatch(mount, /iframe|postMessage/);
  assert.doesNotMatch(bridge, /postMessage|window\.parent/);
});

test('supervised startup restores shared camera state and otherwise stays neutral', async () => {
  const [application, ui] = await Promise.all([
    readFile(new URL('./directApplication.js', import.meta.url), 'utf8'),
    readFile(new URL('../ui.js', import.meta.url), 'utf8'),
  ]);
  assert.match(
    application,
    /if \(styleManager\.hasShareState\)[\s\S]*?Restoring shared view[\s\S]*?else if \(supervised\)[\s\S]*?WorldView ready\.[\s\S]*?else \{[\s\S]*?flyToAustin\(viewer\)/,
  );
  assert.match(ui, /this\._initialShareState = this\.shareLinkManager\.parseInitialHash\(\);/);
  assert.doesNotMatch(ui, /this\._initialShareState = this\._supervisedEmbed \? null/);
});

test('user-facing and model-facing presentation uses the WorldView product name', async () => {
  const [vite, realtime, actions] = await Promise.all([
    readFile(new URL('../../vite.config.js', import.meta.url), 'utf8'),
    readFile(new URL('../voice/gevRealtime.js', import.meta.url), 'utf8'),
    readFile(new URL('../voice/gevActions.js', import.meta.url), 'utf8'),
  ]);
  const productFacingText = [vite, realtime, actions].join('\n');
  assert.doesNotMatch(productFacingText, /called God's Eye View|God's Eye View camera|God's Eye View data layer|GEV UI panel|GEV voice is not connected|GEV command failed|Unknown GEV tool|Current GEV viewport/);
  assert.match(vite, /You are WorldView Voice Control/);
  assert.match(realtime, /WorldView voice is not connected/);
  assert.match(actions, /Unknown WorldView tool/);
});
