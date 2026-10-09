import { describe, expect, it } from 'vitest';
import {
  indexLiveToolCatalog,
  resolveScriptToolDefinitions,
  resolveToolCatalogDefinitions,
  searchToolCatalogDefinitions,
  type ToolCatalogDefinition,
} from './toolCatalogProjection';

function definition(index: number, access: 'read' | 'write' = 'read'): ToolCatalogDefinition {
  const canonicalId = `cbm.tool_${String(index).padStart(5, '0')}`;
  return {
    canonicalId,
    provider: 'cbm',
    providerToolName: `tool_${String(index).padStart(5, '0')}`,
    namespace: 'cbm',
    publications: ['card-runtime', 'external-mcp'],
    displayName: `Tool ${index}`,
    description: `Read repository slice ${index}`,
    available: true,
    grantEligible: true,
    access,
    inputSchema: { type: 'object', properties: { index: { type: 'integer', const: index } } },
    canonicalInputSchema: {
      type: 'object', properties: { index: { type: 'integer', const: index } },
    },
    serverInjectedArguments: [],
    dispatcherContextArguments: [],
    dispatcherOwner: 'app.mcp_provider_operations._call_cbm',
    annotations: {
      readOnlyHint: access === 'read',
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  };
}

describe('live tool catalog lookup', () => {
  it('searches flat live definitions without changing their provider-owned fields', () => {
    const definitions = Array.from({ length: 10_000 }, (_, index) => definition(index));
    const catalog = indexLiveToolCatalog(definitions);
    const page = searchToolCatalogDefinitions(catalog, {
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
    expect(resolveToolCatalogDefinitions(catalog, ['cbm.tool_00003'])[0])
      .toEqual(definitions[3]);
  });

  it('rejects duplicate canonical identities instead of merging or classifying them', () => {
    expect(() => indexLiveToolCatalog([definition(1), definition(1)]))
      .toThrow('tool_catalog_duplicate_id:cbm.tool_00001');
  });

  it('paginates the Card Tools plane over write/effect operations only', () => {
    const catalog = indexLiveToolCatalog([
      definition(1, 'read'),
      definition(2, 'write'),
      definition(3, 'write'),
    ]);
    const page = searchToolCatalogDefinitions(catalog, {
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

  it('derives Script handles only from explicit saved tool grants', () => {
    const disabledRead = { ...definition(2, 'read'), available: false };
    const externalOnly = {
      ...definition(3, 'read'),
      publications: ['external-mcp'] as Array<'card-runtime' | 'external-mcp'>,
    };
    const catalog = indexLiveToolCatalog([
      definition(1, 'read'),
      disabledRead,
      externalOnly,
      definition(4, 'write'),
    ]);

    expect(resolveScriptToolDefinitions(catalog, {
      selectedIds: [
        'cbm.tool_00001', 'cbm.tool_00002', 'cbm.tool_00003', 'cbm.tool_00004',
      ],
    }).map((item) => item.canonicalId)).toEqual([
      'cbm.tool_00001',
      'cbm.tool_00004',
    ]);
  });

  it('rejects an unknown saved Script handle instead of silently dropping it', () => {
    const catalog = indexLiveToolCatalog([definition(1)]);
    expect(() => resolveScriptToolDefinitions(catalog, {
      selectedIds: ['missing.tool'],
    })).toThrow('tool_catalog_selected_id_unknown:missing.tool');
  });
});
