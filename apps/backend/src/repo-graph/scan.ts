import { promises as fs } from 'fs';
import path from 'path';

import type {
  RepoGraphDirectoryRecord,
  RepoGraphFileRecord,
  RepoGraphLanguage,
  RepoGraphScanInput,
  RepoGraphScanResult,
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

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '');
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

export async function scanRepoGraph(input: RepoGraphScanInput): Promise<RepoGraphScanResult> {
  const includeExtensions = new Set(input.includeExtensions || DEFAULT_REPO_GRAPH_EXTENSIONS);
  const excludeDirs = new Set((input.excludeDirs || [...DEFAULT_REPO_GRAPH_EXCLUDES]).map((entry) => entry.trim()));
  const maxFiles = Math.max(1, input.maxFiles || 4000);
  const directories: RepoGraphDirectoryRecord[] = [];
  const files: RepoGraphFileRecord[] = [];

  async function walk(currentDir: string): Promise<void> {
    if (files.length >= maxFiles) return;

    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= maxFiles) break;

      const absolutePath = path.join(currentDir, entry.name);
      const relativePath = normalizeRelativePath(path.relative(input.repoPath, absolutePath));
      if (!relativePath) continue;

      if (entry.isDirectory()) {
        if (excludeDirs.has(entry.name)) continue;
        directories.push({
          path: relativePath,
          name: entry.name,
        });
        await walk(absolutePath);
        continue;
      }

      if (!entry.isFile()) continue;

      const extension = path.extname(entry.name);
      if (!includeExtensions.has(extension)) continue;

      const stats = await fs.stat(absolutePath);
      files.push({
        path: relativePath,
        name: entry.name,
        extension,
        language: languageFromExtension(extension),
        sizeBytes: stats.size,
        lastModifiedAt: stats.mtime.toISOString(),
      });
    }
  }

  await walk(input.repoPath);

  return {
    repoPath: normalizeRelativePath(input.repoPath),
    scannedAt: new Date().toISOString(),
    directories,
    files,
  };
}
