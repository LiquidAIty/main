// @vitest-environment jsdom
import React from 'react';
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

  it('states and enforces the real in-flight chat state', () => {
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

    expect(screen.getByTestId('builder-chat-working').textContent).toContain('Working…');
    expect((screen.getByPlaceholderText('Chat is working…') as HTMLInputElement).disabled).toBe(true);
    const send = screen.getByRole('button', { name: 'Chat is working' });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(send);
    expect(onSend).not.toHaveBeenCalled();
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
});
