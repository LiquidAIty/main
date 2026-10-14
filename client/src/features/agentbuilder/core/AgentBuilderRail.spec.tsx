// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SOLARPUNK_PALETTE } from '../../../components/graph/graphVisualTokens';
import AgentBuilderRail from './AgentBuilderRail';
import { BuilderRailMoonOrb } from './BuilderRailMoonOrb';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const baseVisibility = {
  showKnowledge: true,
  showWorldsignal: false,
  showWorldview: false,
  showTrading: false,
};

const baseProps = {
  colors: { panel: '#000', border: '#111', primary: '#0af', text: '#ccc' },
  workspaceView: 'canvas',
  moonOrb: null,
  onShowWorldsignalWorkspace: () => undefined,
  onShowWorldviewWorkspace: () => undefined,
  onShowCanvasWorkspace: () => undefined,
  onOpenAddAgent: () => undefined,
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

describe('AgentBuilderRail Add Agent control', () => {
  it('shows the hex-plus Agents control', () => {
    const host = render(<AgentBuilderRail {...baseProps} visibleRailItems={baseVisibility} />);
    const button = host.querySelector('[data-testid="rail-plus-button"]') as HTMLButtonElement;
    expect(button).not.toBeNull();
    expect(button.getAttribute('aria-label')).toBe('Agents');
  });

  it('opens the one Add Agent chooser when clicked on the canvas', () => {
    const onOpenAddAgent = vi.fn();
    const host = render(
      <AgentBuilderRail
        {...baseProps}
        workspaceView="canvas"
        visibleRailItems={baseVisibility}
        onOpenAddAgent={onOpenAddAgent}
      />,
    );
    const button = host.querySelector('[data-testid="rail-plus-button"]') as HTMLButtonElement;
    act(() => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onOpenAddAgent).toHaveBeenCalledTimes(2);
  });

  it('switches to the canvas first when clicked from another workspace', () => {
    const onOpenAddAgent = vi.fn();
    const onShowCanvas = vi.fn();
    const host = render(
      <AgentBuilderRail
        {...baseProps}
        workspaceView="knowledge"
        visibleRailItems={baseVisibility}
        onOpenAddAgent={onOpenAddAgent}
        onShowCanvasWorkspace={onShowCanvas}
      />,
    );
    const button = host.querySelector('[data-testid="rail-plus-button"]') as HTMLButtonElement;
    act(() => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onOpenAddAgent).not.toHaveBeenCalled();
    expect(onShowCanvas).toHaveBeenCalledOnce();
  });
});

describe('AgentBuilderRail product destinations', () => {
  it('uses the existing globe for World and the moon orb for WorldView', () => {
    const host = render(
      <AgentBuilderRail
        {...baseProps}
        moonOrb={<span data-testid="existing-moon-orb" />}
        visibleRailItems={{ ...baseVisibility, showWorldsignal: true, showWorldview: true }}
      />,
    );
    const world = host.querySelector('[data-testid="rail-world-button"]') as HTMLButtonElement;
    const worldview = host.querySelector('[data-testid="rail-worldview-button"]') as HTMLButtonElement;
    expect(world.querySelector('svg')).not.toBeNull();
    expect(world.querySelector('[data-testid="existing-moon-orb"]')).toBeNull();
    expect(worldview.querySelector('[data-testid="existing-moon-orb"]')).not.toBeNull();
    expect(worldview.querySelector('svg')).toBeNull();
    expect(world.getAttribute('aria-label')).toBe('World');
    expect(worldview.getAttribute('aria-label')).toBe('WorldView');
  });

  it('uses the shared sea and sun palette for the WorldView moon without a purple rim', () => {
    const host = render(
      <AgentBuilderRail
        {...baseProps}
        moonOrb={<BuilderRailMoonOrb phase01={0.5} />}
        visibleRailItems={{ ...baseVisibility, showWorldview: true }}
      />,
    );
    const worldview = host.querySelector(
      '[data-testid="rail-worldview-button"]',
    ) as HTMLButtonElement;
    const wrapper = worldview.firstElementChild as HTMLDivElement;
    const orb = wrapper.querySelector('svg') as SVGSVGElement;
    const rimColors = Array.from(orb.querySelectorAll('circle[stroke]')).map((circle) =>
      circle.getAttribute('stroke'),
    );
    const gradientColors = Array.from(orb.querySelectorAll('stop')).map((stop) =>
      stop.getAttribute('stop-color'),
    );

    expect(wrapper.style.boxShadow).toContain(`${SOLARPUNK_PALETTE.sea}24`);
    expect(wrapper.style.boxShadow).toContain(`${SOLARPUNK_PALETTE.sun}14`);
    expect(rimColors).toEqual([SOLARPUNK_PALETTE.sun, SOLARPUNK_PALETTE.sea]);
    expect(gradientColors).toContain(SOLARPUNK_PALETTE.sun);
    expect(`${wrapper.style.boxShadow}${orb.innerHTML}`).not.toMatch(
      /rgba\(125,\s*105,\s*180|#7d69b4/i,
    );
  });

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

  it('opens the connected WorldView app from its rail icon', () => {
    const onOpen = vi.fn();
    const host = render(
      <AgentBuilderRail
        {...baseProps}
        visibleRailItems={{ ...baseVisibility, showWorldview: true }}
        onShowWorldviewWorkspace={onOpen}
      />,
    );
    const button = host.querySelector('[data-testid="rail-worldview-button"]') as HTMLButtonElement;
    act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
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
