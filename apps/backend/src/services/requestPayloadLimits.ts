/**
 * Entity: Application Runtime
 * Relationship: Defines environment-aware request size policy used by the backend JSON parser and KnowGraph upload boundary.
 */

export function isDevelopmentEnvironment(): boolean {
  return (process.env.NODE_ENV || 'development').toLowerCase() !== 'production';
}

// One bounded web contract admits the canonical four-image Main envelope in
// every environment; the IDF materializer applies the stricter retained limits.
export function requestJsonBodyLimit(): string {
  return '20mb';
}
