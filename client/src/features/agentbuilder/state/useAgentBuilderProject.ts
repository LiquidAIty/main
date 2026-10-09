import { useCallback, useEffect, useRef, useState } from 'react';

import { waitForBackendReady } from '../api/backendReadiness';
import {
  guardedRequest,
  isAbortLikeError,
  isLatestRequestSequence,
  nextRequestSequence,
  safeJson,
} from '../api/requestGuards';

export type AgentProjectSummary = {
  id: string;
  name?: string | null;
  code?: string | null;
  project_type?: 'assist' | 'agent';
};

type UseAgentBuilderProjectArgs = {
  projectsApi: string;
  workspaceView: string;
  openCanvasWorkspace: () => void;
};

export default function useAgentBuilderProject({
  projectsApi,
  workspaceView,
  openCanvasWorkspace,
}: UseAgentBuilderProjectArgs) {
  const [activeProject, setActiveProject] = useState('');
  const [builderProjects, setBuilderProjects] = useState<AgentProjectSummary[]>([]);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const refreshSequenceRef = useRef(0);
  const refreshAbortRef = useRef<AbortController | null>(null);
  const mountRefreshRanRef = useRef(false);
  const canvasAutoOpenedForProjectRef = useRef(false);
  const canvasProjectId = activeProject.trim();

  const setActiveProjectWithUrl = useCallback((projectId: string) => {
    const normalizedProjectId = String(projectId ?? '').trim();
    const currentSearch = window.location.search.replace(/^\?/, '');
    const current = new URLSearchParams(currentSearch).get('projectId') || '';
    if (normalizedProjectId === activeProject && normalizedProjectId === current) return;

    const nextSearch = new URLSearchParams(window.location.search);
    if (normalizedProjectId) nextSearch.set('projectId', normalizedProjectId);
    else nextSearch.delete('projectId');
    const nextQuery = nextSearch.toString();
    setActiveProject(normalizedProjectId);
    if (nextQuery !== currentSearch) {
      window.history.replaceState(
        {},
        '',
        nextQuery ? `${window.location.pathname}?${nextQuery}` : window.location.pathname,
      );
    }
  }, [activeProject]);

  const refreshProjects = useCallback(async (
    reason?: string,
    preferredProjectId?: string,
  ) => {
    const sequence = ++refreshSequenceRef.current;
    const requestType = 'projects-refresh';
    const requestSequence = nextRequestSequence(requestType);
    refreshAbortRef.current?.abort();
    const controller = new AbortController();
    refreshAbortRef.current = controller;

    try {
      setProjectsError(null);
      await waitForBackendReady({ signal: controller.signal });
      const { response, data } = await guardedRequest({
        key: 'projects:list:all',
        method: 'GET',
        ttlMs: 3_000,
        bypassCache: reason === 'after-create' || reason === 'after-delete',
        signal: controller.signal,
        fetcher: async (signal) => {
          const response = await fetch(projectsApi, { signal });
          return { response, data: await safeJson(response) };
        },
      });
      if (
        controller.signal.aborted
        || sequence !== refreshSequenceRef.current
        || !isLatestRequestSequence(requestType, requestSequence)
      ) return;
      if (!data) {
        console.warn('[refreshProjects] empty response', {
          status: response.status,
          url: response.url,
        });
        if (response.status !== 304 && response.status !== 204) {
          setProjectsError(`Error loading projects (HTTP ${response.status})`);
          setBuilderProjects([]);
        }
        return;
      }

      const records = Array.isArray(data.projects) ? data.projects : [];
      const projects = records.filter((project: unknown): project is AgentProjectSummary => {
        if (!project || typeof project !== 'object' || Array.isArray(project)) return false;
        const record = project as Record<string, unknown>;
        return typeof record.id === 'string'
          && (record.project_type === 'assist' || record.project_type === 'agent');
      });
      setBuilderProjects(projects);

      const urlProjectId = new URLSearchParams(window.location.search).get('projectId') || '';
      const urlProjectExists = Boolean(
        urlProjectId && projects.some((project) => project.id === urlProjectId),
      );
      const currentProjectId = preferredProjectId || activeProject || '';
      const currentProjectExists = Boolean(
        currentProjectId && projects.some((project) => project.id === currentProjectId),
      );
      setActiveProjectWithUrl(
        (urlProjectExists ? urlProjectId : '')
          || (currentProjectExists ? currentProjectId : '')
          || projects[0]?.id
          || '',
      );
    } catch (error: unknown) {
      if (isAbortLikeError(error)) return;
      console.error('Error loading projects:', error);
      if (
        sequence !== refreshSequenceRef.current
        || !isLatestRequestSequence(requestType, requestSequence)
      ) return;
      setProjectsError(error instanceof Error && error.message
        ? error.message
        : 'Error loading projects');
    }
  }, [activeProject, projectsApi, setActiveProjectWithUrl]);

  useEffect(() => {
    if (mountRefreshRanRef.current) return;
    let cancelled = false;
    const timerId = window.setTimeout(() => {
      if (cancelled || mountRefreshRanRef.current) return;
      mountRefreshRanRef.current = true;
      const urlProjectId = new URLSearchParams(window.location.search).get('projectId') || '';
      if (urlProjectId) setActiveProjectWithUrl(urlProjectId);
      void refreshProjects('mount');
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
  }, [refreshProjects, setActiveProjectWithUrl]);

  useEffect(() => () => refreshAbortRef.current?.abort(), []);

  useEffect(() => {
    if (!canvasProjectId) {
      canvasAutoOpenedForProjectRef.current = false;
      return;
    }
    if (workspaceView !== 'chat') {
      canvasAutoOpenedForProjectRef.current = true;
      return;
    }
    if (canvasAutoOpenedForProjectRef.current) return;
    canvasAutoOpenedForProjectRef.current = true;
    openCanvasWorkspace();
  }, [canvasProjectId, openCanvasWorkspace, workspaceView]);

  return {
    activeProject,
    builderProjects,
    projectsError,
    setProjectsError,
    setActiveProjectWithUrl,
    refreshProjects,
    canvasProjectId,
  };
}
