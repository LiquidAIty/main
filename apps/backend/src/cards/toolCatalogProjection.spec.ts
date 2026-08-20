import { describe, expect, it } from 'vitest';
import {
  indexToolCatalogReferences,
  resolveToolCatalogDefinitions,
  searchToolCatalogReferences,
  type ToolCatalogReference,
} from './toolCatalogProjection';

function reference(index: number): ToolCatalogReference {
  const canonicalId = `cbm.tool_${String(index).padStart(5, '0')}`;
  return {
    canonicalId,
    kind: 'tool',
    namespace: 'cbm',
    sourceIds: ['cbm'],
    displayName: `Tool ${index}`,
    shortDescription: `Read repository slice ${index}`,
    availability: 'available',
    access: 'read',
    contracts: [{
      sourceId: 'cbm',
      nativeName: `tool_${String(index).padStart(5, '0')}`,
      connectionKind: 'external-mcp',
      available: true,
      description: `Native tool ${index}`,
      inputSchema: { type: 'object', properties: { index: { type: 'integer', const: index } } },
      annotations: { readOnlyHint: true },
    }],
  };
}

describe('IDD tool catalog lookup', () => {
  it('searches already-materialized IDD references without changing native contracts', () => {
    const references = Array.from({ length: 10_000 }, (_, index) => reference(index));
    const catalog = indexToolCatalogReferences(references);
    const page = searchToolCatalogReferences(catalog, {
      query: 'repository slice',
      offset: 200,
      limit: 25,
      selectedIds: ['cbm.tool_00005', 'cbm.tool_00003', 'missing.tool'],
    });

    expect(page.total).toBe(10_000);
    expect(page.references).toHaveLength(25);
    expect(page.hasMore).toBe(true);
    expect(page.selectedKnownReferences.map((item) => item.canonicalId)).toEqual([
      'cbm.tool_00005',
      'cbm.tool_00003',
    ]);
    expect(page.unresolvedSelectedIds).toEqual(['missing.tool']);
    expect(resolveToolCatalogDefinitions(catalog, ['cbm.tool_00003'])[0].contracts[0])
      .toEqual(references[3].contracts[0]);
  });

  it('rejects duplicate IDD identities instead of merging or classifying them', () => {
    expect(() => indexToolCatalogReferences([reference(1), reference(1)]))
      .toThrow('tool_catalog_duplicate_id:cbm.tool_00001');
  });
});
