import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveRepoRoot } from '../coder/workspaceRoot';

type StringMap = Record<string, string>;

export type AcpMcpServer =
  | {
      name: string;
      command: string;
      args: string[];
      env: { name: string; value: string }[];
    }
  | {
      name: string;
      url: string;
      headers: { name: string; value: string }[];
    };

function uniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => String(value || '').trim())
    .filter((value, index, all) => Boolean(value) && all.indexOf(value) === index);
}

function stringMap(value: unknown, connectionId: string, field: string): StringMap {
  if (value == null) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`mcp_connection_invalid: connectionId=${connectionId} field=${field}`);
  }
  const result: StringMap = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== 'string') {
      throw new Error(`mcp_connection_invalid: connectionId=${connectionId} field=${field}.${key}`);
    }
    result[key] = entry;
  }
  return result;
}

function stringArray(value: unknown, connectionId: string, field: string): string[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`mcp_connection_invalid: connectionId=${connectionId} field=${field}`);
  }
  return value.map((entry) => entry as string);
}

function interpolate(
  value: string,
  connectionId: string,
  env: NodeJS.ProcessEnv,
): string {
  return value.replace(/\$\{(?:env:)?([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => {
    const resolved = env[name];
    if (resolved == null || resolved === '') {
      throw new Error(
        `mcp_connection_env_missing: connectionId=${connectionId} variable=${name}`,
      );
    }
    return resolved;
  });
}

function materializeOne(
  connectionId: string,
  raw: unknown,
  env: NodeJS.ProcessEnv,
): AcpMcpServer {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`mcp_connection_invalid: connectionId=${connectionId}`);
  }
  const config = raw as Record<string, unknown>;
  const transport = String(config.transport || '').trim().toLowerCase();
  if (transport === 'stdio') {
    const command = String(config.command || '').trim();
    if (!command) {
      throw new Error(`mcp_connection_invalid: connectionId=${connectionId} field=command`);
    }
    const args = stringArray(config.args, connectionId, 'args')
      .map((entry) => interpolate(entry, connectionId, env));
    const childEnv = stringMap(config.env, connectionId, 'env');
    return {
      name: connectionId,
      command: interpolate(command, connectionId, env),
      args,
      env: Object.entries(childEnv).map(([name, value]) => ({
        name,
        value: interpolate(value, connectionId, env),
      })),
    };
  }
  if (transport === 'http' || transport === 'sse') {
    const url = String(config.url || '').trim();
    if (!url) {
      throw new Error(`mcp_connection_invalid: connectionId=${connectionId} field=url`);
    }
    const headers = stringMap(config.headers, connectionId, 'headers');
    return {
      name: connectionId,
      url: interpolate(url, connectionId, env),
      headers: Object.entries(headers).map(([name, value]) => ({
        name,
        value: interpolate(value, connectionId, env),
      })),
    };
  }
  throw new Error(`mcp_connection_transport_invalid: connectionId=${connectionId}`);
}

export function materializeSavedMcpConnections(
  rawConfig: unknown,
  connectionIds: unknown,
  env: NodeJS.ProcessEnv = process.env,
): AcpMcpServer[] {
  const ids = uniqueStrings(connectionIds);
  if (ids.length === 0) return [];
  if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) {
    throw new Error('mcp_config_invalid');
  }
  const servers = (rawConfig as Record<string, unknown>).mcpServers;
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) {
    throw new Error('mcp_config_invalid: field=mcpServers');
  }
  const byId = servers as Record<string, unknown>;
  return ids.map((connectionId) => {
    if (!(connectionId in byId)) {
      throw new Error(`mcp_connection_not_found: connectionId=${connectionId}`);
    }
    return materializeOne(connectionId, byId[connectionId], env);
  });
}

export function resolveSavedMcpConnections(
  connectionIds: unknown,
  env: NodeJS.ProcessEnv = process.env,
): AcpMcpServer[] {
  const ids = uniqueStrings(connectionIds);
  if (ids.length === 0) return [];
  const configPath = path.join(resolveRepoRoot(), 'apps', 'backend', 'mcp.config.json');
  if (!existsSync(configPath)) throw new Error('mcp_config_file_missing');
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch {
    throw new Error('mcp_config_invalid_json');
  }
  return materializeSavedMcpConnections(parsed, ids, env);
}
