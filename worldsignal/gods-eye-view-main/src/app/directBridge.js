import { layerFeedState } from '../data/manager.js';
import { contextLayerEnableBlockReason } from '../contextModePolicy.js';

const MAX_CONSUMED_FOCUS_IDS = 128;
let nextRequestId = 0;

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
  if ((longitude === null || latitude === null)
    && record.position && typeof projectCartesianPosition === 'function') {
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
    updatedAt: nativeClock(record.updatedAt),
  };
}

export function projectSourceState(dataManager, sourceStateReady = false) {
  const sources = (dataManager?.getAll?.() || [])
    .filter((row) => row.showInTogglePanel)
    .map((row) => {
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
    sourceClocks: Object.fromEntries(
      sources.filter((row) => row.lastRefreshAt).map((row) => [row.id, row.lastRefreshAt]),
    ),
    sources,
  };
}

/**
 * Direct, same-document product seam for the React-owned WorldView surface.
 * It preserves native data/selection ownership without a cross-window protocol.
 */
export function createDirectHostBridge({
  dataManager,
  contextController = null,
  voiceCommands,
  focusPosition,
  projectCartesianPosition = null,
  sourceStateReady = Promise.resolve(),
  sourceVersion = '0.1.1',
  projectId,
  cardId,
  callbacks = {},
}) {
  if (!boundedId(projectId) || !boundedId(cardId)) {
    throw new Error('worldview_direct_scope_invalid');
  }
  const listeners = [];
  const consumedFocusIds = new Set();
  const sourceReadyPromise = Promise.resolve(sourceStateReady);
  let ready = false;
  let destroyed = false;

  const state = () => projectSourceState(dataManager, ready);
  const publishLayers = () => {
    if (!destroyed) callbacks.onLayerStateChange?.(state());
  };
  const publishSelection = (record) => {
    if (!destroyed) callbacks.onSelectionChange?.(
      projectSelection(record, projectCartesianPosition),
    );
  };
  const on = (target, name, handler) => {
    target.addEventListener(name, handler);
    listeners.push(() => target.removeEventListener(name, handler));
  };
  const commandError = (error, fallback) => boundedText(error?.message || error, 500) || fallback;
  const scope = { projectId, cardId };

  on(window, 'gev:entity-selected', (event) => publishSelection(event.detail));
  on(window, 'gev:awareness-subject-selected', (event) => publishSelection(event.detail));
  on(window, 'gev:entity-selection-cleared', () => {
    if (!destroyed) callbacks.onSelectionChange?.(null);
  });
  on(window, 'gev:awareness-subject-cleared', () => {
    if (!destroyed) callbacks.onSelectionChange?.(null);
  });
  const unsubscribe = dataManager?.subscribe?.(publishLayers);
  if (typeof unsubscribe === 'function') listeners.push(unsubscribe);

  sourceReadyPromise.then(() => {
    if (destroyed) return;
    ready = true;
    publishLayers();
  }).catch(() => { if (!destroyed) publishLayers(); });

  queueMicrotask(() => {
    if (destroyed) return;
    callbacks.onReady?.(sourceVersion);
    callbacks.onNativeAgentState?.({
      available: Boolean(voiceCommands),
      active: Boolean(voiceCommands?.isActive?.()),
      status: boundedText(voiceCommands?.status) || 'idle',
    });
    publishLayers();
  });

  const bridge = {
    setLayerVisibility(layerId, enabled, options = {}) {
      const normalizedLayerId = boundedId(layerId);
      const row = dataManager?.getAll?.()?.find(
        (item) => item.id === normalizedLayerId && item.showInTogglePanel,
      );
      if (destroyed || !normalizedLayerId || typeof enabled !== 'boolean' || !row) return null;
      const requestId = `worldview-${++nextRequestId}`;
      const respond = (ok, error = null) => {
        if (destroyed) return;
        const result = {
          schemaVersion: 'gev.direct.layer-visibility.result.v1',
          ...scope,
          requestId,
          layerId: normalizedLayerId,
          requestedEnabled: enabled,
          ok,
          error,
          state: state(),
        };
        callbacks.onLayerStateChange?.(result.state);
        callbacks.onCommandResult?.(result);
      };
      sourceReadyPromise.then(async () => {
        if (destroyed) return false;
        const contextMode = contextController?.getContextModeState?.()?.mode || null;
        const contextBlockReason = contextLayerEnableBlockReason({
          contextMode,
          change: { layerId: normalizedLayerId, enabled, origin: 'user' },
          layerName: row.name,
        });
        if (contextBlockReason) {
          if (options.exitIncompatibleContext !== true) throw new Error(contextBlockReason);
          const contextResult = await contextController?.setContextMode?.('off');
          if (!contextResult?.ok || contextController?.getContextModeState?.()?.mode) {
            throw new Error(
              contextResult?.error
              || `Could not exit the current Context mode to enable ${row.name || normalizedLayerId}`,
            );
          }
        }
        return dataManager.setEnabled(normalizedLayerId, enabled, { origin: 'user' });
      }).then((operationResult) => {
        if (destroyed) return;
        const readback = dataManager.getLayerLifecycleState(normalizedLayerId);
        const ok = operationResult !== false && readback?.enabled === enabled
          && !readback?.uncertain
          && !['enabling', 'disabling'].includes(readback?.lifecycleState);
        respond(ok, ok ? null : 'Layer did not settle at requested visibility');
      }).catch((error) => {
        if (!destroyed) respond(false, commandError(error, 'Layer request failed'));
      });
      return requestId;
    },

    focusSelection(selection) {
      if (destroyed || typeof focusPosition !== 'function') return null;
      const targetId = boundedId(selection?.id);
      const longitude = validCoordinate(selection?.position?.longitude, -180, 180);
      const latitude = validCoordinate(selection?.position?.latitude, -90, 90);
      if (!targetId || longitude === null || latitude === null) return null;
      const requestId = `worldview-${++nextRequestId}`;
      if (consumedFocusIds.has(requestId)) return null;
      consumedFocusIds.add(requestId);
      if (consumedFocusIds.size > MAX_CONSUMED_FOCUS_IDS) {
        consumedFocusIds.delete(consumedFocusIds.values().next().value);
      }
      const respond = (ok, error = null) => {
        if (!destroyed) callbacks.onCommandResult?.({
          schemaVersion: 'gev.direct.focus.result.v1',
          ...scope,
          requestId,
          targetId,
          ok,
          error,
        });
      };
      try {
        Promise.resolve(focusPosition({ longitude, latitude, targetId }))
          .then(() => respond(true))
          .catch((error) => respond(false, commandError(error, 'Focus failed')));
      } catch (error) {
        respond(false, commandError(error, 'Focus failed'));
      }
      return requestId;
    },

    getLayerState: state,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      while (listeners.length) listeners.pop()?.();
      consumedFocusIds.clear();
    },
  };
  return Object.freeze(bridge);
}
