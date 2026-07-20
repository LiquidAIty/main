import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { resolveProductChatWorkingDirectory, resolveRepoRoot } from './workspaceRoot';

// M-1: a product Main Chat session must NOT run with the repo root as
// its working directory, or the engine walks up loading AGENTS.md/CLAUDE.md
// (~8.4k tokens of developer memory) into a product conversation.
describe('resolveProductChatWorkingDirectory — no repo-memory walk', () => {
  const cwd = resolveProductChatWorkingDirectory();
  const repoRoot = path.resolve(resolveRepoRoot());

  it('resolves to a real, existing directory', () => {
    expect(cwd.length).toBeGreaterThan(0);
    expect(existsSync(cwd)).toBe(true);
  });

  it('is OUTSIDE the repo tree (so the walk-up finds no AGENTS.md/CLAUDE.md)', () => {
    const resolved = path.resolve(cwd);
    expect(resolved.startsWith(repoRoot + path.sep)).toBe(false);
    expect(resolved).not.toBe(repoRoot);
  });

  it('contains no project-memory files that would be injected into chat', () => {
    for (const name of ['AGENTS.md', 'CLAUDE.md']) {
      expect(existsSync(path.join(cwd, name))).toBe(false);
    }
  });

  it('honors an explicit override', () => {
    const prev = process.env.LIQUIDAITY_PRODUCT_CHAT_CWD;
    try {
      process.env.LIQUIDAITY_PRODUCT_CHAT_CWD = path.join(cwd, 'override-probe');
      expect(path.resolve(resolveProductChatWorkingDirectory())).toBe(
        path.resolve(path.join(cwd, 'override-probe')),
      );
    } finally {
      if (prev === undefined) delete process.env.LIQUIDAITY_PRODUCT_CHAT_CWD;
      else process.env.LIQUIDAITY_PRODUCT_CHAT_CWD = prev;
    }
  });

  it('is stable across calls (same session cwd)', () => {
    expect(resolveProductChatWorkingDirectory()).toBe(cwd);
  });
});
