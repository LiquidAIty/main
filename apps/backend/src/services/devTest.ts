import os from 'node:os';
import path from 'node:path';

export function isDevTestModeEnabled(): boolean {
  return (
    process.env.DEV_TEST_REAL_LOOP === '1' ||
    (process.env.NODE_ENV || 'development').toLowerCase() !== 'production'
  );
}

// DEV TEST LIMIT RAISED: larger JSON payloads are allowed in development so real loop testing can carry richer state.
export function getDevTestJsonBodyLimit(): string {
  return isDevTestModeEnabled()
    ? process.env.DEV_TEST_JSON_BODY_LIMIT || '25mb'
    : '2mb';
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : fallback;
}

// TEMPORARY STABILIZATION GUARD: keep loop and research limits visible and env-configurable.
export function getConfiguredPositiveInt(envName: string, fallback: number): number {
  return parsePositiveInt(process.env[envName], fallback);
}

function normalizeRoot(value: string): string {
  return path.resolve(value).replace(/[\\/]+$/, '').toLowerCase();
}

export function requireDevTestMode() {
  if (!isDevTestModeEnabled()) {
    throw new Error('dev_test_route_disabled');
  }
}

export function getDevTestLocalIngestRoots(): string[] {
  const configured = String(process.env.DEV_TEST_LOCAL_INGEST_ROOTS || '')
    .split(/[;,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  const defaults = [
    path.resolve(process.cwd(), 'tmp'),
    path.resolve(process.cwd(), 'mnt', 'data'),
    path.resolve('C:\\mnt\\data'),
    path.resolve(os.homedir(), 'Downloads'),
  ];

  return Array.from(new Set([...configured, ...defaults].map(normalizeRoot)));
}

export function resolveAllowedDevLocalFile(filePath: string): string {
  requireDevTestMode();
  const trimmed = String(filePath || '').trim();
  if (!trimmed) {
    throw new Error('file_path_required');
  }

  const resolved = path.resolve(trimmed);
  const allowAny = process.env.DEV_TEST_LOCAL_FILE_ALLOW_ANY === '1';
  if (allowAny) {
    return resolved;
  }

  const normalizedFile = normalizeRoot(resolved);
  const roots = getDevTestLocalIngestRoots();
  const allowed = roots.some((root) => normalizedFile === root || normalizedFile.startsWith(`${root}${path.sep}`.toLowerCase()));
  if (!allowed) {
    throw new Error(`dev_test_file_not_allowed: ${resolved}`);
  }
  return resolved;
}
