import { describe, expect, it, vi } from 'vitest';
import { CodexAppServerSession } from './codexAppServerSession';

describe('CodexAppServerSession card ownership', () => {
  it('never lets Stop control another card process', async () => {
    const session = new CodexAppServerSession() as any;
    session.ownerCardId = 'card_openai_coder';
    session.activeThreadId = 'thread_1';
    session.activeTurnId = 'turn_1';
    session.request = vi.fn().mockResolvedValue({});
    await expect(session.stop('other_card')).rejects.toThrow('codex_card_process_owner_mismatch');
    expect(session.request).not.toHaveBeenCalled();
    await session.stop('card_openai_coder');
    expect(session.request).toHaveBeenCalledWith('turn/interrupt', {
      threadId: 'thread_1', turnId: 'turn_1',
    });
  });

  it('binds Steer to the owning card and active turn', async () => {
    const session = new CodexAppServerSession() as any;
    session.ownerCardId = 'card_openai_coder';
    session.activeThreadId = 'thread_1';
    session.activeTurnId = 'turn_1';
    session.request = vi.fn().mockResolvedValue({});
    await session.steer('card_openai_coder', 'focus on the failing test');
    expect(session.request).toHaveBeenCalledWith('turn/steer', {
      threadId: 'thread_1', expectedTurnId: 'turn_1',
      input: [{ type: 'text', text: 'focus on the failing test' }],
    });
  });

  it('rejects idle Stop and Steer without dispatching', async () => {
    const session = new CodexAppServerSession() as any;
    session.ownerCardId = 'card_openai_coder';
    session.request = vi.fn().mockResolvedValue({});
    await expect(session.stop('card_openai_coder')).rejects.toThrow('codex_card_no_active_turn');
    await expect(session.steer('card_openai_coder', 'anything')).rejects.toThrow('codex_card_no_active_turn');
    expect(session.request).not.toHaveBeenCalled();
  });

  it('finishes an active receipt immediately and honestly when app-server exits', async () => {
    const session = new CodexAppServerSession() as any;
    session.ownerCardId = 'card_openai_coder';
    session.activeThreadId = 'thread_1';
    session.activeTurnId = 'turn_1';
    session.receipt = {
      cardId: 'card_openai_coder', route: 'main_mag_one_openai_coder', runtime: 'codex_app_server',
      status: 'running', taskBody: 'read only', threadId: 'thread_1', turnId: 'turn_1',
      startedAt: new Date(Date.now() - 25).toISOString(), endedAt: null, durationMs: null,
      toolCalls: [], usage: null, controlEvents: [], result: null, failure: null,
    };
    const waiting = session.waitForReceipt('card_openai_coder', 'turn_1', 5_000);
    session.failActiveTurn(new Error('codex_app_server_exited'));
    await expect(waiting).resolves.toMatchObject({
      status: 'failed', failure: 'codex_app_server_exited', endedAt: expect.any(String),
    });
    expect(session.activeTurnId).toBeNull();
  });

  it('ignores a late completion event from a different turn', () => {
    const session = new CodexAppServerSession() as any;
    session.ownerCardId = 'card_openai_coder';
    session.activeThreadId = 'thread_2';
    session.activeTurnId = 'turn_2';
    session.receipt = {
      cardId: 'card_openai_coder', route: 'main_mag_one_openai_coder', runtime: 'codex_app_server',
      status: 'running', taskBody: 'current assignment', threadId: 'thread_2', turnId: 'turn_2',
      startedAt: new Date().toISOString(), endedAt: null, durationMs: null,
      toolCalls: [], usage: null, controlEvents: [], result: null, failure: null,
    };
    session.recordNotification('turn/completed', { turn: { id: 'turn_1', status: 'completed' } });
    expect(session.receipt.status).toBe('running');
    expect(session.activeTurnId).toBe('turn_2');
  });
});
