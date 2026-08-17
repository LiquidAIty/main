import { existsSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function resolveRepoRoot(): string {
  const configured = String(process.env.LIQUIDAITY_GRPC_CWD || '').trim();
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
  throw new Error('missing_required_config: LIQUIDAITY_GRPC_CWD');
}

/**
 * The working directory for a PRODUCT chat session (Main / Hermes over gRPC).
 *
 * It must NOT be the repo root: the engine walks up from its working directory
 * loading project-memory files such as AGENTS.md, and a
 * repo-root cwd injects the repo's DEVELOPER instructions (~8.4k tokens, M-1)
 * into a PRODUCT conversation that never needed them. Main and Hermes drive the
 * project through MCP tools (Engraphis/Graphiti/CBM/canvas), not the
 * filesystem, so a neutral out-of-repo directory removes the memory walk with
 * zero capability loss. The Coder keeps its real repo root — it is spawned by
 * the backend via resolveRepoRoot(), a different process, unaffected by this.
 *
 * Deliberately outside the repo tree (and stable) so no repo instruction file sits
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
