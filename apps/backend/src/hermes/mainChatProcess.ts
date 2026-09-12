import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn, type IPty } from 'node-pty';
import { resolveProductChatWorkingDirectory, resolveRepoRoot } from '../services/workspaceRoot';
import { withoutInternalMcpSecret } from '../services/mcp/internalMcpAuth';
import { mainCliBridgeToken } from './mainCliBridge';

type ChatChild = Pick<IPty, 'pid' | 'onData' | 'onExit' | 'write' | 'kill'>;
type SpawnChat = (executable: string, args: string[], options: Parameters<typeof spawn>[2]) => ChatChild;

/** Main Chat's existing native Hermes delivery process. It has no terminal API or registry entry. */
export class MainChatProcess {
  private child: ChatChild | null = null;
  private stopping = false;
  private readonly state: {
    profile: string; pid: number | null; state: 'idle' | 'running' | 'stopping' | 'stopped' | 'failed';
    error: string | null;
  } = { profile: 'liquidaity-main', pid: null, state: 'idle', error: null };

  constructor(private readonly spawnChat: SpawnChat = spawn) {}

  ensureStarted() {
    if (this.child) {
      if (this.stopping) throw new Error('main_chat_process_stopping');
      return { ...this.state };
    }
    const repo = resolveRepoRoot();
    const root = path.join(repo, 'Hermes');
    const cwd = resolveProductChatWorkingDirectory();
    const executable = path.join(root, 'venv', 'Scripts', 'hermes.exe');
    if (!existsSync(executable)) throw new Error(`hermes_repo_cli_missing:${executable}`);
    this.stopping = false;
    try {
      const child = this.spawnChat(executable,
        ['-p', this.state.profile, 'chat', '--cli', '--in', cwd], {
          name: 'xterm-256color', cols: 120, rows: 30, cwd, useConpty: true,
          env: {
            ...withoutInternalMcpSecret(process.env),
            HERMES_HOME: path.join(root, '.hermes'),
            TERMINAL_CWD: cwd,
            LIQUIDAITY_MAIN_BRIDGE_URL: `http://127.0.0.1:${process.env.PORT || '4000'}/api/internal/main-cli`,
            LIQUIDAITY_MAIN_BRIDGE_TOKEN: mainCliBridgeToken,
          },
        });
      this.child = child;
      this.state.pid = child.pid;
      this.state.state = 'running';
      this.state.error = null;
      // Chat text and execution events travel through the existing structured bridge.
      child.onData(() => undefined);
      child.onExit(({ exitCode, signal }) => {
        if (this.child !== child) return;
        this.child = null;
        this.state.pid = null;
        this.state.state = this.stopping || exitCode === 0 ? 'stopped' : 'failed';
        this.state.error = this.state.state === 'failed'
          ? `hermes_chat_exited:${exitCode}:${signal ?? 'none'}` : null;
      });
      return { ...this.state };
    } catch (error) {
      this.state.state = 'failed';
      this.state.error = error instanceof Error ? error.message : 'main_chat_process_start_failed';
      throw error;
    }
  }

  interrupt(): boolean {
    if (!this.child || this.stopping) return false;
    this.child.write('\x03');
    return true;
  }

  stop(): void {
    if (!this.child || this.stopping) return;
    this.stopping = true;
    this.state.state = 'stopping';
    this.child.kill();
  }
}

export const mainChatProcess = new MainChatProcess();
