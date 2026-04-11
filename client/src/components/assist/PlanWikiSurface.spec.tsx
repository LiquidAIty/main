// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import type { StructuredAssistPlanSurface } from "../builder/assistPlanSurface";
import PlanWikiSurface from "./PlanWikiSurface";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mountedRoots: Array<() => void> = [];

const colors = {
  primary: "#4FA2AD",
  bg: "#1F1F1F",
  panel: "#2B2B2B",
  border: "#3A3A3A",
  text: "#FFFFFF",
  neutral: "#E0DED5",
  warn: "#D98458",
};

afterEach(() => {
  while (mountedRoots.length > 0) {
    mountedRoots.pop()?.();
  }
  document.body.innerHTML = "";
});

function renderSurface(
  structuredPlan: StructuredAssistPlanSurface,
  documentNode: React.ReactNode | null,
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <PlanWikiSurface
        structuredPlan={structuredPlan}
        document={documentNode}
        colors={colors}
      />,
    );
  });

  mountedRoots.push(() => {
    act(() => {
      root.unmount();
      container.remove();
    });
  });

  return container;
}

describe("PlanWikiSurface", () => {
  it("renders overview, section cards, and stable plan item hooks", () => {
    const container = renderSurface(
      {
        goal: "Ship the readable plan surface.",
        whatMattersNow: ["The plan needs a stronger readable structure."],
        nextMove: ["Route the existing plan through a thin wrapper."],
        assumptions: [],
        research: ["Keep the Graph View future-compatible, but out of scope now."],
        openQuestions: ["How should future text-to-graph highlighting attach?"],
        humanTasks: [],
        agentTasks: ["Keep runtime and navigation untouched."],
        pathOptions: [],
        explicitPlanText: "Narrative plan notes.",
        hasExplicitPlanDocument: true,
        whatChanged: ["Plan notes now render through a dedicated surface wrapper."],
        sources: ["Deck reload state"],
      },
      <div data-testid="plan-doc">Narrative plan notes.</div>,
    );

    expect(container.querySelector("#plan-section-overview")).toBeTruthy();
    expect(container.querySelector('[data-plan-section="notes"]')).toBeTruthy();
    expect(
      container.querySelector('[data-plan-item="openQuestions"][data-plan-item-index="0"]'),
    ).toBeTruthy();
    expect(container.textContent).toContain("Ship the readable plan surface.");
    expect(container.textContent).toContain("Narrative plan notes.");
  });

  it("renders the empty state when no structured plan content is available", () => {
    const container = renderSurface(
      {
        goal: "",
        whatMattersNow: [],
        nextMove: [],
        assumptions: [],
        research: [],
        openQuestions: [],
        humanTasks: [],
        agentTasks: [],
        pathOptions: [],
        explicitPlanText: "",
        hasExplicitPlanDocument: false,
        whatChanged: [],
        sources: [],
      },
      null,
    );

    expect(container.querySelector('[data-plan-section="empty"]')).toBeTruthy();
    expect(container.textContent).toContain("No plan notes yet.");
  });
});
