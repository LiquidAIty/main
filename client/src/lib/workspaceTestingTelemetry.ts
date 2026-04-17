export type WorkspaceTestingSurface = "chat" | "plan" | "canvas" | "knowledge" | "codegraph";
export type WorkspaceTestingSurfaceRole = "large" | "companion";
export type WorkspaceTestingObjectType =
  | "agent_node"
  | "agent_edge"
  | "knowledge_node"
  | "knowledge_edge";

export type WorkspaceTestingEventName =
  | "chat_send_started"
  | "chat_response_received"
  | "post_response_refresh_completed"
  | "surface_opened"
  | "agent_graph_node_selected"
  | "agent_graph_edge_selected"
  | "knowledge_graph_node_selected"
  | "knowledge_graph_edge_selected"
  | "workspace_panel_opened_from_graph_selection"
  | "return_to_chat"
  | "workspace_state_refresh_completed"
  | "graph_refresh_completed";

export type WorkspaceTestingEvent = {
  id: string;
  event: WorkspaceTestingEventName;
  timestamp: number;
  isoTime: string;
  projectId: string | null;
  surface?: WorkspaceTestingSurface | null;
  surfaceRole?: WorkspaceTestingSurfaceRole | null;
  objectType?: WorkspaceTestingObjectType | null;
  objectId?: string | null;
  durationMs?: number | null;
  interactionId?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type WorkspaceTestingEventInput = Omit<
  WorkspaceTestingEvent,
  "id" | "timestamp" | "isoTime"
> & {
  timestamp?: number;
};

type WorkspaceTestingInspector = {
  enable: () => void;
  disable: () => void;
  isEnabled: () => boolean;
  readEvents: () => WorkspaceTestingEvent[];
  clearEvents: () => void;
};

declare global {
  interface Window {
    __LIQUIDAITY_WORKSPACE_TESTING__?: WorkspaceTestingInspector;
    __LIQUIDAITY_WORKSPACE_TESTING_ENABLED__?: boolean;
  }
}

const STORAGE_KEY = "liquidaity:workspace-testing";
const MAX_EVENTS = 500;
let eventSequence = 0;
let enabledOverride: boolean | null = null;
const eventBuffer: WorkspaceTestingEvent[] = [];

function readStoredFlag(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeStoredFlag(enabled: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // ignore storage errors in restricted environments
  }
}

function testModeEnabled(): boolean {
  try {
    return (import.meta as any)?.env?.MODE === "test";
  } catch {
    return false;
  }
}

export function isWorkspaceTestingEnabled(): boolean {
  if (enabledOverride != null) return enabledOverride;
  if (typeof window !== "undefined" && window.__LIQUIDAITY_WORKSPACE_TESTING_ENABLED__ === true) {
    return true;
  }
  return testModeEnabled() || readStoredFlag();
}

function syncInspector() {
  if (typeof window === "undefined") return;
  const inspector: WorkspaceTestingInspector = {
    enable: () => setWorkspaceTestingEnabled(true),
    disable: () => setWorkspaceTestingEnabled(false),
    isEnabled: () => isWorkspaceTestingEnabled(),
    readEvents: () => readWorkspaceTestingEvents(),
    clearEvents: () => clearWorkspaceTestingEvents(),
  };
  window.__LIQUIDAITY_WORKSPACE_TESTING__ = inspector;
}

export function setWorkspaceTestingEnabled(enabled: boolean) {
  enabledOverride = enabled;
  if (typeof window !== "undefined") {
    window.__LIQUIDAITY_WORKSPACE_TESTING_ENABLED__ = enabled;
  }
  writeStoredFlag(enabled);
  syncInspector();
}

export function clearWorkspaceTestingEvents() {
  eventBuffer.length = 0;
}

export function readWorkspaceTestingEvents(): WorkspaceTestingEvent[] {
  return eventBuffer.map((event) => ({
    ...event,
    metadata: event.metadata ? { ...event.metadata } : event.metadata ?? null,
  }));
}

export function createWorkspaceTestingInteractionId(prefix = "workspace"): string {
  eventSequence += 1;
  return `${prefix}-${Date.now()}-${eventSequence}`;
}

export function recordWorkspaceTestingEvent(
  input: WorkspaceTestingEventInput,
): WorkspaceTestingEvent | null {
  if (!isWorkspaceTestingEnabled()) return null;
  const timestamp =
    typeof input.timestamp === "number" && Number.isFinite(input.timestamp)
      ? input.timestamp
      : Date.now();
  eventSequence += 1;
  const event: WorkspaceTestingEvent = {
    id: `workspace-event-${eventSequence}`,
    event: input.event,
    timestamp,
    isoTime: new Date(timestamp).toISOString(),
    projectId: input.projectId ?? null,
    surface: input.surface ?? null,
    surfaceRole: input.surfaceRole ?? null,
    objectType: input.objectType ?? null,
    objectId: input.objectId ?? null,
    durationMs:
      typeof input.durationMs === "number" && Number.isFinite(input.durationMs)
        ? input.durationMs
        : null,
    interactionId: input.interactionId ?? null,
    metadata: input.metadata ? { ...input.metadata } : null,
  };
  eventBuffer.push(event);
  if (eventBuffer.length > MAX_EVENTS) {
    eventBuffer.splice(0, eventBuffer.length - MAX_EVENTS);
  }
  return event;
}

syncInspector();
