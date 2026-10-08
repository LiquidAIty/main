let configuredBaseUrl = null;

/**
 * Configure the one native application's provider/asset base. Direct-mount
 * uses LiquidAIty's same-origin `/worldview-native/` proxy; standalone keeps
 * the vendor origin. The returned disposer makes remount ownership explicit.
 */
export function configureRuntimeBaseUrl(baseUrl) {
  const previous = configuredBaseUrl;
  const raw = String(baseUrl || '').trim();
  const configured = raw
    ? `${raw.replace(/\/+$/, '')}/`
    : null;
  configuredBaseUrl = configured;
  return () => {
    if (configuredBaseUrl === configured) configuredBaseUrl = previous;
  };
}

/** Resolve vendor-owned endpoints against the active native runtime host. */
export function runtimeUrl(path) {
  const value = String(path || '');
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value)) return value;
  if (!configuredBaseUrl) return value;
  if (/^https?:\/\//i.test(configuredBaseUrl)) {
    return new URL(value.replace(/^\/+/, ''), configuredBaseUrl).href;
  }
  return `${configuredBaseUrl}${value.replace(/^\/+/, '')}`;
}
