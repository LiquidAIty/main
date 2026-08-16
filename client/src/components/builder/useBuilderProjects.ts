import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { waitForBackendReady } from "./backendReadiness";
import {
  guardedRequest,
  isAbortLikeError,
  isLatestRequestSequence,
  nextRequestSequence,
  safeJson,
} from "./requestGuards";

function isAdminProjectCard(card: any): boolean {
  return [card?.name, card?.code].some(
    (value) => String(value ?? "").trim().toUpperCase() === "ADMIN",
  );
}

export function useBuilderProjects({
  projectsApi,
  workspaceView,
}: {
  projectsApi: string;
  workspaceView: string;
}) {
  const [activeProject, setActiveProject] = useState("");
  const [projects, setProjects] = useState<any[]>([]);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const refreshSeq = useRef(0);
  const refreshAbortRef = useRef<AbortController | null>(null);
  const mountRefreshRanRef = useRef(false);

  const setActiveProjectWithUrl = useCallback(
    (projectId: string) => {
      const normalizedProjectId = String(projectId ?? "").trim();
      const currentSearch = window.location.search.replace(/^\?/, "");
      const current = new URLSearchParams(currentSearch).get("projectId") || "";
      if (normalizedProjectId === activeProject && normalizedProjectId === current) {
        return;
      }
      const nextSearch = new URLSearchParams(window.location.search);
      if (normalizedProjectId) {
        nextSearch.set("projectId", normalizedProjectId);
      } else {
        nextSearch.delete("projectId");
      }
      const nextQs = nextSearch.toString();
      const nextUrl = nextQs ? `${window.location.pathname}?${nextQs}` : window.location.pathname;
      setActiveProject(normalizedProjectId);
      if (nextQs !== currentSearch) {
        window.history.replaceState({}, "", nextUrl);
      }
    },
    [activeProject],
  );

  const refreshProjects = useCallback(async (reason?: string, preferredAssistId?: string) => {
    const seq = ++refreshSeq.current;
    const requestType = "projects-refresh";
    const requestSeq = nextRequestSequence(requestType);
    refreshAbortRef.current?.abort();
    const controller = new AbortController();
    refreshAbortRef.current = controller;

    try {
      setProjectsError(null);
      console.debug("[refreshProjects]", {
        reason: reason || "unknown",
        workspaceView,
        seq,
      });

      // Backend readiness gate: hold the projects-list fetch until the backend
      // is listening so the dev startup window doesn't spam ECONNREFUSED.
      await waitForBackendReady({ signal: controller.signal });

      const endpoint = projectsApi;
      const payload = await guardedRequest({
        key: "projects:list:all",
        method: "GET",
        ttlMs: 3_000,
        bypassCache: reason === "after-create" || reason === "after-delete",
        signal: controller.signal,
        fetcher: async (signal) => {
          const response = await fetch(endpoint, { signal });
          const data = await safeJson(response);
          return { response, data };
        },
      });
      const { response, data } = payload;

      if (controller.signal.aborted || seq !== refreshSeq.current || !isLatestRequestSequence(requestType, requestSeq)) return;
      if (!data) {
        console.warn("[refreshProjects] empty response", { status: response.status, url: response.url });
        if (response.status !== 304 && response.status !== 204) {
          setProjectsError(`Error loading projects (HTTP ${response.status})`);
          setProjects([]);
        }
        return;
      }

      const rawCards = Array.isArray(data?.projects) ? data.projects : [];
      const cards = rawCards.filter(
        (card: any) =>
          typeof card?.id === "string" &&
          (card?.project_type === "assist" || card?.project_type === "agent"),
      );
      const assistCards = cards.filter((card: any) => card.project_type === "assist");
      const adminAssistCard =
        assistCards.find((card: any) => String(card?.name ?? "").trim() === "ADMIN") ??
        assistCards.find((card: any) => String(card?.code ?? "").trim() === "ADMIN") ??
        assistCards.find((card: any) => isAdminProjectCard(card)) ??
        null;
      const canonicalDeckAssist =
        assistCards.find((card: any) => String(card?.code ?? '').trim().toLowerCase() === 'agent-builder') ??
        null;
      setProjects(cards);

      const search = new URLSearchParams(window.location.search);
      const urlId = search.get("projectId") || "";
      const urlIdValid = urlId && assistCards.some((card: any) => card.id === urlId);
      const currentAssistId = preferredAssistId || activeProject || "";
      const hasCurrentAssist = currentAssistId && assistCards.some((card: any) => card.id === currentAssistId);
      const nextAssistId =
        (urlIdValid ? urlId : "") ||
        (hasCurrentAssist ? currentAssistId : "") ||
        canonicalDeckAssist?.id ||
        adminAssistCard?.id ||
        assistCards[0]?.id ||
        "";
      if (nextAssistId) {
        setActiveProjectWithUrl(nextAssistId);
      } else {
        setActiveProjectWithUrl("");
      }
    } catch (err: any) {
      if (isAbortLikeError(err)) return;
      console.error("Error loading projects:", err);
      if (seq !== refreshSeq.current || !isLatestRequestSequence(requestType, requestSeq)) return;
      setProjectsError(err?.message || "Error loading projects");
    }
  }, [activeProject, projectsApi, setActiveProjectWithUrl, workspaceView]);

  const assistProjects = useMemo(
    () => projects.filter((project: any) => project.project_type === "assist"),
    [projects],
  );

  useEffect(() => {
    if (mountRefreshRanRef.current) return;
    let cancelled = false;
    const timerId = window.setTimeout(() => {
      if (cancelled || mountRefreshRanRef.current) return;
      mountRefreshRanRef.current = true;
      const search = new URLSearchParams(window.location.search);
      const urlId = search.get("projectId") || "";
      if (urlId) {
        setActiveProjectWithUrl(urlId);
      }
      void refreshProjects("mount");
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
  }, [refreshProjects, setActiveProjectWithUrl]);

  useEffect(() => {
    return () => {
      refreshAbortRef.current?.abort();
    };
  }, []);

  return {
    activeProject,
    assistProjects,
    projectsError,
    setProjectsError,
    setActiveProjectWithUrl,
    refreshProjects,
  };
}
