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
  runAction = async () => ({ ok: true }),
  captureViewport = async () => null,
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
  const events = { ready: [], layers: [], selections: [], results: [] };
  const bridge = createDirectHostBridge({
    dataManager: manager,
    contextController,
    sourceStateReady,
    runAction,
    captureViewport,
    projectId: 'project-1',
    cardId: 'card-1',
    focusPosition,
    projectCartesianPosition: (position) => position?.x === 1
      ? { longitude: -77, latitude: 38 }
      : null,
    callbacks: {
      onReady: (value) => events.ready.push(value),
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

    h.bridge.setLayerVisibility('flights', false, { origin: 'restore' });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(calls.at(-1), ['flights', false, { origin: 'restore' }]);
    assert.equal(h.events.results.at(-1).ok, true);
  } finally { h.close(); }
});

test('satellite options use the native layer parameter owner and report effective readback', async () => {
  let enabled = true;
  let params = { catalog: 'core', showPoints: false, showOrbits: false, labelMode: 'focus' };
  const calls = [];
  const manager = {
    getAll: () => [{
      id: 'satellites', name: 'Satellites', showInTogglePanel: true,
      enabled, lifecycleState: 'enabled', lifecycleUncertain: false, stats: {},
    }],
    subscribe: () => () => {},
    getLayerLifecycleState: () => ({ enabled, lifecycleState: 'enabled', uncertain: false }),
    getLayerParams: () => ({ ...params }),
    setLayerParams: (id, requested, options) => {
      calls.push([id, requested, options]);
      params = { ...params, ...requested };
      return true;
    },
  };
  const h = bridgeHarness({ dataManager: manager });
  try {
    const requested = { catalog: 'dense', showPoints: true, showOrbits: true, labelMode: 'all' };
    const requestId = h.bridge.setSatelliteParams(requested);
    assert.ok(requestId);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(calls, [['satellites', requested, { origin: 'user' }]]);
    assert.deepEqual(h.events.results.at(-1), {
      schemaVersion: 'gev.direct.satellite-params.result.v1',
      projectId: 'project-1', cardId: 'card-1', requestId,
      layerId: 'satellites', requestedParams: requested, effectiveParams: requested,
      ok: true, error: null, state: h.events.layers.at(-1),
    });
    assert.equal(h.bridge.setSatelliteParams({ selectedSatTrackingId: 25544 }), null);
    assert.equal(h.bridge.setSatelliteParams({ labelMode: 'nearby' }), null);
    assert.equal(h.bridge.setSatelliteParams({ labelMode: null }), null);
    assert.equal(calls.length, 1, 'invalid label modes never reach the native owner');
    enabled = false;
    h.bridge.setSatelliteParams({ showPoints: true });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls.length, 1, 'disabled layer receives no parameter write');
    assert.equal(h.events.results.at(-1).ok, false);
  } finally { h.close(); }
});

test('Card actions reuse the mounted God\'s Eye action with Card origin', async () => {
  const calls = [];
  const h = bridgeHarness({
    runAction: async (name, args, options) => {
      calls.push({ name, args, origin: options.origin });
      return { ok: true, action: name, layerId: args.layerId, enabled: args.enabled };
    },
  });
  try {
    const result = await h.bridge.executeAction('set_layer_visibility', {
      layerId: 'earthquakes', enabled: false,
    });
    assert.deepEqual(calls, [{
      name: 'set_layer_visibility',
      args: { layerId: 'earthquakes', enabled: false },
      origin: 'worldview_card',
    }]);
    assert.equal(result.ok, true);
  } finally { h.close(); }
});

test('Card action passes normalized Project OFF sources to the native action owner', async () => {
  const calls = [];
  const h = bridgeHarness({
    runAction: async (_name, _args, options) => {
      calls.push(options.disabledLayerIds);
      return { ok: false, error: 'Project WorldView source is OFF' };
    },
  });
  try {
    await h.bridge.executeAction('focus_satellites', { satelliteIds: ['sat-1'] }, {
      disabledLayerIds: ['satellites', '', 'satellites', 42],
    });
    assert.deepEqual(calls, [['satellites']]);
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

test('turn context binds live scene, selected entity, and mounted viewport capture', async () => {
  const calls = [];
  const h = bridgeHarness({
    runAction: async (name, args) => {
      calls.push([name, args]);
      if (name === 'get_current_view_state') {
        return { ok: true, camera: { latitude: 35.15, longitude: -82.5 }, scale: 'regional' };
      }
      return { ok: true, selected: [{ id: 'sat-1', name: 'SAT 1', altitudeKm: 510 }] };
    },
    captureViewport: async () => ({
      dataUrl: 'data:image/jpeg;base64,aGVsbG8=',
      capturedAt: '2026-09-28T12:00:00.000Z',
      rootBounds: { x: 710, y: 180, width: 1190, height: 828 },
      canvasBounds: { x: 710, y: 180, width: 1190, height: 828 },
      sourcePixels: { width: 1190, height: 828 },
      imagePixels: { width: 1200, height: 835 },
    }),
  });
  try {
    const [record] = await h.bridge.prepareRunImages();
    assert.deepEqual(calls, [
      ['get_current_view_state', undefined],
      ['get_entity_context', { scope: 'auto', limit: 5 }],
    ]);
    assert.equal(record.schemaVersion, 'worldview.turn-context.v1');
    assert.equal(record.kind, 'worldview-viewport');
    assert.equal(record.name, 'worldview-viewport.jpg');
    assert.equal(record.mediaType, 'image/jpeg');
    assert.equal(record.sha256, '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    assert.deepEqual(record.viewport.rootBounds, { x: 710, y: 180, width: 1190, height: 828 });
    assert.deepEqual(record.context, {
      schemaVersion: 'worldview.surface-context.v1',
      currentView: { ok: true, camera: { latitude: 35.15, longitude: -82.5 }, scale: 'regional' },
      currentViewError: null,
      entityContext: { ok: true, selected: [{ id: 'sat-1', name: 'SAT 1', altitudeKm: 510 }] },
      entityContextError: null,
    });
  } finally { h.close(); }
});

test('viewport capture failure preserves structured WorldView context for the turn', async () => {
  const h = bridgeHarness({
    runAction: async (name) => name === 'get_current_view_state'
      ? { ok: true, camera: { latitude: 35.15, longitude: -82.5 } }
      : { ok: true, selected: [] },
    captureViewport: async () => { throw new Error('canvas unavailable'); },
  });
  try {
    const [record] = await h.bridge.prepareRunImages();
    assert.equal(record.schemaVersion, 'worldview.turn-context.v1');
    assert.equal(record.kind, 'worldview-context');
    assert.equal(record.dataUrl, undefined);
    assert.equal(record.captureError, 'canvas unavailable');
    assert.equal(record.context.currentView.ok, true);
    assert.equal(record.context.entityContext.ok, true);
  } finally { h.close(); }
});

test('turn context fails honestly when both structured scene channels are unavailable', async () => {
  const h = bridgeHarness({
    runAction: async () => { throw new Error('scene unavailable'); },
    captureViewport: async () => null,
  });
  try {
    await assert.rejects(h.bridge.prepareRunImages(), /worldview_turn_context_incomplete/);
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

test('direct mount keeps native controls, starts calmly, and removes the iframe protocol', async () => {
  const [css, application, mount, bridge, ui] = await Promise.all([
    readFile(new URL('../../style.css', import.meta.url), 'utf8'),
    readFile(new URL('./directApplication.js', import.meta.url), 'utf8'),
    readFile(new URL('./mount.js', import.meta.url), 'utf8'),
    readFile(new URL('./directBridge.js', import.meta.url), 'utf8'),
    readFile(new URL('../ui.js', import.meta.url), 'utf8'),
  ]);
  assert.match(css, /html\.supervised-embed #title-bar/);
  assert.match(css, /html\.supervised-embed #style-indicator/);
  assert.match(css, /html\.supervised-embed #global-loading-status/);
  assert.doesNotMatch(css, /html\.supervised-embed #intel-hud/);
  assert.match(application, /dataManager\.buildTogglePanel\(requiredElement\(root, '#data-toggles'\)\)/);
  assert.match(application, /initGevVoiceCommands\(\{/);
  assert.match(application, /createDirectHostBridge\(\{/);
  assert.match(application, /Cesium\.GoogleMaps\.defaultApiKey = googleApiKey \|\| undefined/);
  assert.match(application, /const canAttemptPhotoreal = Boolean\(googleApiKey \|\| \(supervised && cesiumToken\)\)/);
  assert.match(application, /if \(canAttemptPhotoreal\) \{[\s\S]*?createGooglePhotorealistic3DTileset/);
  assert.match(mount, /createWorldViewApplication\(\{/);
  assert.match(ui, /const hudVariant = this\._supervisedEmbed \? 'minimal' : defaults\.hudVariant/);
  assert.match(ui, /const hudVisible = this\._supervisedEmbed \? false : defaults\.hudVisible/);
  assert.match(ui, /const celestialRing = this\._supervisedEmbed \? true : defaults\.celestialRing/);
  assert.match(ui, /explicitDisplayFieldsOnly: supervisedEmbed/);
  assert.match(ui, /supervisedEmbed && mapStack === 'osm'/);
  assert.match(ui, /isStackAvailable\?\.\('photoreal'\)/);
  assert.match(ui, /const initialHudVariant = this\._supervisedEmbed \? 'minimal' : 'tactical'/);
  assert.match(ui, /this\.hud\.setMode\(this\._supervisedEmbed \? 'off' : 'on'\)/);
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
