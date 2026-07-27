import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function resolveRepoRoot(): string {
  return process.env.LIQUIDAITY_GRPC_CWD || 'C:/Projects/main';
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
