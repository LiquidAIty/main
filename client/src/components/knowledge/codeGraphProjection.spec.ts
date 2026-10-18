/**
 * Entity: CodeGraph
 * Relationship: Verifies fail-closed structural projection parsing, multi-Feature File identity, and expansion merging.
 */

import { describe, expect, it } from 'vitest';

import type { GraphProjectionV1 } from './knowledgeGraphProjection';
import {
  mergeCodeGraphProjections,
  validateCodeGraphProjection,
} from './codeGraphProjection';

function projection(): GraphProjectionV1 {
  return {
    schemaVersion: 'codegraph.projection.v1',
    authority: 'codegraph',
    projectId: 'project-1',
    nodes: [
      { id: 'feature:a', label: 'A', authority: 'codegraph', type: 'Feature', etype: 'Feature', properties: { recordKind: 'feature', featureName: 'A' } },
      { id: 'feature:b', label: 'B', authority: 'codegraph', type: 'Feature', etype: 'Feature', properties: { recordKind: 'feature', featureName: 'B' } },
      { id: 'file:shared', label: 'shared.ts', authority: 'codegraph', type: 'File', etype: 'File', properties: { recordKind: 'file', filePath: 'client/shared.ts', qualifiedName: 'file:shared', features: ['A', 'B'] } },
    ],
    edges: [
      { id: 'a-file', source: 'feature:a', target: 'file:shared', predicate: 'FEATURE_CONTRIBUTION' },
      { id: 'b-file', source: 'feature:b', target: 'file:shared', predicate: 'FEATURE_CONTRIBUTION' },
    ],
  };
}

describe('CodeGraph projection', () => {
  it('retains one shared File and both source-owned Feature memberships', () => {
    const source = validateCodeGraphProjection(projection(), 'project-1');

    expect(source.nodes.map(node => node.id)).toEqual([
      'feature:a', 'feature:b', 'file:shared',
    ]);
    expect(source.nodes.filter(node => node.id === 'file:shared')).toHaveLength(1);
    expect(source.edges).toEqual([
      { id: 'a-file', source: 'feature:a', target: 'file:shared', predicate: 'FEATURE_CONTRIBUTION' },
      { id: 'b-file', source: 'feature:b', target: 'file:shared', predicate: 'FEATURE_CONTRIBUTION' },
    ]);
  });

  it('merges structural expansion without erasing Feature membership', () => {
    const base = projection();
    const expansion: GraphProjectionV1 = {
      schemaVersion: 'codegraph.projection.v1',
      authority: 'codegraph',
      projectId: 'project-1',
      nodes: [
        { id: 'file:shared', label: 'shared.ts', authority: 'codegraph', type: 'File', etype: 'File', properties: { recordKind: 'file', filePath: 'client/shared.ts', qualifiedName: 'file:shared', structuralAuthority: 'cbm' } },
        { id: 'symbol:run', label: 'run', authority: 'codegraph', type: 'Function', etype: 'Symbol', properties: { recordKind: 'symbol', filePath: 'client/shared.ts', qualifiedName: 'symbol:run' } },
      ],
      edges: [{ id: 'defines', source: 'file:shared', target: 'symbol:run', predicate: 'DEFINES' }],
    };

    const merged = mergeCodeGraphProjections(base, expansion);

    expect(merged.nodes.find(node => node.id === 'file:shared')?.properties?.features)
      .toEqual(['A', 'B']);
    expect(merged.edges.map(edge => edge.id)).toEqual(['a-file', 'b-file', 'defines']);
  });

  it('rejects duplicate identities and dangling structural edges', () => {
    const duplicate = projection();
    duplicate.nodes.push({ ...duplicate.nodes[0] });
    expect(() => validateCodeGraphProjection(duplicate, 'project-1'))
      .toThrow('invalid_codegraph_projection');

    const dangling = projection();
    dangling.edges.push({ id: 'bad', source: 'file:shared', target: 'missing', predicate: 'CALLS' });
    expect(() => validateCodeGraphProjection(dangling, 'project-1'))
      .toThrow('invalid_codegraph_projection');
  });
});
