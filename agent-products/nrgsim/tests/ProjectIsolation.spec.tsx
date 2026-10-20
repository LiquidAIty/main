// @vitest-environment jsdom
// Entity: Building Project Isolation
// Relationship: These tests ensure the modeling launcher is absent from Projects without an authorized modeling Card connection.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import AgentBuilderRail from '../../../client/src/features/agentbuilder/core/AgentBuilderRail';
import { companionMinimumWidth, resolveHybridWorkspaceGeometry } from '../../../client/src/features/agentbuilder/core/useAgentBuilderWorkspaceLayout';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('uses the ordinary canvas minimum so the model tree does not slide under Chat at desktop width', () => {
  expect(companionMinimumWidth('nrgsim')).toBe(companionMinimumWidth('canvas'));
  expect(companionMinimumWidth('trading')).toBe(520);
  expect(resolveHybridWorkspaceGeometry({
    workspaceWidth: 1170, mainWidth: 420, companionMinWidth: companionMinimumWidth('nrgsim'),
  }).companionOverlayWidth).toBe(0);
});

it('does not add a modeling launcher to the Trading rail without a modeling connection', () => {
  const host = document.createElement('div');
  const root = createRoot(host);
  const props = {
    colors: { panel: '#000', border: '#111', primary: '#4FA2AD', text: '#fff' },
    workspaceView: 'trading', moonOrb: null,
    visibleRailItems: { showKnowledge: true, showWorldsignal: false, showWorldview: false, showTrading: true },
    onShowWorldsignalWorkspace: vi.fn(), onShowWorldviewWorkspace: vi.fn(),
    onShowCanvasWorkspace: vi.fn(), onOpenAddAgent: vi.fn(),
    onShowKnowledgeWorkspace: vi.fn(), onShowTradingWorkspace: vi.fn(), onOpenNavigationDrawer: vi.fn(),
  };
  try {
    act(() => root.render(<AgentBuilderRail {...props} />));
    expect(host.querySelector('[data-testid="rail-trading-button"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="rail-modeling-button"]')).toBeNull();
    act(() => root.render(<AgentBuilderRail {...props} workspaceView="nrgsim" onShowModelingWorkspace={vi.fn()} />));
    expect(host.querySelector('[data-testid="rail-modeling-button"]')).not.toBeNull();
  } finally {
    act(() => root.unmount());
  }
});
