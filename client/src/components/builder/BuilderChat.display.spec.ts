import { describe, expect, it } from 'vitest';

import { chatDisplayText } from './BuilderChat';

describe('BuilderChat research-result display', () => {
  it('keeps cited provenance out of Main while pointing to KnowGraph', () => {
    const displayed = chatDisplayText(JSON.stringify({
      schemaVersion: 'atomic-research-result.v1',
      results: [{
        thinkMemoryId: 'think-one',
        status: 'supported',
        summary: 'The bounded claim is supported.',
        citations: [{
          title: 'Primary filing',
          url: 'https://primary.example/filing',
          publishedAt: '2026-10-01',
        }],
        episodeUuids: ['episode-one'],
      }],
    }));

    expect(displayed).toBe(
      'Research result\n\nSupported: The bounded claim is supported.\n\n'
      + 'Evidence and sources are retained in KnowGraph.',
    );
    expect(displayed).not.toContain('Primary filing');
    expect(displayed).not.toContain('https://primary.example/filing');
  });
});
