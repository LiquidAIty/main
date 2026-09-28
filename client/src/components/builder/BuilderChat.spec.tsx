// @vitest-environment jsdom
import React from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { VirtuosoMockContext } from 'react-virtuoso';

import BuilderChat, { followLatestOutput } from './BuilderChat';

const colors = {
  primary: '#4fa2ad',
  bg: '#111',
  panel: '#222',
  border: '#333',
  text: '#fff',
  neutral: '#777',
};

function scrollVirtualViewportToBottom(totalCount: number, itemHeight: number, viewportHeight: number) {
  const scroller = screen.getByTestId('builder-chat-message-list');
  const scrollHeight = Math.max(viewportHeight, totalCount * itemHeight);
  Object.defineProperties(scroller, {
    offsetHeight: { configurable: true, value: viewportHeight },
    scrollHeight: { configurable: true, value: scrollHeight },
  });
  scroller.scrollTop = Math.max(0, scrollHeight - viewportHeight);
  fireEvent.scroll(scroller);
}

describe('BuilderChat', () => {
  beforeEach(() => {
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
    delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo;
    vi.unstubAllGlobals();
  });

  it('shows only a visual indicator for the real active turn', () => {
    const onSend = vi.fn();
    render(
      <BuilderChat
        busy
        messages={[]}
        onSend={onSend}
        knowledgeProjectId="project-1"
        colors={colors}
      />,
    );

    expect(screen.getByTestId('builder-chat-active-indicator').textContent).toBe('');
    expect(screen.queryByText('Working…')).toBeNull();
    expect((screen.getByPlaceholderText('Type a message…') as HTMLInputElement).disabled).toBe(false);
    const send = screen.getByRole('button', { name: 'Send' });
    expect((send as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(send);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('follows appended output only while the reader remains at the bottom', () => {
    expect(followLatestOutput(true)).toBe('auto');
    expect(followLatestOutput(false)).toBe(false);
  });

  it('shows a quiet activity indicator while the native turn is connecting', () => {
    render(
      <BuilderChat
        connecting
        messages={[]}
        onSend={vi.fn()}
        knowledgeProjectId="project-1"
        colors={colors}
      />,
    );

    expect(screen.queryByText('Connecting…')).toBeNull();
    expect(screen.queryByTestId('builder-chat-active-indicator')).not.toBeNull();
    expect(screen.queryByText('Working…')).toBeNull();
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled)
      .toBe(false);
  });

  it('uses one mic control for idle, listening, and explicit stop', () => {
    const onVoiceStart = vi.fn();
    const onVoiceStop = vi.fn();
    const { rerender } = render(
      <BuilderChat
        messages={[]}
        onSend={vi.fn()}
        knowledgeProjectId="project-1"
        colors={colors}
        voicePhase="idle"
        onVoiceStart={onVoiceStart}
        onVoiceStop={onVoiceStop}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Start voice' }));
    expect(onVoiceStart).toHaveBeenCalledOnce();

    rerender(
      <BuilderChat
        messages={[]}
        onSend={vi.fn()}
        knowledgeProjectId="project-1"
        colors={colors}
        voicePhase="listening"
        onVoiceStart={onVoiceStart}
        onVoiceStop={onVoiceStop}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Stop and transcribe voice' }));
    expect(onVoiceStop).toHaveBeenCalledOnce();
  });

  it('shows native history rejoin and prevents a send until it completes', () => {
    const onSend = vi.fn();
    render(
      <BuilderChat
        historyLoading
        messages={[]}
        onSend={onSend}
        knowledgeProjectId="project-1"
        colors={colors}
      />,
    );

    expect(screen.queryByText('Loading conversation…')).toBeNull();
    expect(screen.queryByTestId('builder-chat-active-indicator')).toBeNull();
    expect((screen.getByPlaceholderText('Type a message…') as HTMLInputElement).disabled).toBe(true);
    const send = screen.getByRole('button', { name: 'Send' });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(send);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('keeps conversation identity and navigation out of Main Chat', () => {
    render(
      <BuilderChat
        messages={[]}
        onSend={vi.fn()}
        knowledgeProjectId="project-1"
        colors={colors}
      />,
    );

    expect(screen.queryByTestId('builder-chat-conversation-bar')).toBeNull();
    expect(screen.queryByRole('button', { name: /new chat|rejoin|conversation/i })).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    const page = readFileSync(path.resolve(process.cwd(), 'client/src/pages/agentbuilder.tsx'), 'utf8');
    expect(page).not.toMatch(/startNewConversation|syncConversationFromUrl|setConversationId|onNewConversation/);
    // Existing project-scoped history and legacy links remain internal inputs.
    expect(page).toContain('const [conversationId] = useState');
    expect(page).toContain('selectedConversationId(window.location.search)');
  });

  it('keeps delegation and preview controls out of the chat composer', () => {
    render(
      <BuilderChat
        messages={[]}
        onSend={vi.fn()}
        knowledgeProjectId="project-1"
        colors={colors}
      />,
    );

    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(screen.getByPlaceholderText('Type a message…')).not.toBeNull();
    expect(screen.queryByTestId('builder-chat-current-responder')).toBeNull();
  });

  it('uses the parent-owned draft so an imported Main task reaches the one chat composer', () => {
    const onSend = vi.fn();
    function ControlledChat() {
      const [draft, setDraft] = React.useState('Imported Main task.');
      return (
        <BuilderChat
          messages={[]}
          onSend={onSend}
          knowledgeProjectId="project-1"
          colors={colors}
          draft={draft}
          onDraftChange={setDraft}
        />
      );
    }
    render(<ControlledChat />);
    expect((screen.getByTestId('builder-chat-input') as HTMLInputElement).value).toBe('Imported Main task.');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledWith('Imported Main task.');
    expect((screen.getByTestId('builder-chat-input') as HTMLInputElement).value).toBe('');
  });

  it('sends the exact non-empty user text without trimming it', () => {
    const onSend = vi.fn();
    render(
      <BuilderChat
        messages={[]}
        onSend={onSend}
        knowledgeProjectId="project-1"
        colors={colors}
      />,
    );

    fireEvent.change(screen.getByTestId('builder-chat-input'), {
      target: { value: '  Exact user text.  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledWith('  Exact user text.  ');
  });

  it('filters the saved callable roster and completes the selected address with Tab', () => {
    render(
      <BuilderChat
        messages={[]}
        directChatTargets={[
          {
            cardId: 'builder', cardRevisionId: 'revision-builder',
            profile: 'builder', title: 'Builder',
            address: 'Builder', aliases: ['builder'],
          },
          {
            cardId: 'trading', cardRevisionId: 'revision-trading',
            profile: 'trading', title: 'Trading',
            address: 'Trading', aliases: ['trading'],
          },
        ]}
        onSend={vi.fn()}
        knowledgeProjectId="project-1"
        colors={colors}
      />,
    );

    const input = screen.getByTestId('builder-chat-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '@b' } });
    expect(screen.getByTestId('builder-chat-address-Builder').textContent).toContain('@Builder');
    expect(screen.queryByTestId('builder-chat-address-Trading')).toBeNull();
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(input.value).toBe('@Builder ');
  });

  it('keeps routing metadata out of the user bubble and renders the replying Card identity', async () => {
    render(
      <VirtuosoMockContext.Provider value={{ viewportHeight: 420, itemHeight: 72 }}>
        <BuilderChat
          messages={[
            {
              role: 'assistant', text: 'Main answer', status: 'complete',
              speaker: {
                kind: 'card', label: 'Main Chat', cardId: 'card_main_chat', profile: 'liquidaity-main',
              },
            },
            {
              role: 'user', text: '@builder Reply exactly BUILDER_DIRECT_OK', status: 'complete',
              speaker: { kind: 'user', label: 'You' },
              target: { kind: 'card', label: 'Builder', cardId: 'builder', profile: 'builder' },
            },
            {
              role: 'assistant', text: 'BUILDER_DIRECT_OK', status: 'complete',
              speaker: { kind: 'card', label: 'Builder', cardId: 'builder', profile: 'builder' },
            },
          ]}
          mainCardId="card_main_chat"
          onSend={vi.fn()}
          knowledgeProjectId="project-1"
          colors={colors}
        />
      </VirtuosoMockContext.Provider>,
    );

    scrollVirtualViewportToBottom(3, 72, 420);

    expect(await screen.findByText('@builder Reply exactly BUILDER_DIRECT_OK')).not.toBeNull();
    expect(screen.queryByText('You → Builder')).toBeNull();
    expect(screen.queryByText('You')).toBeNull();
    expect(screen.getAllByTestId('builder-chat-speaker')).toHaveLength(1);
    expect(screen.getByTestId('builder-chat-speaker').textContent).toBe('@Builder');
    expect(screen.queryByText('Main Chat')).toBeNull();
    expect(screen.getByText('Main answer')).not.toBeNull();
    expect(screen.getByText('BUILDER_DIRECT_OK')).not.toBeNull();
  });

  it('mounts only a bounded Virtuoso window for the 114-message Trading history', async () => {
    const messages = Array.from({ length: 114 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
      text: index % 5 === 0
        ? `Trading message ${index}: ${'variable height evidence '.repeat(8)}`
        : `Trading message ${index}`,
      speaker: index % 2 === 0
        ? { kind: 'user' as const, label: 'You' }
        : { kind: 'card' as const, label: 'Main', cardId: 'card_main_chat' },
      status: 'complete' as const,
    }));

    render(
      <VirtuosoMockContext.Provider value={{ viewportHeight: 300, itemHeight: 64 }}>
        <BuilderChat
          messages={messages}
          mainCardId="card_main_chat"
          onSend={vi.fn()}
          knowledgeProjectId="trading-project"
          colors={colors}
        />
      </VirtuosoMockContext.Provider>,
    );

    scrollVirtualViewportToBottom(114, 64, 300);

    await screen.findByText('Trading message 113');
    await waitFor(() => {
      const mountedRows = screen.getAllByTestId('builder-chat-message-row').length;
      expect(mountedRows).toBeGreaterThan(0);
      expect(mountedRows).toBeLessThan(114);
    });
    expect(screen.queryByText('Trading message 0')).toBeNull();
  });

  it('shows a native transport failure as status instead of assistant speech', () => {
    render(
      <BuilderChat
        messages={[]}
        error="card_tools_unavailable:cbm.search_graph"
        onSend={vi.fn()}
        knowledgeProjectId="project-1"
        colors={colors}
      />,
    );

    expect(screen.getByTestId('builder-chat-error').textContent)
      .toBe('card_tools_unavailable:cbm.search_graph');
    expect(screen.queryAllByText('card_tools_unavailable:cbm.search_graph')).toHaveLength(1);
  });
});
