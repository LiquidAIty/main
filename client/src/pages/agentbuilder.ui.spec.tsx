// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AgentBuilder from "./agentbuilder";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../components/builder/BuilderCanvas", () => ({
  default: function BuilderCanvasMock() {
    return <div data-testid="builder-canvas">Builder Canvas</div>;
  },
}));

vi.mock("../components/AgentManager", () => ({
  AgentManager: function AgentManagerMock() {
    return <div data-testid="agent-manager">Agent Manager</div>;
  },
}));

vi.mock("../components/knowledge/KnowledgeGraphNVL", () => ({
  default: function KnowledgeGraphMock() {
    return <div data-testid="knowledge-graph">Knowledge Graph</div>;
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

beforeEach(() => {
  window.history.replaceState({}, "", "/");
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: vi.fn(),
  });

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
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
        return jsonResponse({
          messages: [{ role: "assistant", text: "Loaded chat state" }],
          plan: [{ id: "goal", text: "Define objective", status: "draft" }],
          links: [],
        });
      }

      if (url === `/api/v3/projects/${AGENT_PROJECT.id}/decks/deck_builder`) {
        return jsonResponse({});
      }

      if (url.startsWith(`/api/v2/projects/${ASSIST_PROJECT.id}/kg/query?`)) {
        return jsonResponse({ ok: true, cypher: "MATCH (n) RETURN n", rows: [] });
      }

      if (url === `/api/knowgraph/graph?projectId=${ASSIST_PROJECT.id}`) {
        return jsonResponse({ nodes: [], relationships: [] });
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

  it("uses Burst to open Knowledge View and Chat to return to Home behavior", async () => {
    const container = mount(<AgentBuilder />);

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-chat")).toBeTruthy();
    });

    click(getButtonByTitle(container, "Burst"));

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-knowledge")).toBeTruthy();
    });

    expect(queryByTestId(container, "companion-surface-chat")).toBeTruthy();
    expect(getByTestId(container, "companion-tab-chat")).toBeTruthy();
    expect(getByTestId(container, "companion-tab-canvas")).toBeTruthy();
    expect(getByTestId(container, "companion-tab-plan")).toBeTruthy();

    click(getButtonByText(container, "Chat"));

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-chat")).toBeTruthy();
    });

    expect(getByTestId(container, "workspace-large-region").getAttribute("data-surface")).toBe("chat");
    expect(getByTestId(container, "companion-tab-canvas")).toBeTruthy();
    expect(getByTestId(container, "companion-tab-knowledge")).toBeTruthy();
    expect(getByTestId(container, "companion-tab-plan")).toBeTruthy();
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
});
