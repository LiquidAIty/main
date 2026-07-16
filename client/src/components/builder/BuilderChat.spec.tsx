// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

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
  it('focuses the normal composer with only a temporary selected-object placeholder', () => {
    const { rerender } = render(<BuilderChat messages={[]} onSend={vi.fn()} knowledgeProjectId="project-1" colors={colors} />);
    rerender(<BuilderChat messages={[]} onSend={vi.fn()} knowledgeProjectId="project-1" colors={colors} composerFocusRequest={1} graphObjectPlaceholder="Knowledge graphs" />);
    const input = screen.getByPlaceholderText('Ask about Knowledge graphs…');
    expect(document.activeElement).toBe(input);
    expect(screen.queryByTestId('graph-context-chips')).toBeNull();
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
});
