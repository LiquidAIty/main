export function isDevTestModeEnabled(): boolean {
  return (
    process.env.DEV_TEST_REAL_LOOP === '1' ||
    (process.env.NODE_ENV || 'development').toLowerCase() !== 'production'
  );
}

// Larger JSON payloads are allowed in development so real loop testing can
// carry richer state; production keeps the tight default.
export function getDevTestJsonBodyLimit(): string {
  return isDevTestModeEnabled()
    ? process.env.DEV_TEST_JSON_BODY_LIMIT || '25mb'
    : '2mb';
}

export function requireDevTestMode() {
  if (!isDevTestModeEnabled()) {
    throw new Error('dev_test_route_disabled');
  }
}

// Removed: getConfiguredPositiveInt / getDevTestLocalIngestRoots /
// resolveAllowedDevLocalFile — dev local-file-ingest helpers whose callers
// (the old ingest routes) were deleted; zero consumers remained.
