import { describe, expect, it } from 'vitest';

import {
  isBoundedCodeGraphScope,
  validateCodeGraphScope,
  MAX_DEPENDENCY_DEPTH,
  type CodeGraphScope,
} from './codeGraphScope';

const base: CodeGraphScope = {
  repositoryId: 'C-Projects-main',
  rootPath: 'C:/Projects/main',
  representedRawNodeIds: [],
  representedRawEdgeIds: [],
};

describe('CodeGraphScope contract', () => {
  it('accepts a minimal repository-bound scope', () => {
    expect(validateCodeGraphScope(base)).toEqual({ ok: true, errors: [] });
  });

  it('requires explicit identity — no default/guessed fallback', () => {
    const r = validateCodeGraphScope({ ...base, repositoryId: '' });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/repositoryId required/);
  });

  it('expresses "one folder at a time" and is bounded', () => {
    const scope: CodeGraphScope = { ...base, folderPath: 'services/knowgraph' };
    expect(validateCodeGraphScope(scope).ok).toBe(true);
    expect(isBoundedCodeGraphScope(scope)).toBe(true);
  });

  it('expresses "one module" and "module plus direct tests"', () => {
    const oneModule: CodeGraphScope = { ...base, moduleIds: ['mod:strategy_core'] };
    expect(validateCodeGraphScope(oneModule).ok).toBe(true);
    expect(isBoundedCodeGraphScope(oneModule)).toBe(true);

    const moduleAndTests: CodeGraphScope = {
      ...base,
      moduleIds: ['mod:strategy_core'],
      testIds: ['test:strategy_core_spec'],
      includeTests: true,
    };
    expect(validateCodeGraphScope(moduleAndTests).ok).toBe(true);
  });

  it('a whole-repo scope (no folder/module/symbol) is NOT bounded', () => {
    expect(isBoundedCodeGraphScope(base)).toBe(false);
  });

  it('rejects an out-of-range dependencyDepth', () => {
    expect(validateCodeGraphScope({ ...base, dependencyDepth: -1 }).ok).toBe(false);
    expect(
      validateCodeGraphScope({ ...base, dependencyDepth: MAX_DEPENDENCY_DEPTH + 1 })
        .ok,
    ).toBe(false);
    expect(validateCodeGraphScope({ ...base, dependencyDepth: 2 }).ok).toBe(true);
  });

  it('preserves raw CBM ids for reversibility', () => {
    const scope: CodeGraphScope = {
      ...base,
      representedRawNodeIds: ['1146', '1147'],
      representedRawEdgeIds: ['e1'],
    };
    expect(validateCodeGraphScope(scope).ok).toBe(true);
    expect(scope.representedRawNodeIds).toEqual(['1146', '1147']);
  });

  it('rejects non-explicit (empty) ids in an id list', () => {
    const r = validateCodeGraphScope({ ...base, moduleIds: ['', 'ok'] });
    expect(r.ok).toBe(false);
  });
});
