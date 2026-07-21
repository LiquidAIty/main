import { describe, expect, it, vi } from 'vitest';

import {
  isDeckAutosaveBlocked,
  resolveDeckAutosaveFailure,
} from './useAgentBuilderAutosave';

describe('Agent Builder autosave conflict safety', () => {
  it('preserves the stale revision and enters a visible blocked state', () => {
    const failure = resolveDeckAutosaveFailure('deck_conflict', 'client-stale-revision');

    expect(failure).toEqual({
      conflictRevision: 'client-stale-revision',
      revisionAfter: 'client-stale-revision',
      autosaveBlocked: true,
    });
    expect(isDeckAutosaveBlocked(failure.conflictRevision)).toBe(true);
  });

  it('does not issue a second write while conflict state remains active', () => {
    const write = vi.fn();
    const failure = resolveDeckAutosaveFailure('deck_conflict', 'client-stale-revision');

    if (!isDeckAutosaveBlocked(failure.conflictRevision)) {
      write();
    }

    expect(write).not.toHaveBeenCalled();
  });

  it('also blocks when the server requires a missing revision', () => {
    const failure = resolveDeckAutosaveFailure('deck_revision_required', null);
    expect(failure.conflictRevision).toBe('missing-revision');
    expect(failure.revisionAfter).toBeNull();
    expect(failure.autosaveBlocked).toBe(true);
  });
});
