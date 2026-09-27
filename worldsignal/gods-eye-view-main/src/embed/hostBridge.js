import { layerFeedState } from '../data/manager.js';

const MAX_CONSUMED_FOCUS_IDS = 128;
const EMBED_QUERY = Object.freeze({
  embed: '1',
  agentRuntime: 'supervised',
});

function loopbackHost(hostname) {
  return ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
}

export function resolveEmbedMode(search = '') {
  const params = new URLSearchParams(String(search || ''));
  const enabled = Object.entries(EMBED_QUERY).every(([key, value]) => params.get(key) === value);
  if (!enabled) return Object.freeze({ enabled: false, hostOrigin: null });
  const rawOrigin = params.get('hostOrigin');
  try {
    const origin = new URL(String(rawOrigin || '')).origin;
    const parsed = new URL(origin);
    if (!['http:', 'https:'].includes(parsed.protocol) || !loopbackHost(parsed.hostname)) {
      return Object.freeze({ enabled: false, hostOrigin: null });
    }
    return Object.freeze({ enabled: true, hostOrigin: origin });
  } catch {
    return Object.freeze({ enabled: false, hostOrigin: null });
  }
}

function boundedText(value, maximum = 200) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value ?? '').trim();
  return text ? text.slice(0, maximum) : null;
}

function boundedId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 200
    && value.trim() === value ? value : null;
}

function validCoordinate(value, minimum, maximum) {
  const number = typeof value === 'number' ? value : NaN;
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : null;
}

function nativeClock(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function projectSelection(record, projectCartesianPosition = null) {
  if (!record || typeof record !== 'object') return null;
  const id = boundedText(record.id);
  const type = boundedText(record.layerId || record.type);
  if (!id || !type) return null;
  let longitude = validCoordinate(record.longitude ?? record.lon, -180, 180);
  let latitude = validCoordinate(record.latitude ?? record.lat, -90, 90);
  if ((longitude === null || latitude === null) && record.position && typeof projectCartesianPosition === 'function') {
    try {
      const projected = projectCartesianPosition(record.position);
      longitude = validCoordinate(projected?.longitude, -180, 180);
      latitude = validCoordinate(projected?.latitude, -90, 90);
    } catch { /* Native position remains unprojected. */ }
  }
  return {
    id,
    type,
    label: boundedText(record.label || record.name || record.title || record.callsign || id),
    position: longitude === null || latitude === null ? null : { longitude, latitude },
    // Context records expose their own registration/update time. Do not
    // mislabel that local timestamp as a provider observation time.
    updatedAt: nativeClock(record.updatedAt),
  };
}

export function projectSourceState(dataManager, sourceStateReady = false) {
  const sources = (dataManager?.getAll?.() || []).filter((row) => row.showInTogglePanel).map((row) => {
    const stats = row.stats || {};
    const lastRefreshAt = nativeClock(stats.lastUpdate);
    const error = stats.error || stats.lastError || stats.managerRefreshError;
    return {
      id: boundedText(row.id),
      name: boundedText(row.name),
      provider: boundedText(stats.source || row.source),
      enabled: row.enabled === true,
      lifecycleState: boundedText(row.lifecycleState),
      lifecycleUncertain: row.lifecycleUncertain === true,
      feedState: row.enabled ? layerFeedState(stats) : 'off',
      available: typeof stats.available === 'boolean' ? stats.available
        : (typeof stats.unavailable === 'boolean' ? !stats.unavailable : null),
      loading: stats.loading === true,
      refreshing: stats.refreshing === true,
      count: Number.isFinite(stats.count) && stats.count >= 0 ? stats.count : null,
      lastRefreshAt,
      error: error ? boundedText(error?.message || error, 500) : null,
    };
  });
  return {
    sourceStateReady: sourceStateReady === true,
    enabledLayerIds: sources.filter((row) => row.enabled).map((row) => row.id),
    sourceClocks: Object.fromEntries(sources.filter((row) => row.lastRefreshAt).map((row) => [row.id, row.lastRefreshAt])),
    sources,
  };
}

export function validHostConfig(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && value.schemaVersion === 'gev.embed.host-config.v1'
    && boundedId(value.projectId)
    && boundedId(value.cardId)
    && value.parentRuntime === 'hermes'
    && value.nativeAgentPolicy === 'user-initiated'
  );
}

export function validFocusRequest(value, acceptedConfig) {
  if (!acceptedConfig || !value || typeof value !== 'object') return null;
  const requestId = boundedId(value.requestId);
  const targetId = boundedId(value.targetId);
  if (
    value.schemaVersion !== 'gev.embed.focus.v1'
    || !requestId
    || !targetId
    || boundedId(value.projectId) !== acceptedConfig.projectId
    || boundedId(value.cardId) !== acceptedConfig.cardId
  ) return null;
  const longitude = validCoordinate(value.position?.longitude, -180, 180);
  const latitude = validCoordinate(value.position?.latitude, -90, 90);
  if (longitude === null || latitude === null) return null;
  return {
    requestId,
    targetId,
    longitude,
    latitude,
  };
}

export function installHostBridge({
  dataManager,
  voiceCommands,
  focusPosition,
  projectCartesianPosition = null,
  sourceStateReady = Promise.resolve(),
  sourceVersion = '0.1.0',
  mode,
}) {
  if (!mode?.enabled || !mode.hostOrigin || window.parent === window) {
    return Object.freeze({ enabled: false, destroy() {} });
  }
  const listeners = [];
  const consumedFocusIds = new Set();
  const sourceReadyPromise = Promise.resolve(sourceStateReady);
  let acceptedConfig = null;
  let ready = false;
  let destroyed = false;

  const post = (payload) => {
    if (!acceptedConfig || destroyed) return;
    window.parent.postMessage({
      ...payload,
      projectId: acceptedConfig.projectId,
      cardId: acceptedConfig.cardId,
    }, mode.hostOrigin);
  };
  const publishSelection = (record) => {
    post({ schemaVersion: 'gev.embed.selection.v1', selection: projectSelection(record, projectCartesianPosition) });
  };
  const state = () => projectSourceState(dataManager, ready);
  const publishLayers = () => {
    post({
      schemaVersion: 'gev.embed.layer-state.v1',
      state: state(),
    });
  };
  const on = (target, name, handler) => {
    target.addEventListener(name, handler);
    listeners.push(() => target.removeEventListener(name, handler));
  };
  const receive = (event) => {
    if (event.source !== window.parent || event.origin !== mode.hostOrigin || destroyed) return;
    if (validHostConfig(event.data)) {
      if (acceptedConfig && (
        boundedId(event.data.projectId) !== acceptedConfig.projectId
        || boundedId(event.data.cardId) !== acceptedConfig.cardId
      )) return;
      acceptedConfig = {
        projectId: boundedId(event.data.projectId),
        cardId: boundedId(event.data.cardId),
      };
      post({
        schemaVersion: 'gev.embed.ready.v1',
        sourceVersion,
        agentRuntime: 'supervised',
        nativeAgentAvailable: Boolean(voiceCommands),
        nativeAgentActive: Boolean(voiceCommands?.isActive?.()),
      });
      publishLayers();
      return;
    }
    if (!acceptedConfig || boundedId(event.data?.projectId) !== acceptedConfig.projectId
      || boundedId(event.data?.cardId) !== acceptedConfig.cardId) return;
    if (event.data?.schemaVersion === 'gev.embed.layer-visibility.v1') {
      const request = event.data;
      const layerId = boundedId(request.layerId);
      const requestId = boundedId(request.requestId);
      const row = dataManager?.getAll?.()?.find((item) => item.id === layerId && item.showInTogglePanel);
      const respond = (ok, error = null) => {
        post({
          schemaVersion: 'gev.embed.layer-visibility.result.v1',
          requestId,
          layerId,
          requestedEnabled: request.enabled,
          ok,
          error,
          state: state(),
        });
        publishLayers();
      };
      if (!requestId || !layerId || typeof request.enabled !== 'boolean' || !row) {
        respond(false, 'Invalid visible layer request');
        return;
      }
      sourceReadyPromise.then(() => dataManager.setEnabled(layerId, request.enabled, { origin: 'user' }))
        .then((result) => {
          const readback = dataManager.getLayerLifecycleState(layerId);
          const ok = result !== false && readback?.enabled === request.enabled
            && !readback?.uncertain && !['enabling', 'disabling'].includes(readback?.lifecycleState);
          respond(ok, ok ? null : 'Layer did not settle at requested visibility');
        })
        .catch((error) => respond(false, boundedText(error?.message || error, 500) || 'Layer request failed'));
      return;
    }
    if (event.data?.schemaVersion !== 'gev.embed.focus.v1') return;
    const focus = validFocusRequest(event.data, acceptedConfig);
    const requestId = boundedId(event.data.requestId);
    const targetId = boundedId(event.data.targetId);
    const focusResult = (ok, error = null) => post({
      schemaVersion: 'gev.embed.focus.result.v1', requestId, targetId, ok, error,
    });
    if (!requestId) { focusResult(false, 'Invalid focus request'); return; }
    if (consumedFocusIds.has(requestId)) { focusResult(false, 'Focus request already consumed'); return; }
    consumedFocusIds.add(requestId);
    if (consumedFocusIds.size > MAX_CONSUMED_FOCUS_IDS) {
      consumedFocusIds.delete(consumedFocusIds.values().next().value);
    }
    if (!focus || typeof focusPosition !== 'function') { focusResult(false, 'Invalid focus request'); return; }
    try {
      Promise.resolve(focusPosition(focus))
        .then(() => focusResult(true))
        .catch((error) => focusResult(false, boundedText(error?.message || error, 500) || 'Focus failed'));
    } catch (error) {
      focusResult(false, boundedText(error?.message || error, 500) || 'Focus failed');
    }
  };

  on(window, 'message', receive);
  on(window, 'gev:entity-selected', (event) => publishSelection(event.detail));
  on(window, 'gev:awareness-subject-selected', (event) => publishSelection(event.detail));
  on(window, 'gev:entity-selection-cleared', () => {
    post({ schemaVersion: 'gev.embed.selection.v1', selection: null });
  });
  on(window, 'gev:awareness-subject-cleared', () => {
    post({ schemaVersion: 'gev.embed.selection.v1', selection: null });
  });
  const unsubscribe = dataManager?.subscribe?.(() => publishLayers());
  if (typeof unsubscribe === 'function') listeners.push(unsubscribe);
  sourceReadyPromise.then(() => {
    if (destroyed) return;
    ready = true;
    publishLayers();
  }).catch(() => { if (!destroyed) publishLayers(); });
  // Host may have sent config before this listener existed; announce bootstrapping.
  window.parent.postMessage({ schemaVersion: 'gev.embed.bootstrap.v1' }, mode.hostOrigin);

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    while (listeners.length) listeners.pop()?.();
    acceptedConfig = null;
    consumedFocusIds.clear();
  };
  on(window, 'beforeunload', destroy);
  return Object.freeze({ enabled: true, destroy });
}
