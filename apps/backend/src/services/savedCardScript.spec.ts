import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  hermesCallbackToolNames,
  hermesCardScriptDefinition,
  hermesDynamicToolDefinitions,
} from './savedCardRun';

const source = `CARD_SCRIPT = {
    "mode": "tool_recipe",
    "input": {"type": "object", "properties": {"query": {"type": "string"}}},
    "output": {"type": "object", "properties": {"result": {}}, "required": ["result"]},
}
from hermes_tools import SCRIPT, output, tools
tools.cbm.search_graph = SCRIPT
output.emit({"result": tools.call("cbm.search_graph")})
`;

function definition(canonicalId: string) {
  return {
    canonicalId,
    available: true,
    publications: ['card-runtime'],
    description: `Use ${canonicalId}.`,
    inputSchema: { type: 'object', properties: {} },
  };
}

describe('saved Card Python turn projection', () => {
  it('keeps script-owned handles on the signed callback while exposing only agent tools', () => {
    const dynamicTools = hermesDynamicToolDefinitions([
      definition('graphiti.get_status'),
    ]);
    const cardScript = hermesCardScriptDefinition({
      enabledTools: ['cbm.search_graph', 'graphiti.get_status'],
      presentedTools: ['graphiti.get_status'],
      scriptPresentation: { mode: 'script' },
      runtimeOptions: {
        script: {
          version: 3,
          source,
          sourceHash: createHash('sha256').update(source, 'utf8').digest('hex'),
          compiledHash: 'a'.repeat(64),
          lastValidation: { status: 'valid' },
          compiled: {
            mode: 'tool_recipe',
            inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
            outputSchema: {
              type: 'object', properties: { result: {} }, required: ['result'],
            },
            toolStates: { 'cbm.search_graph': 1, 'graphiti.get_status': 2 },
            scriptToolIds: ['cbm.search_graph'],
            agentToolIds: ['graphiti.get_status'],
            timeoutSeconds: 15,
            maxToolCalls: 2,
            maxOutputBytes: 20_000,
          },
        },
      },
    });

    expect(cardScript).toBeDefined();
    expect(Object.keys(cardScript!.tool_aliases)).toEqual(['cbm.search_graph']);
    expect(dynamicTools.map((tool) => tool.canonical_name)).toEqual(['graphiti.get_status']);
    expect(hermesCallbackToolNames(dynamicTools, cardScript)).toEqual([
      'graphiti.get_status', 'cbm.search_graph',
    ]);
  });

  it('does not project blank or invalid source as an executable recipe', () => {
    expect(hermesCardScriptDefinition({
      scriptPresentation: { mode: 'selected-mcp' },
      runtimeOptions: { script: { source: '', lastValidation: { status: 'blank' } } },
    })).toBeUndefined();
  });
});
