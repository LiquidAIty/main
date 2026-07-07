import { mkdirSync } from 'node:fs';
import path from 'node:path';

/**
 * The one trusted default Local Coder workspace resolver.
 *
 * The repo root is the server authority (LIQUIDAITY_GRPC_CWD, default the canonical
 * repo path) — never a client-supplied path. The DEFAULT owned Coder workspace is
 * <repo-root>/coder-workspace: where Local Coder keeps its handoff prompts, returned
 * model artifacts, and its own future repos/apps/documents — NOT the LiquidAIty repo
 * root. Created if absent.
 *
 * One resolver shared by runMagOne (job handoff), configured-card result folders,
 * run_local_coder's default root, and (mirrored) the Python job-folder tools. The
 * native OpenClaude chat/console launch keeps its own cwd unchanged — only this
 * assigned workspace default moves off the repo root.
 */
export function resolveRepoRoot(): string {
  return process.env.LIQUIDAITY_GRPC_CWD || 'C:/Projects/main';
}

export function resolveCoderWorkspaceRoot(): string {
  const root = path.join(resolveRepoRoot(), 'coder-workspace');
  try {
    mkdirSync(root, { recursive: true });
  } catch {
    // best effort — the Python job-folder resolver re-validates the directory
  }
  return root;
}
