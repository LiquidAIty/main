// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AgentCardNode from './AgentCardNode';

vi.mock('@xyflow/react', () => ({
  Handle: ({
    'aria-label': ariaLabel,
    id,
    className,
    style,
    type,
  }: {
    'aria-label'?: string;
    id?: string;
    className?: string;
    style?: React.CSSProperties;
    type?: string;
  }) => (
    <span aria-label={ariaLabel} className={className} data-handle-id={id} data-handle-type={type} style={style} />
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
  it('shows an orange source only on Main while every Card keeps an orange input', () => {
    const card = { ...baseCard, runtime: { kind: 'hermes' as const, mode: 'delegate' as const, profile: 'receiver' } };
    const { rerender } = render(<AgentCardNode data={card} />);
    expect(screen.queryByLabelText('Test Agent bot output')).toBeNull();
    expect(screen.getByLabelText('Test Agent Magnetic worker output')).not.toBeNull();
    const directInput = screen.getByLabelText('Test Agent bot input');
    expect(directInput.getAttribute('data-handle-id')).toBe('card-control-target');
    expect(directInput.style.opacity).toBe('0');
    rerender(<AgentCardNode data={{
      ...card,
      title: 'Main',
      runtime: { kind: 'hermes', mode: 'main', profile: 'main' },
    }} />);
    const directHandle = screen.getByLabelText('Main bot output');
    expect(directHandle.getAttribute('data-handle-id')).toBe('card-control');
    expect(directHandle.getAttribute('data-handle-type')).toBe('source');
    rerender(<AgentCardNode data={{
      ...card,
      title: 'Main',
      runtime: { kind: 'hermes', mode: 'main', profile: 'main' },
      runtimeOptions: { enabled: false } as any,
    }} />);
    expect(screen.queryByLabelText('Main bot output')).toBeNull();
  });

  it('renders Main as a hexagon while ordinary Cards keep the compact rounded geometry', () => {
    const { container, rerender } = render(
      <AgentCardNode
        data={{ ...baseCard, runtime: { kind: 'hermes', mode: 'delegate', profile: 'delegate' } }}
      />,
    );
    const card = container.firstElementChild as HTMLElement;
    expect(card.style.width).toBe('124px');
    expect(card.style.minHeight).toBe('90px');
    expect(card.dataset.cardShape).toBe('rounded');
    expect(screen.queryByTestId('main-card-hexagon')).toBeNull();

    rerender(<AgentCardNode data={{
      ...baseCard,
      title: 'Main',
      runtime: { kind: 'hermes', mode: 'main', profile: 'main' },
    }} />);
    expect(card.style.width).toBe('136px');
    expect(card.style.minHeight).toBe('104px');
    expect(card.dataset.cardShape).toBe('hexagon');
    expect(screen.getByTestId('main-card-hexagon').style.clipPath).toContain('polygon');
    expect(screen.getByLabelText('Main bot output')).not.toBeNull();
  });

  it('keeps ordinary Cards rounded and never enables Magnetic orange output', () => {
    const { container, rerender } = render(<AgentCardNode data={{
      ...baseCard,
      runtime: { kind: 'hermes', mode: 'delegate', profile: 'signal' },
    }} />);
    expect((container.firstElementChild as HTMLElement).dataset.cardShape).toBe('rounded');
    expect(screen.queryByLabelText('Test Agent bot output')).toBeNull();

    rerender(<AgentCardNode data={{
      ...baseCard,
      title: 'Magnetic',
      runtime: { kind: 'hermes', mode: 'magentic_one', profile: 'card_magentic' },
    }} />);
    expect(screen.queryByLabelText('Magnetic bot output')).toBeNull();
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
