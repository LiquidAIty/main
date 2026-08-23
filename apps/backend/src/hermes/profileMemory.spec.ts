import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveRepoRoot } from '../coder/workspaceRoot';

import { resolveHermesRuntimeHome } from './profileMemory';

const HERMES_ROOT = path.join(resolveRepoRoot(), 'Hermes');
describe('Hermes runtime home', () => {
  it('resolves the repository-owned native Hermes root without mutating it', () => {
    const home = resolveHermesRuntimeHome(HERMES_ROOT);
    expect(home).toBe(path.join(HERMES_ROOT, '.hermes'));
  });
});
