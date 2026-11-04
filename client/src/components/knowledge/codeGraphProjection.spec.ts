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
  applyCodeGraphPhysics,
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
  it('retains source memberships internally but renders only selected files, once', () => {
    const source = validateCodeGraphProjection(projection(), 'project-1');
    const before = JSON.stringify(source);
    const view = codeGraphCategoryProjection(source, ['feature:a', 'feature:b']);
    expect(view.nodes.map(node => node.id)).toEqual(['file:shared']);
    expect(view.nodes[0].properties?.features).toEqual(['A', 'B']);
    expect(view.edges).toEqual([]);
    expect(codeGraphCategoryProjection(source, []).nodes).toEqual([]);
    expect(codeGraphCategoryProjection(source, ['missing']).nodes).toEqual([]);
    expect(JSON.stringify(source)).toBe(before);
  });

  it('includes real directed cross-category calls and imports, never symbols or membership spokes', () => {
    const source = projection();
    source.nodes.push({ id: 'symbol', label: 'symbol', properties: { recordKind: 'symbol' } });
    const properties = { recordKind: 'structural-relationship', structuralAuthority: 'cbm' };
    source.edges.push(
      { id: 'call', source: 'file:plain', target: 'file:shared', predicate: 'CALLS', properties },
      { id: 'import', source: 'file:shared', target: 'file:plain', predicate: 'IMPORTS', properties },
      { id: 'usage', source: 'file:shared', target: 'symbol', predicate: 'USAGE', properties },
    );
    const view = codeGraphCategoryProjection(source, ['feature:a']);
    expect(view.nodes.map(node => node.id)).toEqual(['file:shared', 'file:plain']);
    expect(view.edges.map(edge => [edge.id, edge.source, edge.target])).toEqual([
      ['call', 'file:plain', 'file:shared'], ['import', 'file:shared', 'file:plain'],
    ]);
  });

  it('refreshes complete incident structure without erasing another file or annotations', () => {
    const base = projection();
    base.edges.push({ id: 'stale', source: 'file:plain', target: 'file:shared', predicate: 'CALLS',
      properties: { recordKind: 'structural-relationship', structuralAuthority: 'cbm', selectedFilePath: 'client/plain.ts' } });
    const expansion = { ...projection(), metadata: { selectedFilePaths: ['client/shared.ts'] },
      nodes: [{ ...base.nodes[2], properties: { ...base.nodes[2].properties, structuralComplete: true } }], edges: [] };
    const merged = mergeCodeGraphProjections(base, expansion);
    expect(merged.edges.map(edge => edge.id)).toEqual(['a-file', 'b-file']);
    expect(merged.nodes.find(node => node.id === 'file:shared')?.properties?.features).toEqual(['A', 'B']);
    expect(base.edges).toHaveLength(3);
  });

  it('does not erase known connections after an incomplete read', () => {
    const base = projection();
    base.edges.push({ id: 'call', source: 'file:plain', target: 'file:shared', predicate: 'CALLS',
      properties: { recordKind: 'structural-relationship', structuralAuthority: 'cbm' } });
    const expansion = { ...projection(), metadata: { selectedFilePaths: ['client/shared.ts'] },
      nodes: [{ ...base.nodes[2], properties: { ...base.nodes[2].properties, structuralComplete: false } }], edges: [] };
    expect(mergeCodeGraphProjections(base, expansion).edges.some(edge => edge.id === 'call')).toBe(true);
  });

  it('sizes by distinct incoming callers, not annotation count or repeated symbol evidence', () => {
    const source = projection();
    source.nodes[3].properties!.features = ['A'];
    source.edges.push({ id: 'call', source: 'file:plain', target: 'file:shared', predicate: 'CALLS',
      properties: { structuralAuthority: 'cbm', symbolConnections: Array(100).fill({}) } });
    source.edges.push({ id: 'import', source: 'file:plain', target: 'file:shared', predicate: 'IMPORTS',
      properties: { structuralAuthority: 'cbm' } });
    const view = applyCodeGraphPhysics(codeGraphCategoryProjection(source, ['feature:a']));
    const shared = view.nodes.find(node => node.id === 'file:shared')!;
    const plain = view.nodes.find(node => node.id === 'file:plain')!;
    expect(shared.properties?.callerFileCount).toBe(1);
    expect(shared.properties?.incomingConnectionCount).toBe(1);
    expect(plain.properties?.incomingConnectionCount).toBe(0);
    expect(shared.properties?.categoryConnections).toEqual({ A: 1, B: 0 });
    expect(shared.visual_radius).toBeGreaterThan(plain.visual_radius!);
    expect(view.edges[0].spring_strength).toBeGreaterThan(0);
    expect(view.edges[0].rest_length).toBeGreaterThan(shared.visual_radius! + plain.visual_radius!);
    expect(shared.properties?.connectionCountScope).toBe('loaded-cbm-neighborhood');
    expect(source.nodes[2].visual_radius).toBeUndefined();
  });

  it('does not impose a displayed-file or neighbor count cap', () => {
    const source = projection();
    for (let index = 0; index < 1100; index++) {
      const id = 'file:' + index;
      source.nodes.push({ id, label: id, authority: 'codegraph', properties: { recordKind: 'file' } });
      source.edges.push({ id: 'call:' + index, source: id, target: 'file:shared', predicate: 'CALLS',
        properties: { structuralAuthority: 'cbm' } });
    }
    const view = codeGraphCategoryProjection(source, ['feature:a']);
    expect(view.nodes).toHaveLength(1101);
    expect(view.edges).toHaveLength(1100);
  });

  it('rejects duplicate identities, dangling edges and cross-project merges', () => {
    const duplicate = projection();
    duplicate.nodes.push({ ...duplicate.nodes[0] });
    expect(() => validateCodeGraphProjection(duplicate, 'project-1')).toThrow('invalid_codegraph_projection');
    const dangling = projection();
    dangling.edges.push({ id: 'bad', source: 'file:shared', target: 'missing', predicate: 'CALLS' });
    expect(() => validateCodeGraphProjection(dangling, 'project-1')).toThrow('invalid_codegraph_projection');
    expect(() => mergeCodeGraphProjections(projection(), { ...projection(), projectId: 'other' }))
      .toThrow('codegraph_projection_merge_scope_mismatch');
  });
});
