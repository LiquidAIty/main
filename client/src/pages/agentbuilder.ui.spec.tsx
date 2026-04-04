// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AgentBuilder from "./agentbuilder";
import {
  clearWorkspaceTestingEvents,
  readWorkspaceTestingEvents,
  setWorkspaceTestingEnabled,
} from "../lib/workspaceTestingTelemetry";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../components/builder/BuilderCanvas", () => ({
  default: function BuilderCanvasMock(props: { onSelectCard?: (cardId: string | null) => void }) {
    return (
      <div data-testid="builder-canvas">
        Builder Canvas
        <button
          type="button"
          data-testid="builder-select-node"
          onClick={() => props.onSelectCard?.("main_chat")}
        >
          Select Agent Node
        </button>
      </div>
    );
  },
}));

vi.mock("../components/AgentManager", () => ({
  AgentManager: function AgentManagerMock() {
    return <div data-testid="agent-manager">Agent Manager</div>;
  },
}));

vi.mock("../components/knowledge/KnowledgeGraphNVL", () => ({
  default: function KnowledgeGraphMock(props: {
    entities?: Array<{ id: string; label?: string; type?: string; source?: string; scope?: string; degree?: number }>;
    relationships?: Array<{
      id: string;
      from: string;
      to: string;
      type: string;
      source?: string;
      scope?: string;
      evidence_snippet?: string;
    }>;
    selectionEnabled?: boolean;
    onSelectEntity?: (entity: any) => void;
    onSelectRelationship?: (relationship: any) => void;
    onRelationshipInspect?: (relationship: any) => void;
  }) {
    const firstEntity = props.entities?.[0] || null;
    const firstRelationship = props.relationships?.[0] || null;
    return (
      <div data-testid="knowledge-graph">
        Knowledge Graph
        {Array.isArray(props.entities) && props.entities.length > 0 ? (
          <div data-testid="knowledge-graph-ready">Ready</div>
        ) : null}
        {props.selectionEnabled ? (
          <div>
            <button
              type="button"
              data-testid="knowledge-select-node"
              onClick={() => props.onSelectEntity?.(firstEntity)}
            >
              Select Node
            </button>
            <button
              type="button"
              data-testid="knowledge-select-edge"
              onClick={() => {
                const relationship = firstRelationship;
                props.onSelectRelationship?.(relationship);
                props.onRelationshipInspect?.(relationship);
              }}
            >
              Select Edge
            </button>
            <button
              type="button"
              data-testid="knowledge-clear-selection"
              onClick={() => {
                props.onSelectEntity?.(null);
                props.onSelectRelationship?.(null);
                props.onRelationshipInspect?.(null);
              }}
            >
              Clear Selection
            </button>
          </div>
        ) : null}
      </div>
    );
  },
}));

vi.mock("../components/knowledge/UploadAttachment", () => ({
  default: function UploadAttachmentMock() {
    return <button type="button">Attach</button>;
  },
}));

vi.mock("../components/assist/PlanWikiLexicalView", () => ({
  default: function PlanWikiLexicalViewMock(props: { fallbackText: string }) {
    return <div>{props.fallbackText}</div>;
  },
}));

const ASSIST_PROJECT = {
  id: "assist_alpha",
  name: "Alpha Project",
  code: "alpha",
  project_type: "assist",
};

const AGENT_PROJECT = {
  id: "agent_main",
  name: "Main Chat",
  code: "main-chat",
  project_type: "agent",
};

let assistProjectState: {
  messages: Array<{ role: "assistant" | "user"; text: string }>;
  plan: Array<{ id: string; text: string; status: string }>;
  links: any[];
} = {
  messages: [{ role: "assistant", text: "Loaded chat state" }],
  plan: [{ id: "goal", text: "Define objective", status: "draft" }],
  links: [],
};
let bossRequests: Array<Record<string, unknown>> = [];

const mountedRoots: Array<() => void> = [];

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mount(element: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(element);
  });

  mountedRoots.push(() =>
    act(() => {
      root.unmount();
      container.remove();
    }),
  );

  return container;
}

async function flushUi() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

async function waitFor(assertion: () => void, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch {
      await flushUi();
    }
  }
  assertion();
}

function click(element: Element | null) {
  if (!(element instanceof HTMLElement)) {
    throw new Error("missing_click_target");
  }
  act(() => {
    element.click();
  });
}

function getButtonByTitle(container: HTMLElement, title: string): HTMLButtonElement {
  const button = container.querySelector(`button[title="${title}"]`);
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`missing button: ${title}`);
  }
  return button;
}

function getButtonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(
    (entry) => entry.textContent?.trim() === text,
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`missing button text: ${text}`);
  }
  return button;
}

function getByTestId(container: HTMLElement, testId: string): HTMLElement {
  const element = container.querySelector(`[data-testid="${testId}"]`);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`missing test id: ${testId}`);
  }
  return element;
}

function queryByTestId(container: HTMLElement, testId: string): HTMLElement | null {
  const element = container.querySelector(`[data-testid="${testId}"]`);
  return element instanceof HTMLElement ? element : null;
}

function queryChatInput(container: HTMLElement): HTMLInputElement | null {
  const input = container.querySelector('input[placeholder="Type a message…"]');
  return input instanceof HTMLInputElement ? input : null;
}

function getSendButton(container: HTMLElement): HTMLButtonElement {
  const button = container.querySelector('button[aria-label="Send"]');
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error("missing send button");
  }
  return button;
}

beforeEach(() => {
  window.history.replaceState({}, "", "/");
  setWorkspaceTestingEnabled(true);
  clearWorkspaceTestingEvents();
  assistProjectState = {
    messages: [{ role: "assistant", text: "Loaded chat state" }],
    plan: [{ id: "goal", text: "Define objective", status: "draft" }],
    links: [],
  };
  bossRequests = [];
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: vi.fn(),
  });

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url === "/api/v2/projects") {
        return jsonResponse({
          projects: [ASSIST_PROJECT, AGENT_PROJECT],
        });
      }

      if (url === `/api/v2/projects/${ASSIST_PROJECT.id}/state`) {
        return jsonResponse(assistProjectState);
      }

      if (url === `/api/v3/projects/${AGENT_PROJECT.id}/decks/deck_builder`) {
        return jsonResponse({});
      }

      if (url === "/api/agents/boss") {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        bossRequests.push(body);
        assistProjectState = {
          messages: [
            { role: "assistant", text: "Loaded chat state" },
            { role: "user", text: String(body.message || "") },
            { role: "assistant", text: "Live assist reply" },
          ],
          plan: [{ id: "goal", text: "Updated objective", status: "draft" }],
          links: [],
        };
        return jsonResponse({
          ok: true,
          projectId: ASSIST_PROJECT.id,
          result: { final: "Live assist reply" },
          provider: "openai",
          model: "gpt-5.4",
          orchestration: {
            stopReason: "final",
            turnsUsed: 2,
          },
        });
      }

      if (url.startsWith(`/api/v2/projects/${ASSIST_PROJECT.id}/kg/query?`)) {
        return jsonResponse({ ok: true, cypher: "MATCH (n) RETURN n", rows: [] });
      }

      if (url === `/api/knowgraph/graph?projectId=${ASSIST_PROJECT.id}`) {
        return jsonResponse({
          nodes: [
            { id: "research_1", type: "Entity", properties: { name: "Research Node" } },
            { id: "research_2", type: "Entity", properties: { name: "Output Node" } },
          ],
          relationships: [
            {
              id: "rel_1",
              from: "research_1",
              to: "research_2",
              type: "serves_model_outputs",
              properties: { snippet: "Grounded relationship" },
            },
          ],
        });
      }

      if (url === "/api/knowgraph/health" || url === "/api/health") {
        return jsonResponse({ ok: true });
      }

      throw new Error(`Unhandled fetch: ${url}`);
    }),
  );
});

afterEach(() => {
  while (mountedRoots.length > 0) {
    mountedRoots.pop()?.();
  }
  clearWorkspaceTestingEvents();
  setWorkspaceTestingEnabled(false);
  vi.restoreAllMocks();
  localStorage.clear();
  document.body.innerHTML = "";
});

describe("AgentBuilder locked 3-state flow", () => {
  it("starts in Home View with large chat and small Canvas / Knowledge / Plan tabs", async () => {
    const container = mount(<AgentBuilder />);

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-chat")).toBeTruthy();
    });

    expect(getButtonByTitle(container, "Home")).toBeTruthy();
    expect(getButtonByTitle(container, "Plus")).toBeTruthy();
    expect(getButtonByTitle(container, "Burst")).toBeTruthy();
    expect(getButtonByTitle(container, "Orange")).toBeTruthy();
    expect(getButtonByTitle(container, "Three-lines")).toBeTruthy();
    expect(getByTestId(container, "workspace-large-region").getAttribute("data-surface")).toBe("chat");
    expect(queryByTestId(container, "companion-surface-canvas")).toBeTruthy();
    expect(queryByTestId(container, "large-surface-canvas")).toBeNull();
    expect(queryByTestId(container, "large-surface-knowledge")).toBeNull();
    expect(queryByTestId(container, "large-surface-plan")).toBeNull();
    expect(getByTestId(container, "companion-tab-canvas").getAttribute("aria-pressed")).toBe("true");
    expect(getByTestId(container, "companion-tab-knowledge")).toBeTruthy();
    expect(getByTestId(container, "companion-tab-plan")).toBeTruthy();
    expect(container.textContent).not.toContain("Step 1");
    expect(queryChatInput(container)).toBeTruthy();
  });

  it("Home restores large Chat with the Home companion tab family", async () => {
    const container = mount(<AgentBuilder />);

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-chat")).toBeTruthy();
    });

    click(getButtonByTitle(container, "Plus"));

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-canvas")).toBeTruthy();
    });

    click(getButtonByTitle(container, "Home"));

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-chat")).toBeTruthy();
    });

    expect(getByTestId(container, "workspace-large-region").getAttribute("data-surface")).toBe("chat");
    expect(queryByTestId(container, "companion-surface-canvas")).toBeTruthy();
    expect(getByTestId(container, "companion-tab-canvas").getAttribute("aria-pressed")).toBe("true");
    expect(getByTestId(container, "companion-tab-knowledge")).toBeTruthy();
    expect(getByTestId(container, "companion-tab-plan")).toBeTruthy();
  });

  it("uses Plus to enter Agent Canvas View and Home to return", async () => {
    const container = mount(<AgentBuilder />);

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-chat")).toBeTruthy();
    });

    click(getButtonByTitle(container, "Plus"));

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-canvas")).toBeTruthy();
    });

    expect(queryByTestId(container, "companion-surface-editor")).toBeTruthy();
    expect(getByTestId(container, "companion-tab-prompt")).toBeTruthy();
    expect(getByTestId(container, "companion-tab-knowledge")).toBeTruthy();
    expect(getByTestId(container, "companion-tab-tools")).toBeTruthy();
    expect(getByTestId(container, "companion-tab-runtime")).toBeTruthy();
    expect(queryChatInput(container)).toBeNull();

    click(getButtonByTitle(container, "Home"));

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-chat")).toBeTruthy();
    });

    expect(queryByTestId(container, "companion-surface-canvas")).toBeTruthy();
  });

  it("keeps workspace tab clicks in the small pane until the preview is clicked", async () => {
    const container = mount(<AgentBuilder />);

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-chat")).toBeTruthy();
    });

    click(getByTestId(container, "companion-tab-knowledge"));

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-chat")).toBeTruthy();
      expect(queryByTestId(container, "companion-surface-knowledge")).toBeTruthy();
    });

    expect(getByTestId(container, "companion-tab-knowledge").getAttribute("aria-pressed")).toBe("true");
    expect(queryByTestId(container, "large-surface-knowledge")).toBeNull();
    expect(queryByTestId(container, "large-surface-plan")).toBeNull();
    expect(queryByTestId(container, "large-surface-canvas")).toBeNull();

    click(getByTestId(container, "companion-surface-knowledge"));

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-knowledge")).toBeTruthy();
    });

    expect(queryByTestId(container, "companion-surface-chat")).toBeTruthy();
    expect(getByTestId(container, "companion-tab-chat").getAttribute("aria-pressed")).toBe("true");
    expect(getByTestId(container, "companion-tab-canvas")).toBeTruthy();
    expect(getByTestId(container, "companion-tab-plan")).toBeTruthy();

    click(getByTestId(container, "companion-tab-plan"));

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-knowledge")).toBeTruthy();
      expect(queryByTestId(container, "companion-surface-plan")).toBeTruthy();
    });

    expect(getByTestId(container, "companion-tab-plan").getAttribute("aria-pressed")).toBe("true");
    expect(queryByTestId(container, "large-surface-plan")).toBeNull();

    click(getByTestId(container, "companion-surface-plan"));

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-plan")).toBeTruthy();
    });

    expect(queryByTestId(container, "companion-surface-knowledge")).toBeTruthy();
    expect(getByTestId(container, "companion-tab-knowledge").getAttribute("aria-pressed")).toBe("true");

    click(getByTestId(container, "companion-tab-canvas"));

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-plan")).toBeTruthy();
      expect(queryByTestId(container, "companion-surface-canvas")).toBeTruthy();
    });

    expect(getByTestId(container, "companion-tab-canvas").getAttribute("aria-pressed")).toBe("true");
    expect(queryByTestId(container, "large-surface-canvas")).toBeNull();

    click(getByTestId(container, "companion-surface-canvas"));

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-canvas")).toBeTruthy();
    });

    expect(queryByTestId(container, "companion-surface-editor")).toBeTruthy();
  });

  it("uses Burst to open Knowledge View and only returns to Home after clicking the small Chat preview", async () => {
    const container = mount(<AgentBuilder />);

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-chat")).toBeTruthy();
    });

    click(getButtonByTitle(container, "Burst"));

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-knowledge")).toBeTruthy();
    });

    expect(container.textContent).not.toContain("Click node to focus. Double-click to expand.");
    expect(container.textContent).not.toContain("Max nodes");

    click(getByTestId(container, "companion-tab-chat"));

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-knowledge")).toBeTruthy();
      expect(queryByTestId(container, "companion-surface-chat")).toBeTruthy();
    });

    expect(getByTestId(container, "companion-tab-chat").getAttribute("aria-pressed")).toBe("true");
    expect(queryByTestId(container, "large-surface-chat")).toBeNull();

    click(getByTestId(container, "companion-surface-chat"));

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-chat")).toBeTruthy();
    });

    expect(getByTestId(container, "workspace-large-region").getAttribute("data-surface")).toBe("chat");
    expect(getByTestId(container, "companion-tab-canvas")).toBeTruthy();
    expect(getByTestId(container, "companion-tab-knowledge")).toBeTruthy();
    expect(getByTestId(container, "companion-tab-plan")).toBeTruthy();
  });

  it("routes large Knowledge Graph node and edge selection into the shared right-side workspace panel", async () => {
    const container = mount(<AgentBuilder />);

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-chat")).toBeTruthy();
    });

    click(getButtonByTitle(container, "Burst"));

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-knowledge")).toBeTruthy();
      expect(queryByTestId(container, "companion-surface-chat")).toBeTruthy();
    });

    await waitFor(() => {
      expect(queryByTestId(container, "knowledge-graph-ready")).toBeTruthy();
    });

    click(getByTestId(container, "knowledge-select-node"));

    await waitFor(() => {
      expect(queryByTestId(container, "companion-surface-knowledge-panel")).toBeTruthy();
      expect(queryByTestId(container, "knowledge-panel-entity")).toBeTruthy();
    });

    expect(container.textContent).toContain("Research Node");
    expect(container.textContent).toContain("grounded research");
    expect(queryByTestId(container, "companion-surface-chat")).toBeNull();

    click(getByTestId(container, "knowledge-clear-selection"));

    await waitFor(() => {
      expect(queryByTestId(container, "companion-surface-chat")).toBeTruthy();
    });

    click(getByTestId(container, "knowledge-select-edge"));

    await waitFor(() => {
      expect(queryByTestId(container, "companion-surface-knowledge-panel")).toBeTruthy();
      expect(queryByTestId(container, "knowledge-panel-relationship")).toBeTruthy();
    });

    expect(container.textContent).toContain("serves_model_outputs");
    expect(container.textContent).toContain("know");
    expect(container.textContent).toContain("grounded research");
  });

  it("does not promote when clicking inner controls inside a companion preview", async () => {
    const container = mount(<AgentBuilder />);

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-chat")).toBeTruthy();
    });

    click(getButtonByTitle(container, "Burst"));

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-knowledge")).toBeTruthy();
      expect(queryByTestId(container, "companion-surface-chat")).toBeTruthy();
    });

    const chatInput = queryChatInput(container);
    if (!(chatInput instanceof HTMLInputElement)) {
      throw new Error("missing companion chat input");
    }
    click(chatInput);

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-knowledge")).toBeTruthy();
    });

    click(getButtonByText(container, "Attach"));

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-knowledge")).toBeTruthy();
      expect(queryByTestId(container, "large-surface-chat")).toBeNull();
    });
  });

  it("uses Orange to open Plan as a Home-family surface", async () => {
    const container = mount(<AgentBuilder />);

    await waitFor(() => {
      expect(container.textContent).toContain("Loaded chat state");
    });

    click(getButtonByTitle(container, "Orange"));

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-plan")).toBeTruthy();
    });

    expect(queryByTestId(container, "companion-surface-chat")).toBeTruthy();
    expect(getByTestId(container, "companion-tab-chat")).toBeTruthy();
    expect(getByTestId(container, "companion-tab-canvas")).toBeTruthy();
    expect(getByTestId(container, "companion-tab-knowledge")).toBeTruthy();
    expect(container.textContent).toContain("Define objective");
  });

  it("keeps agent editor tabs in the small pane when Canvas is large", async () => {
    const container = mount(<AgentBuilder />);

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-chat")).toBeTruthy();
    });

    click(getButtonByTitle(container, "Plus"));

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-canvas")).toBeTruthy();
      expect(queryByTestId(container, "companion-surface-editor")).toBeTruthy();
    });

    click(getByTestId(container, "companion-tab-knowledge"));

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-canvas")).toBeTruthy();
      expect(queryByTestId(container, "companion-surface-editor")).toBeTruthy();
    });

    expect(getByTestId(container, "companion-tab-knowledge").getAttribute("aria-pressed")).toBe("true");
    expect(queryByTestId(container, "large-surface-knowledge")).toBeNull();
  });

  it("uses Three-lines for the drawer and keeps competing project controls out of the header", async () => {
    const container = mount(<AgentBuilder />);

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-chat")).toBeTruthy();
    });

    expect(getByTestId(container, "header-actions").textContent?.trim()).toBe("");
    expect(container.querySelector('button[title="Projects"]')).toBeNull();

    click(getButtonByTitle(container, "Three-lines"));

    await waitFor(() => {
      expect(queryByTestId(container, "navigation-drawer")).toBeTruthy();
    });

    await waitFor(() => {
      expect(container.textContent).toContain("Alpha Project");
    });

    expect(getByTestId(container, "drawer-projects-section")).toBeTruthy();
    expect(container.textContent).toContain("Chat Projects");
    expect(container.textContent).toContain("Alpha Project");
  });

  it("captures internal workspace testing events for surfaces, graph selection, and return to chat", async () => {
    const container = mount(<AgentBuilder />);

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-chat")).toBeTruthy();
    });

    click(getButtonByTitle(container, "Burst"));

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-knowledge")).toBeTruthy();
    });

    await waitFor(() => {
      expect(queryByTestId(container, "knowledge-graph-ready")).toBeTruthy();
    });

    click(getByTestId(container, "knowledge-select-node"));

    await waitFor(() => {
      expect(queryByTestId(container, "companion-surface-knowledge-panel")).toBeTruthy();
    });

    click(getByTestId(container, "companion-tab-chat"));

    await waitFor(() => {
      expect(queryByTestId(container, "companion-surface-chat")).toBeTruthy();
    });

    click(getByTestId(container, "companion-surface-chat"));

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-chat")).toBeTruthy();
    });

    click(getButtonByTitle(container, "Plus"));

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-canvas")).toBeTruthy();
    });

    click(getByTestId(container, "builder-select-node"));

    const events = readWorkspaceTestingEvents();

    expect(
      events.some(
        (event) =>
          event.event === "surface_opened" &&
          event.surface === "knowledge" &&
          event.surfaceRole === "large",
      ),
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.event === "knowledge_graph_node_selected" &&
          event.objectType === "knowledge_node" &&
          typeof event.objectId === "string" &&
          event.objectId.includes("research_1"),
      ),
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.event === "workspace_panel_opened_from_graph_selection" &&
          event.objectType === "knowledge_node",
      ),
    ).toBe(true);
    expect(events.some((event) => event.event === "return_to_chat")).toBe(true);
    expect(
      events.some(
        (event) =>
          event.event === "surface_opened" &&
          event.surface === "canvas" &&
          event.surfaceRole === "large",
      ),
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.event === "agent_graph_node_selected" && event.objectId === "main_chat",
      ),
    ).toBe(true);
  });

  it("sends Builder chat through the live assist path and records real loop telemetry", async () => {
    const container = mount(<AgentBuilder />);

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-chat")).toBeTruthy();
      expect(container.textContent).toContain("Loaded chat state");
    });

    const input = queryChatInput(container);
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("missing chat input");
    }

    act(() => {
      const descriptor = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      );
      descriptor?.set?.call(input, "Map the next move");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    click(getSendButton(container));

    await waitFor(() => {
      expect(container.textContent).toContain("Live assist reply");
    });

    expect(bossRequests).toHaveLength(1);
    expect(bossRequests[0]?.projectId).toBe(ASSIST_PROJECT.id);
    expect(bossRequests[0]?.message).toBe("Map the next move");

    const events = readWorkspaceTestingEvents();
    expect(
      events.some(
        (event) =>
          event.event === "chat_send_started" &&
          event.metadata?.responseMode === "assist_runtime",
      ),
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.event === "chat_response_received" &&
          event.metadata?.responseMode === "assist_runtime" &&
          event.metadata?.provider === "openai",
      ),
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.event === "post_response_refresh_completed" &&
          typeof event.durationMs === "number",
      ),
    ).toBe(true);
  });
});
