/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: Main Chat
 * Relationship: Verifies the unchanged conversation-store interface uses Engraphis transport and never PostgreSQL conversation SQL.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), request: vi.fn(), handoff: vi.fn() }));
vi.mock('../db/pool', () => ({ pool: { query: mocks.query } }));
vi.mock('../services/pythonRailsClient', () => ({ requestPythonRailsJson: mocks.request }));
vi.mock('./thinkGraphHandoff', () => ({ submitSavedThinkPair: mocks.handoff }));
import { appendConversationTurn, appendConversationReplyOnce, getConversationMessages } from './store';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockResolvedValue({ rows: [{ id: 'project-one' }] });
  mocks.handoff.mockResolvedValue(undefined);
});

describe('Engraphis conversation storage transport', () => {
  it('preserves append/read inputs and limits PostgreSQL to Project lookup', async () => {
    const messages = [{ role: 'user' as const, content: 'exact question', speaker: { kind: 'user' as const, label: 'You' } }];
    mocks.request.mockResolvedValue(messages);
    expect(await appendConversationTurn({ projectId: 'trading', conversationId: 'chat', messages })).toBe(messages);
    expect(await getConversationMessages('trading', 'chat')).toBe(messages);
    expect(mocks.query.mock.calls.every(([sql]) => sql === 'SELECT id FROM ag_catalog.projects WHERE code = $1 LIMIT 1')).toBe(true);
    expect(JSON.parse(mocks.request.mock.calls[0][1].body)).toEqual({
      projectId: 'project-one', operation: 'conversation', arguments: { action: 'append', conversationId: 'chat', messages },
    });
    expect(mocks.request.mock.calls[1][0]).toBe('/thinkgraph/operation');
    expect(JSON.parse(mocks.request.mock.calls[1][1].body).arguments.action).toBe('read');
  });

  it('preserves the actual duplicate-reply receipt', async () => {
    const message = { role: 'assistant' as const, content: 'answer', providerMessageId: 'row-1',
      speaker: { kind: 'card' as const, label: 'Main' } };
    const receipt = { inserted: false, message };
    mocks.request.mockResolvedValue(receipt);
    expect(await appendConversationReplyOnce({ projectId: 'trading', conversationId: 'chat', message })).toBe(receipt);
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });

  it('does not fall back to PostgreSQL when Engraphis fails', async () => {
    mocks.request.mockRejectedValue(new Error('Engraphis unavailable'));
    await expect(getConversationMessages('trading', 'chat')).rejects.toThrow('Engraphis unavailable');
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });

  it('hands off exactly once and only after successful persistence', async () => {
    let commit!: (result: unknown) => void;
    mocks.request.mockReturnValue(new Promise(resolve => { commit = resolve; }));
    const message = { role: 'assistant' as const, content: 'answer', providerMessageId: 'row-1',
      speaker: { kind: 'card' as const, label: 'Main' } };
    const saved = { messageId: 'saved-answer', role: 'assistant', content: 'saved answer', status: 'complete' };
    const pending = appendConversationReplyOnce({ projectId: 'trading', conversationId: 'chat', message });
    await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledOnce());
    expect(mocks.handoff).not.toHaveBeenCalled();
    commit({ inserted: true, message: saved });
    expect(await pending).toEqual({ inserted: true, message: saved });
    expect(mocks.handoff).toHaveBeenCalledExactlyOnceWith(saved);
    mocks.request.mockResolvedValue({ inserted: false, message: saved });
    await appendConversationReplyOnce({ projectId: 'trading', conversationId: 'chat', message });
    expect(mocks.handoff).toHaveBeenCalledTimes(1);
  });

  it('does not submit partial output or failed persistence', async () => {
    const message = { role: 'assistant' as const, content: 'unfinished', providerMessageId: 'row-1',
      status: 'pending' as const, speaker: { kind: 'card' as const, label: 'Main' } };
    mocks.request.mockResolvedValue({ inserted: true, message: { status: 'complete' } });
    await appendConversationReplyOnce({ projectId: 'trading', conversationId: 'chat', message });
    expect(mocks.handoff).not.toHaveBeenCalled();
    mocks.request.mockRejectedValue(new Error('storage failed'));
    await expect(appendConversationReplyOnce({ projectId: 'trading', conversationId: 'chat',
      message: { ...message, status: 'complete' } })).rejects.toThrow('storage failed');
    expect(mocks.handoff).not.toHaveBeenCalled();
  });

  it('reports submission failure without rejecting the committed conversation', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const message = { role: 'assistant' as const, content: 'answer', providerMessageId: 'row-1',
        speaker: { kind: 'card' as const, label: 'Main' } };
      const saved = { inserted: true, message: { messageId: 'saved', status: 'complete' } };
      mocks.request.mockResolvedValue(saved);
      mocks.handoff.mockRejectedValue(new Error('submission refused'));
      expect(await appendConversationReplyOnce({ projectId: 'trading', conversationId: 'chat', message })).toBe(saved);
      await vi.waitFor(() => expect(log).toHaveBeenCalledWith('[thinkgraph]', {
        messageId: 'saved', error: 'submission refused',
      }));
    } finally { log.mockRestore(); }
  });
});
