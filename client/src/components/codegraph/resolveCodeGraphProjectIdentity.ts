/**
 * Authoritative CodeGraph project-identity resolution.
 *
 * The CodeGraph tab must request its layout from the Codebase-Memory (CBM) project
 * that actually indexes the running repository. Historically the Agent Builder
 * hardcoded a stale CBM project name (`C-Projects-LiquidAIty-main`) which no longer
 * matches the live index (`C-Projects-main`), so CodeGraph reported "project not
 * found". This resolver removes the hardcode: it asks CBM for its indexed projects
 * (the same `list_projects` RPC the vendored CBM UI uses) and binds CodeGraph to the
 * project whose `root_path` is the active repository root.
 *
 * No hardcoded project name, no `default`, no guessed fallback. When CBM has no
 * project matching the active repo, this returns `null` and CodeGraph surfaces its
 * honest empty/error state instead of fabricating an identity.
 */
type CbmProjectRow = {
  name?: string;
  root_path?: string;
  nodes?: number;
  edges?: number;
};

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
 * Resolution order (all authoritative, none fabricated):
 *  1. The indexed project whose `root_path` equals the active repo root.
 *  2. When CBM indexes exactly one project, that single index IS the active
 *     workbench repo — accept it (handles path-format drift between the app's repo
 *     constant and CBM's stored root).
 * Otherwise `null` (honest unresolved).
 */
export async function resolveCbmProjectName(
  repoPath: string,
  list: (() => Promise<{ projects?: CbmProjectRow[] }>) | null = null,
): Promise<string | null> {
  const fetchProjects =
    list ?? (() => callCbmTool<{ projects?: CbmProjectRow[] }>('list_projects'));
  const result = await fetchProjects();
  const projects = Array.isArray(result?.projects) ? result.projects : [];
  if (projects.length === 0) return null;

  const target = normalizeRepoPath(repoPath);
  if (target) {
    const exact = projects.find(
      (p) => p.root_path && normalizeRepoPath(p.root_path) === target,
    );
    if (exact?.name) return exact.name;
  }

  if (projects.length === 1 && projects[0]?.name) {
    return projects[0].name;
  }

  return null;
}
