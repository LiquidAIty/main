import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  guardedRequest,
  isAbortLikeError,
  isLatestRequestSequence,
  nextRequestSequence,
  safeJson,
} from "./requestGuards";

function normalizeProjectCardKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function inferProjectCardType(card: any): "assist" | "agent" {
  const explicit = String(card?.project_type ?? "").trim().toLowerCase();
  if (explicit === "assist" || explicit === "agent") {
    return explicit;
  }

  const codeKey = normalizeProjectCardKey(card?.code);
  const nameKey = normalizeProjectCardKey(card?.name);
  const legacyAgentKeys = new Set([
    "main-chat",
    "kg-ingest",
    "thinkgraph",
    "knowgraph",
    "neo4j",
    "research-agent",
    "agent-builder",
  ]);

  if (legacyAgentKeys.has(codeKey) || legacyAgentKeys.has(nameKey) || Boolean(card?.hasAgentConfig)) {
    return "agent";
  }

  return "assist";
}

function isAdminProjectCard(card: any): boolean {
  const rawName = String(card?.name ?? "").trim();
  const rawCode = String(card?.code ?? "").trim();
  if (rawName === "ADMIN") return true;
  if (rawCode === "ADMIN") return true;
  const codeKey = normalizeProjectCardKey(card?.code);
  const nameKey = normalizeProjectCardKey(card?.name);
  return codeKey === "admin" || nameKey === "admin";
}

function dedupeProjectCards(cards: any[]): any[] {
  const byKey = new Map<string, any>();

  cards.forEach((card: any) => {
    const codeKey = normalizeProjectCardKey(card?.code);
    const nameKey = normalizeProjectCardKey(card?.name);
    const idKey = String(card?.id ?? "").trim();
    const key = codeKey ? `code:${codeKey}` : nameKey ? `name:${nameKey}` : `id:${idKey}`;
    if (!key) return;

    const next = {
      ...card,
      project_type: inferProjectCardType(card),
    };
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, next);
      return;
    }

    const existingExactAdmin = String(existing?.name ?? "").trim() === "ADMIN";
    const nextExactAdmin = String(next?.name ?? "").trim() === "ADMIN";
    if (!existingExactAdmin && nextExactAdmin) {
      byKey.set(key, next);
      return;
    }

    const existingSynthetic = Boolean(existing?.syntheticSystemDeck);
    const nextSynthetic = Boolean(next?.syntheticSystemDeck);
    if (existingSynthetic && !nextSynthetic) {
      byKey.set(key, next);
      return;
    }
    if (!existing?.project_type && next?.project_type) {
      byKey.set(key, next);
    }
  });

  return Array.from(byKey.values());
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
      const cards = dedupeProjectCards(rawCards);
      const assistCards = cards.filter((card: any) => inferProjectCardType(card) === "assist");
      const adminAssistCard =
        assistCards.find((card: any) => String(card?.name ?? "").trim() === "ADMIN") ??
        assistCards.find((card: any) => String(card?.code ?? "").trim() === "ADMIN") ??
        assistCards.find((card: any) => isAdminProjectCard(card)) ??
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
    () => projects.filter((project: any) => inferProjectCardType(project) === "assist"),
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
