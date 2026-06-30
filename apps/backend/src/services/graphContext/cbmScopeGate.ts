import path from 'node:path';
import {
  createCodebaseMemoryMcpCaller,
  type CbmToolCaller,
} from './cbmMcpCaller';

export const LOCALCODER_CBM_REQUIRED_FILES = [
  '.mcp.json',
  'AGENTS.md',
  'PLAN.md',
  'apps/backend/mcp.config.json',
  'apps/backend/src/coder/localcoder/adapter.ts',
  'apps/backend/src/coder/localcoder/service.ts',
  'apps/backend/src/contracts/coderContracts.ts',
  'apps/backend/src/routes/coder.routes.ts',
  'repo-intake/localcoder-boundary.md',
  'skills/codebase-memory-indexing-skill.md',
  'skills/coder-report-protocol-skill.md',
] as const;

export const LOCALCODER_CBM_EXCLUDED_PREFIXES = [
  'localcoder/',
  'worldsignal/',
  'data-formulator-main/',
  'Understand-Anything-main/',
  'client/src/vendor/codebase-memory-ui/',
  'vendor/',
] as const;

const LOCALCODER_CBM_EXCLUDED_SEGMENTS = new Set([
  'node_modules',
  'dist',
  'build',
  '.next',
  '.nx',
  'coverage',
  'tmp',
  'temp',
  '.cache',
  '.codex-temp',
  '.codex-smoke',
]);

export type LocalCoderCbmScopeGateResult = {
  indexRan: boolean;
  indexStatus: string;
  project: string;
  sourceRoot: string;
  nodes: number | null;
  edges: number | null;
  indexedFiles: number;
  requiredFiles: string[];
  missingRequiredFiles: string[];
  excludedFilesFound: string[];
  scopeStatus: 'ok' | 'blocked';
  editAllowed: boolean;
  blockedReason: string;
};

type LocalCoderCbmScopeGateDeps = {
  callTool?: CbmToolCaller;
};

function normalizeFsPath(value: unknown): string {
  return path.resolve(String(value ?? '')).replace(/\\/g, '/').toLowerCase();
}

function normalizeRelativePath(value: unknown): string {
  return String(value ?? '').trim().replace(/\\/g, '/').replace(/^[/]+/, '');
}

function rowsToFiles(value: Record<string, any>): string[] {
  const rows = Array.isArray(value.rows) ? value.rows : [];
  return rows
    .map((row) => normalizeRelativePath(Array.isArray(row) ? row[0] : row?.file_path))
    .filter(Boolean);
}

function isExcludedFile(file: string): boolean {
  const normalized = normalizeRelativePath(file);
  if (
    LOCALCODER_CBM_EXCLUDED_PREFIXES.some(
      (prefix) => normalized === prefix.slice(0, -1) || normalized.startsWith(prefix),
    )
  ) {
    return true;
  }
  return normalized.split('/').some((segment) => LOCALCODER_CBM_EXCLUDED_SEGMENTS.has(segment));
}

function blockedResult(
  reason: string,
  partial: Partial<LocalCoderCbmScopeGateResult> = {},
): LocalCoderCbmScopeGateResult {
  return {
    indexRan: false,
    indexStatus: 'unavailable',
    project: '',
    sourceRoot: '',
    nodes: null,
    edges: null,
    indexedFiles: 0,
    requiredFiles: [...LOCALCODER_CBM_REQUIRED_FILES],
    missingRequiredFiles: [...LOCALCODER_CBM_REQUIRED_FILES],
    excludedFilesFound: [],
    scopeStatus: 'blocked',
    editAllowed: false,
    blockedReason: reason,
    ...partial,
  };
}

export async function runLocalCoderCbmScopeGate(
  repoPath: string,
  deps: LocalCoderCbmScopeGateDeps = {},
): Promise<LocalCoderCbmScopeGateResult> {
  const resolvedRoot = path.resolve(repoPath);
  let session: Awaited<ReturnType<typeof createCodebaseMemoryMcpCaller>> | null = null;
  try {
    session = deps.callTool ? null : await createCodebaseMemoryMcpCaller(resolvedRoot);
    const callTool = deps.callTool ?? session!.callTool;
    const indexResult = await callTool('index_repository', {
      repo_path: resolvedRoot,
      mode: 'moderate',
      persistence: false,
    });
    const indexStatus = String(indexResult.status || '').trim().toLowerCase();
    if (indexStatus !== 'indexed') {
      return blockedResult(`cbm_scope_index_failed: ${indexStatus || 'missing status'}`, {
        indexRan: true,
        indexStatus: indexStatus || 'unknown',
      });
    }

    const projectList = await callTool('list_projects', {});
    const projects = Array.isArray(projectList.projects) ? projectList.projects : [];
    const project = projects.find(
      (candidate) => normalizeFsPath(candidate?.root_path) === normalizeFsPath(resolvedRoot),
    );
    if (!project) {
      return blockedResult(`cbm_scope_root_mismatch: ${resolvedRoot}`, {
        indexRan: true,
        indexStatus,
      });
    }
    const projectName = String(project.name || '').trim();
    const sourceRoot = String(project.root_path || '').trim();
    const status = await callTool('index_status', { project: projectName });
    if (String(status.status || '').trim().toLowerCase() !== 'ready') {
      return blockedResult('cbm_scope_index_not_ready', {
        indexRan: true,
        indexStatus,
        project: projectName,
        sourceRoot,
      });
    }
    const inventory = await callTool('query_graph', {
      project: projectName,
      query: 'MATCH (f:File) RETURN f.file_path AS file_path',
      max_rows: 20_000,
    });
    const files = rowsToFiles(inventory);
    const fileSet = new Set(files.map((file) => file.toLowerCase()));
    const missingRequiredFiles = LOCALCODER_CBM_REQUIRED_FILES.filter(
      (file) => !fileSet.has(file.toLowerCase()),
    );
    const excludedFilesFound = files.filter(isExcludedFile).slice(0, 20);
    const common = {
      indexRan: true,
      indexStatus,
      project: projectName,
      sourceRoot,
      nodes: Number.isFinite(Number(status.nodes)) ? Number(status.nodes) : null,
      edges: Number.isFinite(Number(status.edges)) ? Number(status.edges) : null,
      indexedFiles: files.length,
      requiredFiles: [...LOCALCODER_CBM_REQUIRED_FILES],
      missingRequiredFiles,
      excludedFilesFound,
    };
    if (missingRequiredFiles.length > 0) {
      return blockedResult(
        `cbm_scope_required_files_missing: ${missingRequiredFiles.join(', ')}`,
        common,
      );
    }
    if (excludedFilesFound.length > 0) {
      return blockedResult(
        `cbm_scope_excluded_files_indexed: ${excludedFilesFound.join(', ')}`,
        common,
      );
    }
    return {
      ...common,
      scopeStatus: 'ok',
      editAllowed: true,
      blockedReason: '',
    };
  } catch (error) {
    return blockedResult(
      `cbm_scope_gate_failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    await session?.close();
  }
}
