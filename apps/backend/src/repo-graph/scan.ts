import { promises as fs } from 'fs';
import path from 'path';

import type {
  RepoGraphDirectoryRecord,
  RepoGraphFileRecord,
  RepoGraphLanguage,
  RepoGraphScanInput,
  RepoGraphScanResult,
  RepoGraphScanRootStatus,
} from './types';

export const DEFAULT_REPO_GRAPH_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.py'];
export const DEFAULT_REPO_GRAPH_EXCLUDES = [
  '.git',
  '.nx',
  '.next',
  '.windsurf',
  'node_modules',
  'dist',
  'build',
  'coverage',
  'test-results',
  'vendor',
  'checkpoints',
  'tmp',
  'tmp-orchestrator-proof',
] as const;

export const DEFAULT_ACTIVE_REPO_GRAPH_ALLOWLIST_ROOTS = [
  'client/src/pages/agentbuilder.tsx',
  'client/src/pages/tradingui.tsx',
  'client/src/components/builder',
  'client/src/components/AgentManager.tsx',
  'client/src/components/knowledge/KnowledgeGraphNVL.tsx',
  'client/src/components/knowledge/UploadAttachment.tsx',
  'apps/backend/src/v3',
  'apps/backend/src/routes/v2',
  'apps/backend/src/routes/agent.routes.ts',
  'apps/backend/src/routes/knowgraph.routes.ts',
  'apps/backend/src/services/orchestration',
  'apps/backend/src/planwiki',
  'apps/backend/src/repo-graph',
  'apps/backend/src/tools',
  'apps/python-models/app/python_models',
] as const;

export const DEFAULT_ACTIVE_REPO_GRAPH_EXCLUDE_ROOTS = [
  'node_modules',
  'vendor',
  'dist',
  'data',
  'db',
  'n8n',
  'n8n_data',
  '.data',
  'test-results',
] as const;

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

function isWithinRepo(repoPath: string, absolutePath: string): boolean {
  const relativePath = path.relative(path.resolve(repoPath), path.resolve(absolutePath));
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function toRepoRelativePath(repoPath: string, candidatePath: string): string {
  return normalizeRelativePath(path.relative(path.resolve(repoPath), path.resolve(candidatePath)));
}

function isPathWithinRoot(candidatePath: string, rootPath: string): boolean {
  return candidatePath === rootPath || candidatePath.startsWith(`${rootPath}/`);
}

function isExcludedPath(relativePath: string, excludeRoots: Set<string>): boolean {
  if (!relativePath) return false;

  for (const root of excludeRoots) {
    if (!root) continue;
    if (isPathWithinRoot(relativePath, root)) return true;
  }

  return false;
}

function isRouteFile(relativePath: string): boolean {
  const normalized = normalizeRelativePath(relativePath);
  const fileName = path.posix.basename(normalized);

  return (
    normalized.includes('/routes/') ||
    /(^|\/)route\.(ts|tsx|js|jsx)$/.test(normalized) ||
    /\.routes\.(ts|tsx|js|jsx)$/.test(fileName)
  );
}

function languageFromExtension(extension: string): RepoGraphLanguage {
  switch (extension) {
    case '.ts':
      return 'typescript';
    case '.tsx':
      return 'tsx';
    case '.js':
      return 'javascript';
    case '.jsx':
      return 'jsx';
    case '.json':
      return 'json';
    case '.md':
      return 'markdown';
    case '.py':
      return 'python';
    default:
      return 'unknown';
  }
}

function uniqueNormalizedPaths(values: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  (values || []).forEach((value) => {
    const normalized = normalizeRelativePath(String(value || '').trim());
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    result.push(normalized);
  });

  return result;
}

export function createActiveSliceRepoGraphScanInput(
  repoPath: string,
  overrides: Partial<RepoGraphScanInput> = {},
): RepoGraphScanInput {
  return {
    repoPath,
    allowlistRoots: overrides.allowlistRoots || [...DEFAULT_ACTIVE_REPO_GRAPH_ALLOWLIST_ROOTS],
    excludeRoots: overrides.excludeRoots || [...DEFAULT_ACTIVE_REPO_GRAPH_EXCLUDE_ROOTS],
    includeExtensions: overrides.includeExtensions || [...DEFAULT_REPO_GRAPH_EXTENSIONS],
    excludeDirs: overrides.excludeDirs || [...DEFAULT_REPO_GRAPH_EXCLUDES],
    maxFiles: overrides.maxFiles,
    dryRun: overrides.dryRun,
  };
}

export async function scanRepoGraph(input: RepoGraphScanInput): Promise<RepoGraphScanResult> {
  const resolvedRepoPath = path.resolve(input.repoPath);
  const includeExtensions = new Set(input.includeExtensions || DEFAULT_REPO_GRAPH_EXTENSIONS);
  const excludeDirs = new Set((input.excludeDirs || [...DEFAULT_REPO_GRAPH_EXCLUDES]).map((entry) => entry.trim()));
  const excludeRoots = new Set(
    uniqueNormalizedPaths(input.excludeRoots || [...DEFAULT_ACTIVE_REPO_GRAPH_EXCLUDE_ROOTS]),
  );
  const allowlistRoots = uniqueNormalizedPaths(input.allowlistRoots);
  const maxFiles = Math.max(1, input.maxFiles || 4000);
  const dryRun = Boolean(input.dryRun);

  const directories: RepoGraphDirectoryRecord[] = [];
  const files: RepoGraphFileRecord[] = [];
  const directoryPaths = new Set<string>();
  const filePaths = new Set<string>();
  const rootStatuses: RepoGraphScanRootStatus[] = [];
  let truncated = false;

  function ensureDirectoryChain(relativeDirPath: string): void {
    const normalized = normalizeRelativePath(relativeDirPath);
    if (!normalized || normalized === '.') return;

    const segments = normalized.split('/').filter(Boolean);
    let built = '';
    segments.forEach((segment) => {
      built = built ? `${built}/${segment}` : segment;
      if (directoryPaths.has(built)) return;
      directoryPaths.add(built);
      directories.push({
        path: built,
        name: segment,
      });
    });
  }

  async function recordFile(absolutePath: string): Promise<void> {
    if (files.length >= maxFiles) {
      truncated = true;
      return;
    }

    const relativePath = toRepoRelativePath(resolvedRepoPath, absolutePath);
    if (!relativePath || isExcludedPath(relativePath, excludeRoots)) return;

    const extension = path.extname(absolutePath);
    if (!includeExtensions.has(extension) || filePaths.has(relativePath)) return;

    const stats = await fs.stat(absolutePath);
    filePaths.add(relativePath);
    ensureDirectoryChain(path.posix.dirname(relativePath));
    files.push({
      path: relativePath,
      name: path.basename(relativePath),
      extension,
      language: languageFromExtension(extension),
      sizeBytes: stats.size,
      lastModifiedAt: stats.mtime.toISOString(),
      isRouteFile: isRouteFile(relativePath),
    });
  }

  async function walkDirectory(absoluteDirPath: string): Promise<void> {
    if (files.length >= maxFiles) {
      truncated = true;
      return;
    }

    const relativeDirPath = toRepoRelativePath(resolvedRepoPath, absoluteDirPath);
    if (relativeDirPath && isExcludedPath(relativeDirPath, excludeRoots)) return;
    if (relativeDirPath) ensureDirectoryChain(relativeDirPath);

    const entries = await fs.readdir(absoluteDirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= maxFiles) {
        truncated = true;
        break;
      }

      const absolutePath = path.join(absoluteDirPath, entry.name);
      const relativePath = toRepoRelativePath(resolvedRepoPath, absolutePath);
      if (!relativePath || isExcludedPath(relativePath, excludeRoots)) continue;

      if (entry.isDirectory()) {
        if (excludeDirs.has(entry.name)) continue;
        await walkDirectory(absolutePath);
        continue;
      }

      if (!entry.isFile()) continue;
      await recordFile(absolutePath);
    }
  }

  async function scanRoot(root: string): Promise<void> {
    const normalizedRoot = normalizeRelativePath(root);
    const status: RepoGraphScanRootStatus = {
      root,
      normalizedRoot,
      kind: 'missing',
      selectedDirectoryCount: 0,
      selectedFileCount: 0,
    };

    if (!normalizedRoot) {
      status.kind = 'outside_repo';
      status.reason = 'Root resolved to the repository root or an empty path.';
      rootStatuses.push(status);
      return;
    }

    if (isExcludedPath(normalizedRoot, excludeRoots)) {
      status.kind = 'excluded';
      status.reason = 'Root is inside an explicit exclude root.';
      rootStatuses.push(status);
      return;
    }

    const absoluteRootPath = path.resolve(resolvedRepoPath, normalizedRoot);
    if (!isWithinRepo(resolvedRepoPath, absoluteRootPath)) {
      status.kind = 'outside_repo';
      status.reason = 'Root resolves outside the repository.';
      rootStatuses.push(status);
      return;
    }

    let stats;
    try {
      stats = await fs.stat(absoluteRootPath);
    } catch {
      status.kind = 'missing';
      status.reason = 'Root does not exist.';
      rootStatuses.push(status);
      return;
    }

    const directoryCountBefore = directories.length;
    const fileCountBefore = files.length;

    if (stats.isDirectory()) {
      status.kind = 'directory';
      await walkDirectory(absoluteRootPath);
    } else if (stats.isFile()) {
      status.kind = 'file';
      await recordFile(absoluteRootPath);
      if (!filePaths.has(normalizedRoot)) {
        status.reason = `Skipped file because extension "${path.extname(normalizedRoot)}" is not included.`;
      }
    } else {
      status.kind = 'unsupported';
      status.reason = 'Root is neither a file nor a directory.';
      rootStatuses.push(status);
      return;
    }

    status.selectedDirectoryCount = directories.length - directoryCountBefore;
    status.selectedFileCount = files.length - fileCountBefore;
    rootStatuses.push(status);
  }

  const rootsToScan = allowlistRoots.length > 0 ? allowlistRoots : ['.'];
  if (rootsToScan.length === 1 && rootsToScan[0] === '.') {
    await walkDirectory(resolvedRepoPath);
    rootStatuses.push({
      root: '.',
      normalizedRoot: '.',
      kind: 'directory',
      selectedDirectoryCount: directories.length,
      selectedFileCount: files.length,
      reason: 'Scanned repository root because no allowlist roots were provided.',
    });
  } else {
    for (const root of rootsToScan) {
      await scanRoot(root);
    }
  }

  const routeFileCount = files.reduce((count, file) => count + (file.isRouteFile ? 1 : 0), 0);

  return {
    repoPath: normalizeRelativePath(resolvedRepoPath),
    scannedAt: new Date().toISOString(),
    allowlistRoots,
    excludeRoots: [...excludeRoots],
    maxFiles,
    dryRun,
    truncated,
    rootStatuses,
    summary: {
      dryRun,
      truncated,
      directoryCount: directories.length,
      fileCount: files.length,
      routeFileCount,
    },
    directories,
    files,
  };
}
