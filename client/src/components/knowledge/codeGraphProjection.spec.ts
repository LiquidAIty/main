/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: CodeGraph
 * Relationship: This file verifies fail-closed structural projection parsing, multi-Feature File identity, and expansion merging without erasing source contributions.
 * Entity: Project Knowledge Graph
 * Relationship: This file verifies CodeGraph projections can join the shared graph workspace only with complete identities and non-dangling edges.
 */

import { describe, expect, it } from 'vitest';

import type { GraphProjectionV1 } from './knowledgeGraphProjection';
import {
  codeGraphCategoryProjection,
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
      { id: 'file:plain', label: 'plain.ts', authority: 'codegraph', type: 'File', etype: 'File', properties: { recordKind: 'file', filePath: 'client/plain.ts', qualifiedName: 'file:plain', features: [] } },
    ],
    edges: [
      { id: 'a-file', source: 'feature:a', target: 'file:shared', predicate: 'FEATURE_CONTRIBUTION', properties: { filePath: 'client/shared.ts', relationship: 'Implements A.' } },
      { id: 'b-file', source: 'feature:b', target: 'file:shared', predicate: 'FEATURE_CONTRIBUTION', properties: { filePath: 'client/shared.ts', relationship: 'Implements B.' } },
    ],
  };
}

describe('CodeGraph projection', () => {
  it('retains one shared File and both source-owned Feature memberships', () => {
    const source = validateCodeGraphProjection(projection(), 'project-1');

    expect(source.nodes.map(node => node.id)).toEqual([
      'feature:a', 'feature:b', 'file:shared', 'file:plain',
    ]);
    expect(source.nodes.filter(node => node.id === 'file:shared')).toHaveLength(1);
    expect(source.edges).toEqual([
      expect.objectContaining({ id: 'a-file', source: 'feature:a', target: 'file:shared', predicate: 'FEATURE_CONTRIBUTION' }),
      expect.objectContaining({ id: 'b-file', source: 'feature:b', target: 'file:shared', predicate: 'FEATURE_CONTRIBUTION' }),
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

  it('starts with source-tagged Features and does not parse untagged Files into categories', () => {
    const visible = codeGraphCategoryProjection(projection(), null, null);

    expect(visible.nodes.map(node => node.id)).toEqual(['feature:a', 'feature:b']);
    expect(visible.edges).toEqual([]);
  });

  it('reveals only one Feature membership and its exact Relationship prose', () => {
    const visible = codeGraphCategoryProjection(projection(), 'feature:a', null);

    expect(visible.nodes.map(node => node.id)).toEqual(['feature:a', 'file:shared']);
    expect(visible.edges.map(edge => edge.id)).toEqual(['a-file']);
    expect(visible.nodes[0].properties?.contributions).toEqual([{
      feature: 'client/shared.ts', relationship: 'Implements A.',
    }]);
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
