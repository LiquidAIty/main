import { describe, expect, it } from 'vitest';
import {
  indexToolCatalogReferences,
  resolveScriptToolReferences,
  resolveToolCatalogDefinitions,
  searchToolCatalogReferences,
  type ToolCatalogReference,
} from './toolCatalogProjection';

function reference(index: number, access: 'read' | 'write' = 'read'): ToolCatalogReference {
  const canonicalId = `cbm.tool_${String(index).padStart(5, '0')}`;
  return {
    canonicalId,
    kind: 'tool',
    namespace: 'cbm',
    sourceIds: ['cbm'],
    displayName: `Tool ${index}`,
    shortDescription: `Read repository slice ${index}`,
    availability: 'available',
    access,
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

  it('paginates the Card Tools plane over write/effect operations only', () => {
    const catalog = indexToolCatalogReferences([
      reference(1, 'read'),
      reference(2, 'write'),
      reference(3, 'write'),
    ]);
    const page = searchToolCatalogReferences(catalog, {
      access: 'write',
      selectedIds: ['cbm.tool_00001', 'cbm.tool_00002'],
    });

    expect(page.total).toBe(2);
    expect(page.references.map((item) => item.canonicalId)).toEqual([
      'cbm.tool_00002',
      'cbm.tool_00003',
    ]);
    expect(page.selectedKnownReferences.map((item) => item.canonicalId)).toEqual([
      'cbm.tool_00002',
    ]);
  });

  it('derives Script handles from the same saved Tools-tab policy without widening writes', () => {
    const disabledRead = { ...reference(2, 'read'), availability: 'disabled' as const };
    const catalog = indexToolCatalogReferences([
      reference(1, 'read'),
      disabledRead,
      reference(3, 'write'),
      reference(4, 'write'),
    ]);

    expect(resolveScriptToolReferences(catalog, {
      policy: 'all_healthy',
      selectedIds: ['cbm.tool_00003'],
      disabledIds: ['cbm.tool_00001'],
    }).map((item) => item.canonicalId)).toEqual(['cbm.tool_00003']);

    expect(resolveScriptToolReferences(catalog, {
      policy: 'selected',
      selectedIds: ['cbm.tool_00001', 'cbm.tool_00004'],
      disabledIds: [],
    }).map((item) => item.canonicalId)).toEqual([
      'cbm.tool_00001',
      'cbm.tool_00004',
    ]);
  });

  it('rejects an unknown saved Script handle instead of silently dropping it', () => {
    const catalog = indexToolCatalogReferences([reference(1)]);
    expect(() => resolveScriptToolReferences(catalog, {
      policy: 'selected',
      selectedIds: ['missing.tool'],
      disabledIds: [],
    })).toThrow('tool_catalog_selected_id_unknown:missing.tool');
  });
});
