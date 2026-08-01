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
      threadId: 'thread_1', turnId: 'turn_1',
      input: [{ type: 'text', text: 'focus on the failing test' }],
    });
  });
});
