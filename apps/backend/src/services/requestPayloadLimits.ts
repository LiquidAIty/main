export function isDevelopmentEnvironment(): boolean {
  return (process.env.NODE_ENV || 'development').toLowerCase() !== 'production';
}

// Larger JSON payloads are allowed in development so real loop testing can
// carry richer state; production keeps the tight default.
export function requestJsonBodyLimit(): string {
  return isDevelopmentEnvironment()
    ? process.env.DEVELOPMENT_JSON_BODY_LIMIT || '25mb'
    : '2mb';
}
