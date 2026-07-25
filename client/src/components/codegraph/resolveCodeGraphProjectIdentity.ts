/**
 * Authoritative CodeGraph project-identity resolution.
 *
 * The CodeGraph tab must request its layout from the Codebase-Memory (CBM) project
 * that actually indexes the running repository. Historically the Agent Builder
 * hardcoded a stale CBM project name (`C-Projects-LiquidAIty-main`) which no longer
 * matches the live index (`C-Projects-main`), so CodeGraph reported "project not
 * found". This resolver asks CBM for its indexed projects (the same `list_projects`
 * RPC the vendored CBM UI uses), prefers the canonical project identity, and only
 * falls back to an unambiguous ready index for the active repository root.
 *
 * A missing, unready, or ambiguous identity is an error. CodeGraph must show that
 * failure instead of silently binding to whichever same-root index CBM listed first.
 */
type CbmProjectRow = {
  name?: string;
  root_path?: string;
  nodes?: number;
  edges?: number;
};

type CbmProjectStatus = {
  project?: string;
  status?: string;
  root_path?: string;
};

type ResolveCbmProjectOptions = {
  configuredProjectName?: string | null;
  canonicalProjectName?: string;
  listProjects?: () => Promise<{ projects?: CbmProjectRow[] }>;
  getProjectStatus?: (projectName: string) => Promise<CbmProjectStatus>;
};

export const CANONICAL_CBM_PROJECT_NAME = 'C-Projects-main';

let nextRpcId = 1;

async function callCbmTool<T = unknown>(
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const res = await fetch('/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: nextRpcId++,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  if (!res.ok) {
    throw new Error(`CBM RPC HTTP ${res.status}: ${res.statusText}`);
  }
  const json = await res.json();
  if (json?.error) {
    throw new Error(String(json.error.message || 'CBM RPC error'));
  }
  const text = json?.result?.content?.[0]?.text;
  if (typeof text === 'string') return JSON.parse(text) as T;
  return json?.result as T;
}

/** Normalize a filesystem path for identity comparison: backslashes → slashes,
 *  collapse duplicate slashes, drop a trailing slash, lowercase (Windows roots are
 *  case-insensitive). This only compares the active repo path against CBM's stored
 *  `root_path`; it never derives or fabricates the project name itself. */
export function normalizeRepoPath(value: string | null | undefined): string {
  return String(value ?? '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
}

/**
 * Resolve the authoritative CBM project name bound to `repoPath`.
 *
 * Resolution order:
 *  1. An explicitly configured, indexed, ready project.
 *  2. The indexed, ready canonical project (`C-Projects-main`).
 *  3. The sole ready project whose `root_path` equals the active repo root.
 *
 * Any missing, unready, or ambiguous authority rejects with a user-visible error.
 */
export async function resolveCbmProjectName(
  repoPath: string,
  options: ResolveCbmProjectOptions = {},
): Promise<string> {
  const fetchProjects =
    options.listProjects ??
    (() => callCbmTool<{ projects?: CbmProjectRow[] }>('list_projects'));
  const fetchStatus =
    options.getProjectStatus ??
    ((projectName: string) =>
      callCbmTool<CbmProjectStatus>('index_status', { project: projectName }));
  const result = await fetchProjects();
  const projects = Array.isArray(result?.projects) ? result.projects : [];
  const canonicalProjectName =
    options.canonicalProjectName ?? CANONICAL_CBM_PROJECT_NAME;

  const requireReady = async (projectName: string): Promise<string> => {
    const status = await fetchStatus(projectName);
    if (status?.status !== 'ready') {
      throw new Error(
        `CBM project is not ready: ${projectName} (${status?.status || 'unknown'})`,
      );
    }
    return projectName;
  };

  const configuredProjectName = options.configuredProjectName?.trim();
  if (configuredProjectName) {
    if (!projects.some((project) => project.name === configuredProjectName)) {
      throw new Error(
        `Configured CBM project is not indexed: ${configuredProjectName}`,
      );
    }
    return requireReady(configuredProjectName);
  }

  if (projects.some((project) => project.name === canonicalProjectName)) {
    return requireReady(canonicalProjectName);
  }

  const target = normalizeRepoPath(repoPath);
  const exactRootProjects = target
    ? projects.filter(
        (project) =>
          project.name &&
          project.root_path &&
          normalizeRepoPath(project.root_path) === target,
      )
    : [];
  const readyExactRootProjects = (
    await Promise.all(
      exactRootProjects.map(async (project) => ({
        name: project.name as string,
        status: await fetchStatus(project.name as string),
      })),
    )
  ).filter(({ status }) => status?.status === 'ready');

  if (readyExactRootProjects.length === 1) {
    return readyExactRootProjects[0].name;
  }

  if (readyExactRootProjects.length > 1) {
    throw new Error(
      `CBM project identity is ambiguous for ${repoPath}: ${readyExactRootProjects
        .map(({ name }) => name)
        .sort()
        .join(', ')}`,
    );
  }

  if (exactRootProjects.length > 0) {
    throw new Error(
      `No ready CBM project indexes ${repoPath}: ${exactRootProjects
        .map(({ name }) => name)
        .sort()
        .join(', ')}`,
    );
  }

  throw new Error(`CBM project is not indexed: ${canonicalProjectName}`);
}
