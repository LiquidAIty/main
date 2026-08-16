// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

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
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      accessMode: 'chatgpt-account',
      account: null,
    }), { status: 200 })));
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

  it('renders managed ChatGPT account state on the existing Main chat surface', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      accessMode: 'chatgpt-account',
      account: { type: 'chatgpt', email: 'owner@example.com', planType: 'pro' },
      rateLimits: { rateLimits: { primary: { usedPercent: 12 } } },
    }), { status: 200 })));

    render(
      <BuilderChat
        messages={[]}
        onSend={vi.fn()}
        knowledgeProjectId="project-1"
        mainAccessMode="chatgpt-account"
        colors={colors}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('main-codex-account').textContent).toContain('owner@example.com'));
    expect(screen.getByTestId('main-codex-account').textContent).toContain('12% used');
  });
});
