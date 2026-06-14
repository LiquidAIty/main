import { useEffect, useRef } from 'react';
import type { ConsoleOutputChunk } from './openClaudeConsoleClient';

/**
 * xterm.js rendering of an OpenClaude console session. Kept isolated so the
 * parent panel stays testable: xterm needs a real DOM (canvas/measurement), so
 * terminal creation is guarded and degrades to a no-op in non-DOM/test
 * environments. The parent also keeps a plain-text transcript mirror.
 */

export type XtermViewProps = {
  chunks: ConsoleOutputChunk[];
  interactive: boolean;
  onInput?: (data: string) => void;
  onResize?: (cols: number, rows: number) => void;
};

export default function XtermView({ chunks, interactive, onInput, onResize }: XtermViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<{ term: { write(d: string): void; dispose(): void }; written: number } | null>(
    null,
  );
  const onInputRef = useRef(onInput);
  const onResizeRef = useRef(onResize);
  onInputRef.current = onInput;
  onResizeRef.current = onResize;

  useEffect(() => {
    let disposed = false;
    let fitAddon: { fit(): void } | null = null;
    void (async () => {
      try {
        const [{ Terminal }, { FitAddon }] = await Promise.all([
          import('@xterm/xterm'),
          import('@xterm/addon-fit'),
        ]);
        await import('@xterm/xterm/css/xterm.css').catch(() => undefined);
        if (disposed || !containerRef.current) return;
        const term = new Terminal({
          convertEol: true,
          fontSize: 12,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          theme: { background: '#0b0f14', foreground: '#d7e0ea' },
          cursorBlink: interactive,
          disableStdin: !interactive,
        });
        fitAddon = new FitAddon();
        term.loadAddon(fitAddon as never);
        term.open(containerRef.current);
        try {
          fitAddon.fit();
        } catch {
          /* container not measurable yet */
        }
        if (interactive) {
          term.onData((data: string) => onInputRef.current?.(data));
        }
        termRef.current = { term, written: 0 };
        // Flush whatever has already streamed in.
        for (let i = 0; i < chunks.length; i++) term.write(chunks[i].data);
        termRef.current.written = chunks.length;
        const cols = (term as unknown as { cols?: number }).cols ?? 80;
        const rows = (term as unknown as { rows?: number }).rows ?? 24;
        onResizeRef.current?.(cols, rows);
      } catch {
        /* xterm unavailable (e.g. jsdom/test env): the text mirror still works */
      }
    })();
    return () => {
      disposed = true;
      try {
        termRef.current?.term.dispose();
      } catch {
        /* noop */
      }
      termRef.current = null;
    };
    // Mount-only: chunk flushing is handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interactive]);

  // Stream newly arrived chunks into the live terminal.
  useEffect(() => {
    const state = termRef.current;
    if (!state) return;
    for (let i = state.written; i < chunks.length; i++) state.term.write(chunks[i].data);
    state.written = chunks.length;
  }, [chunks]);

  return <div ref={containerRef} data-testid="openclaude-xterm" style={{ flex: 1, minHeight: 0 }} />;
}
