// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent } from "@testing-library/dom";

import AgentBuilder from "./agentbuilder";
import {
  clearWorkspaceTestingEvents,
  readWorkspaceTestingEvents,
  setWorkspaceTestingEnabled,
} from "../lib/workspaceTestingTelemetry";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../components/builder/BuilderCanvas", () => ({
  default: function BuilderCanvasMock(props: {
    document?: { nodes?: Array<unknown> };
    onSelectCard?: (cardId: string | null) => void;
    onSelectEdge?: (edgeId: string | null) => void;
  }) {
    return (
      <div data-testid="builder-canvas">
        Builder Canvas
        <div data-testid="builder-node-count">{props.document?.nodes?.length ?? 0}</div>
        <div
          className="react-flow__node"
          data-testid="builder-preview-node"
          onClick={() => props.onSelectCard?.("card_main_chat")}
        >
          Preview Agent Node
        </div>
        <button type="button" data-testid="builder-preview-control">
          Preview Control
        </button>
        <button
          type="button"
          data-testid="builder-select-node"
          onClick={() => props.onSelectCard?.("card_main_chat")}
        >
          Select Agent Node
        </button>
        <button
          type="button"
          data-testid="builder-select-edge"
          onClick={() => props.onSelectEdge?.("edge_main_chat")}
        >
          Select Edge
        </button>
        <button
          type="button"
          data-testid="builder-pane-click"
          onClick={() => {
            props.onSelectCard?.(null);
            props.onSelectEdge?.(null);
          }}
        >
          Pane Click
        </button>
      </div>
    );
  },
}));

vi.mock("../components/AgentManager", () => ({
  AgentManager: function AgentManagerMock(props: {
    activeTab?: string;
    cardName?: string;
    cardSubtext?: string;
    onChangeCardName?: (value: string) => void;
    onChangeCardSubtext?: (value: string) => void;
  }) {
    const hasCardIdentityFields = Boolean(props.onChangeCardName || props.onChangeCardSubtext);
    return (
      <div
        data-testid="agent-manager"
        data-active-tab={String(props.activeTab || "")}
        data-has-card-identity-fields={hasCardIdentityFields ? "true" : "false"}
        data-card-name={String(props.cardName || "")}
        data-card-subtext={String(props.cardSubtext || "")}
      >
        Agent Manager
        <button
          type="button"
          data-testid="agent-manager-rename"
          onClick={() => props.onChangeCardName?.("Renamed Agent")}
        >
          Rename
        </button>
        <button
          type="button"
          data-testid="agent-manager-resubtext"
          onClick={() => props.onChangeCardSubtext?.("Renamed Subtext")}
        >
          Resubtext
        </button>
      </div>
    );
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

vi.mock("../components/assist/PlanMissionFlow", () => ({
  default: function PlanMissionFlowMock(props: {
    onFocusChange?: (
      focus:
        | {
            nodeId: string;
            nodeLabel: string;
            nodeKind: string;
            nodeData: {
              label: string;
              kind: string;
              status: string;
              description: string;
              assignedAgentId: string;
              starterPrompt: string;
              updateKey: string;
              outputKey: string;
            };
          }
        | null,
    ) => void;
  }) {
    return (
      <button
        type="button"
        data-testid="plan-mission-flow"
        onClick={() =>
          props.onFocusChange?.({
            nodeId: "plan-goal",
            nodeLabel: "Mission Goal",
            nodeKind: "Goal",
            nodeData: {
              label: "Mission Goal",
              kind: "Goal",
              status: "ready",
              description: "Mock mission node for tests.",
              assignedAgentId: "card_research_agent",
              starterPrompt: "Mock starter prompt",
              updateKey: "mock_update",
              outputKey: "mock_output",
            },
          })
        }
      >
        Plan Mission Flow
      </button>
    );
  },
}));

vi.mock("../components/energy/EnergyFacadeSurface", () => ({
  default: function EnergyFacadeSurfaceMock() {
    return <div data-testid="energy-facade-surface">Energy Facade Surface</div>;
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

let deckRunRequests: Array<Record<string, unknown>> = [];
let coderPrepareRequests: Array<Record<string, unknown>> = [];

const mountedRoots: Array<() => void> = [];

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function buildDeckLoadResponse(latestAssistantText = "Loaded chat state") {
  const latestRun = {
    id: "deck_run_saved",
    deckId: "deck_builder",
    startedAt: "2026-04-10T00:00:00.000Z",
    endedAt: "2026-04-10T00:00:01.000Z",
    status: "success",
    input: "Restore the prior deck response",
    steps: [
      {
        id: "step_saved",
        executionId: "card_magentic::single",
        cardId: "card_magentic",
        templateId: "template_magentic",
        title: "Magentic-One",
        input: "Restore the prior deck response",
        runtimeBinding: null,
        runtimeType: "magentic_one",
        effectiveAgent: {
          id: "template_magentic",
          name: "Magentic-One",
          model: "gpt-5-mini",
          provider: "openai",
          temperature: 0.2,
          maxTokens: 1200,
          tools: [],
        },
        output: latestAssistantText,
        status: "success",
        startedAt: "2026-04-10T00:00:00.000Z",
        endedAt: "2026-04-10T00:00:01.000Z",
        inputSummary: "Restore the prior deck response",
        outputSummary: latestAssistantText,
      },
    ],
    validationSummary: {
      ok: true,
      errors: [],
      warnings: [],
    },
    events: [
      {
        id: "evt_saved",
        at: "2026-04-10T00:00:00.000Z",
        kind: "run_completed",
        text: "Deck Agent Card Deck completed.",
        status: "success",
      },
    ],
    executionPlanSummary: {
      startCardIds: ["card_magentic"],
      simpleOrderCardIds: ["card_magentic"],
      expandedStepIds: ["card_magentic::single"],
    },
  };

  return {
    ok: true,
    deck: null,
    latestRun,
    runs: [latestRun],
    meta: {
      deckRevision: "rev_saved",
      deckSavedAt: "2026-04-10T00:00:01.000Z",
    },
  };
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

function getBuilderNodeCount(container: HTMLElement): number {
  const countElement = getByTestId(container, "builder-node-count");
  const parsed = Number.parseInt(countElement.textContent || "", 10);
  if (!Number.isFinite(parsed)) {
    throw new Error("invalid builder node count");
  }
  return parsed;
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
  deckRunRequests = [];
  coderPrepareRequests = [];
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

      if (url === "/api/projects") {
        return jsonResponse({
          projects: [ASSIST_PROJECT, AGENT_PROJECT],
        });
      }

      if (url === `/api/projects/${ASSIST_PROJECT.id}/decks/deck_builder`) {
        return jsonResponse(buildDeckLoadResponse("Loaded chat state"));
      }

      if (url === `/api/projects/${AGENT_PROJECT.id}/decks/deck_builder`) {
        return jsonResponse(buildDeckLoadResponse("Loaded chat state"));
      }

      if (url === `/api/projects/${ASSIST_PROJECT.id}/decks/deck_builder/run?stream=1`) {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        deckRunRequests.push(body);
        return jsonResponse({
          ok: true,
          run: {
            id: "deck_run_test",
            deckId: "deck_builder",
            startedAt: "2026-04-10T00:00:00.000Z",
            endedAt: "2026-04-10T00:00:01.000Z",
            status: "success",
            input: String(body.input || ""),
            steps: [
              {
                id: "step_1",
                executionId: "card_magentic::single",
                cardId: "card_magentic",
                templateId: "template_magentic",
                title: "Magentic-One",
                input: String(body.input || ""),
                runtimeBinding: null,
                runtimeType: "magentic_one",
                effectiveAgent: {
                  id: "template_magentic",
                  name: "Magentic-One",
                  model: "gpt-5-mini",
                  provider: "openai",
                  temperature: 0.2,
                  maxTokens: 1200,
                  tools: [],
                },
                output: "Live deck reply",
                status: "success",
                startedAt: "2026-04-10T00:00:00.000Z",
                endedAt: "2026-04-10T00:00:01.000Z",
                inputSummary: String(body.input || ""),
                outputSummary: "Live deck reply",
              },
            ],
            validationSummary: {
              ok: true,
              errors: [],
              warnings: [],
            },
            events: [
              {
                id: "evt_1",
                at: "2026-04-10T00:00:00.000Z",
                kind: "magentic_assignment",
                cardId: "card_magentic",
                cardTitle: "Magentic-One",
                runtimeType: "magentic_one",
                edgeIds: ["edge_magentic_main_chat"],
                text: "Magentic-One assigned work to Main Chat.",
                progressText: "Goal: map the next move. Next: calling Main Chat because it is the visible reply node.",
                status: "running",
              },
              {
                id: "evt_2",
                at: "2026-04-10T00:00:01.000Z",
                kind: "run_completed",
                text: "Deck Agent Card Deck completed.",
                status: "success",
              },
            ],
            executionPlanSummary: {
              startCardIds: ["card_magentic"],
              simpleOrderCardIds: ["card_magentic"],
              expandedStepIds: ["card_magentic::single"],
            },
          },
        });
      }

      if (url === "/api/coder/planflow/prepare") {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        coderPrepareRequests.push(body);
        return jsonResponse({
          ok: true,
          contextPacket: {
            userInput: String(body.userInput || ""),
            planExcerpt: "LiquidAIty Living Plan",
          },
          packet: {
            id: "packet-ui-1",
            projectId: ASSIST_PROJECT.id,
            repoPath: "C:\\Projects\\main",
            objective: "Wire one active job.",
            planExcerpt: "LiquidAIty Living Plan",
            contextSummary: "Real context assembled.",
            codeAnchors: ["client/src/pages/agentbuilder.tsx"],
            cbmQueries: ["search_graph PlanFlow"],
            guardrails: ["No fake success."],
            allowedFiles: ["client/src/features/agentbuilder/plan/*"],
            forbiddenWork: ["Do not auto-run the next job."],
            proofRequired: ["Run focused client checks."],
            reportFormat: "Make a bounded task list and return a task-by-task CoderReport.",
            stopConditions: ["Stop after one report."],
            writeMode: "edit",
          },
          plannerProvenance: {
            source: "backend_planning_service",
            provider: "openai",
            model: "gpt-5",
            contextSources: ["PLAN.md", "ThinkGraph", "SkillGraph/Neo4j", "CodeGraph/CBM query plan"],
          },
        });
      }

      if (url.startsWith(`/api/projects/${ASSIST_PROJECT.id}/kg/query?`)) {
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
  it("starts in chat-first simple mode", async () => {
    const container = mount(<AgentBuilder />);

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-chat")).toBeTruthy();
    });

    expect(getButtonByTitle(container, "Home")).toBeTruthy();
    expect(getButtonByTitle(container, "Plus")).toBeTruthy();
    expect(getButtonByTitle(container, "Burst")).toBeTruthy();
    expect(getButtonByTitle(container, "Orange")).toBeTruthy();
    expect(container.querySelector('[data-testid="rail-codegraph-button"]')).toBeNull();
    expect(container.querySelector('[data-testid="rail-three-lines-button"]')).toBeTruthy();
    expect(getByTestId(container, "workspace-large-region").getAttribute("data-surface")).toBe("chat");
    expect(queryByTestId(container, "workspace-canvas-region")).toBeNull();
    expect(queryByTestId(container, "workspace-companion-region")).toBeNull();
    expect(queryByTestId(container, "large-surface-canvas")).toBeNull();
    expect(queryByTestId(container, "large-surface-knowledge")).toBeNull();
    expect(queryByTestId(container, "large-surface-plan")).toBeNull();
    expect(container.textContent).not.toContain("Step 1");
    expect(queryChatInput(container)).toBeTruthy();
  });

  it("chat mode does not render or reserve companion workspace", async () => {
    const container = mount(<AgentBuilder />);

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-chat")).toBeTruthy();
    });

    click(getButtonByTitle(container, "Home"));

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-chat")).toBeTruthy();
    });

    expect(getByTestId(container, "workspace-large-region").getAttribute("data-surface")).toBe("chat");
    expect(queryByTestId(container, "workspace-canvas-region")).toBeNull();
    expect(queryByTestId(container, "workspace-companion-region")).toBeNull();
  });

  it("does not render a top-level CodeGraph rail icon", async () => {
    const container = mount(<AgentBuilder />);

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-chat")).toBeTruthy();
    });

    expect(container.querySelector('[data-testid="rail-codegraph-button"]')).toBeNull();
    expect(getButtonByTitle(container, "Burst")).toBeTruthy();
  });

  it("Home returns to flat chat and closes any open object drawer", async () => {
    const container = mount(<AgentBuilder />);

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-chat")).toBeTruthy();
    });

    click(getButtonByTitle(container, "Plus"));
    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-canvas")).toBeTruthy();
    });

    click(getByTestId(container, "builder-select-node"));
    await waitFor(() => {
      expect(queryByTestId(container, "companion-surface-editor")).toBeTruthy();
    });

    click(getButtonByTitle(container, "Home"));
    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-chat")).toBeTruthy();
    });

    expect(queryByTestId(container, "workspace-canvas-region")).toBeNull();
    expect(queryByTestId(container, "workspace-companion-region")).toBeNull();
    expect(queryByTestId(container, "workspace-object-drawer")).toBeNull();
    expect(queryByTestId(container, "companion-surface-editor")).toBeNull();
  });

  it("Home clears lower/companion workspace after Knowledge is open", async () => {
    const container = mount(<AgentBuilder />);

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-chat")).toBeTruthy();
    });

    click(getButtonByTitle(container, "Burst"));
    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-knowledge")).toBeTruthy();
      expect(queryByTestId(container, "workspace-companion-region")).toBeTruthy();
    });

    click(getButtonByTitle(container, "Home"));
    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-chat")).toBeTruthy();
    });

    expect(queryByTestId(container, "workspace-canvas-region")).toBeNull();
    expect(queryByTestId(container, "workspace-companion-region")).toBeNull();
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

    expect(queryByTestId(container, "companion-surface-editor")).toBeNull();
    expect(queryChatInput(container)).toBeNull();

    click(getButtonByTitle(container, "Home"));

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-chat")).toBeTruthy();
    });

    expect(queryByTestId(container, "workspace-canvas-region")).toBeNull();
    expect(queryByTestId(container, "workspace-companion-region")).toBeNull();
  });

  it("switching to Agents/Knowledge/Plan does not auto-open object drawer", async () => {
    const container = mount(<AgentBuilder />);

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-chat")).toBeTruthy();
    });

    click(getButtonByTitle(container, "Plus"));
    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-canvas")).toBeTruthy();
    });
    expect(queryByTestId(container, "companion-surface-editor")).toBeNull();

    click(getButtonByTitle(container, "Burst"));
    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-knowledge")).toBeTruthy();
    });
    expect(queryByTestId(container, "companion-surface-editor")).toBeNull();
    expect(queryByTestId(container, "workspace-object-drawer")).toBeNull();

    click(getButtonByTitle(container, "Orange"));
    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-plan")).toBeTruthy();
    });
    expect(queryByTestId(container, "companion-surface-editor")).toBeNull();
    expect(queryByTestId(container, "workspace-object-drawer")).toBeNull();

    click(getButtonByTitle(container, "Plus"));
    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-canvas")).toBeTruthy();
    });
    expect(queryByTestId(container, "companion-surface-editor")).toBeNull();
  });

  it("does not open the full agent editor when Plus reveals Agents from Home", async () => {
    const container = mount(<AgentBuilder />);

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-chat")).toBeTruthy();
    });

    click(getButtonByTitle(container, "Plus"));

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-canvas")).toBeTruthy();
    });

    expect(queryByTestId(container, "companion-surface-editor")).toBeNull();
  });

  it("adds an agent only when Agents is already active", async () => {
    const container = mount(<AgentBuilder />);

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-chat")).toBeTruthy();
    });

    click(getButtonByTitle(container, "Plus"));

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-canvas")).toBeTruthy();
    });

    const beforeAddCount = getBuilderNodeCount(container);

    click(getButtonByTitle(container, "Plus"));

    await waitFor(() => {
      expect(getBuilderNodeCount(container)).toBe(beforeAddCount + 1);
    });
    expect(queryByTestId(container, "companion-surface-editor")).toBeNull();
  });

  it("opens the agent editor only when an existing node is clicked", async () => {
    const container = mount(<AgentBuilder />);

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-chat")).toBeTruthy();
    });

    click(getButtonByTitle(container, "Plus"));

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-canvas")).toBeTruthy();
      expect(queryByTestId(container, "companion-surface-editor")).toBeNull();
    });

    click(getByTestId(container, "builder-select-node"));

    await waitFor(() => {
      expect(queryByTestId(container, "companion-surface-editor")).toBeTruthy();
    });
  });

  it("does not open any drawer when an edge is clicked", async () => {
    const container = mount(<AgentBuilder />);

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-chat")).toBeTruthy();
    });

    click(getButtonByTitle(container, "Plus"));

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-canvas")).toBeTruthy();
    });

    click(getByTestId(container, "builder-select-edge"));

    await waitFor(() => {
      expect(queryByTestId(container, "companion-surface-editor")).toBeNull();
    });
  });

  it("closes the node drawer when empty canvas is clicked", async () => {
    const container = mount(<AgentBuilder />);

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-chat")).toBeTruthy();
    });

    click(getButtonByTitle(container, "Plus"));

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-canvas")).toBeTruthy();
    });

    click(getByTestId(container, "builder-select-node"));

    await waitFor(() => {
      expect(queryByTestId(container, "companion-surface-editor")).toBeTruthy();
    });

    click(getByTestId(container, "builder-pane-click"));

    await waitFor(() => {
      expect(queryByTestId(container, "companion-surface-editor")).toBeNull();
    });
  });

  it("closes the node drawer when the drawer close button is clicked", async () => {
    const container = mount(<AgentBuilder />);

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-chat")).toBeTruthy();
    });

    click(getButtonByTitle(container, "Plus"));

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-canvas")).toBeTruthy();
    });

    click(getByTestId(container, "builder-select-node"));

    await waitFor(() => {
      expect(queryByTestId(container, "companion-surface-editor")).toBeTruthy();
    });

    const closeButton = container.querySelector('button[aria-label="Close drawer"]');
    click(closeButton);

    await waitFor(() => {
      expect(queryByTestId(container, "companion-surface-editor")).toBeNull();
    });
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

  it("promotes the small canvas preview instead of dropping back to Chat when a preview node is clicked", async () => {
    const container = mount(<AgentBuilder />);

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-canvas")).toBeTruthy();
    });

    click(getButtonByTitle(container, "Orange"));

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-plan")).toBeTruthy();
      expect(queryByTestId(container, "large-surface-canvas")).toBeNull();
    });

    click(getByTestId(container, "companion-tab-canvas"));

    await waitFor(() => {
      expect(queryByTestId(container, "companion-surface-canvas")).toBeTruthy();
    });

    click(getByTestId(container, "builder-preview-node"));

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-canvas")).toBeTruthy();
    });

    expect(queryByTestId(container, "large-surface-plan")).toBeNull();
    expect(queryByTestId(container, "companion-surface-editor")).toBeTruthy();
    expect(getByTestId(container, "companion-tab-prompt").getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps the small canvas preview in place when a preview control button is clicked", async () => {
    const container = mount(<AgentBuilder />);

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-canvas")).toBeTruthy();
    });

    click(getButtonByTitle(container, "Orange"));

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-plan")).toBeTruthy();
    });

    click(getByTestId(container, "companion-tab-canvas"));

    await waitFor(() => {
      expect(queryByTestId(container, "companion-surface-canvas")).toBeTruthy();
    });

    click(getByTestId(container, "builder-preview-control"));

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-plan")).toBeTruthy();
      expect(queryByTestId(container, "large-surface-canvas")).toBeNull();
      expect(queryByTestId(container, "companion-surface-canvas")).toBeTruthy();
    });
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
    expect(getByTestId(container, "plan-mission-flow")).toBeTruthy();
    expect(queryByTestId(container, "plan-thinkgraph-flow")).toBeNull();
  });

  it("keeps agent editor tabs in the small pane when Canvas is large", async () => {
    const container = mount(<AgentBuilder />);

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-chat")).toBeTruthy();
    });

    click(getButtonByTitle(container, "Plus"));

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-canvas")).toBeTruthy();
      expect(queryByTestId(container, "companion-surface-editor")).toBeNull();
    });

    click(getByTestId(container, "builder-select-node"));

    await waitFor(() => {
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

  it("shows Name/Subtext editing only in the first Agent Edit tab", async () => {
    const container = mount(<AgentBuilder />);

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-chat")).toBeTruthy();
    });

    click(getButtonByTitle(container, "Plus"));

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-canvas")).toBeTruthy();
    });

    click(getByTestId(container, "builder-select-node"));

    await waitFor(() => {
      const manager = getByTestId(container, "agent-manager");
      expect(manager.getAttribute("data-active-tab")).toBe("Prompt");
      expect(manager.getAttribute("data-has-card-identity-fields")).toBe("true");
    });

    click(getByTestId(container, "companion-tab-knowledge"));

    await waitFor(() => {
      const manager = getByTestId(container, "agent-manager");
      expect(manager.getAttribute("data-active-tab")).toBe("Knowledge");
      expect(manager.getAttribute("data-has-card-identity-fields")).toBe("false");
    });
  });

  it("updates selected agent Name/Subtext from Prompt and keeps them hidden outside Prompt", async () => {
    const container = mount(<AgentBuilder />);

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-chat")).toBeTruthy();
    });

    click(getButtonByTitle(container, "Plus"));

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-canvas")).toBeTruthy();
    });

    click(getByTestId(container, "builder-select-node"));

    await waitFor(() => {
      const manager = getByTestId(container, "agent-manager");
      expect(manager.getAttribute("data-active-tab")).toBe("Prompt");
      expect(manager.getAttribute("data-has-card-identity-fields")).toBe("true");
    });

    click(getByTestId(container, "agent-manager-rename"));
    click(getByTestId(container, "agent-manager-resubtext"));

    await waitFor(() => {
      const manager = getByTestId(container, "agent-manager");
      expect(manager.getAttribute("data-card-name")).toBe("Renamed Agent");
      expect(manager.getAttribute("data-card-subtext")).toBe("Renamed Subtext");
    });

    click(getByTestId(container, "companion-tab-tools"));

    await waitFor(() => {
      const manager = getByTestId(container, "agent-manager");
      expect(manager.getAttribute("data-active-tab")).toBe("Tools");
      expect(manager.getAttribute("data-has-card-identity-fields")).toBe("false");
    });
  });

  it("uses Three-lines for the drawer and keeps competing project controls out of the header", async () => {
    const container = mount(<AgentBuilder />);

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-chat")).toBeTruthy();
    });

    expect(getByTestId(container, "header-actions").textContent?.trim()).toBe("");
    expect(container.querySelector('button[title="Projects"]')).toBeNull();

    click(getByTestId(container, "rail-three-lines-button"));

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

  it("hides the Energy rail button while the NRGSim workbench is disconnected", async () => {
    const container = mount(<AgentBuilder />);

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-chat")).toBeTruthy();
    });

    expect(queryByTestId(container, "rail-energy-button")).toBeNull();
  });

  it("creates a new project using inline form without browser prompts", async () => {
    const container = mount(<AgentBuilder />);

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-chat")).toBeTruthy();
    });

    click(getByTestId(container, "rail-three-lines-button"));

    await waitFor(() => {
      expect(queryByTestId(container, "navigation-drawer")).toBeTruthy();
    });

    const newProjectButton = getByTestId(container, "new-project-button");
    expect(newProjectButton.textContent).toBe("New Project");

    click(newProjectButton);

    await waitFor(() => {
      expect(queryByTestId(container, "create-project-form")).toBeTruthy();
    });

    expect(newProjectButton.textContent).toBe("New Project");

    const nameInput = getByTestId(container, "project-name-input") as HTMLInputElement;
    const submitButton = getByTestId(container, "create-project-submit");

    expect(submitButton.hasAttribute("disabled")).toBe(true);

    fireEvent.change(nameInput, { target: { value: "Test Project" } });

    await waitFor(() => {
      expect(nameInput.value).toBe("Test Project");
      expect(submitButton.hasAttribute("disabled")).toBe(false);
    });

    click(submitButton);

    await waitFor(() => {
      expect(queryByTestId(container, "create-project-form")).toBeNull();
    });

    await waitFor(() => {
      expect(container.textContent).toContain("Test Project");
    });
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

  it("sends Builder chat through the deck runtime path and records real loop telemetry", async () => {
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
      expect(container.textContent).toContain("Live deck reply");
    });

    expect(deckRunRequests).toHaveLength(1);
    expect(deckRunRequests[0]?.deckId).toBe("deck_builder");
    expect(deckRunRequests[0]?.input).toBe("Map the next move");
    expect(deckRunRequests[0]?.workspaceContext).toMatchObject({
      workspaceView: "chat",
      largeSurface: "chat",
      objectEditor: {
        open: false,
        selectedCardId: null,
        editable: false,
        runnable: false,
      },
    });

    const events = readWorkspaceTestingEvents();
    expect(
      events.some(
        (event) =>
          event.event === "chat_send_started" &&
          event.metadata?.responseMode === "deck_runtime",
      ),
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.event === "chat_response_received" &&
          event.metadata?.responseMode === "deck_runtime" &&
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

  it("prepares one active CoderPacket after the real Magentic chat run and displays it in PlanFlow", async () => {
    const container = mount(<AgentBuilder />);

    await waitFor(() => {
      expect(queryByTestId(container, "large-surface-chat")).toBeTruthy();
    });

    const input = queryChatInput(container);
    if (!(input instanceof HTMLInputElement)) throw new Error("missing chat input");
    fireEvent.change(input, { target: { value: "Wire one active job" } });
    click(getSendButton(container));

    await waitFor(() => {
      expect(coderPrepareRequests).toHaveLength(1);
    });

    click(getButtonByTitle(container, "Orange"));

    await waitFor(() => {
      expect(queryByTestId(container, "active-coder-job-panel")).toBeTruthy();
      expect(container.textContent).toContain("Wire one active job.");
    });

    expect(coderPrepareRequests[0]).toMatchObject({
      projectId: ASSIST_PROJECT.id,
      userInput: "Wire one active job",
    });
    expect(container.textContent).not.toContain("Paste one Magentic-One/Sol generated CoderPacket");
  });
});
