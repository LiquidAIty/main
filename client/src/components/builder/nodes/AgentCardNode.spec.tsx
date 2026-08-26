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
          kanbanRunState: {
            kind: 'ready',
            status: {
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
          },
        }}
      />,
    );

    const card = container.firstElementChild as HTMLElement | null;
    const status = screen.getByTestId('kanban-card-run-status');
    expect(card?.contains(status)).toBe(true);
    expect(card?.style.width).toBe('124px');
    expect(card?.style.minHeight).toBe('90px');
    expect(card?.style.aspectRatio).toBe('');
    expect(status.getAttribute('data-run-id')).toBe('external-mcp:ecccd111-1dae-4950-93cb-ad7eccdff59a');
    expect(screen.getByText('complete')).toBeTruthy();
    expect(status.getAttribute('data-state')).toBe('ready');
    expect(status.getAttribute('data-run-state')).toBe('completed');
    expect(status.getAttribute('data-cached-tokens')).toBe('109568');
    expect(status.getAttribute('data-reasoning-tokens')).toBe('109');
    expect(screen.getByText('5/5 tasks · 0 active')).toBeTruthy();
    expect(screen.getByText('Tools 7 · Graph 2R/1W')).toBeTruthy();
    expect(screen.getByText('64K tok · $0.0000 · ready')).toBeTruthy();
    expect(screen.getByText('Root t_625de6e8')).toBeTruthy();
  });

  it('renders honest empty and transport-error states inside the same Card geometry', () => {
    const { container, rerender } = render(
      <AgentCardNode
        data={{
          ...baseCard,
          runtime: { kind: 'hermes', mode: 'kanban', profile: 'liquidaity-hermes-steward' },
          kanbanRunState: { kind: 'empty' },
        }}
      />,
    );
    const card = container.firstElementChild as HTMLElement;
    expect(card.style.width).toBe('124px');
    expect(card.style.minHeight).toBe('90px');
    expect(screen.getByText('NO RETAINED RUN')).toBeTruthy();

    rerender(
      <AgentCardNode
        data={{
          ...baseCard,
          runtime: { kind: 'hermes', mode: 'kanban', profile: 'liquidaity-hermes-steward' },
          kanbanRunState: { kind: 'error', error: 'python_rails_unavailable' },
        }}
      />,
    );
    const status = screen.getByTestId('kanban-card-run-status');
    expect(screen.getByText('STATUS UNAVAILABLE')).toBeTruthy();
    expect(status.getAttribute('data-error')).toBe('python_rails_unavailable');
  });
});
