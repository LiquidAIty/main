// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AgentCardNode from './AgentCardNode';

vi.mock('@xyflow/react', () => ({
  Handle: ({ 'aria-label': ariaLabel }: { 'aria-label'?: string }) => (
    <span aria-label={ariaLabel} />
  ),
  Position: { Left: 'left', Right: 'right' },
}));

afterEach(cleanup);

const baseCard = {
  id: 'card-test',
  templateId: 'template-test',
  title: 'Test Agent',
  subtitle: 'Runtime-specific card shape',
  position: { x: 0, y: 0 },
};

describe('AgentCardNode shared Card geometry', () => {
  it('renders Hermes Cards as the shared compact rectangle', () => {
    const { container } = render(
      <AgentCardNode
        data={{ ...baseCard, runtime: { kind: 'hermes', mode: 'main', profile: 'main' } }}
      />,
    );

    const card = container.firstElementChild as HTMLElement | null;
    expect(card).not.toBeNull();
    expect(card?.style.width).toBe('124px');
    expect(card?.style.minHeight).toBe('90px');
    expect(card?.style.aspectRatio).toBe('');
    expect(card?.className).toContain('rounded-xl');
  });

  it('renders AutoGen Cards with the exact same geometry', () => {
    const { container } = render(
      <AgentCardNode data={{ ...baseCard, runtime: { kind: 'autogen', mode: 'assistant' } }} />,
    );

    const card = container.firstElementChild as HTMLElement | null;
    expect(card).not.toBeNull();
    expect(card?.style.width).toBe('124px');
    expect(card?.style.minHeight).toBe('90px');
    expect(card?.style.aspectRatio).toBe('');
  });

  it('keeps real retained-root Kanban status inside the ordinary Card rectangle', () => {
    const { container } = render(
      <AgentCardNode
        data={{
          ...baseCard,
          runtime: { kind: 'hermes', mode: 'kanban', profile: 'liquidaity-hermes-steward' },
          kanbanRunStatus: {
            runId: 'external-mcp:ecccd111-1dae-4950-93cb-ad7eccdff59a',
            correlationId: 'mcp:retained-root-readback',
            cardId: 'card-test',
            runtimeKind: 'hermes',
            runtimeMode: 'kanban',
            runtimeProfile: 'liquidaity-hermes-steward',
            state: 'completed',
            status: 'complete',
            nativeRootId: 't_625de6e8',
            nativeRunId: 4,
            tasksCompleted: 5,
            tasksTotal: 5,
            activeWorkers: 0,
            elapsedMs: 312_000,
            toolCallCount: 7,
            graphReads: 2,
            graphWrites: 1,
            inputTokens: 62_020,
            outputTokens: 1_960,
            cachedTokens: 109_568,
            reasoningTokens: 109,
            costUsd: 0,
            resultReady: true,
            output: 'Native synthesis.',
            errorCode: null,
            errorSummary: null,
          },
        }}
      />,
    );

    const card = container.firstElementChild as HTMLElement | null;
    const status = screen.getByTestId('kanban-card-run-status');
    expect(card?.contains(status)).toBe(true);
    expect(card?.style.width).toBe('232px');
    expect(card?.style.minHeight).toBe('194px');
    expect(card?.style.aspectRatio).toBe('');
    expect(status.getAttribute('data-run-id')).toBe('external-mcp:ecccd111-1dae-4950-93cb-ad7eccdff59a');
    expect(screen.getByText('complete')).toBeTruthy();
    expect(screen.getByText('5/5 tasks · 0 active · 5m 12s')).toBeTruthy();
    expect(screen.getByText('Tools 7')).toBeTruthy();
    expect(screen.getByText('Graph 2R/1W')).toBeTruthy();
    expect(screen.getByText('Tokens 62K in/2K out')).toBeTruthy();
    expect(screen.getByText('Cost $0.0000')).toBeTruthy();
    expect(screen.getByText('Result ready')).toBeTruthy();
    expect(screen.getByText('Root t_625de6e8')).toBeTruthy();
  });
});
