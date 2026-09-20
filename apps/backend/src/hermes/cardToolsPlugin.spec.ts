import { describe, expect, it, vi } from 'vitest';
import {
  materializeHermesExternalMcpTools,
  requireHermesCardToolsReadback,
  type HermesCardTools,
} from './cardToolsPlugin';

function configuration(overrides: Partial<HermesCardTools> = {}): HermesCardTools {
  return {
    projectId: 'project-one',
    deckId: 'deck-one',
    cardId: 'builder',
    cardRevisionId: 'revision-one',
    cardRevisionSha256: 'a'.repeat(64),
    runtime: { kind: 'hermes', mode: 'delegate', profile: 'builder' },
    enabledTools: ['card.create'],
    unavailableTools: [],
    unavailableToolReasons: {},
    presentedTools: ['card.create'],
    nativeTools: ['memory'],
    toolsets: [],
    mcpConnectionIds: [],
    pluginTools: [{
      canonicalName: 'card.create',
      hermesName: 'card__card_create',
      description: 'Create one saved Card.',
      inputSchema: { type: 'object', properties: {} },
    }],
    externalMcpTools: [],
    externalToolCatalogState: 'available',
    configurationFingerprint: 'b'.repeat(64),
    ...overrides,
  };
}

describe('requireHermesCardToolsReadback', () => {
  it('accepts the exact plugin and native surface', () => {
    expect(requireHermesCardToolsReadback({ sections: [
      { name: 'card-tools', tools: [{ name: 'card__card_create' }] },
      { name: 'memory', tools: [{ name: 'memory' }] },
    ] }, configuration())).toEqual({});
  });

  it('fails closed when the native plugin exposes an ungranted tool', () => {
    expect(() => requireHermesCardToolsReadback({ sections: [{
      name: 'card-tools',
      tools: [{ name: 'card__card_create' }, { name: 'card__canvas_inspect' }],
    }] }, configuration())).toThrow(
      'hermes_card_tools_readback_broadened:card__canvas_inspect',
    );
  });

  it('keeps chat available and reports a granted plugin tool that is missing', () => {
    expect(requireHermesCardToolsReadback({ sections: [
      { name: 'card-tools', tools: [] },
      { name: 'memory', tools: [{ name: 'memory' }] },
    ] }, configuration())).toEqual({
      'card.create': 'internal_plugin_tool_unavailable',
    });
  });

  it('accepts only the selected external MCP tool and reports a missing one', () => {
    const selected = configuration({
      enabledTools: ['graphiti.search_nodes'],
      presentedTools: ['graphiti.search_nodes'],
      nativeTools: [],
      mcpConnectionIds: [],
      pluginTools: [],
      externalMcpTools: [{
        canonicalName: 'graphiti.search_nodes',
        connectionId: 'graphiti',
        nativeName: 'search_nodes',
      }],
    });
    expect(requireHermesCardToolsReadback({ sections: [{
      name: 'mcp-graphiti',
      tools: [{ name: 'mcp__graphiti__search_nodes' }],
    }] }, selected)).toEqual({});
    expect(requireHermesCardToolsReadback({ sections: [], }, selected)).toEqual({
      'graphiti.search_nodes': 'external_mcp_tool_unavailable',
    });
  });

  it('fails closed when a selected MCP server exposes an ungranted tool', () => {
    const selected = configuration({
      enabledTools: ['graphiti.search_nodes'],
      presentedTools: ['graphiti.search_nodes'],
      nativeTools: [],
      mcpConnectionIds: [],
      pluginTools: [],
      externalMcpTools: [{
        canonicalName: 'graphiti.search_nodes',
        connectionId: 'graphiti',
        nativeName: 'search_nodes',
      }],
    });
    expect(() => requireHermesCardToolsReadback({ sections: [{
      name: 'mcp-graphiti',
      tools: [
        { name: 'mcp__graphiti__search_nodes' },
        { name: 'mcp__graphiti__add_memory' },
      ],
    }] }, selected)).toThrow('hermes_external_mcp_readback_broadened:graphiti');
  });
});

describe('materializeHermesExternalMcpTools', () => {
  it('derives one exact native server/tool surface from an individual Card tool grant', async () => {
    const selected = configuration({
      enabledTools: ['graphiti.search_nodes'],
      presentedTools: ['graphiti.search_nodes'],
      pluginTools: [],
      externalMcpTools: [{
        canonicalName: 'graphiti.search_nodes',
        connectionId: 'graphiti',
        nativeName: 'search_nodes',
      }],
    });
    const request = vi.fn(async (method: string) => {
      if (method === 'mcp.servers.list') return {
        servers: [{ name: 'graphiti', auth: null, tools: {} }],
      };
      if (method === 'mcp.servers.test') return {
        ok: true,
        tools: [{ name: 'search_nodes' }, { name: 'add_memory' }],
        prompts: 0,
        resources: 0,
      };
      if (method === 'tools.configure') return { changed: ['graphiti:search_nodes'] };
      throw new Error(`unexpected:${method}`);
    });

    await expect(materializeHermesExternalMcpTools(request, selected)).resolves.toEqual({});
    expect(request).toHaveBeenCalledWith('tools.configure', {
      action: 'disable',
      names: ['graphiti:add_memory'],
    });
    expect(request).toHaveBeenCalledWith('tools.configure', {
      action: 'enable',
      names: ['graphiti:search_nodes'],
    });
  });

  it('keeps the Card runtime available with a typed missing-server result', async () => {
    const selected = configuration({
      enabledTools: ['graphiti.search_nodes'],
      presentedTools: ['graphiti.search_nodes'],
      pluginTools: [],
      externalMcpTools: [{
        canonicalName: 'graphiti.search_nodes',
        connectionId: 'graphiti',
        nativeName: 'search_nodes',
      }],
    });
    const request = vi.fn(async (method: string) => {
      if (method === 'mcp.servers.list') return { servers: [] };
      if (method === 'profiles.configure') return { ok: true, applied: { mcp_servers: true } };
      throw new Error(`unexpected:${method}`);
    });

    await expect(materializeHermesExternalMcpTools(
      request,
      selected,
      { graphiti: 'mcp_server_not_configured' },
    )).resolves.toEqual({
      'graphiti.search_nodes': 'mcp_server_not_configured',
    });
    expect(request).toHaveBeenCalledWith('profiles.configure', {
      name: 'builder',
      enabled_mcp_servers: [],
    });
  });
});
