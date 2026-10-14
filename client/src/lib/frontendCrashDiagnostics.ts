export type FrontendCrashRecord = {
  type: "react_error_boundary" | "window_error" | "unhandled_rejection";
  message: string;
  stack?: string;
  componentStack?: string;
  timestamp: number;
  route: string;
  href: string;
  projectId: string | null;
  activeDeckOrCanvasId: string | null;
};

let lastCrashRecord: FrontendCrashRecord | null = null;
let globalHooksInstalled = false;

function safeWindowLocation() {
  if (typeof window === "undefined") {
    return { route: "", href: "" };
  }
  return {
    route: window.location.pathname + window.location.search + window.location.hash,
    href: window.location.href,
  };
}

function readUrlContext() {
  if (typeof window === "undefined") {
    return { projectId: null, activeDeckOrCanvasId: null };
  }
  const search = new URLSearchParams(window.location.search);
  const projectId = search.get("projectId");
  const activeDeckOrCanvasId =
    search.get("deckId") ||
    search.get("canvasId") ||
    search.get("workspaceId") ||
    null;
  return {
    projectId: projectId && projectId.trim() ? projectId : null,
    activeDeckOrCanvasId:
      activeDeckOrCanvasId && activeDeckOrCanvasId.trim()
        ? activeDeckOrCanvasId
        : null,
  };
}

export function getLastFrontendCrash(): FrontendCrashRecord | null {
  return lastCrashRecord;
}

export function clearFrontendCrash(): void {
  lastCrashRecord = null;
}

export function reportFrontendCrash(
  partial: Omit<
    FrontendCrashRecord,
    "timestamp" | "route" | "href" | "projectId" | "activeDeckOrCanvasId"
  >,
): FrontendCrashRecord {
  const location = safeWindowLocation();
  const urlContext = readUrlContext();
  const record: FrontendCrashRecord = {
    ...partial,
    timestamp: Date.now(),
    route: location.route,
    href: location.href,
    projectId: urlContext.projectId,
    activeDeckOrCanvasId: urlContext.activeDeckOrCanvasId,
  };
  lastCrashRecord = record;
  return record;
}

export function installGlobalFrontendCrashHooks(): void {
  if (globalHooksInstalled || typeof window === "undefined") {
    return;
  }
  globalHooksInstalled = true;

  window.addEventListener("error", (event) => {
    const err = event.error;
    reportFrontendCrash({
      type: "window_error",
      message:
        (err && typeof err.message === "string" && err.message) ||
        event.message ||
        "Unknown window error",
      stack: err && typeof err.stack === "string" ? err.stack : undefined,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    let message = "Unhandled promise rejection";
    let stack: string | undefined;

    if (reason instanceof Error) {
      message = reason.message || message;
      stack = reason.stack;
    } else if (typeof reason === "string") {
      message = reason;
    } else if (reason != null) {
      try {
        message = JSON.stringify(reason);
      } catch {
        message = String(reason);
      }
    }

    reportFrontendCrash({
      type: "unhandled_rejection",
      message,
      stack,
    });
  });
}
