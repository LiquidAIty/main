// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import PlanMissionFlow from './PlanMissionFlow';
import type { StructuredAssistPlanSurface } from '../builder/assistPlanSurface';
import type { DeckRun } from '../../types/agentgraph';
import {
  buildPlanFlowMissionGraph,
  PLAN_CANVAS_RUN_TASK_NODE_ID,
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

function runWithTaskLedger(): DeckRun {
  return {
    id: 'run-1',
    steps: [
      {
        id: 'step-1',
        title: 'Magentic-One',
        magenticTrace: { plan: { task_ledger: { user_goal: 'Audit code', plan: '1. read' } } },
      },
    ],
  } as DeckRun;
}

describe('PlanMissionFlow — deterministic Run Task node', () => {
  it('renders Task Ledger Planning and a disabled Run Task before a real Task Ledger exists', () => {
    const onRunTask = vi.fn();
    render(
      <PlanMissionFlow
        structuredPlan={EMPTY_PLANFLOW_STRUCTURED_PLAN}
        missionGraph={buildPlanFlowMissionGraph(null)}
        projectId="p1"
        fullHeight
        nodeOverrides={{ [PLAN_CANVAS_RUN_TASK_NODE_ID]: { onRunTask } }}
      />,
    );
    expect(screen.getByText('Task Ledger Planning')).toBeTruthy();
    // "Run Task" appears as both the node title and the button label.
    expect(screen.getAllByText('Run Task').length).toBeGreaterThanOrEqual(1);
    const runTaskButton = screen.getByTestId('plan-run-task-button') as HTMLButtonElement;
    expect(runTaskButton.disabled).toBe(true);
    fireEvent.click(runTaskButton);
    expect(onRunTask).not.toHaveBeenCalled();
  });

  it('enables Run Task once a real Task Ledger exists and dispatches only on click', () => {
    const onRunTask = vi.fn();
    render(
      <PlanMissionFlow
        structuredPlan={EMPTY_PLANFLOW_STRUCTURED_PLAN}
        missionGraph={buildPlanFlowMissionGraph(runWithTaskLedger())}
        projectId="p1"
        fullHeight
        nodeOverrides={{ [PLAN_CANVAS_RUN_TASK_NODE_ID]: { onRunTask } }}
      />,
    );
    const runTaskButton = screen.getByTestId('plan-run-task-button') as HTMLButtonElement;
    expect(runTaskButton.disabled).toBe(false);
    // Execution starts only on the explicit Run Task click.
    expect(onRunTask).not.toHaveBeenCalled();
    fireEvent.click(runTaskButton);
    expect(onRunTask).toHaveBeenCalledTimes(1);
  });

  it('keeps the ReactFlow controls visible on the Plan canvas', () => {
    render(
      <PlanMissionFlow
        structuredPlan={EMPTY_PLANFLOW_STRUCTURED_PLAN}
        missionGraph={buildPlanFlowMissionGraph(runWithTaskLedger())}
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
