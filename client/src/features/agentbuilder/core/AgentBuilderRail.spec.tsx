// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AgentBuilderRail from './AgentBuilderRail';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const baseVisibility = {
  showKnowledge: false,
  showWorldsignal: false,
  showTrading: false,
  showCode: false,
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
  onShowCodeWorkspace: () => undefined,
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

describe('AgentBuilderRail OpenClaude console icon', () => {
  it('shows the terminal icon when the console is visible', () => {
    const host = render(
      <AgentBuilderRail
        {...baseProps}
        visibleRailItems={{ ...baseVisibility, showOpenClaudeConsole: true }}
      />,
    );
    expect(host.querySelector('[data-testid="rail-openclaude-console-button"]')).not.toBeNull();
  });

  it('labels the console icon "Code Console" with no internal branding', () => {
    // Product language: the rail entry names the surface it opens.
    const host = render(
      <AgentBuilderRail
        {...baseProps}
        visibleRailItems={{ ...baseVisibility, showOpenClaudeConsole: true }}
      />,
    );
    const button = host.querySelector(
      '[data-testid="rail-openclaude-console-button"]',
    ) as HTMLButtonElement;
    expect(button.getAttribute('aria-label')).toBe('Code Console');
    expect(button.getAttribute('title')).toBe('Code Console');
    // Visible chrome is clean. (Internal data-testids may still carry old names.)
    expect(/OpenClaude|LocalCoder|Local Coder|Claude/i.test(host.textContent || '')).toBe(false);
  });

  it('hides the terminal icon when the console is not visible', () => {
    const host = render(
      <AgentBuilderRail
        {...baseProps}
        visibleRailItems={{ ...baseVisibility, showOpenClaudeConsole: false }}
      />,
    );
    expect(host.querySelector('[data-testid="rail-openclaude-console-button"]')).toBeNull();
  });

  it('invokes the open handler when the terminal icon is clicked', () => {
    const onOpen = vi.fn();
    const host = render(
      <AgentBuilderRail
        {...baseProps}
        visibleRailItems={{ ...baseVisibility, showOpenClaudeConsole: true }}
        onOpenOpenClaudeConsole={onOpen}
      />,
    );
    const button = host.querySelector(
      '[data-testid="rail-openclaude-console-button"]',
    ) as HTMLButtonElement;
    act(() => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onOpen).toHaveBeenCalled();
  });
});
