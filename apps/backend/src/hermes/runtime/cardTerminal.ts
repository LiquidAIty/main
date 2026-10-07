import { spawn as spawnPty, type IPty } from 'node-pty';
import path from 'node:path';
import type { CardRuntime, CardTerminalListener } from './cardRuntime';

const MAX_REPLAY_BYTES = 2 * 1024 * 1024;

export class CardTerminal {
  constructor(
    private readonly runtime: CardRuntime,
    private readonly spawnProcess: typeof spawnPty = spawnPty,
  ) {}

  attach(cols: number, rows: number): void {
    this.runtime.requireRunning();
    if (this.runtime.pty) {
      if (this.runtime.state.cols !== cols || this.runtime.state.rows !== rows) {
        this.resize(cols, rows);
      }
      return;
    }
    const process = this.spawnProcess(
      this.runtime.launch.file,
      [...this.tuiArgs(), '--resume', this.runtime.state.storedSessionId],
      {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: this.runtime.launch.cwd,
        env: {
          ...this.runtime.launch.env,
          TERMINAL_CWD: this.runtime.launch.cwd,
          HERMES_TUI_DIR: path.join(
            path.resolve(this.runtime.launch.profileHome, '..', '..'),
            'ui-tui',
          ),
          TERM: 'xterm-256color',
          HERMES_TUI_GATEWAY_URL: this.runtime.gatewayUrl,
          HERMES_TUI_INLINE: '1',
        },
        useConpty: true,
      },
    );
    if (!process.pid) {
      try { process.kill(); } catch {}
      throw new Error('card_terminal_process_unavailable');
    }
    this.runtime.pty = process;
    Object.assign(this.runtime.state, {
      tuiPid: process.pid,
      ptyId: this.runtime.state.sessionId,
      cols,
      rows,
      exitCode: undefined,
    });
    if (this.runtime.state.error?.startsWith('card_terminal_exited:')) {
      this.runtime.state.error = undefined;
    }
    process.onData((data) => this.record(data));
    process.onExit(({ exitCode }) => this.exited(process, exitCode));
    this.runtime.emitState();
  }

  private tuiArgs(): string[] {
    const options = this.runtime.card.runtimeOptions as Record<string, unknown> | undefined;
    const args = [
      '-m', 'hermes_cli.main',
      '-p', this.runtime.launch.profile,
      '--tui', '--in', this.runtime.launch.cwd,
      '--model', this.runtime.launch.providerSelection.model,
      '--provider', this.runtime.launch.providerSelection.provider,
    ];
    if (typeof options?.reasoningEffort === 'string' && options.reasoningEffort.trim()) {
      args.push('--reasoning', options.reasoningEffort.trim());
    }
    if (options?.maxTurns != null) args.push('--max-turns', String(options.maxTurns));
    const skills = Array.isArray(options?.skills)
      ? options.skills.map((value) => String(value || '').trim()).filter(Boolean)
      : [];
    if (skills.length) args.push('--skills', [...new Set(skills)].join(','));
    return args;
  }

  input(data: string): void {
    this.runtime.requireRunning();
    if (!this.runtime.pty) throw new Error('card_terminal_not_attached');
    this.runtime.pty.write(data);
  }

  interrupt(): void {
    this.input('\u0003');
  }

  resize(cols: number, rows: number): void {
    this.runtime.requireRunning();
    if (!this.runtime.pty) throw new Error('card_terminal_not_attached');
    if (!Number.isInteger(cols) || cols < 2 || cols > 500
      || !Number.isInteger(rows) || rows < 1 || rows > 200) {
      throw new Error('card_terminal_dimensions_invalid');
    }
    this.runtime.pty.resize(cols, rows);
    Object.assign(this.runtime.state, { cols, rows });
    this.runtime.emitState();
  }

  subscribe(after: number, listener: CardTerminalListener): () => void {
    if (!Number.isSafeInteger(after) || after < 0) throw new Error('card_terminal_cursor_invalid');
    for (const output of this.runtime.output) {
      if (output.sequence > after) listener('output', output);
    }
    listener('state', this.runtime.snapshot());
    if (this.runtime.listeners.size >= 8) throw new Error('card_terminal_connection_limit');
    this.runtime.listeners.add(listener);
    return () => this.runtime.listeners.delete(listener);
  }

  detach(): void {
    const process = this.runtime.pty;
    this.runtime.pty = null;
    if (process) {
      try { process.kill(); } catch {}
    }
    this.runtime.state.tuiPid = null;
    this.runtime.state.ptyId = null;
    this.runtime.emitState();
  }

  private record(data: string): void {
    const output = { sequence: ++this.runtime.sequence, data };
    this.runtime.output.push(output);
    this.runtime.outputBytes += Buffer.byteLength(data);
    while (this.runtime.outputBytes > MAX_REPLAY_BYTES && this.runtime.output.length) {
      this.runtime.outputBytes -= Buffer.byteLength(this.runtime.output.shift()!.data);
      this.runtime.state.replayTruncated = true;
    }
    for (const listener of this.runtime.listeners) listener('output', output);
  }

  private exited(process: IPty, exitCode: number): void {
    if (this.runtime.pty !== process) return;
    this.runtime.pty = null;
    this.runtime.state.tuiPid = null;
    this.runtime.state.ptyId = null;
    this.runtime.state.exitCode = exitCode;
    if (!this.runtime.stopping && exitCode !== 0) {
      this.runtime.state.error = `card_terminal_exited:${exitCode}`;
    }
    this.runtime.emitState();
  }
}
