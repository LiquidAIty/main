import { describe, expect, it } from 'vitest';

import { parseGraphObjectRefs } from './graphObjectContext';

describe('GraphObjectRef validation', () => {
  it('preserves the source authority for Unified selections and deduplicates identity', () => {
    const refs = parseGraphObjectRefs([
      { authority: 'thinkgraph', canonicalId: 'decision:1', selectedThrough: 'unified', sourceAuthority: 'thinkgraph', projectionId: 'unified:abc', displayLabel: 'Decision' },
      { authority: 'thinkgraph', canonicalId: 'decision:1', selectedThrough: 'thinkgraph', displayLabel: 'Decision duplicate' },
    ]);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ authority: 'thinkgraph', sourceAuthority: 'thinkgraph' });
  });

  it('rejects raw graph content, invalid authority, and mismatched Unified authority', () => {
    expect(() => parseGraphObjectRefs([{ authority: 'unified', canonicalId: 'x', selectedThrough: 'unified', sourceAuthority: 'thinkgraph', displayLabel: 'x' }])).toThrow();
    expect(() => parseGraphObjectRefs([{ authority: 'knowgraph', canonicalId: 'x', selectedThrough: 'unified', sourceAuthority: 'codegraph', displayLabel: 'x' }])).toThrow();
    expect(() => parseGraphObjectRefs([{ authority: 'codegraph', canonicalId: 'x', selectedThrough: 'codegraph', displayLabel: 'x', nodes: [] }])).toThrow();
  });
});
