// @vitest-environment jsdom
/**
 * Entity: Main Chat
 * Relationship: This file verifies the bounded conversation viewport, draft-preserving composer, voice controls, and visible transport-error presentation.
 * Entity: Agent Messaging
 * Relationship: This file verifies @Card suggestions come only from the supplied direct roster.
 * Entity: Card Invocation
 * Relationship: Verifies unchanged text and accepted images reach the supplied callback, invalid image selections are rejected, and rejected submissions preserve the draft; it does not prove Hermes execution or IDF materialization.
 * Entity: Project Knowledge Graph
 * Relationship: This file verifies current assistant Entity names open exact graph focus targets without exposing markup or linking user text.
 */

import React from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { VirtuosoMockContext } from 'react-virtuoso';

import MainProjectChat from './MainProjectChat';

const colors = {
  primary: '#4fa2ad',
  bg: '#111',
  panel: '#222',
  border: '#333',
  text: '#fff',
  neutral: '#777',
};

function scrollVirtualViewportToBottom(totalCount: number, itemHeight: number, viewportHeight: number) {
  const scroller = screen.getByTestId('main-chat-message-list');
  const scrollHeight = Math.max(viewportHeight, totalCount * itemHeight);
  Object.defineProperties(scroller, {
    offsetHeight: { configurable: true, value: viewportHeight },
    scrollHeight: { configurable: true, value: scrollHeight },
  });
  scroller.scrollTop = Math.max(0, scrollHeight - viewportHeight);
  fireEvent.scroll(scroller);
}

describe('MainProjectChat', () => {
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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('replaces the one circular Send control with the square Stop control for the active operation', () => {
    const onSend = vi.fn();
    const onStop = vi.fn();
    const { unmount } = render(
      <MainProjectChat
        messages={[]}
        onSend={onSend}
        onStop={onStop}
        knowledgeProjectId="project-1"
        colors={colors}
      />,
    );

    const send = screen.getByRole('button', { name: 'Send' });
    expect(send.className).toContain('rounded-full');
    expect((send as HTMLButtonElement).style.width).toBe('40px');
    expect((send as HTMLButtonElement).style.height).toBe('40px');
    expect(send.querySelector('svg')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();

    unmount();
    render(
      <MainProjectChat
        busy
        messages={[]}
        onSend={onSend}
        onStop={onStop}
        knowledgeProjectId="project-1"
        colors={colors}
      />,
    );

    expect(screen.queryByTestId('main-chat-active-indicator')).toBeNull();
    expect(screen.queryByText('Working…')).toBeNull();
    expect((screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement).disabled).toBe(false);
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    const stop = screen.getByRole('button', { name: 'Stop' });
    expect(stop).toBe(screen.getByTestId('main-chat-stop'));
    expect((stop as HTMLButtonElement).disabled).toBe(false);
    expect(stop.className).toContain('rounded-full');
    expect((stop as HTMLButtonElement).style.width).toBe('40px');
    expect((stop as HTMLButtonElement).style.height).toBe('40px');
    const square = stop.querySelector('span');
    expect(square?.style.width).toBe('10px');
    expect(square?.style.height).toBe('10px');
    expect(square?.style.background).toBe('rgb(255, 255, 255)');
    expect(stop.textContent).toBe('');
    fireEvent.click(stop);
    expect(onStop).toHaveBeenCalledOnce();
    expect(onSend).not.toHaveBeenCalled();
  });

  it('renders Markdown around canonical Entity links without exposing markers', async () => {
    const onEntityFocus = vi.fn();
    const targets = new Map(['Electron', 'Neutron', 'Rocket Lab'].map(name => [name, {
      canonicalName: name,
      members: [{ authority: 'thinkgraph', entityId: `provider-${name}` }],
    }]));
    const entityMatcher = {
      revisionKey: 'markdown-link-proof',
      segmentMessage: (role: string, text: string) => {
        if (role !== 'assistant') return [{ text }];
        const matches = [...targets.keys()].flatMap(name => {
          const start = text.indexOf(name);
          return start < 0 ? [] : [{ start, end: start + name.length, name }];
        }).sort((left, right) => left.start - right.start);
        if (!matches.length) return [{ text }];
        const segments: Array<{ text: string; target?: unknown }> = [];
        let cursor = 0;
        for (const match of matches) {
          if (match.start > cursor) segments.push({ text: text.slice(cursor, match.start) });
          segments.push({ text: match.name, target: targets.get(match.name) });
          cursor = match.end;
        }
        if (cursor < text.length) segments.push({ text: text.slice(cursor) });
        return segments;
      },
    } as any;
    render(
      <VirtuosoMockContext.Provider value={{ viewportHeight: 300, itemHeight: 96 }}>
        <MainProjectChat
          messages={[{
            role: 'assistant',
            text: '**Electron** and *Neutron* refine the Rocket Lab, thesis.',
            status: 'complete',
          }]}
          onSend={vi.fn()}
          knowledgeProjectId="project-1"
          colors={colors}
          entityMatcher={entityMatcher}
          onEntityFocus={onEntityFocus}
        />
      </VirtuosoMockContext.Provider>,
    );
    scrollVirtualViewportToBottom(1, 96, 300);

    const electron = await screen.findByRole('button', { name: 'Open Electron in graph' });
    const neutron = screen.getByRole('button', { name: 'Open Neutron in graph' });
    const rocket = screen.getByRole('button', { name: 'Open Rocket Lab in graph' });
    expect((electron as HTMLButtonElement).style.fontStyle).toBe('italic');
    expect((electron as HTMLButtonElement).style.textDecorationStyle).toBe('dotted');
    expect((electron as HTMLButtonElement).style.color).not.toBe(colors.primary);
    expect(electron.closest('strong')).not.toBeNull();
    expect(neutron.closest('em')).not.toBeNull();
    expect(rocket.parentElement?.textContent).toContain('Rocket Lab, thesis.');
    expect(screen.getByTestId('main-chat-message-frame').textContent).not.toContain('*');
    fireEvent.click(rocket);
    expect(onEntityFocus).toHaveBeenCalledWith(targets.get('Rocket Lab'));
  });

  it('renders exact Run-linked Knows as graph focus controls', async () => {
    const onEvidenceFocus = vi.fn();
    render(
      <VirtuosoMockContext.Provider value={{ viewportHeight: 300, itemHeight: 96 }}>
        <MainProjectChat
          messages={[{
            role: 'assistant',
            text: 'The sourced research is ready.',
            linkedEvidenceIds: ['know-one', 'know-two'],
            status: 'complete',
          }]}
          onSend={vi.fn()}
          knowledgeProjectId="project-1"
          colors={colors}
          onEvidenceFocus={onEvidenceFocus}
        />
      </VirtuosoMockContext.Provider>,
    );
    scrollVirtualViewportToBottom(1, 96, 300);

    const first = await screen.findByRole('button', { name: 'Open Know 1 in graph' });
    const second = screen.getByRole('button', { name: 'Open Know 2 in graph' });
    expect(first.textContent).toBe('Know 1');
    expect(second.textContent).toBe('Know 2');
    fireEvent.click(second);
    expect(onEvidenceFocus).toHaveBeenCalledExactlyOnceWith('know-two');
  });

  it('keeps intraword underscores literal while retaining intentional underscore emphasis', async () => {
    render(
      <VirtuosoMockContext.Provider value={{ viewportHeight: 300, itemHeight: 96 }}>
        <MainProjectChat
          messages={[{
            role: 'assistant',
            text: [
              'MAIN_RESTORE_OK BUILDER_RESTORE_OK snake_case file_name.py',
              '_intentional emphasis_ _outer_identifier_value_',
            ].join('\n'),
            status: 'complete',
          }]}
          onSend={vi.fn()}
          knowledgeProjectId="project-1"
          colors={colors}
        />
      </VirtuosoMockContext.Provider>,
    );
    scrollVirtualViewportToBottom(1, 96, 300);

    const frame = await screen.findByTestId('main-chat-message-frame');
    expect(frame.textContent).toContain('MAIN_RESTORE_OK');
    expect(frame.textContent).toContain('BUILDER_RESTORE_OK');
    expect(frame.textContent).toContain('snake_case');
    expect(frame.textContent).toContain('file_name.py');
    expect([...frame.querySelectorAll('em')].map(element => element.textContent)).toEqual([
      'intentional emphasis',
      'outer_identifier_value',
    ]);
  });

  it('does not show Stop before the server has supplied the active Run identity', () => {
    const onStop = vi.fn();
    render(
      <MainProjectChat
        connecting
        messages={[]}
        onSend={vi.fn()}
        onStop={onStop}
        knowledgeProjectId="project-1"
        colors={colors}
      />,
    );

    expect(screen.queryByText('Connecting…')).toBeNull();
    expect(screen.queryByTestId('main-chat-active-indicator')).toBeNull();
    expect(screen.queryByText('Working…')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    const send = screen.getByRole('button', { name: 'Send' });
    expect((send as HTMLButtonElement).disabled).toBe(false);
    expect(onStop).not.toHaveBeenCalled();
  });

  it('uses one mic control for idle, listening, and explicit stop', () => {
    const onVoiceStart = vi.fn();
    const onVoiceStop = vi.fn();
    const { rerender } = render(
      <MainProjectChat
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
      <MainProjectChat
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

  it('shows history rejoin and prevents a send until it completes', () => {
    const onSend = vi.fn();
    render(
      <MainProjectChat
        historyLoading
        messages={[]}
        onSend={onSend}
        knowledgeProjectId="project-1"
        colors={colors}
      />,
    );

    expect(screen.queryByText('Loading conversation…')).toBeNull();
    expect(screen.queryByTestId('main-chat-active-indicator')).toBeNull();
    expect((screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement).disabled).toBe(true);
    const send = screen.getByRole('button', { name: 'Send' });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(send);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('keeps conversation identity and navigation out of Main Chat', () => {
    render(
      <MainProjectChat
        messages={[]}
        onSend={vi.fn()}
        knowledgeProjectId="project-1"
        colors={colors}
      />,
    );

    expect(screen.queryByTestId('main-chat-conversation-bar')).toBeNull();
    expect(screen.queryByRole('button', { name: /new chat|rejoin|conversation/i })).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    const page = readFileSync(path.resolve(process.cwd(), 'client/src/pages/agentbuilder.tsx'), 'utf8');
    expect(page).not.toMatch(/startNewConversation|syncConversationFromUrl|setConversationId|onNewConversation/);
    expect(page).toContain('const conversationId = canvasProjectId;');
    expect(page).not.toContain('selectedConversationId(');
  });

  it('keeps delegation and preview controls out of the chat composer', () => {
    render(
      <MainProjectChat
        messages={[]}
        onSend={vi.fn()}
        knowledgeProjectId="project-1"
        colors={colors}
      />,
    );

    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Attach images' })).not.toBeNull();
    expect(screen.getByRole('textbox', { name: 'Message' })).not.toBeNull();
    expect(screen.queryByTestId('main-chat-current-responder')).toBeNull();
  });

  it('uses the parent-owned draft so an imported Main task reaches the one chat composer', () => {
    const onSend = vi.fn();
    function ControlledChat() {
      const [draft, setDraft] = React.useState('Imported Main task.');
      return (
        <MainProjectChat
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
    expect((screen.getByTestId('main-chat-input') as HTMLTextAreaElement).value).toBe('Imported Main task.');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledWith('Imported Main task.');
    expect((screen.getByTestId('main-chat-input') as HTMLTextAreaElement).value).toBe('');
  });

  it('sends the exact non-empty user text without trimming it', () => {
    const onSend = vi.fn();
    render(
      <MainProjectChat
        messages={[]}
        onSend={onSend}
        knowledgeProjectId="project-1"
        colors={colors}
      />,
    );

    fireEvent.change(screen.getByTestId('main-chat-input'), {
      target: { value: '  Exact user text.  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledWith('  Exact user text.  ');
  });

  it('retains the draft when the owner rejects submission before acceptance', () => {
    const onSend = vi.fn(() => false);
    render(
      <MainProjectChat
        messages={[]}
        onSend={onSend}
        knowledgeProjectId="project-1"
        colors={colors}
      />,
    );
    const input = screen.getByTestId('main-chat-input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'Keep this draft.' } });

    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(onSend).toHaveBeenCalledWith('Keep this draft.');
    expect(input.value).toBe('Keep this draft.');
  });

  it('wraps multiline drafts, sends on Enter and preserves Shift+Enter and composing input', () => {
    const onSend = vi.fn();
    render(<MainProjectChat messages={[]} onSend={onSend} knowledgeProjectId="project-1" colors={colors} />);
    const input = screen.getByTestId('main-chat-input') as HTMLTextAreaElement;
    expect(input.tagName).toBe('TEXTAREA');
    expect(input.style.whiteSpace).toBe('pre-wrap');
    expect(input.style.overflowX).toBe('hidden');
    fireEvent.change(input, { target: { value: '@Builder First line\nSecond line' } });
    expect(fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })).toBe(true);
    expect(fireEvent.keyDown(input, { key: 'Enter', isComposing: true })).toBe(true);
    expect(onSend).not.toHaveBeenCalled();
    expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(false);
    expect(onSend).toHaveBeenCalledWith('@Builder First line\nSecond line');
    expect(input.value).toBe('');
  });

  it('grows and reflows the composer as its panel narrows, bounding tall drafts without visible scrollbars', () => {
    let panelWidth = 600;
    let neededHeight = 72;
    const resizeCallbacks = new Map<Element, () => void>();
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => panelWidth);
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => neededHeight);
    vi.stubGlobal('ResizeObserver', vi.fn(function ResizeObserverMock(
      callback: ResizeObserverCallback,
    ) {
      return {
        observe: (element: Element) => resizeCallbacks.set(
          element,
          () => callback([], {} as ResizeObserver),
        ),
        unobserve: vi.fn(),
        disconnect: vi.fn(),
      };
    }));
    render(<MainProjectChat messages={[]} onSend={vi.fn()} knowledgeProjectId="project-1" colors={colors} />);
    const input = screen.getByTestId('main-chat-input') as HTMLTextAreaElement;
    expect(input.style.height).toBe('72px');
    neededHeight = 120;
    fireEvent.change(input, { target: { value: 'A wrapped draft with several lines.' } });
    expect(input.style.height).toBe('120px');
    panelWidth = 300;
    neededHeight = 180;
    act(() => resizeCallbacks.get(input.parentElement!)!());
    expect(input.style.height).toBe('180px');
    neededHeight = 900;
    fireEvent.change(input, { target: { value: 'Long draft. '.repeat(100) } });
    expect(Number.parseFloat(input.style.height)).toBeLessThanOrEqual(240);
    expect(input.style.overflowY).toBe('auto');
    expect(getComputedStyle(input).getPropertyValue('scrollbar-width')).toBe('none');
    neededHeight = 40;
    fireEvent.change(input, { target: { value: '' } });
    expect(input.style.height).toBe('40px');
  });

  it('previews removable image files and sends the selected records through the existing composer while retaining PDF ingestion', async () => {
    const onSend = vi.fn();
    render(<MainProjectChat messages={[]} onSend={onSend} knowledgeProjectId="project-1" colors={colors} />);
    expect(screen.getByRole('button', { name: 'Attach knowledge PDF' })).not.toBeNull();
    const files = screen.getByLabelText('Image files');
    fireEvent.change(files, { target: { files: [new File(['pixels'], 'scene.png', { type: 'image/png' })] } });
    expect(await screen.findByAltText('scene.png')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove scene.png' }));
    expect(screen.queryByAltText('scene.png')).toBeNull();
    fireEvent.change(files, { target: { files: [new File(['pixels'], 'scene.png', { type: 'image/png' })] } });
    await screen.findByAltText('scene.png');
    fireEvent.change(screen.getByTestId('main-chat-input'), { target: { value: '@WorldView Inspect this image.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledWith('@WorldView Inspect this image.', {
      images: [{ name: 'scene.png', mediaType: 'image/png', dataUrl: 'data:image/png;base64,cGl4ZWxz', kind: 'user-upload' }],
    });
    expect(screen.queryByAltText('scene.png')).toBeNull();
  });

  it('accepts pasted images and rejects unsupported, oversized and over-count selections before sending', async () => {
    const onSend = vi.fn();
    render(<MainProjectChat messages={[]} onSend={onSend} knowledgeProjectId="project-1" colors={colors} />);
    const pasted = new File(['pixels'], 'pasted.png', { type: 'image/png' });
    fireEvent.paste(screen.getByTestId('main-chat-input'), {
      clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => pasted }] },
    });
    await screen.findByAltText('pasted.png');
    const files = screen.getByLabelText('Image files');
    fireEvent.change(files, { target: { files: [new File(['svg'], 'vector.svg', { type: 'image/svg+xml' })] } });
    await screen.findByText('Choose a PNG, JPEG, WebP or GIF image.');
    const oversized = new File(['pixels'], 'large.png', { type: 'image/png' });
    Object.defineProperty(oversized, 'size', { value: 2 * 1024 * 1024 + 1 });
    fireEvent.change(files, { target: { files: [oversized] } });
    await screen.findByText('Each image must be between 1 byte and 2 MB.');
    fireEvent.change(files, { target: { files: Array.from({ length: 4 }, () => pasted) } });
    await screen.findByText('A message can include at most 4 images.');
    expect(screen.getAllByRole('img')).toHaveLength(1);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('filters the saved callable roster and completes the selected address with Tab', () => {
    render(
      <MainProjectChat
        messages={[]}
        directChatTargets={[
          {
            cardId: 'builder', title: 'Builder',
            address: 'Builder',
          },
          {
            cardId: 'trading', title: 'Trading',
            address: 'Trading',
          },
        ]}
        onSend={vi.fn()}
        knowledgeProjectId="project-1"
        colors={colors}
      />,
    );

    const input = screen.getByTestId('main-chat-input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '@b' } });
    expect(screen.getByTestId('main-chat-address-Builder').textContent).toContain('@Builder');
    expect(screen.queryByTestId('main-chat-address-Trading')).toBeNull();
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(input.value).toBe('@Builder ');
  });

  it('mounts only a bounded Virtuoso window for the 114-message Trading history', async () => {
    const messages = Array.from({ length: 114 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
      text: index % 5 === 0
        ? `Trading message ${index}: ${'variable height evidence '.repeat(8)}`
        : `Trading message ${index}`,
      status: 'complete' as const,
    }));

    const renderChat = (items: typeof messages) => (
      <VirtuosoMockContext.Provider value={{ viewportHeight: 300, itemHeight: 64 }}>
        <MainProjectChat
          messages={items}
          onSend={vi.fn()}
          knowledgeProjectId="trading-project"
          colors={colors}
        />
      </VirtuosoMockContext.Provider>
    );
    const { rerender } = render(renderChat(messages));

    scrollVirtualViewportToBottom(114, 64, 300);

    await screen.findByText('Trading message 113');
    await waitFor(() => {
      const mountedRows = screen.getAllByTestId('main-chat-message-row').length;
      expect(mountedRows).toBeGreaterThan(0);
      expect(mountedRows).toBeLessThan(114);
    });
    expect(screen.queryByText('Trading message 0')).toBeNull();

    const scroller = screen.getByTestId('main-chat-message-list');
    scroller.scrollTop = 3200;
    fireEvent.scroll(scroller);
    expect(await screen.findByRole('button', { name: 'Return to latest' })).not.toBeNull();

    const readerPosition = scroller.scrollTop;
    rerender(renderChat([
      ...messages,
      {
        role: 'assistant',
        text: 'Trading message 114',
        status: 'complete',
      },
    ]));
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 115 * 64 });
    await waitFor(() => expect(scroller.scrollTop).toBe(readerPosition));
  });

  it('reflows Pretext bubble width when the continuously resizable Main lane changes', async () => {
    let viewportWidth = 720;
    let notifyResize: () => void = () => undefined;
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => viewportWidth);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      font: '',
      measureText: (text: string) => ({ width: Array.from(text).length * 7.5 }),
    } as unknown as CanvasRenderingContext2D);
    vi.stubGlobal('ResizeObserver', vi.fn(function ResizeObserverMock(
      callback: ResizeObserverCallback,
    ) {
      notifyResize = () => callback([], {} as ResizeObserver);
      return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    }));

    render(
      <VirtuosoMockContext.Provider value={{ viewportHeight: 300, itemHeight: 96 }}>
        <MainProjectChat
          messages={[{
            role: 'assistant',
            text: 'This variable-height answer reflows through Pretext as Main changes width without replacing the conversation.',
            status: 'complete',
          }]}
          onSend={vi.fn()}
          knowledgeProjectId="trading-project"
          colors={colors}
        />
      </VirtuosoMockContext.Provider>,
    );
    scrollVirtualViewportToBottom(1, 96, 300);

    const frame = await screen.findByTestId('main-chat-message-frame');
    const wideWidth = Number.parseFloat(frame.style.width);
    const scroller = screen.getByTestId('main-chat-message-list');
    scroller.scrollTop = 37;
    const readerPosition = scroller.scrollTop;
    viewportWidth = 300;
    await act(async () => notifyResize());
    const narrowWidth = Number.parseFloat(frame.style.width);

    expect(wideWidth).toBeGreaterThan(narrowWidth);
    expect(narrowWidth).toBeLessThanOrEqual((300 - 40) * 0.92 + 1);
    expect(scroller.scrollTop).toBe(readerPosition);
  });

  it('shows a runtime transport failure as status instead of assistant speech', () => {
    render(
      <MainProjectChat
        messages={[]}
        error="card_tools_unavailable:cbm.search_graph"
        onSend={vi.fn()}
        knowledgeProjectId="project-1"
        colors={colors}
      />,
    );

    expect(screen.getByTestId('main-chat-error').textContent)
      .toBe('card_tools_unavailable:cbm.search_graph');
    expect(screen.queryAllByText('card_tools_unavailable:cbm.search_graph')).toHaveLength(1);
  });
});
