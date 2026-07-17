import { existsSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { resolveRepoRoot } from '../coder/workspaceRoot';

/**
 * WS-7: the WorldSignals embed bundle (client/public/worldsignals/embed.js) is a
 * BUILD ARTIFACT produced by `npm run build:embed` from the vendor source at
 * worldsignal/Shadowbroker-main/frontend/src. It does NOT rebuild automatically,
 * so a vendor source edit silently leaves the host serving a stale bundle. This
 * detects that honestly — it does not rebuild (that stays an explicit command),
 * and it ignores unrelated files so an unrelated change never reads as stale.
 */
export type EmbedBundleFreshness = {
  status: 'fresh' | 'stale' | 'missing';
  bundlePath: string;
  bundleMtimeMs: number | null;
  newestSourceMtimeMs: number | null;
  newestSourceFile: string | null;
  message: string;
};

// Only files that actually affect the built bundle count toward "stale".
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.css', '.json']);

function newestSourceMtime(sourceDir: string): { ms: number; file: string } | null {
  let newest: { ms: number; file: string } | null = null;
  const walk = (dir: string): void => {
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === 'dist') continue;
        walk(full);
      } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        try {
          const ms = statSync(full).mtimeMs;
          if (!newest || ms > newest.ms) newest = { ms, file: full };
        } catch {
          // unreadable file — skip, never let it read as fresh-or-stale
        }
      }
    }
  };
  walk(sourceDir);
  return newest;
}

/** Pure core (explicit paths) so it is directly testable with temp dirs. */
export function computeEmbedBundleFreshness(
  bundlePath: string,
  sourceDir: string,
): EmbedBundleFreshness {
  const base: Omit<EmbedBundleFreshness, 'status' | 'message'> = {
    bundlePath,
    bundleMtimeMs: null,
    newestSourceMtimeMs: null,
    newestSourceFile: null,
  };
  if (!existsSync(bundlePath)) {
    return { ...base, status: 'missing', message: 'embed bundle missing — run: npm run build:embed' };
  }
  const bundleMtimeMs = statSync(bundlePath).mtimeMs;
  const newest = newestSourceMtime(sourceDir);
  if (!newest) {
    // No source found (e.g. vendor tree absent): the bundle exists and nothing
    // proves it stale, so it is fresh — never guess stale without evidence.
    return { ...base, status: 'fresh', bundleMtimeMs, message: 'embed bundle present; no vendor source to compare' };
  }
  if (newest.ms > bundleMtimeMs) {
    return {
      ...base,
      status: 'stale',
      bundleMtimeMs,
      newestSourceMtimeMs: newest.ms,
      newestSourceFile: newest.file,
      message: 'embed bundle is STALE — vendor source changed since the last build; run: npm run build:embed',
    };
  }
  return {
    ...base,
    status: 'fresh',
    bundleMtimeMs,
    newestSourceMtimeMs: newest.ms,
    newestSourceFile: newest.file,
    message: 'embed bundle is up to date',
  };
}

/** Real-path wrapper for the health route + dev startup. */
export function resolveEmbedBundleFreshness(): EmbedBundleFreshness {
  const repoRoot = resolveRepoRoot();
  const bundlePath = path.join(repoRoot, 'client', 'public', 'worldsignals', 'embed.js');
  const sourceDir = path.join(repoRoot, 'worldsignal', 'Shadowbroker-main', 'frontend', 'src');
  return computeEmbedBundleFreshness(bundlePath, sourceDir);
}
