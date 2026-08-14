import { describe, expect, it } from 'vitest';
import { materializeSavedMcpConnections } from './mcpConnections';

describe('saved Hermes MCP connection materialization', () => {
  it('materializes only referenced connections and resolves injected environment values once', () => {
    const result = materializeSavedMcpConnections(
      {
        mcpServers: {
          selected: {
            transport: 'sse',
            url: '${MCP_URL}',
            headers: { Authorization: 'Bearer ${MCP_TOKEN}' },
          },
          ignored: {
            transport: 'http',
            url: 'https://ignored.invalid/mcp',
            headers: {},
          },
        },
      },
      ['selected'],
      { MCP_URL: 'https://selected.invalid/mcp', MCP_TOKEN: 'secret-value' },
    );

    expect(result).toEqual([{
      name: 'selected',
      url: 'https://selected.invalid/mcp',
      headers: [{ name: 'Authorization', value: 'Bearer secret-value' }],
    }]);
  });

  it('materializes stdio command, arguments, and child environment', () => {
    expect(materializeSavedMcpConnections(
      {
        mcpServers: {
          local: {
            transport: 'stdio',
            command: '${PYTHON_BIN}',
            args: ['-m', 'example_server'],
            env: { SERVICE_TOKEN: '${SERVICE_TOKEN}' },
          },
        },
      },
      ['local'],
      { PYTHON_BIN: 'python', SERVICE_TOKEN: 'secret-value' },
    )).toEqual([{
      name: 'local',
      command: 'python',
      args: ['-m', 'example_server'],
      env: [{ name: 'SERVICE_TOKEN', value: 'secret-value' }],
    }]);
  });

  it('names a missing variable without exposing any other secret value', () => {
    const secret = 'must-not-leak';
    expect(() => materializeSavedMcpConnections(
      {
        mcpServers: {
          selected: {
            transport: 'http',
            url: '${MCP_URL}',
            headers: { Authorization: 'Bearer ${MCP_TOKEN}' },
          },
        },
      },
      ['selected'],
      { MCP_TOKEN: secret },
    )).toThrow('mcp_connection_env_missing: connectionId=selected variable=MCP_URL');
    try {
      materializeSavedMcpConnections(
        {
          mcpServers: {
            selected: {
              transport: 'http',
              url: '${MCP_URL}',
              headers: { Authorization: 'Bearer ${MCP_TOKEN}' },
            },
          },
        },
        ['selected'],
        { MCP_TOKEN: secret },
      );
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });

  it('fails specifically for an unknown saved connection id', () => {
    expect(() => materializeSavedMcpConnections(
      { mcpServers: {} },
      ['missing'],
      {},
    )).toThrow('mcp_connection_not_found: connectionId=missing');
  });
});
