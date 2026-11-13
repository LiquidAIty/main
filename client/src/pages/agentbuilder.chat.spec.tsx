// @vitest-environment jsdom
/**
 * Entity: Main Chat
 * Relationship: Verifies Agent Builder keeps literal @Card completion and submission bound to the saved Main profile without switching its visible Bot Chat.
 */

import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { VirtuosoMockContext } from 'react-virtuoso';
import type { DeckDocument } from '../types/agentgraph';
import useHermesMainChat, { type HermesChatRequest } from '../features/hermes/useHermesMainChat';
import AgentBuilder from './agentbuilder';

function noop() {}
const deck: DeckDocument = {
  id: 'deck_builder', name: 'Saved Trading', version: 1, promptTemplates: [],
  nodes: [
    {
      id: 'saved-main', title: 'Main', kind: 'agent', templateId: 'template_main_chat',
      prompt: 'Saved Main instructions', position: { x: 0, y: 0 },
      runtime: { kind: 'hermes', mode: 'main', profile: 'owner-main-profile' },
    },
    {
      id: 'saved-know', title: 'KnowGraph', kind: 'agent', templateId: 'template_assist',
      prompt: 'Saved research instructions', position: { x: 200, y: 0 },
      runtime: { kind: 'hermes', mode: 'delegate', profile: 'owner-know-profile' },
    },
  ],
  edges: [{ id: 'saved-wire', source: 'saved-main', target: 'saved-know', edgeType: 'flow' }],
};

vi.mock('../features/hermes/useHermesMainChat', () => ({ default: vi.fn() }));
vi.mock('../features/hermes/useHermesCardRuntime', () => ({ default: () => ({}) }));
vi.mock('../features/agentbuilder/state/useAgentBuilderProject', () => ({ default: () => ({
  activeProject: 'project-a', canvasProjectId: 'project-a', builderProjects: [],
  setProjectsError: noop, setActiveProjectWithUrl: noop, refreshProjects: noop,
}) }));
vi.mock('../features/agentbuilder/state/useAgentBuilderDeck', () => ({ default: () => ({
  deck, deckRevision: 'saved-revision', deckLoadBusy: false, deckSaveBusy: false,
  setDeckState: noop, setDeckRevision: noop, setDeckLoadBusy: noop,
  setDeckSaveBusy: noop, setDeckStatusMessage: noop, setDeckLoadError: noop,
}) }));
vi.mock('../features/agentbuilder/state/useAgentBuilderDeckLoad', () => ({ default: noop }));
vi.mock('../features/agentbuilder/state/useAgentBuilderAutosave', () => ({
  default: () => ({ handleSaveDeck: noop, handleDeleteCard: noop, reloadCanonical: noop }),
  projectDeckForPersistence: (value: DeckDocument) => value,
}));
vi.mock('../features/agentbuilder/state/useAgentBuilderCardEditor', () => ({ default: () => ({
  selectedCard: null, selectedCardConfig: null,
}) }));
vi.mock('../features/agentbuilder/state/useAgentBuilderSelection', () => ({ default: () => ({
  selectedCardId: null, selectedEdgeId: null, tab: 'Plan', openDrawer: null,
  setInspectorDrawerOpen: noop, setSelectedCardId: noop, setSelectedEdgeId: noop,
  setBuilderCanvasFocusRequest: noop, setTab: noop, setOpenDrawer: noop,
}) }));
vi.mock('../features/agentbuilder/state/useAgentBuilderKnowledgeGraphs', () => ({ default: () => ({
  projections: { thinkgraph: { nodes: [], edges: [] }, knowgraph: { nodes: [], edges: [] } },
}) }));
vi.mock('../features/agentbuilder/core/useAgentBuilderWorkspaceLayout', () => ({ default: () => ({}) }));
vi.mock('../features/agentbuilder/core/AgentBuilderWorkspace', () => ({
  default: ({ chat }: { chat: React.ReactNode }) => <>{chat}</>,
}));
vi.mock('../features/agentbuilder/console/MainBuilderSplitPanel', () => ({
  default: ({ chat }: { chat: React.ReactNode }) => <>{chat}</>,
}));
vi.mock('../components/CardEditor', () => ({ CardEditor: () => null }));
vi.mock('../components/knowledge/KnowledgeGraphFramework', () => ({ default: () => null }));
vi.mock('../features/agentbuilder/canvas/AgentCanvasPane', () => ({ default: () => null }));
vi.mock('../features/agentbuilder/project/AgentBuilderProjectDrawer', () => ({ default: () => null }));
vi.mock('../features/agentbuilder/console/AgentTerminalPanel', () => ({ default: () => null }));
vi.mock('../features/worldview/WorldViewSurface', () => ({ default: () => null }));
vi.mock('./tradingui', () => ({ default: () => null }));

beforeEach(() => {
  window.history.replaceState({}, '', '/agentbuilder?projectId=project-a');
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value(this: HTMLElement, options: ScrollToOptions | number, y?: number) {
      this.scrollTop = typeof options === 'number' ? (y || 0) : (options.top || 0);
      this.dispatchEvent(new Event('scroll'));
    },
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo;
});

it('keeps saved Main history and submission when completing and sending a connected @Card', async () => {
  const mainSend = vi.fn().mockResolvedValue(undefined);
  const targetSend = vi.fn().mockResolvedValue(undefined);
  const pendingRequests: HermesChatRequest[] = [];
  vi.mocked(useHermesMainChat).mockImplementation((_projectId, profile) => ({
    messages: [{ role: 'assistant', text: profile === 'owner-main-profile' ? 'Main history' : 'Target history' }],
    send: profile === 'owner-main-profile' ? mainSend : targetSend,
    busy: false, historyLoading: false, error: null, voiceError: null, voicePhase: 'idle',
    pendingRequest: pendingRequests[0], startVoice: vi.fn(), stopVoice: vi.fn(), stop: vi.fn(),
    answerApproval: vi.fn(), answerClarify: vi.fn(), cancelRequest: vi.fn(),
  }));
  render(<VirtuosoMockContext.Provider value={{ viewportHeight: 600, itemHeight: 96 }}>
    <AgentBuilder />
  </VirtuosoMockContext.Provider>);
  const scroller = screen.getByTestId('main-chat-message-list');
  Object.defineProperties(scroller, {
    offsetHeight: { configurable: true, value: 600 },
    scrollHeight: { configurable: true, value: 600 },
  });
  fireEvent.scroll(scroller);
  await screen.findByText('Main history');
  const input = screen.getByTestId('main-chat-input') as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: '@k' } });
  expect(screen.getByTestId('main-chat-address-KnowGraph')).toBeTruthy();
  fireEvent.keyDown(input, { key: 'Tab' });
  expect(input.value).toBe('@KnowGraph ');
  expect(screen.queryByText('Target history')).toBeNull();
  expect(screen.getByText('Main history')).toBeTruthy();
  const body = '@KnowGraph exact task\nkeep literal';
  fireEvent.change(input, { target: { value: body } });
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(mainSend).toHaveBeenCalledExactlyOnceWith(body));
  expect(targetSend).not.toHaveBeenCalled();
  expect(screen.getByText('Main history')).toBeTruthy();
  for (const call of vi.mocked(useHermesMainChat).mock.calls) {
    expect(call).toEqual(['project-a', 'owner-main-profile', 'Main']);
  }
});
