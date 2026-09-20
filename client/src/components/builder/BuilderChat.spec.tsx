// @vitest-environment jsdom
import React from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import BuilderChat from './BuilderChat';

const colors = {
  primary: '#4fa2ad',
  bg: '#111',
  panel: '#222',
  border: '#333',
  text: '#fff',
  neutral: '#777',
};

describe('BuilderChat', () => {
  afterEach(() => {
    cleanup();
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
    expect((screen.getByPlaceholderText('Type a message…') as HTMLInputElement).disabled).toBe(true);
    const send = screen.getByRole('button', { name: 'Send' });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(send);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('shows no activity indicator or status prose before a native turn exists', () => {
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
    expect(screen.queryByTestId('builder-chat-active-indicator')).toBeNull();
    expect(screen.queryByText('Working…')).toBeNull();
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled)
      .toBe(true);
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
        addressableAgents={[
          {
            cardId: 'builder', profile: 'builder', title: 'Builder',
            address: 'builder', aliases: ['builder'],
          },
          {
            cardId: 'trading', profile: 'trading', title: 'Trading',
            address: 'trading', aliases: ['trading'],
          },
        ]}
        onSend={vi.fn()}
        knowledgeProjectId="project-1"
        colors={colors}
      />,
    );

    const input = screen.getByTestId('builder-chat-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '@b' } });
    expect(screen.getByTestId('builder-chat-address-builder').textContent).toContain('@builder');
    expect(screen.queryByTestId('builder-chat-address-trading')).toBeNull();
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(input.value).toBe('@builder ');
  });

  it('keeps routing metadata out of the user bubble and renders the replying Card identity', () => {
    render(
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
      />,
    );

    expect(screen.getByText('@builder Reply exactly BUILDER_DIRECT_OK')).not.toBeNull();
    expect(screen.queryByText('You → Builder')).toBeNull();
    expect(screen.queryByText('You')).toBeNull();
    expect(screen.getAllByTestId('builder-chat-speaker')).toHaveLength(1);
    expect(screen.getByTestId('builder-chat-speaker').textContent).toBe('Builder');
    expect(screen.queryByText('Main Chat')).toBeNull();
    expect(screen.getByText('Main answer')).not.toBeNull();
    expect(screen.getByText('BUILDER_DIRECT_OK')).not.toBeNull();
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
