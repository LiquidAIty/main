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
});
