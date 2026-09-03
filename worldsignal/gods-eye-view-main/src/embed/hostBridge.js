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
  const text = String(value ?? '').trim();
  return text ? text.slice(0, maximum) : null;
}

function validCoordinate(value, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : null;
}

export function projectSelection(record) {
  if (!record || typeof record !== 'object') return null;
  const id = boundedText(record.id);
  const type = boundedText(record.layerId || record.type);
  if (!id || !type) return null;
  const longitude = validCoordinate(record.longitude ?? record.lon, -180, 180);
  const latitude = validCoordinate(record.latitude ?? record.lat, -90, 90);
  return {
    id,
    type,
    label: boundedText(record.name || record.title || record.callsign || id),
    position: longitude === null || latitude === null ? null : { longitude, latitude },
    observedAt: Number.isFinite(record.updatedAt)
      ? new Date(record.updatedAt).toISOString()
      : null,
  };
}

export function validHostConfig(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && value.schemaVersion === 'gev.embed.host-config.v1'
    && boundedText(value.projectId)
    && boundedText(value.cardId)
    && value.parentRuntime === 'hermes'
    && value.nativeAgentPolicy === 'user-initiated'
  );
}

export function validFocusRequest(value, acceptedConfig) {
  if (!acceptedConfig || !value || typeof value !== 'object') return null;
  const id = boundedText(value.id);
  if (
    value.schemaVersion !== 'gev.embed.focus.v1'
    || !id
    || boundedText(value.projectId) !== boundedText(acceptedConfig.projectId)
    || boundedText(value.cardId) !== boundedText(acceptedConfig.cardId)
  ) return null;
  const longitude = validCoordinate(value.position?.longitude, -180, 180);
  const latitude = validCoordinate(value.position?.latitude, -90, 90);
  if (longitude === null || latitude === null) return null;
  return {
    id,
    longitude,
    latitude,
  };
}

export function installHostBridge({
  dataManager,
  voiceCommands,
  focusPosition,
  sourceVersion = '0.1.0',
  mode,
}) {
  if (!mode?.enabled || !mode.hostOrigin || window.parent === window) {
    return Object.freeze({ enabled: false, destroy() {} });
  }
  const listeners = [];
  let accepted = false;
  let acceptedConfig = null;

  const post = (payload) => {
    if (!accepted) return;
    window.parent.postMessage(payload, mode.hostOrigin);
  };
  const publishSelection = (record) => {
    post({ schemaVersion: 'gev.embed.selection.v1', selection: projectSelection(record) });
  };
  const publishLayers = () => {
    post({
      schemaVersion: 'gev.embed.layer-state.v1',
      state: {
        enabledLayerIds: dataManager?.getEnabledLayerIds?.() || [],
        sourceClocks: {},
      },
    });
  };
  const on = (target, name, handler) => {
    target.addEventListener(name, handler);
    listeners.push(() => target.removeEventListener(name, handler));
  };
  const receive = (event) => {
    if (event.source !== window.parent || event.origin !== mode.hostOrigin) return;
    if (validHostConfig(event.data)) {
      acceptedConfig = event.data;
      accepted = true;
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
    const focus = validFocusRequest(event.data, acceptedConfig);
    if (focus && typeof focusPosition === 'function') focusPosition(focus);
  };

  on(window, 'message', receive);
  on(window, 'gev:entity-selected', (event) => publishSelection(event.detail));
  on(window, 'gev:awareness-subject-selected', (event) => publishSelection(event.detail));
  on(window, 'gev:entity-selection-cleared', () => {
    post({ schemaVersion: 'gev.embed.selection.v1', selection: null });
  });
  const unsubscribe = dataManager?.subscribe?.(() => publishLayers());
  if (typeof unsubscribe === 'function') listeners.push(unsubscribe);

  const destroy = () => {
    while (listeners.length) listeners.pop()?.();
    accepted = false;
    acceptedConfig = null;
  };
  on(window, 'beforeunload', destroy);
  return Object.freeze({ enabled: true, destroy });
}
