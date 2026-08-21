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

describe('AgentCardNode runtime shape', () => {
  it('renders Hermes Cards as rounded squares', () => {
    const { container } = render(
      <AgentCardNode
        data={{ ...baseCard, runtime: { kind: 'hermes', mode: 'main', profile: 'main' } }}
      />,
    );

    const card = container.querySelector<HTMLElement>('[data-runtime-kind="hermes"]');
    expect(card).not.toBeNull();
    expect(card?.style.width).toBe('112px');
    expect(card?.style.minHeight).toBe('112px');
    expect(card?.style.aspectRatio).toBe('1 / 1');
    expect(card?.style.borderRadius).toBe('28px');
  });

  it('preserves the existing AutoGen card proportions', () => {
    const { container } = render(
      <AgentCardNode data={{ ...baseCard, runtime: { kind: 'autogen', mode: 'assistant' } }} />,
    );

    const card = container.querySelector<HTMLElement>('[data-runtime-kind="autogen"]');
    expect(card).not.toBeNull();
    expect(card?.style.width).toBe('124px');
    expect(card?.style.minHeight).toBe('90px');
    expect(card?.style.aspectRatio).toBe('');
    expect(card?.style.borderRadius).toBe('12px');
  });
});
