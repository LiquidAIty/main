/**
 * Entity: Projects
 * Relationship: Verifies Project and deck reads share in-flight requests without letting one caller's abort or stale completion cancel a newer generation.
 */

import { describe, expect, it, vi } from 'vitest';

import { guardedRequest } from './requestGuards';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}

describe('guardedRequest ownership', () => {
  it('does not let the first caller abort a shared deduplicated request', async () => {
    const result = deferred<string>();
    const fetcher = vi.fn(async (_signal: AbortSignal) => result.promise);
    const firstController = new AbortController();
    const secondController = new AbortController();
    const first = guardedRequest({
      key: 'dedupe-abort',
      signal: firstController.signal,
      fetcher,
    });
    const second = guardedRequest({
      key: 'dedupe-abort',
      signal: secondController.signal,
      fetcher,
    });

    firstController.abort();
    result.resolve('shared-result');

    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await expect(second).resolves.toBe('shared-result');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0].aborted).toBe(false);
  });

  it('does not let an older non-deduplicated completion clear the newer generation', async () => {
    const firstResult = deferred<string>();
    const secondResult = deferred<string>();
    const firstFetcher = vi.fn(async () => firstResult.promise);
    const secondFetcher = vi.fn(async () => secondResult.promise);
    const thirdFetcher = vi.fn(async () => 'unexpected');

    const first = guardedRequest({
      key: 'overlap-generation',
      dedupe: false,
      fetcher: firstFetcher,
    });
    const second = guardedRequest({
      key: 'overlap-generation',
      dedupe: false,
      fetcher: secondFetcher,
    });
    firstResult.resolve('old-result');
    await expect(first).resolves.toBe('old-result');

    const joined = guardedRequest({
      key: 'overlap-generation',
      fetcher: thirdFetcher,
    });
    secondResult.resolve('new-result');

    await expect(second).resolves.toBe('new-result');
    await expect(joined).resolves.toBe('new-result');
    expect(thirdFetcher).not.toHaveBeenCalled();
  });
});
