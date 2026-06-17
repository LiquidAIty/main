// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import PlanMissionFlow from './PlanMissionFlow';
import type { StructuredAssistPlanSurface } from '../builder/assistPlanSurface';
import type { DeckRun } from '../../types/agentgraph';
import {
  buildPlanFlowMissionGraph,
} from '../../features/agentbuilder/plan/planFlowProjection';

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

function runWithArtifact(): DeckRun {
  return {
    id: 'run-1',
    steps: [
      {
        id: 'step-1',
        title: 'Magentic-One',
        magenticTrace: {
          plan: {
            taskLedgerArtifact: {
              source: 'autogen_0_7_5_magentic_one',
              phase: 'task_ledger',
              factsResponse: '1. GIVEN FACTS\n- repo exists',
              planResponse: ['1. Audit signal sources', '2. Check data path'].join('\n'),
              taskLedgerResponse: 'Full Task Ledger text',
              teamDescription: 'Research_Agent: research',
              modelCallProof: [],
            },
          },
        },
      },
    ],
  } as DeckRun;
}

// Plan canvas scope: editable Step nodes from the real Task Ledger artifact, no
// Run Task gate node, no Task Ledger metadata monument, and no Source: line on
// the small cards (provenance lives in the inspector only).
describe('PlanMissionFlow — editable Step nodes from the real Task Ledger', () => {
  it('renders nothing fabricated and no Run Task button before AutoGen returns anything', () => {
    render(
      <PlanMissionFlow
        structuredPlan={EMPTY_PLANFLOW_STRUCTURED_PLAN}
        missionGraph={buildPlanFlowMissionGraph(null)}
        projectId="p1"
        fullHeight
      />,
    );
    expect(screen.queryByText('Task Ledger Planning')).toBeNull();
    expect(screen.queryByText(/Preparing the Task Ledger/i)).toBeNull();
    expect(screen.queryByTestId('plan-run-task-button')).toBeNull();
    // No Step nodes yet -> no SWAT tray.
    expect(screen.queryByTestId('planflow-swat-tray')).toBeNull();
  });

  it('renders readable Step nodes (no Source: line, no metadata card, no Run Task button)', () => {
    render(
      <PlanMissionFlow
        structuredPlan={EMPTY_PLANFLOW_STRUCTURED_PLAN}
        missionGraph={buildPlanFlowMissionGraph(runWithArtifact())}
        projectId="p1"
        fullHeight
      />,
    );
    expect(screen.getByText(/Step 1/)).toBeTruthy();
    expect(screen.getByText(/Step 2/)).toBeTruthy();
    // Old metadata monument and provenance clutter are gone from the cards.
    expect(screen.queryByText('Task Ledger (AutoGen 0.7.5)')).toBeNull();
    expect(screen.queryByText(/Source:/)).toBeNull();
    expect(screen.queryByTestId('plan-run-task-button')).toBeNull();
  });

  it('shows NO SWAT tray when no Step is selected (only a subtle hint)', () => {
    render(
      <PlanMissionFlow
        structuredPlan={EMPTY_PLANFLOW_STRUCTURED_PLAN}
        missionGraph={buildPlanFlowMissionGraph(runWithArtifact())}
        projectId="p1"
        fullHeight
      />,
    );
    expect(screen.queryByTestId('planflow-swat-tray')).toBeNull();
    expect(screen.queryByTestId('planflow-swat-go')).toBeNull();
    // The old subtle bottom-left canvas arrow is gone.
    expect(screen.queryByTestId('planflow-canvas-go-gate')).toBeNull();
    // A non-intrusive hint is allowed.
    expect(screen.getByText('Select a step to approve')).toBeTruthy();
  });

  it('attaches a labeled SWAT GO tray to the selected Step and stages it (no execution)', () => {
    const onGoGate = vi.fn();
    render(
      <PlanMissionFlow
        structuredPlan={EMPTY_PLANFLOW_STRUCTURED_PLAN}
        missionGraph={buildPlanFlowMissionGraph(runWithArtifact())}
        projectId="p1"
        fullHeight
        selectedNodeId="plan-canvas:step:1"
        onGoGate={onGoGate}
        goGateStatus="Run Task unavailable: approved task-node execution is not wired yet."
      />,
    );
    const tray = screen.getByTestId('planflow-swat-tray');
    expect(tray).toBeTruthy();
    const goButton = screen.getByTestId('planflow-swat-go');
    expect(goButton.textContent || '').toContain('GO');
    // Clicking GO only stages via the injected gate handler — never executes.
    goButton.click();
    expect(onGoGate).toHaveBeenCalledTimes(1);
    // The not-wired approval status is shown in the tray.
    expect(screen.getByTestId('planflow-swat-status').textContent || '').toMatch(
      /not wired yet/i,
    );
  });

  it('keeps the ReactFlow controls visible on the Plan canvas', () => {
    render(
      <PlanMissionFlow
        structuredPlan={EMPTY_PLANFLOW_STRUCTURED_PLAN}
        missionGraph={buildPlanFlowMissionGraph(runWithArtifact())}
        projectId="p1"
        fullHeight
      />,
    );
    const canvas = screen.getByTestId('plan-mission-flow');
    expect(canvas.querySelector('.react-flow__controls')).toBeTruthy();
  });
});

// Silence act() noise from ReactFlow's async measurement in jsdom.
vi.spyOn(console, 'error').mockImplementation(() => {});
