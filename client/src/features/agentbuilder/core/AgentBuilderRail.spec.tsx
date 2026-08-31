// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AgentBuilderRail from './AgentBuilderRail';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const baseVisibility = {
  showKnowledge: true,
  showWorldsignal: false,
  showTrading: false,
};

const baseProps = {
  colors: { panel: '#000', border: '#111', primary: '#0af', text: '#ccc' },
  workspaceView: 'canvas',
  moonOrb: null,
  onShowWorldsignalWorkspace: () => undefined,
  onShowCanvasWorkspace: () => undefined,
  onQuickAddAssistNode: () => undefined,
  onShowKnowledgeWorkspace: () => undefined,
  onShowTradingWorkspace: () => undefined,
  onOpenNavigationDrawer: () => undefined,
};

let container: HTMLDivElement | null = null;

afterEach(() => {
  if (container) {
    container.remove();
    container = null;
  }
});

function render(node: React.ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return container;
}

describe('AgentBuilderRail hex-plus quick-add', () => {
  it('shows the hex-plus Agents control', () => {
    const host = render(<AgentBuilderRail {...baseProps} visibleRailItems={baseVisibility} />);
    const button = host.querySelector('[data-testid="rail-plus-button"]') as HTMLButtonElement;
    expect(button).not.toBeNull();
    expect(button.getAttribute('aria-label')).toBe('Agents');
  });

  it('creates a new Agent Card when clicked on the canvas (one invocation)', () => {
    const onQuickAdd = vi.fn();
    const host = render(
      <AgentBuilderRail
        {...baseProps}
        workspaceView="canvas"
        visibleRailItems={baseVisibility}
        onQuickAddAssistNode={onQuickAdd}
      />,
    );
    const button = host.querySelector('[data-testid="rail-plus-button"]') as HTMLButtonElement;
    act(() => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onQuickAdd).toHaveBeenCalledTimes(2);
  });

  it('switches to the canvas first when clicked from another workspace', () => {
    const onQuickAdd = vi.fn();
    const onShowCanvas = vi.fn();
    const host = render(
      <AgentBuilderRail
        {...baseProps}
        workspaceView="knowledge"
        visibleRailItems={baseVisibility}
        onQuickAddAssistNode={onQuickAdd}
        onShowCanvasWorkspace={onShowCanvas}
      />,
    );
    const button = host.querySelector('[data-testid="rail-plus-button"]') as HTMLButtonElement;
    act(() => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onQuickAdd).not.toHaveBeenCalled();
    expect(onShowCanvas).toHaveBeenCalledOnce();
  });
});

describe('AgentBuilderRail product destinations', () => {
  it('shows the graph launcher with the stable rail treatment', () => {
    const host = render(
      <AgentBuilderRail {...baseProps} visibleRailItems={baseVisibility} />,
    );
    const button = host.querySelector('[data-testid="rail-graphs-button"]') as HTMLButtonElement;
    expect(button).not.toBeNull();
    expect(button.getAttribute('aria-label')).toBe('Graphs');
    expect(button.getAttribute('title')).toBe('Graphs');
  });

  it('shows the connected Trading Agent app icon', () => {
    const host = render(
      <AgentBuilderRail
        {...baseProps}
        visibleRailItems={{ ...baseVisibility, showTrading: true }}
      />,
    );
    expect(host.querySelector('[data-testid="rail-trading-button"]')).not.toBeNull();
  });

  it('opens the Trading Agent app from its rail icon', () => {
    const onOpen = vi.fn();
    const host = render(
      <AgentBuilderRail
        {...baseProps}
        visibleRailItems={{ ...baseVisibility, showTrading: true }}
        onShowTradingWorkspace={onOpen}
      />,
    );
    const button = host.querySelector(
      '[data-testid="rail-trading-button"]',
    ) as HTMLButtonElement;
    act(() => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('exposes no Kanban product or Hermes terminal launcher in the rail', () => {
    const host = render(
      <AgentBuilderRail
        {...baseProps}
        visibleRailItems={baseVisibility}
      />,
    );
    expect(host.querySelector('[data-testid="rail-hermes-kanban-button"]')).toBeNull();
    expect(host.querySelector('[data-testid="rail-hermes-terminal-button"]')).toBeNull();
  });
});
