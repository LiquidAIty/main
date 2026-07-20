import { mkdirSync } from 'node:fs';
import os from 'node:os';
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

/** Project-scoped workspace: <workspace>/<projectId>/cards/<cardId>/runs/<runId>/.
 * Two projects never share card artifacts. Callers that pass projectId get
 * isolation; callers without it get the legacy un-scoped root for non-artifact
 * paths (handoff, episodes, dev-telemetry). */
export function resolveProjectWorkspaceRoot(projectId: string): string {
  const root = path.join(resolveCoderWorkspaceRoot(), 'projects', sanitizeId(projectId));
  mkdirSync(root, { recursive: true });
  return root;
}

/**
 * The working directory for a PRODUCT chat session (Main / Hermes over gRPC).
 *
 * It must NOT be the repo root: the engine walks up from its working directory
 * loading project-memory files (AGENTS.md / CLAUDE.md / .claude/rules/*), and a
 * repo-root cwd injects the repo's DEVELOPER instructions (~8.4k tokens, M-1)
 * into a PRODUCT conversation that never needed them. Main and Hermes drive the
 * project through MCP tools (ThinkGraph/KnowGraph/CodeGraph/canvas), not the
 * filesystem, so a neutral out-of-repo directory removes the memory walk with
 * zero capability loss. The Coder keeps its real repo root — it is spawned by
 * the backend via resolveRepoRoot(), a different process, unaffected by this.
 *
 * Deliberately outside the repo tree (and stable) so no AGENTS.md/CLAUDE.md sits
 * anywhere on the walk-up. Created if absent.
 */
export function resolveProductChatWorkingDirectory(): string {
  const dir = process.env.LIQUIDAITY_PRODUCT_CHAT_CWD
    ? String(process.env.LIQUIDAITY_PRODUCT_CHAT_CWD)
    : path.join(os.tmpdir(), 'liquidaity-product-chat');
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    // best effort — the engine re-validates the directory at session start
  }
  return dir;
}

// ── Card workspace authority ────────────────────────────────────────────
// Cards own durable workspaces. Runs live beneath their card. One authority.

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function sanitizeId(id: string): string {
  const trimmed = String(id || '').trim();
  if (!trimmed || trimmed === '.' || trimmed === '..') throw new Error(`card_workspace_id_invalid: ${id}`);
  if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes(path.sep)) throw new Error(`card_workspace_id_separator: ${id}`);
  if (!SAFE_ID.test(trimmed)) throw new Error(`card_workspace_id_unsafe: ${id}`);
  return trimmed;
}

function withinWorkspace(root: string, target: string): boolean {
  const r = path.resolve(root);
  const t = path.resolve(target);
  return t === r || t.startsWith(r + path.sep);
}

/** <project-workspace>/cards/<card-id>/ — the one durable card workspace. */
export function resolveCardWorkspace(projectId: string, cardId: string): string {
  const root = resolveProjectWorkspaceRoot(projectId);
  const dir = path.join(root, 'cards', sanitizeId(cardId));
  if (!withinWorkspace(root, dir)) throw new Error(`card_workspace_escapes: ${cardId}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** <project-workspace>/cards/<card-id>/runs/<run-id>/ — one run beneath its owning card. */
export function resolveCardRunDir(projectId: string, cardId: string, runId: string): string {
  const cw = resolveCardWorkspace(projectId, cardId);
  const dir = path.join(cw, 'runs', sanitizeId(runId));
  if (!withinWorkspace(cw, dir)) throw new Error(`card_run_escapes: ${runId}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}
