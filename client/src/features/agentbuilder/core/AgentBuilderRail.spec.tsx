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

describe('AgentBuilderRail Hermes terminal icon', () => {
  it('shows the graph launcher with the stable rail treatment', () => {
    const host = render(
      <AgentBuilderRail {...baseProps} visibleRailItems={baseVisibility} />,
    );
    const button = host.querySelector('[data-testid="rail-graphs-button"]') as HTMLButtonElement;
    expect(button).not.toBeNull();
    expect(button.getAttribute('aria-label')).toBe('Graphs');
    expect(button.getAttribute('title')).toBe('Graphs');
  });

  it('shows the terminal icon when the console is visible', () => {
    const host = render(
      <AgentBuilderRail
        {...baseProps}
        visibleRailItems={{ ...baseVisibility, showHermesTerminal: true }}
      />,
    );
    expect(host.querySelector('[data-testid="rail-hermes-terminal-button"]')).not.toBeNull();
  });

  it('labels the separate console as the Hermes Terminal', () => {
    const host = render(
      <AgentBuilderRail
        {...baseProps}
        visibleRailItems={{ ...baseVisibility, showHermesTerminal: true }}
      />,
    );
    const button = host.querySelector(
      '[data-testid="rail-hermes-terminal-button"]',
    ) as HTMLButtonElement;
    expect(button.getAttribute('aria-label')).toBe('Hermes Terminal');
    expect(button.getAttribute('title')).toBe('Hermes Terminal');
  });

  it('hides the terminal icon when the console is not visible', () => {
    const host = render(
      <AgentBuilderRail
        {...baseProps}
        visibleRailItems={{ ...baseVisibility, showHermesTerminal: false }}
      />,
    );
    expect(host.querySelector('[data-testid="rail-hermes-terminal-button"]')).toBeNull();
  });

  it('invokes the open handler when the terminal icon is clicked', () => {
    const onOpen = vi.fn();
    const host = render(
      <AgentBuilderRail
        {...baseProps}
        visibleRailItems={{ ...baseVisibility, showHermesTerminal: true }}
        onOpenHermesTerminal={onOpen}
      />,
    );
    const button = host.querySelector(
      '[data-testid="rail-hermes-terminal-button"]',
    ) as HTMLButtonElement;
    act(() => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onOpen).toHaveBeenCalled();
  });
});
