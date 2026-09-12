import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { MainChatProcess } from './mainChatProcess';
import { BuilderTerminalManager } from './builderTerminal';
import { resolveProductChatWorkingDirectory } from '../services/workspaceRoot';

function nativeChild() {
  let exit: (event: { exitCode: number; signal?: number }) => void = () => undefined;
  return {
    pid: 73, write: vi.fn(), kill: vi.fn(), onData: vi.fn(),
    onExit: vi.fn((listener: typeof exit) => { exit = listener; return { dispose() {} }; }),
    emitExit: (exitCode: number) => exit({ exitCode }),
  };
}

describe('Main Chat native process ownership', () => {
  it('starts the existing chat delivery process once without registering a terminal', () => {
    const child = nativeChild();
    const spawn = vi.fn(() => child);
    const chat = new MainChatProcess(spawn);
    const terminals = new BuilderTerminalManager();
    const before = terminals.list();
    expect(chat.ensureStarted()).toMatchObject({ profile: 'liquidaity-main', pid: 73, state: 'running' });
    chat.ensureStarted();
    expect(spawn).toHaveBeenCalledOnce();
    const [file, args, options] = spawn.mock.calls[0] as unknown as [string, string[], {
      cwd: string; useConpty: boolean; env: Record<string, string>;
    }];
    expect(file).toMatch(/Hermes[\\/]venv[\\/]Scripts[\\/]hermes\.exe$/);
    expect(args).toEqual(['-p', 'liquidaity-main', 'chat', '--cli', '--in', resolveProductChatWorkingDirectory()]);
    expect(options.cwd).toBe(resolveProductChatWorkingDirectory());
    expect(options.useConpty).toBe(true);
    expect(options.env.LIQUIDAITY_MAIN_BRIDGE_URL).toContain('/api/internal/main-cli');
    expect(terminals.list()).toEqual(before);
    expect(chat.ensureStarted()).not.toHaveProperty('ownerCardId');
    expect(chat.ensureStarted()).not.toHaveProperty('transportMode');
    expect(chat).not.toHaveProperty('resize');
    expect(chat).not.toHaveProperty('subscribeOutput');
    chat.stop();
  });

  it('keeps inherited development context out of Main without disabling native memory or rules', () => {
    vi.stubEnv('TERMINAL_CWD', process.cwd());
    try {
      const spawn = vi.fn(() => nativeChild());
      const chat = new MainChatProcess(spawn);
      chat.ensureStarted();
      const [, args, options] = spawn.mock.calls[0] as unknown as [string, string[], { cwd: string; env: Record<string, string> }];
      expect(options.cwd).toBe(resolveProductChatWorkingDirectory());
      expect(options.cwd).not.toBe(process.cwd());
      expect(options.env.TERMINAL_CWD).toBe(options.cwd);
      expect(options.env.HERMES_HOME).toMatch(/Hermes[\\/]\.hermes$/);
      expect(args).not.toContain('--ignore-rules');
      expect(args).not.toContain('--ignore-user-config');
      expect(args).not.toContain('--resume');
      expect(args).not.toContain('--continue');
      chat.stop();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('interrupts only its own chat child and rejects input after shutdown', () => {
    const child = nativeChild();
    const chat = new MainChatProcess(() => child);
    expect(chat.interrupt()).toBe(false);
    chat.ensureStarted();
    expect(chat.interrupt()).toBe(true);
    expect(child.write).toHaveBeenCalledExactlyOnceWith('\x03');
    chat.stop();
    chat.stop();
    expect(child.kill).toHaveBeenCalledOnce();
    expect(chat.interrupt()).toBe(false);
    expect(() => chat.ensureStarted()).toThrow('main_chat_process_stopping');
  });

  it('releases an exited process and reports launch failure without a substitute', () => {
    const child = nativeChild();
    const spawn = vi.fn().mockReturnValueOnce(child).mockImplementationOnce(() => { throw new Error('native spawn failed'); });
    const chat = new MainChatProcess(spawn);
    chat.ensureStarted();
    child.emitExit(19);
    expect(chat.interrupt()).toBe(false);
    expect(() => chat.ensureStarted()).toThrow('native spawn failed');
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('cannot acquire Main or another Agent through Builder ownership', () => {
    const manager = new BuilderTerminalManager();
    for (const profile of ['liquidaity-main', 'quant-analyst']) {
      expect(manager.acquire({ projectId: 'p', deckId: 'd', conversationId: 'c',
        ownerCardId: profile, profile })).toEqual({ ok: false,
          error: 'builder_terminal_saved_profile_required', missing: [] });
    }
    expect(manager.list()).toEqual([]);
    const source = readFileSync('apps/backend/src/hermes/mainChatProcess.ts', 'utf8');
    expect(source).not.toMatch(/from ['"].*builderTerminal/);
  });
});
