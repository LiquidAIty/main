// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import PlanMissionFlow from './PlanMissionFlow';
import type { PlanMissionGraph } from './planMissionModel';
import type { StructuredAssistPlanSurface } from '../builder/assistPlanSurface';

const EMPTY_PLANFLOW_STRUCTURED_PLAN: StructuredAssistPlanSurface = {
  planMode: 'draft',
  goal: '',
  steps: [],
  whatMattersNow: [],
  nextMove: [],
  assumptions: [],
  research: [],
  openQuestions: [],
  humanTasks: [],
  agentTasks: [],
  pathOptions: [],
  explicitPlanText: '',
  hasExplicitPlanDocument: false,
  whatChanged: [],
  sources: [],
};

// ReactFlow needs these browser APIs that jsdom does not implement.
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverMock;
(globalThis as unknown as { DOMMatrixReadOnly: unknown }).DOMMatrixReadOnly = class {
  m22 = 1;
  constructor() {}
};
if (!(window as unknown as { matchMedia?: unknown }).matchMedia) {
  (window as unknown as { matchMedia: unknown }).matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  });
}

afterEach(() => cleanup());

const EMPTY_GRAPH: PlanMissionGraph = { nodes: [], edges: [] };

describe('PlanMissionFlow — empty canvas stays mounted', () => {
  it('renders the ReactFlow canvas container even with zero nodes and edges', () => {
    render(
      <PlanMissionFlow
        structuredPlan={EMPTY_PLANFLOW_STRUCTURED_PLAN}
        missionGraph={EMPTY_GRAPH}
        projectId="p1"
        fullHeight
      />,
    );
    const canvas = screen.getByTestId('plan-mission-flow');
    expect(canvas).toBeTruthy();
    // The ReactFlow viewport/grid pane is mounted even with an empty graph.
    expect(canvas.querySelector('.react-flow')).toBeTruthy();
    expect(canvas.querySelector('.react-flow__background')).toBeTruthy();
    // No real Mag One ledger nodes are rendered for an empty graph.
    expect(screen.queryByText('TaskLedger')).toBeNull();
    expect(screen.queryByText('ProgressLedger')).toBeNull();
  });

  it('renders ReactFlow controls even when the graph is empty', () => {
    render(
      <PlanMissionFlow
        structuredPlan={EMPTY_PLANFLOW_STRUCTURED_PLAN}
        missionGraph={EMPTY_GRAPH}
        projectId="p1"
        fullHeight
      />,
    );
    const canvas = screen.getByTestId('plan-mission-flow');
    expect(canvas.querySelector('.react-flow__controls')).toBeTruthy();
  });

  it('shows no static chip row / billboard / empty-state text on the canvas', () => {
    render(
      <PlanMissionFlow
        structuredPlan={EMPTY_PLANFLOW_STRUCTURED_PLAN}
        missionGraph={EMPTY_GRAPH}
        projectId="p1"
        fullHeight
      />,
    );
    // The fixed overlay chip row must be gone (these were not real nodes).
    expect(screen.queryByText('Current Mission')).toBeNull();
    expect(screen.queryByText('Task Ledger')).toBeNull();
    expect(screen.queryByText('Current SPEC')).toBeNull();
    expect(screen.queryByText('Next SPEC Candidate')).toBeNull();
    expect(screen.queryByText(/No Magentic-One ledger yet/i)).toBeNull();
    expect(screen.queryByText(/Active CoderPacket/i)).toBeNull();
    expect(screen.queryByText(/LiquidAIty Living Plan/i)).toBeNull();
    expect(screen.queryByText(/PlanFlow shows the living PLAN\.md/i)).toBeNull();
  });

  // NOTE: "real nodes render as ReactFlow nodes" is proven from the REAL Task
  // Ledger path in PlanMissionFlow.runtask.spec.tsx (buildPlanFlowMissionGraph
  // over a real autogen_0_7_5 taskLedgerArtifact). We do not hand-build a fake
  // 'TaskLedger' mission node here — that would fake the real Python/AutoGen
  // Task Ledger instead of connecting to it.
});

// Silence act() noise from ReactFlow's async measurement in jsdom.
vi.spyOn(console, 'error').mockImplementation(() => {});
