import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

export function resolveRepoRoot(): string {
  const configured = String(process.env.LIQUIDAITY_REPO_ROOT || '').trim();
  if (configured) return path.resolve(configured);

  for (const start of [process.cwd(), __dirname]) {
    let candidate = path.resolve(start);
    for (;;) {
      if (
        existsSync(path.join(candidate, 'package.json')) &&
        existsSync(path.join(candidate, 'apps', 'backend', 'package.json'))
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
 * The working directory for a product Main/Hermes ACP session.
 *
 * It must NOT be the repo root: the engine walks up from its working directory
 * loading project-memory files such as AGENTS.md, and a
 * repo-root cwd injects the repo's DEVELOPER instructions (~8.4k tokens, M-1)
 * into a PRODUCT conversation that never needed them. Main and Hermes drive the
 * project through MCP tools (Engraphis/Graphiti/CBM/canvas), not the
 * filesystem, so a neutral out-of-repo directory removes the memory walk with
 * zero capability loss. Builder uses its saved workspace and resolves the installation root through
 * resolveRepoRoot().
 *
 * Deliberately outside the repo tree (and stable) so no repo instruction file sits
 * anywhere on the walk-up. Created if absent.
 */
export function resolveProductChatWorkingDirectory(scope?: string): string {
  const mainDirectory = path.resolve(process.env.LIQUIDAITY_PRODUCT_CHAT_CWD
    || path.join(process.env.LOCALAPPDATA || os.homedir(), 'LiquidAIty', 'workspaces', 'main'));
  // Sibling workspaces cannot discover Main's context by walking their ancestors.
  const dir = scope
    ? path.join(path.dirname(mainDirectory), createHash('sha256').update(scope).digest('hex').slice(0, 24))
    : mainDirectory;
  const inside = (root: string, target: string) => {
    const relative = path.relative(root, target);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
  };
  if (inside(resolveRepoRoot(), dir) || inside(os.tmpdir(), dir)) {
    throw new Error('product_workspace_must_be_neutral_and_durable');
  }
  mkdirSync(dir, { recursive: true });
  const resolved = realpathSync(dir);
  if (inside(realpathSync(resolveRepoRoot()), resolved) || inside(realpathSync(os.tmpdir()), resolved)) {
    throw new Error('product_workspace_must_be_neutral_and_durable');
  }
  return resolved;
}
