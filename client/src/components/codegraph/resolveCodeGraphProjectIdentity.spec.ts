import { describe, expect, it } from 'vitest';

import {
  normalizeRepoPath,
  resolveCbmProjectName,
} from './resolveCodeGraphProjectIdentity';

describe('CodeGraph authoritative CBM identity resolution', () => {
  const ready = async (projectName: string) => ({
    project: projectName,
    status: 'ready',
  });

  it('normalizes Windows repo paths to a comparable form', () => {
    expect(normalizeRepoPath('C:\\Projects\\main')).toBe('c:/projects/main');
    expect(normalizeRepoPath('C:/Projects/main/')).toBe('c:/projects/main');
  });

  it('prefers a valid explicitly configured project', async () => {
    const name = await resolveCbmProjectName('C:\\Projects\\main', {
      configuredProjectName: 'C-Configured-main',
      listProjects: async () => ({
        projects: [
          { name: 'C-Projects-main', root_path: 'C:/Projects/main' },
          { name: 'C-Configured-main', root_path: 'C:/Configured/main' },
        ],
      }),
      getProjectStatus: ready,
    });
    expect(name).toBe('C-Configured-main');
  });

  it('prefers the canonical project over an earlier stale same-root index', async () => {
    const name = await resolveCbmProjectName('C:\\Projects\\main', {
      listProjects: async () => ({
        projects: [
          {
            name: 'C-Projects-main-2cf8608-validation',
            root_path: 'C:/Projects/main',
          },
          { name: 'C-Projects-main', root_path: 'C:/Projects/main' },
        ],
      }),
      getProjectStatus: ready,
    });
    expect(name).toBe('C-Projects-main');
  });

  it('chooses the canonical project regardless of list ordering', async () => {
    const name = await resolveCbmProjectName('C:\\Projects\\main', {
      listProjects: async () => ({
        projects: [
          { name: 'C-Projects-main', root_path: 'C:/Projects/main' },
          {
            name: 'C-Projects-main-validation',
            root_path: 'C:/Projects/main',
          },
        ],
      }),
      getProjectStatus: ready,
    });
    expect(name).toBe('C-Projects-main');
  });

  it('uses the only ready exact-root project when the canonical identity is absent', async () => {
    const name = await resolveCbmProjectName('C:\\Projects\\main', {
      canonicalProjectName: 'C-Missing-canonical',
      listProjects: async () => ({
        projects: [
          { name: 'C-Projects-main-stale', root_path: 'C:/Projects/main' },
          { name: 'C-Projects-main-ready', root_path: 'C:/Projects/main' },
        ],
      }),
      getProjectStatus: async (projectName) => ({
        project: projectName,
        status: projectName.endsWith('-ready') ? 'ready' : 'stale',
      }),
    });
    expect(name).toBe('C-Projects-main-ready');
  });

  it('rejects ambiguous ready same-root projects and names every candidate', async () => {
    const resolution = resolveCbmProjectName('C:\\Projects\\main', {
      canonicalProjectName: 'C-Missing-canonical',
      listProjects: async () => ({
        projects: [
          { name: 'C-Projects-main-a', root_path: 'C:/Projects/main' },
          { name: 'C-Projects-main-b', root_path: 'C:/Projects/main' },
        ],
      }),
      getProjectStatus: ready,
    });
    await expect(resolution).rejects.toThrow(
      'CBM project identity is ambiguous for C:\\Projects\\main: C-Projects-main-a, C-Projects-main-b',
    );
  });

  it('rejects an indexed canonical project that is not ready', async () => {
    const resolution = resolveCbmProjectName('C:\\Projects\\main', {
      listProjects: async () => ({
        projects: [{ name: 'C-Projects-main', root_path: 'C:/Projects/main' }],
      }),
      getProjectStatus: async (projectName) => ({
        project: projectName,
        status: 'stale',
      }),
    });
    await expect(resolution).rejects.toThrow(
      'CBM project is not ready: C-Projects-main (stale)',
    );
  });

  it('rejects when the canonical project and exact-root candidates are absent', async () => {
    const resolution = resolveCbmProjectName('C:\\Projects\\main', {
      listProjects: async () => ({
        projects: [{ name: 'C-Other-repo', root_path: 'C:/Other/repo' }],
      }),
      getProjectStatus: ready,
    });
    await expect(resolution).rejects.toThrow(
      'CBM project is not indexed: C-Projects-main',
    );
  });
});
