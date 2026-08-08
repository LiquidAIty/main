import { describe, expect, it } from 'vitest';
import {
  buildToolInputDataDictionary,
  resolveToolInputDefinitions,
  searchToolInputReferences,
} from './toolInputDataDictionary';

describe('tool input data dictionary', () => {
  it('bounds a 10,000-entry reference search and resolves definitions only for requested ids', () => {
    const catalog = Array.from({ length: 10_000 }, (_, index) => ({
      name: `cbm.tool_${String(index).padStart(5, '0')}`,
      title: `Tool ${index}`,
      description: `Read repository slice ${index}`,
      inputSchema: { type: 'object', properties: { index: { type: 'integer', const: index } } },
      capability: { runtimeCompatibility: ['autogen'] },
    }));
    const dictionary = buildToolInputDataDictionary(catalog);
    const page = searchToolInputReferences(dictionary, {
      query: 'repository slice',
      offset: 200,
      limit: 25,
      selectedIds: ['cbm.tool_00005', 'cbm.tool_00003', 'missing.tool'],
    });

    expect(page.total).toBe(10_000);
    expect(page.references).toHaveLength(25);
    expect(page.hasMore).toBe(true);
    expect(page.references[0]).not.toHaveProperty('inputSchema');
    expect(page.references[0].capability).toEqual({
      runtimeCompatibility: ['autogen'],
      assignableRuntimeBindings: [],
      assignableRuntimeTypes: [],
      cardAssignable: false,
    });
    expect(page.selectedKnownReferences.map((reference) => reference.canonicalId)).toEqual([
      'cbm.tool_00005',
      'cbm.tool_00003',
    ]);
    expect(page.selectedKnownReferences[0].nativeName).toBe('cbm.tool_00005');
    expect(page.unresolvedSelectedIds).toEqual(['missing.tool']);

    const definitions = resolveToolInputDefinitions(dictionary, ['cbm.tool_00003']);
    expect(definitions).toHaveLength(1);
    expect(definitions[0].implementations).toHaveLength(1);
    expect(definitions[0].implementations[0].inputSchema).toEqual(catalog[3].inputSchema);
    expect(() => resolveToolInputDefinitions(dictionary, ['missing.tool'])).toThrow(
      'tool_input_dictionary_selected_id_unknown:missing.tool',
    );
    expect(() => resolveToolInputDefinitions(dictionary, ['cbm.tool_00003', 'cbm.tool_00003'])).toThrow(
      'tool_input_dictionary_selected_id_duplicate:cbm.tool_00003',
    );
  });

  it('rejects duplicate canonical ids inside one live source', () => {
    expect(() => buildToolInputDataDictionary(
      [
        { name: 'shared.tool', inputSchema: {}, capability: {} },
        { name: 'shared.tool', inputSchema: {}, capability: {} },
      ],
    )).toThrow('tool_input_dictionary_duplicate_id:shared.tool');
  });

  it('keeps one canonical id with runtime-specific live implementations', () => {
    const dictionary = buildToolInputDataDictionary([
      {
        sourceId: 'mcp_server_one',
        publication: { externalMcp: true },
        name: 'web_search',
        title: 'Web search',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
        capability: {
          runtimeCompatibility: ['harness'],
          assignableRuntimeBindings: ['main_chat'],
          cardAssignable: true,
        },
      },
      {
        sourceId: 'mcp_server_two',
        publication: { externalMcp: false },
        name: 'web_search',
        displayName: 'Web search',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
        capability: {
          runtimeCompatibility: ['autogen'],
          assignableRuntimeTypes: ['assistant_agent'],
          cardAssignable: true,
        },
      },
    ]);

    expect(dictionary.references).toHaveLength(1);
    expect(dictionary.references[0]).toMatchObject({
      canonicalId: 'web_search',
      sourceId: 'federated',
      sourceIds: ['mcp_server_one', 'mcp_server_two'],
      publication: { externalMcp: true },
      execution: { authority: 'federated', nativeName: 'web_search' },
      capability: {
        runtimeCompatibility: ['harness', 'autogen'],
        assignableRuntimeBindings: ['main_chat'],
        assignableRuntimeTypes: ['assistant_agent'],
        cardAssignable: true,
      },
    });
    expect(resolveToolInputDefinitions(dictionary, ['web_search'])[0].implementations).toHaveLength(2);
  });

  it('keeps a private native agent referenceable without publishing it as MCP', () => {
    const dictionary = buildToolInputDataDictionary([{
      id: 'run_local_coder',
      kind: 'agent',
      sourceId: 'local_coder',
      namespace: 'coder',
      displayName: 'Local Coder',
      publication: { externalMcp: false },
      execution: { authority: 'local_coder', nativeName: 'run_local_coder' },
      inputSchema: { type: 'object', properties: { objective: { type: 'string' } } },
      capability: {
        runtimeCompatibility: ['autogen'],
        assignableRuntimeBindings: ['local_coder'],
        cardAssignable: true,
      },
    }]);

    expect(dictionary.references).toEqual([
      expect.objectContaining({
        canonicalId: 'run_local_coder',
        kind: 'agent',
        sourceId: 'local_coder',
        namespace: 'coder',
        publication: { externalMcp: false },
        execution: { authority: 'local_coder', nativeName: 'run_local_coder' },
      }),
    ]);
  });
});
