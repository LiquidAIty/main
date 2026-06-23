import { describe, expect, it } from 'vitest';

import {
  normalizeRepoPath,
  resolveCbmProjectName,
} from './resolveCodeGraphProjectIdentity';

describe('CodeGraph authoritative CBM identity resolution', () => {
  it('normalizes Windows repo paths to a comparable form', () => {
    expect(normalizeRepoPath('C:\\Projects\\main')).toBe('c:/projects/main');
    expect(normalizeRepoPath('C:/Projects/main/')).toBe('c:/projects/main');
  });

  it('binds CodeGraph to the indexed project whose root_path is the active repo', async () => {
    const list = async () => ({
      projects: [
        { name: 'C-Other-repo', root_path: 'C:/Other/repo', nodes: 10 },
        { name: 'C-Projects-main', root_path: 'C:/Projects/main', nodes: 5674 },
      ],
    });
    const name = await resolveCbmProjectName('C:\\Projects\\main', list);
    expect(name).toBe('C-Projects-main');
  });

  it('never returns the stale hardcoded identity', async () => {
    const list = async () => ({
      projects: [{ name: 'C-Projects-main', root_path: 'C:/Projects/main' }],
    });
    const name = await resolveCbmProjectName('C:\\Projects\\main', list);
    expect(name).not.toBe('C-Projects-LiquidAIty-main');
    expect(name).toBe('C-Projects-main');
  });

  it('accepts the single indexed project as the active workbench repo', async () => {
    const list = async () => ({
      projects: [{ name: 'C-Projects-main', root_path: 'C:/Projects/main' }],
    });
    // path format differs but there is exactly one indexed repo
    const name = await resolveCbmProjectName('/weird/unmatched/path', list);
    expect(name).toBe('C-Projects-main');
  });

  it('returns null (honest unresolved) when no match and multiple projects exist', async () => {
    const list = async () => ({
      projects: [
        { name: 'C-Other-a', root_path: 'C:/Other/a' },
        { name: 'C-Other-b', root_path: 'C:/Other/b' },
      ],
    });
    const name = await resolveCbmProjectName('C:\\Projects\\main', list);
    expect(name).toBeNull();
  });

  it('returns null when CBM has no indexed projects (no fabricated identity)', async () => {
    const list = async () => ({ projects: [] });
    const name = await resolveCbmProjectName('C:\\Projects\\main', list);
    expect(name).toBeNull();
  });
});
