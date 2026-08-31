// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const terminalMocks = vi.hoisted(() => ({
  dataListener: null as ((data: string) => void) | null,
  writes: [] as string[],
  options: {} as Record<string, unknown>,
  focus: vi.fn(),
  dispose: vi.fn(),
}));

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 120;
    rows = 30;
    options = terminalMocks.options;
    textarea = document.createElement('textarea');
    constructor(options: Record<string, unknown>) {
      terminalMocks.options = { ...options };
      this.options = terminalMocks.options;
    }
    loadAddon() {}
    open(container: HTMLElement) { container.appendChild(this.textarea); }
    focus() { terminalMocks.focus(); }
    write(data: string) { terminalMocks.writes.push(data); }
    dispose() { terminalMocks.dispose(); }
    onData(listener: (data: string) => void) {
      terminalMocks.dataListener = listener;
      return { dispose: () => undefined };
    }
  },
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {}
  },
}));

import XtermView from './XtermView';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  terminalMocks.dataListener = null;
  terminalMocks.writes.length = 0;
  vi.clearAllMocks();
});

describe('XtermView real PTY transport', () => {
  it('renders only PTY output and forwards raw input without local echo or line parsing', async () => {
    const onData = vi.fn(async () => undefined);
    const connectOutput = vi.fn(async (onOutput: (data: string) => void) => {
      onOutput('\u001b[32mnative\u001b[0m\r\n');
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <XtermView
          interactive
          connectOutput={connectOutput}
          onData={onData}
        />,
      );
    });

    expect(terminalMocks.options.convertEol).toBe(false);
    expect(connectOutput).toHaveBeenCalledOnce();
    expect(terminalMocks.writes).toEqual(['\u001b[32mnative\u001b[0m\r\n']);
    await act(async () => {
      terminalMocks.dataListener?.('abc\u007f\r');
      await Promise.resolve();
    });
    expect(onData).toHaveBeenCalledWith('abc\u007f\r');
    expect(terminalMocks.writes).toEqual(['\u001b[32mnative\u001b[0m\r\n']);
  });

  it('removes the terminal input affordance from a read-only PTY projection', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(<XtermView interactive={false} connectOutput={async () => undefined} />);
    });

    const textarea = host.querySelector('textarea');
    expect(terminalMocks.options.disableStdin).toBe(true);
    expect(textarea?.getAttribute('aria-hidden')).toBe('true');
    expect(textarea?.tabIndex).toBe(-1);
    expect(terminalMocks.focus).not.toHaveBeenCalled();
  });
});
