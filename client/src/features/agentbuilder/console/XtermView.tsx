import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

/**
 * xterm.js rendering of the repository Hermes CLI pseudoterminal.
 * Input bytes go directly to ConPTY and only ConPTY output is rendered.
 */

type XtermViewProps = {
  interactive: boolean;
  connectOutput?: (onData: (data: string) => void, signal: AbortSignal) => Promise<void>;
  onData?: (data: string) => void | Promise<void>;
  onResize?: (cols: number, rows: number) => void | Promise<void>;
  onOutputClosed?: () => void | Promise<void>;
  onError?: (message: string) => void;
  launchError?: string | null;
  /** Render with a transparent background so text sits on the host panel. */
  transparent?: boolean;
};

export default function XtermView({
  interactive,
  connectOutput,
  onData,
  onResize,
  onOutputClosed,
  onError,
  launchError = null,
  transparent = false,
}: XtermViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<{ term: Terminal } | null>(null);
  const onDataRef = useRef(onData);
  const onResizeRef = useRef(onResize);
  const connectOutputRef = useRef(connectOutput);
  const onOutputClosedRef = useRef(onOutputClosed);
  const onErrorRef = useRef(onError);
  const launchErrorRef = useRef(launchError);
  const renderedLaunchErrorRef = useRef<string | null>(null);
  const interactiveRef = useRef(interactive);
  onDataRef.current = onData;
  onResizeRef.current = onResize;
  connectOutputRef.current = connectOutput;
  onOutputClosedRef.current = onOutputClosed;
  onErrorRef.current = onError;
  launchErrorRef.current = launchError;
  interactiveRef.current = interactive;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let frame: number | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let inputDisposable: { dispose(): void } | null = null;
    const outputController = new AbortController();
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
      termRef.current = { term };
      if (launchErrorRef.current) {
        term.write(`${launchErrorRef.current}\r\n`);
        renderedLaunchErrorRef.current = launchErrorRef.current;
      }
      if (connectOutputRef.current) {
        void connectOutputRef.current(
          (data) => term?.write(data),
          outputController.signal,
        ).then(() => {
          if (!outputController.signal.aborted) {
            return onOutputClosedRef.current?.();
          }
          return undefined;
        }).catch((error) => {
          if (outputController.signal.aborted) return;
          onErrorRef.current?.(error instanceof Error ? error.message : String(error));
        });
      }
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
      outputController.abort();
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

  useEffect(() => {
    const state = termRef.current;
    if (!state || !launchError || renderedLaunchErrorRef.current === launchError) return;
    state.term.write(`${launchError}\r\n`);
    renderedLaunchErrorRef.current = launchError;
  }, [launchError]);

  return (
    <div
      ref={containerRef}
      data-testid="coder-terminal-xterm"
      style={{ flex: 1, minHeight: 0, padding: '6px 8px' }}
    />
  );
}
