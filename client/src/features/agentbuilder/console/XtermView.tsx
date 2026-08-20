import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { ConsoleOutputChunk } from './coderTerminalClient';

/**
 * xterm.js rendering of the saved Coder Card's native Hermes pseudoterminal.
 * Input bytes go directly to ConPTY and only ConPTY output is rendered.
 */

type XtermViewProps = {
  chunks: ConsoleOutputChunk[];
  interactive: boolean;
  onData?: (data: string) => void | Promise<void>;
  onResize?: (cols: number, rows: number) => void | Promise<void>;
  onError?: (message: string) => void;
  /** Render with a transparent background so text sits on the host panel. */
  transparent?: boolean;
};

export default function XtermView({
  chunks,
  interactive,
  onData,
  onResize,
  onError,
  transparent = false,
}: XtermViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<{ term: Terminal; lastSequence: number } | null>(null);
  const onDataRef = useRef(onData);
  const onResizeRef = useRef(onResize);
  const onErrorRef = useRef(onError);
  const interactiveRef = useRef(interactive);
  onDataRef.current = onData;
  onResizeRef.current = onResize;
  onErrorRef.current = onError;
  interactiveRef.current = interactive;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let frame: number | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let inputDisposable: { dispose(): void } | null = null;
    let term: Terminal | null = null;
    let lastSize = '';
    const focusTerminal = () => term?.focus();
    const fit = () => {
      if (!term) return;
      try {
        fitAddon.fit();
        const size = `${term.cols}x${term.rows}`;
        if (size !== lastSize) {
          lastSize = size;
          void Promise.resolve(onResizeRef.current?.(term.cols, term.rows)).catch((error) => {
            onErrorRef.current?.(error instanceof Error ? error.message : String(error));
          });
        }
      } catch {
        // The next ResizeObserver/window resize callback retries once measurable.
      }
    };
    const scheduleFit = () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = null;
        fit();
      });
    };
    const fitAddon = new FitAddon();
    try {
      term = new Terminal({
        convertEol: false,
        fontSize: 12,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        allowTransparency: transparent,
        theme: { background: transparent ? 'rgba(0,0,0,0)' : '#0b0f14', foreground: '#d7e0ea' },
        cursorBlink: interactiveRef.current,
        disableStdin: !interactiveRef.current,
        scrollback: 5_000,
      });
      term.loadAddon(fitAddon);
      term.open(container);
      inputDisposable = term.onData((data) => {
        if (!interactiveRef.current) return;
        try {
          void Promise.resolve(onDataRef.current?.(data)).catch((error) => {
            onErrorRef.current?.(error instanceof Error ? error.message : String(error));
          });
        } catch (error) {
          onErrorRef.current?.(error instanceof Error ? error.message : String(error));
        }
      });
      let lastSequence = 0;
      for (const chunk of chunks) {
        term.write(chunk.data);
        lastSequence = Math.max(lastSequence, chunk.seq);
      }
      termRef.current = { term, lastSequence };
      container.addEventListener('pointerdown', focusTerminal);
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(scheduleFit);
        resizeObserver.observe(container);
      } else {
        window.addEventListener('resize', scheduleFit);
      }
      scheduleFit();
      if (interactiveRef.current) term.focus();
    } catch (error) {
      onErrorRef.current?.(
        `terminal_emulator_initialization_failed:${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', scheduleFit);
      container.removeEventListener('pointerdown', focusTerminal);
      inputDisposable?.dispose();
      term?.dispose();
      termRef.current = null;
    };
  }, [transparent]);

  useEffect(() => {
    const state = termRef.current;
    if (!state) return;
    state.term.options.disableStdin = !interactive;
    state.term.options.cursorBlink = interactive;
    if (interactive) state.term.focus();
  }, [interactive]);

  // Stream newly arrived chunks into the live terminal.
  useEffect(() => {
    const state = termRef.current;
    if (!state) return;
    for (const chunk of chunks) {
      if (chunk.seq <= state.lastSequence) continue;
      state.term.write(chunk.data);
      state.lastSequence = chunk.seq;
    }
  }, [chunks]);

  return (
    <div
      ref={containerRef}
      data-testid="coder-terminal-xterm"
      style={{ flex: 1, minHeight: 0, padding: '6px 8px' }}
    />
  );
}
