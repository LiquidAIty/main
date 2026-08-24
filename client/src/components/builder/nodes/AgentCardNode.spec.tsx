// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
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

  it('keeps a Kanban Card on the shared rectangle without a special status panel', () => {
    const { container } = render(
      <AgentCardNode
        data={{
          ...baseCard,
          runtime: { kind: 'hermes', mode: 'kanban', profile: 'liquidaity-hermes-steward' },
        }}
      />,
    );

    const card = container.firstElementChild as HTMLElement | null;
    expect(card?.style.width).toBe('124px');
    expect(card?.style.minHeight).toBe('90px');
    expect(card?.style.aspectRatio).toBe('');
    expect(container.querySelector('[data-testid="kanban-card-run-status"]')).toBeNull();
  });
});
