import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { ConsoleOutputChunk } from './coderTerminalClient';

/**
 * xterm.js rendering of the saved Coder Card's native Hermes session. This is
 * line-oriented ACP input, not a shell or PTY: xterm supplies terminal editing
 * ergonomics while the backend sends each completed line as a Hermes turn.
 */

type XtermViewProps = {
  chunks: ConsoleOutputChunk[];
  interactive: boolean;
  onSubmit?: (message: string) => void | Promise<void>;
  onError?: (message: string) => void;
  /** Render with a transparent background so text sits on the host panel. */
  transparent?: boolean;
};

export default function XtermView({
  chunks,
  interactive,
  onSubmit,
  onError,
  transparent = false,
}: XtermViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<{ term: Terminal; lastSequence: number } | null>(null);
  const onSubmitRef = useRef(onSubmit);
  const onErrorRef = useRef(onError);
  const interactiveRef = useRef(interactive);
  onSubmitRef.current = onSubmit;
  onErrorRef.current = onError;
  interactiveRef.current = interactive;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let frame: number | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let inputDisposable: { dispose(): void } | null = null;
    let term: Terminal | null = null;
    const focusTerminal = () => term?.focus();
    const fit = () => {
      if (!term) return;
      try {
        fitAddon.fit();
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
        convertEol: true,
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
      let line = '';
      let previousWasCarriageReturn = false;
      inputDisposable = term.onData((data) => {
        if (!interactiveRef.current) return;
        for (const character of data) {
          if (character === '\n' && previousWasCarriageReturn) {
            previousWasCarriageReturn = false;
            continue;
          }
          if (character === '\r' || character === '\n') {
            previousWasCarriageReturn = character === '\r';
            const message = line.trim();
            if (message) {
              term?.write('\r\n');
              try {
                void Promise.resolve(onSubmitRef.current?.(message)).catch((error) => {
                  onErrorRef.current?.(error instanceof Error ? error.message : String(error));
                });
              } catch (error) {
                onErrorRef.current?.(error instanceof Error ? error.message : String(error));
              }
            }
            line = '';
            continue;
          }
          previousWasCarriageReturn = false;
          if (character === '\u007f' || character === '\b') {
            if (line) {
              line = line.slice(0, -1);
              term?.write('\b \b');
            }
            continue;
          }
          if (character >= ' ' && character !== '\u007f') {
            line += character;
            term?.write(character);
          }
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
