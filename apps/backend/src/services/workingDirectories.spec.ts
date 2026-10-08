import {
  existsSync,
  mkdtempSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  normalizeProjectCodeFolder,
  resolveBuilderProjectCodeDirectory,
  resolveProductChatWorkingDirectory,
  resolveRepoRoot,
} from './workingDirectories';

describe('product Card working directories', () => {
  const cwd = resolveProductChatWorkingDirectory();
  const repoRoot = path.resolve(resolveRepoRoot());

  it('keeps ordinary product conversations outside repository instructions', () => {
    expect(existsSync(cwd)).toBe(true);
    expect(path.resolve(cwd)).not.toBe(repoRoot);
    expect(path.resolve(cwd).startsWith(repoRoot + path.sep)).toBe(false);
    expect(existsSync(path.join(cwd, 'AGENTS.md'))).toBe(false);
    expect(existsSync(path.join(cwd, 'CLAUDE.md'))).toBe(false);
  });

  it('discovers this checkout from repository markers without a machine path', () => {
    const previous = process.env.LIQUIDAITY_REPO_ROOT;
    try {
      delete process.env.LIQUIDAITY_REPO_ROOT;
      expect(path.resolve(resolveRepoRoot())).toBe(path.resolve(process.cwd()));
    } finally {
      if (previous === undefined) delete process.env.LIQUIDAITY_REPO_ROOT;
      else process.env.LIQUIDAITY_REPO_ROOT = previous;
    }
  });

  it('honors the injected repository root used by packaged runtimes', () => {
    const previous = process.env.LIQUIDAITY_REPO_ROOT;
    try {
      process.env.LIQUIDAITY_REPO_ROOT = path.join(process.cwd(), 'injected-root');
      expect(resolveRepoRoot()).toBe(path.resolve(process.cwd(), 'injected-root'));
    } finally {
      if (previous === undefined) delete process.env.LIQUIDAITY_REPO_ROOT;
      else process.env.LIQUIDAITY_REPO_ROOT = previous;
    }
  });

  it('uses durable sibling directories for distinct ordinary Card scopes', () => {
    const first = resolveProductChatWorkingDirectory('isolation-first');
    const second = resolveProductChatWorkingDirectory('isolation-second');
    expect(first).not.toBe(second);
    expect(path.dirname(first)).toBe(path.dirname(cwd));
    expect(first.startsWith(os.tmpdir() + path.sep)).toBe(false);
    expect(resolveProductChatWorkingDirectory('isolation-first')).toBe(first);
  });

  it.each([repoRoot, path.join(repoRoot, 'HermesLatest'), os.tmpdir()])(
    'rejects a non-neutral or temporary product-chat override: %s',
    (target) => {
      const previous = process.env.LIQUIDAITY_PRODUCT_CHAT_CWD;
      try {
        process.env.LIQUIDAITY_PRODUCT_CHAT_CWD = target;
        expect(() => resolveProductChatWorkingDirectory()).toThrow(
          'product_workspace_must_be_neutral_and_durable',
        );
      } finally {
        if (previous === undefined) delete process.env.LIQUIDAITY_PRODUCT_CHAT_CWD;
        else process.env.LIQUIDAITY_PRODUCT_CHAT_CWD = previous;
      }
    },
  );
});

describe('Builder managed Project repository folder', () => {
  const createdRoots: string[] = [];
  const previousRoot = process.env.BUILDER_PROJECT_CODE_ROOT;

  afterEach(() => {
    if (previousRoot === undefined) delete process.env.BUILDER_PROJECT_CODE_ROOT;
    else process.env.BUILDER_PROJECT_CODE_ROOT = previousRoot;
    while (createdRoots.length > 0) {
      rmSync(createdRoots.pop()!, { recursive: true, force: true });
    }
  });

  function managedRoot(): string {
    const root = mkdtempSync(path.join(process.env.LOCALAPPDATA || os.homedir(), 'builder-folder-test-'));
    createdRoots.push(root);
    process.env.BUILDER_PROJECT_CODE_ROOT = root;
    return root;
  }

  it('resolves one portable folder name beneath the exact Project boundary', () => {
    const root = managedRoot();
    const resolved = resolveBuilderProjectCodeDirectory('project-one', 'worker-agent-ui');
    expect(resolved).toBe(path.join(realpathSync(root), 'project-one', 'worker-agent-ui'));
    expect(existsSync(resolved)).toBe(true);
    expect(resolveBuilderProjectCodeDirectory('project-one', 'worker-agent-ui')).toBe(resolved);
  });

  it.each([
    '', '.', '..', 'nested/folder', 'nested\\folder', 'C:\\outside', '/outside', 'NUL', 'trailing.',
  ])('rejects a non-portable or host-addressing folder: %s', (folder) => {
    expect(() => normalizeProjectCodeFolder(folder)).toThrow();
  });

  it('never accepts the LiquidAIty checkout as managed Builder storage', () => {
    process.env.BUILDER_PROJECT_CODE_ROOT = resolveRepoRoot();
    expect(() => resolveBuilderProjectCodeDirectory('project-one', 'worker-agent-ui'))
      .toThrow('builder_project_code_root_invalid');
  });
});
