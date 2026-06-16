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
              planResponse: '- inspect read-only',
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

// Task-Ledger-only scope: the Plan canvas renders ONE real artifact viewer and
// NO Run Task gate node (Run Task / Progress Ledger are out of scope).
describe('PlanMissionFlow — real Task Ledger artifact viewer only', () => {
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
  });

  it('renders the real Task Ledger artifact viewer and still no Run Task button', () => {
    render(
      <PlanMissionFlow
        structuredPlan={EMPTY_PLANFLOW_STRUCTURED_PLAN}
        missionGraph={buildPlanFlowMissionGraph(runWithArtifact())}
        projectId="p1"
        fullHeight
      />,
    );
    expect(screen.getByText('Task Ledger (AutoGen 0.7.5)')).toBeTruthy();
    expect(screen.queryByTestId('plan-run-task-button')).toBeNull();
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
