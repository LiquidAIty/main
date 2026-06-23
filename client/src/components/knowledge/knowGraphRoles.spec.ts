import { describe, expect, it } from 'vitest';

import {
  KNOWGRAPH_OWLCLASS_ROLE,
  resolveKnowGraphRole,
  unmappedKnowGraphOwlClasses,
  type KnowGraphSemanticRole,
} from './knowGraphRoles';

// The live observed KnowGraph vocabulary for the active project (owlClass / @type).
const LIVE_KNOWGRAPH_OWLCLASSES = [
  'Source',
  'SemanticRecord',
  'SearchPacket',
  'ObservedEntity',
  'SearchTask',
  'SourceBackedAssertion',
  'SearchRun',
  'GraphSeed',
];

describe('KnowGraph semantic-role contract (structured owlClass only)', () => {
  it('covers every live KnowGraph owlClass (none unmapped)', () => {
    expect(unmappedKnowGraphOwlClasses(LIVE_KNOWGRAPH_OWLCLASSES)).toEqual([]);
  });

  it('maps the real vocabulary to the expected roles', () => {
    const expected: Record<string, KnowGraphSemanticRole> = {
      ObservedEntity: 'PrimaryEntity',
      SemanticRecord: 'PrimaryEntity',
      SourceBackedAssertion: 'Claim',
      Source: 'Source',
      SearchPacket: 'ProvenanceProcess',
      SearchTask: 'ProvenanceProcess',
      SearchRun: 'ProvenanceProcess',
      GraphSeed: 'ProvenanceProcess',
    };
    for (const [owlClass, role] of Object.entries(expected)) {
      expect(resolveKnowGraphRole({ owlClass })).toBe(role);
    }
  });

  it('reads the structured SemanticRecord sub-class for Claim (no string-matching)', () => {
    expect(
      resolveKnowGraphRole({ owlClass: 'SemanticRecord', innerOwlClass: 'Claim' }),
    ).toBe('Claim');
    // default SemanticRecord (no inner class) stays a PrimaryEntity
    expect(resolveKnowGraphRole({ owlClass: 'SemanticRecord' })).toBe('PrimaryEntity');
  });

  it('returns null (explicitly unmapped) for an unknown owlClass', () => {
    expect(resolveKnowGraphRole({ owlClass: 'TotallyUnknownClass' })).toBeNull();
    expect(unmappedKnowGraphOwlClasses(['Source', 'Mystery'])).toEqual(['Mystery']);
  });

  it('has no generic Thing role', () => {
    expect(Object.values(KNOWGRAPH_OWLCLASS_ROLE)).not.toContain('Thing');
    expect(Object.keys(KNOWGRAPH_OWLCLASS_ROLE)).not.toContain('Thing');
  });
});
