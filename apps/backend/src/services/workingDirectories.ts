import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (
    !relative.startsWith(`..${path.sep}`)
    && relative !== '..'
    && !path.isAbsolute(relative)
  );
}

export function resolveRepoRoot(): string {
  const configured = String(process.env.LIQUIDAITY_REPO_ROOT || '').trim();
  if (configured) return path.resolve(configured);

  for (const start of [process.cwd(), __dirname]) {
    let candidate = path.resolve(start);
    for (;;) {
      if (
        existsSync(path.join(candidate, 'package.json'))
        && existsSync(path.join(candidate, 'apps', 'backend', 'package.json'))
      ) {
        return candidate;
      }
      const parent = path.dirname(candidate);
      if (parent === candidate) break;
      candidate = parent;
    }
  }
  throw new Error('liquidaity_repo_root_not_found');
}

/**
 * Neutral working directory for a non-coding product Card session.
 *
 * It remains outside both the application repository and the OS temporary
 * directory so Hermes cannot discover repository instructions by walking up
 * from an ordinary product conversation.
 */
export function resolveProductChatWorkingDirectory(scope?: string): string {
  const mainDirectory = path.resolve(process.env.LIQUIDAITY_PRODUCT_CHAT_CWD
    || path.join(process.env.LOCALAPPDATA || os.homedir(), 'LiquidAIty', 'workspaces', 'main'));
  const dir = scope
    ? path.join(path.dirname(mainDirectory), createHash('sha256').update(scope).digest('hex').slice(0, 24))
    : mainDirectory;
  if (isInside(resolveRepoRoot(), dir) || isInside(os.tmpdir(), dir)) {
    throw new Error('product_workspace_must_be_neutral_and_durable');
  }
  mkdirSync(dir, { recursive: true });
  const resolved = realpathSync(dir);
  if (isInside(realpathSync(resolveRepoRoot()), resolved) || isInside(realpathSync(os.tmpdir()), resolved)) {
    throw new Error('product_workspace_must_be_neutral_and_durable');
  }
  return resolved;
}

export function normalizeProjectCodeFolder(value: unknown): string {
  const folder = String(value || '').trim();
  if (!folder) throw new Error('builder_project_code_folder_required');
  if (
    folder.length > 100
    || folder === '.'
    || folder === '..'
    || path.posix.isAbsolute(folder)
    || path.win32.isAbsolute(folder)
    || folder.includes('/')
    || folder.includes('\\')
    || /[<>:"|?*\u0000-\u001F]/.test(folder)
    || /[. ]$/.test(folder)
    || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(folder)
  ) {
    throw new Error('builder_project_code_folder_invalid');
  }
  return folder;
}

/**
 * Resolve one portable Project folder name into LiquidAIty-managed host
 * storage. Only this directory is mounted into Builder's Docker terminal.
 */
export function resolveBuilderProjectCodeDirectory(
  projectId: string,
  folderValue: unknown,
): string {
  const normalizedProjectId = String(projectId || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(normalizedProjectId)) {
    throw new Error('builder_project_identity_invalid');
  }
  const folder = normalizeProjectCodeFolder(folderValue);
  const configuredRoot = String(process.env.BUILDER_PROJECT_CODE_ROOT || '').trim();
  const root = path.resolve(configuredRoot || path.join(
    process.env.LOCALAPPDATA || os.homedir(),
    'LiquidAIty',
    'builder-projects',
  ));
  const repoRoot = realpathSync(resolveRepoRoot());
  const temporaryRoot = realpathSync(os.tmpdir());
  if (isInside(repoRoot, root) || isInside(temporaryRoot, root)) {
    throw new Error('builder_project_code_root_invalid');
  }
  mkdirSync(root, { recursive: true });
  const resolvedRoot = realpathSync(root);
  if (isInside(repoRoot, resolvedRoot) || isInside(temporaryRoot, resolvedRoot)) {
    throw new Error('builder_project_code_root_invalid');
  }

  const projectDirectory = path.join(resolvedRoot, normalizedProjectId);
  mkdirSync(projectDirectory, { recursive: true });
  const resolvedProjectDirectory = realpathSync(projectDirectory);
  if (!isInside(resolvedRoot, resolvedProjectDirectory)) {
    throw new Error('builder_project_code_folder_invalid');
  }

  const repositoryDirectory = path.join(resolvedProjectDirectory, folder);
  mkdirSync(repositoryDirectory, { recursive: true });
  const resolvedRepositoryDirectory = realpathSync(repositoryDirectory);
  if (!isInside(resolvedProjectDirectory, resolvedRepositoryDirectory)) {
    throw new Error('builder_project_code_folder_invalid');
  }
  return resolvedRepositoryDirectory;
}
