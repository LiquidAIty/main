import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

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
    projectId: 'project-1',
    deckId: 'deck_builder',
    conversationId: 'main',
    targetRoot: process.cwd(),
    mode: 'interactive',
    state: 'starting',
    runtimeSource: 'saved_hermes_card',
    transportMode: 'acp-stdio',
    profile: 'coder',
    provider: null,
    model: null,
    interactiveSupported: true,
    pid: null,
    nativeSessionId: null,
    activeRunId: null,
    startedAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z',
    stoppedAt: null,
    warnings: [],
    error: null,
  };
}

const identity = {
  projectId: 'project-1',
  deckId: 'deck_builder',
  conversationId: 'main',
};

describe('Hermes Coder terminal boundary', () => {
  it('requires server-owned project, deck, and conversation identity', () => {
    const result = new HermesCoderTerminalManager().acquire({
      projectId: '',
      deckId: '',
      conversationId: '',
    });
    expect(result).toEqual({
      ok: false,
      error: 'hermes_coder_terminal_identity_required',
      missing: [],
    });
  });

  it('fails honestly when the requested workspace root is missing', () => {
    const missing = path.join(process.cwd(), '__missing_coder_terminal_root__');
    const result = new HermesCoderTerminalManager().acquire({ ...identity, targetRoot: missing });
    expect(result).toEqual({
      ok: false,
      error: `hermes_coder_terminal_target_root_missing:${missing}`,
      missing: [],
    });
  });

  it('reuses one Card-bound terminal face for the stable native session identity', () => {
    const manager = new HermesCoderTerminalManager();
    const first = manager.acquire(identity);
    const second = manager.acquire(identity);
    const otherConversation = manager.acquire({ ...identity, conversationId: 'other' });
    expect(first.ok && first.created).toBe(true);
    expect(second.ok && second.created).toBe(false);
    expect(first.ok && second.ok && first.session).toBe(second.ok ? second.session : null);
    expect(first.ok && otherConversation.ok && first.session).not.toBe(
      otherConversation.ok ? otherConversation.session : null,
    );
  });

  it('redacts secrets before native Hermes output is buffered or published', () => {
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

  it('forwards Hermes output and permission control through the same turn', () => {
    const session = new HermesCoderTerminalSession(sessionInfo());
    const answer = vi.fn();
    const cancel = vi.fn();
    session.markReady({
      cardId: 'card_local_coder',
      provider: 'openai',
      modelKey: 'gpt-5.6-luna',
      providerModelId: 'gpt-5.6-luna',
      executable: 'hermes-acp',
      pid: 42,
      hermesHome: 'C:/repo/Hermes/.hermes',
      sessionId: 'native-coder-session',
      transport: 'acp-stdio',
    });
    expect(session.transcript()).toEqual([]);
    expect(session.beginTurn('run-1')).toBe(true);
    expect(session.attachControl('run-1', { answer, cancel })).toBe(true);
    session.receiveHermesEvent({ kind: 'text', text: 'working' });
    session.receiveHermesEvent({
      kind: 'permission',
      promptId: 'permission-1',
      question: 'Approve edit?',
      promptType: '[]',
    });
    expect(session.info.state).toBe('waiting');
    expect(session.answerPermission('allow')).toBe(true);
    expect(answer).toHaveBeenCalledWith('permission-1', 'allow');
    session.completeTurn('run-1');
    expect(session.info.state).toBe('ready');
    expect(session.info.nativeSessionId).toBe('native-coder-session');
    expect(session.transcript().map((chunk) => chunk.data).join('')).toContain('working');
  });

  it('publishes an exact terminal failure once without canned status prose', () => {
    const session = new HermesCoderTerminalSession(sessionInfo());
    session.receiveHermesEvent({ kind: 'error', message: 'native failure' });
    session.markFailed('native failure');
    session.markFailed('native failure');
    expect(session.transcript().map((chunk) => chunk.data)).toEqual(['native failure\r\n']);
  });

  it('cancels only the active native Hermes turn', () => {
    const session = new HermesCoderTerminalSession(sessionInfo());
    const cancel = vi.fn();
    session.markReady({
      cardId: 'card_local_coder',
      provider: 'openai',
      modelKey: 'gpt-5.6-luna',
      providerModelId: 'gpt-5.6-luna',
      executable: 'hermes-acp',
      pid: 42,
      hermesHome: 'C:/repo/Hermes/.hermes',
      sessionId: 'native-coder-session',
      transport: 'acp-stdio',
    });
    expect(session.beginTurn('run-1')).toBe(true);
    expect(session.attachControl('run-1', { answer: vi.fn(), cancel })).toBe(true);
    expect(session.stop()).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
    expect(session.info.state).toBe('stopped');
  });
});
