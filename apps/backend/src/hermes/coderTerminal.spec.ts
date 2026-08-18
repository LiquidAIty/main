import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  HermesCoderTerminalManager,
  HermesCoderTerminalSession,
  redactTerminalSecrets,
  type ConsoleSessionInfo,
} from './coderTerminal';

function sessionInfo(): ConsoleSessionInfo {
  return {
    id: 'coder_terminal_test',
    ownerCardId: 'card_local_coder',
    targetRoot: process.cwd(),
    mode: 'interactive',
    state: 'starting',
    commandPath: 'hermes chat --cli --toolsets file,terminal,memory',
    runtimeSource: 'hermes_installed',
    transportMode: 'pty',
    provider: null,
    model: null,
    interactiveSupported: true,
    pid: null,
    startedAt: '2026-08-18T00:00:00.000Z',
    exitedAt: null,
    exitCode: null,
    exitSignal: null,
    warnings: [],
    error: null,
  };
}

describe('Hermes Coder terminal boundary', () => {
  it('rejects noninteractive execution instead of becoming another task runner', () => {
    const result = new HermesCoderTerminalManager().start({ mode: 'task' });
    expect(result).toEqual({
      ok: false,
      error: 'hermes_coder_terminal_interactive_only',
      missing: [],
    });
  });

  it('fails honestly when the requested workspace root is missing', () => {
    const missing = path.join(process.cwd(), '__missing_coder_terminal_root__');
    const result = new HermesCoderTerminalManager().start({ targetRoot: missing });
    expect(result).toEqual({
      ok: false,
      error: `hermes_coder_terminal_target_root_missing:${missing}`,
      missing: [],
    });
  });

  it('redacts secrets before terminal output is buffered or published', () => {
    expect(redactTerminalSecrets('OPENAI_API_KEY=sk-example_secret_123456789')).toBe(
      'OPENAI_API_KEY= <redacted>',
    );
    expect(redactTerminalSecrets('Authorization: Bearer example_token_123456789')).toBe(
      'Authorization: <redacted>',
    );

    const session = new HermesCoderTerminalSession(sessionInfo());
    session.emitOutput('stdout', 'TOKEN=example_secret_123456789');
    expect(session.transcript()).toHaveLength(1);
    expect(session.transcript()[0]?.data).toBe('TOKEN= <redacted>');
  });
});
