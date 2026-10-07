// @vitest-environment jsdom
import React from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { VirtuosoMockContext } from 'react-virtuoso';

import BuilderChat, {
  CANONICAL_SUBJECT_LINK_STYLE,
  followLatestOutput,
} from './BuilderChat';

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
    vi.restoreAllMocks();
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
    expect((screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement).disabled).toBe(false);
    const send = screen.getByRole('button', { name: 'Send' });
    expect((send as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(send);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('follows appended output only while the reader remains at the bottom', () => {
    expect(followLatestOutput(true)).toBe('auto');
    expect(followLatestOutput(false)).toBe(false);
  });

  it('keeps canonical subject links neutral and quietly italic', () => {
    expect(CANONICAL_SUBJECT_LINK_STYLE).toMatchObject({
      color: '#A7B0BA',
      fontStyle: 'italic',
      textDecorationStyle: 'dotted',
    });
    expect(CANONICAL_SUBJECT_LINK_STYLE.color).not.toBe(colors.primary);
  });

  it('renders Markdown around canonical subject links without exposing markers', async () => {
    const onSubjectFocus = vi.fn();
    const targets = new Map(['Electron', 'Neutron', 'Rocket Lab'].map(name => [name, {
      canonicalName: name,
      members: [{ authority: 'thinkgraph', entityId: `entity-${name}` }],
    }]));
    const subjectMatcher = {
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
        <BuilderChat
          messages={[{
            role: 'assistant',
            text: '**Electron** and *Neutron* refine the Rocket Lab, thesis.',
            speaker: { kind: 'card', label: 'Main', cardId: 'card_main_chat' },
            status: 'complete',
          }]}
          mainCardId="card_main_chat"
          onSend={vi.fn()}
          knowledgeProjectId="project-1"
          colors={colors}
          subjectMatcher={subjectMatcher}
          onSubjectFocus={onSubjectFocus}
        />
      </VirtuosoMockContext.Provider>,
    );
    scrollVirtualViewportToBottom(1, 96, 300);

    const electron = await screen.findByRole('button', { name: 'Open Electron in graph' });
    const neutron = screen.getByRole('button', { name: 'Open Neutron in graph' });
    const rocket = screen.getByRole('button', { name: 'Open Rocket Lab in graph' });
    expect(electron.closest('strong')).not.toBeNull();
    expect(neutron.closest('em')).not.toBeNull();
    expect(rocket.parentElement?.textContent).toContain('Rocket Lab, thesis.');
    expect(screen.getByTestId('builder-chat-message-frame').textContent).not.toContain('*');
    fireEvent.click(rocket);
    expect(onSubjectFocus).toHaveBeenCalledWith(targets.get('Rocket Lab'));
  });

  it('shows a quiet activity indicator while the provider turn is connecting', () => {
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

  it('shows provider history rejoin and prevents a send until it completes', () => {
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
    expect((screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement).disabled).toBe(true);
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
    expect(screen.getAllByRole('button')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Attach images' })).not.toBeNull();
    expect(screen.getByRole('textbox', { name: 'Message' })).not.toBeNull();
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
    expect((screen.getByTestId('builder-chat-input') as HTMLTextAreaElement).value).toBe('Imported Main task.');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledWith('Imported Main task.');
    expect((screen.getByTestId('builder-chat-input') as HTMLTextAreaElement).value).toBe('');
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

  it('wraps multiline drafts, sends on Enter and preserves Shift+Enter and composing input', () => {
    const onSend = vi.fn();
    render(<BuilderChat messages={[]} onSend={onSend} knowledgeProjectId="project-1" colors={colors} />);
    const input = screen.getByTestId('builder-chat-input') as HTMLTextAreaElement;
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
    vi.stubGlobal('ResizeObserver', vi.fn((callback: ResizeObserverCallback) => ({
      observe: (element: Element) => resizeCallbacks.set(element, () => callback([], {} as ResizeObserver)),
      unobserve: vi.fn(), disconnect: vi.fn(),
    })));
    render(<BuilderChat messages={[]} onSend={vi.fn()} knowledgeProjectId="project-1" colors={colors} />);
    const input = screen.getByTestId('builder-chat-input') as HTMLTextAreaElement;
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
    render(<BuilderChat messages={[]} onSend={onSend} knowledgeProjectId="project-1" colors={colors} />);
    expect(screen.getByRole('button', { name: 'Attach knowledge PDF' })).not.toBeNull();
    const files = screen.getByLabelText('Image files');
    fireEvent.change(files, { target: { files: [new File(['pixels'], 'scene.png', { type: 'image/png' })] } });
    expect(await screen.findByAltText('scene.png')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove scene.png' }));
    expect(screen.queryByAltText('scene.png')).toBeNull();
    fireEvent.change(files, { target: { files: [new File(['pixels'], 'scene.png', { type: 'image/png' })] } });
    await screen.findByAltText('scene.png');
    fireEvent.change(screen.getByTestId('builder-chat-input'), { target: { value: '@WorldView Inspect this image.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledWith('@WorldView Inspect this image.', {
      images: [{ name: 'scene.png', mediaType: 'image/png', dataUrl: 'data:image/png;base64,cGl4ZWxz', kind: 'user-upload' }],
    });
    expect(screen.queryByAltText('scene.png')).toBeNull();
  });

  it('accepts pasted images and rejects unsupported, oversized and over-count selections before sending', async () => {
    const onSend = vi.fn();
    render(<BuilderChat messages={[]} onSend={onSend} knowledgeProjectId="project-1" colors={colors} />);
    const pasted = new File(['pixels'], 'pasted.png', { type: 'image/png' });
    fireEvent.paste(screen.getByTestId('builder-chat-input'), {
      clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => pasted }] },
    });
    await screen.findByAltText('pasted.png');
    const files = screen.getByLabelText('Image files');
    fireEvent.change(files, { target: { files: [new File(['svg'], 'vector.svg', { type: 'image/svg+xml' })] } });
    await screen.findByText('Choose a PNG, JPEG, WebP or GIF image.');
    const oversized = new File(['pixels'], 'large.png', { type: 'image/png' });
    Object.defineProperty(oversized, 'size', { value: 10 * 1024 * 1024 + 1 });
    fireEvent.change(files, { target: { files: [oversized] } });
    await screen.findByText('Each image must be between 1 byte and 10 MB.');
    fireEvent.change(files, { target: { files: Array.from({ length: 12 }, () => pasted) } });
    await screen.findByText('A message can include at most 12 images.');
    expect(screen.getAllByRole('img')).toHaveLength(1);
    expect(onSend).not.toHaveBeenCalled();
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

    const input = screen.getByTestId('builder-chat-input') as HTMLTextAreaElement;
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
    expect(screen.getAllByTestId('builder-chat-message-frame').some(
      frame => frame.textContent?.endsWith('BUILDER_DIRECT_OK'),
    )).toBe(true);
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

    const renderChat = (items: typeof messages) => (
      <VirtuosoMockContext.Provider value={{ viewportHeight: 300, itemHeight: 64 }}>
        <BuilderChat
          messages={items}
          mainCardId="card_main_chat"
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
      const mountedRows = screen.getAllByTestId('builder-chat-message-row').length;
      expect(mountedRows).toBeGreaterThan(0);
      expect(mountedRows).toBeLessThan(114);
    });
    expect(screen.queryByText('Trading message 0')).toBeNull();

    const scroller = screen.getByTestId('builder-chat-message-list');
    scroller.scrollTop = 3200;
    fireEvent.scroll(scroller);
    expect(await screen.findByRole('button', { name: 'Return to latest' })).not.toBeNull();

    const readerPosition = scroller.scrollTop;
    rerender(renderChat([
      ...messages,
      {
        role: 'assistant',
        text: 'Trading message 114',
        speaker: { kind: 'card', label: 'Main', cardId: 'card_main_chat' },
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
    vi.stubGlobal('ResizeObserver', vi.fn((callback: ResizeObserverCallback) => {
      notifyResize = () => callback([], {} as ResizeObserver);
      return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    }));

    render(
      <VirtuosoMockContext.Provider value={{ viewportHeight: 300, itemHeight: 96 }}>
        <BuilderChat
          messages={[{
            role: 'assistant',
            text: 'This variable-height answer reflows through Pretext as Main changes width without replacing the conversation.',
            speaker: { kind: 'card', label: 'Main', cardId: 'card_main_chat' },
            status: 'complete',
          }]}
          mainCardId="card_main_chat"
          onSend={vi.fn()}
          knowledgeProjectId="trading-project"
          colors={colors}
        />
      </VirtuosoMockContext.Provider>,
    );
    scrollVirtualViewportToBottom(1, 96, 300);

    const frame = await screen.findByTestId('builder-chat-message-frame');
    const wideWidth = Number.parseFloat(frame.style.width);
    const scroller = screen.getByTestId('builder-chat-message-list');
    scroller.scrollTop = 37;
    const readerPosition = scroller.scrollTop;
    viewportWidth = 300;
    await act(async () => notifyResize());
    const narrowWidth = Number.parseFloat(frame.style.width);

    expect(wideWidth).toBeGreaterThan(narrowWidth);
    expect(narrowWidth).toBeLessThanOrEqual((300 - 40) * 0.92 + 1);
    expect(scroller.scrollTop).toBe(readerPosition);
  });

  it('shows a provider transport failure as status instead of assistant speech', () => {
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
