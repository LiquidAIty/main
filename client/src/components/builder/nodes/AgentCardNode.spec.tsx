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
  kind: 'agent' as const,
  templateId: 'template-test',
  title: 'Test Agent',
  subtitle: 'Runtime-specific card shape',
  position: { x: 0, y: 0 },
};

describe('AgentCardNode shared Card geometry', () => {
  it('shows Card control output for every enabled Hermes Agent source and retains worker output', () => {
    const card = { ...baseCard, runtime: { kind: 'hermes' as const, mode: 'delegate' as const, profile: 'receiver' } };
    const { rerender } = render(<AgentCardNode data={card} />);
    expect(screen.getByLabelText('Test Agent Card control output')).not.toBeNull();
    expect(screen.getByLabelText('Test Agent Mag One worker output')).not.toBeNull();
    rerender(<AgentCardNode data={{ ...card, runtimeOptions: { delegationRole: 'off' } }} />);
    expect(screen.getByLabelText('Test Agent Card control output')).not.toBeNull();
    rerender(<AgentCardNode data={{ ...card, runtimeOptions: { enabled: false } }} />);
    expect(screen.queryByLabelText('Test Agent Card control output')).toBeNull();
  });
  it('keeps the same compact geometry across Hermes Card runtime modes', () => {
    const { container, rerender } = render(
      <AgentCardNode
        data={{ ...baseCard, runtime: { kind: 'hermes', mode: 'main', profile: 'main' } }}
      />,
    );
    const card = container.firstElementChild as HTMLElement;
    expect(card.style.width).toBe('124px');
    expect(card.style.minHeight).toBe('90px');
    expect(card.style.aspectRatio).toBe('');

    rerender(<AgentCardNode data={{
      ...baseCard,
      runtime: { kind: 'hermes', mode: 'magentic_one', profile: 'card_magentic' },
    }} />);
    expect(card.style.width).toBe('124px');
    expect(card.style.minHeight).toBe('90px');
    expect(card.style.aspectRatio).toBe('');
  });

  it('shows only the live numeric agent count beside the Card name', () => {
    render(
      <AgentCardNode
        data={{
          ...baseCard,
          runtime: { kind: 'hermes', mode: 'kanban', profile: 'liquidaity-hermes-steward' },
          activeAgentCount: 3,
          isRuntimeActive: true,
        }}
      />,
    );

    const badge = screen.getByTestId('active-agent-count');
    expect(badge.textContent).toBe('3');
    expect(screen.getByText('Test Agent').parentElement?.contains(badge)).toBe(true);
    expect(screen.queryByTestId('kanban-card-run-status')).toBeNull();
    expect(document.body.textContent).not.toContain('Root');
    expect(document.body.textContent).not.toContain('tasks');
    expect(document.body.textContent).not.toContain('Tokens');
    expect(document.body.textContent).not.toContain('STATUS');
  });

  it('shows no badge when dormant or finished and preserves the existing runtime glow', () => {
    const { container, rerender } = render(
      <AgentCardNode
        data={{
          ...baseCard,
          runtime: { kind: 'hermes', mode: 'delegate', profile: 'delegate' },
          activeAgentCount: 1,
          isRuntimeActive: true,
        }}
      />,
    );
    const card = container.firstElementChild as HTMLElement;
    const activeShadow = card.style.boxShadow;
    expect(screen.getByTestId('active-agent-count').textContent).toBe('1');
    expect(activeShadow).toContain('rgba(55,173,170');

    rerender(
      <AgentCardNode
        data={{
          ...baseCard,
          runtime: { kind: 'hermes', mode: 'delegate', profile: 'delegate' },
          activeAgentCount: 0,
          isRuntimeActive: false,
        }}
      />,
    );
    expect(screen.queryByTestId('active-agent-count')).toBeNull();
    expect(card.style.boxShadow).not.toBe(activeShadow);
  });

  it('does not project historical learning counts as live Card activity', () => {
    render(
      <AgentCardNode
        data={{
          ...baseCard,
          runtime: { kind: 'hermes', mode: 'delegate', profile: 'delegate' },
        }}
      />,
    );
    expect(screen.queryByTestId('hermes-learning-indicator')).toBeNull();
    expect(screen.queryByTestId('active-agent-count')).toBeNull();
  });
});
