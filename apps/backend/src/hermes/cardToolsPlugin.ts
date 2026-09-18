import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  access,
  copyFile,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import type { AgentCardInstance } from '../types';
import { requestPythonRailsJson } from '../services/autogen/pythonRailsClient';
import { readPythonAgentMcpCatalog } from '../services/mcp/pythonAgentMcpClient';
import { withoutInternalMcpSecret } from '../services/mcp/internalMcpAuth';
import { resolveRepoRoot } from '../services/workspaceRoot';
import type { AgentTerminalOwner } from './agentTerminal';

export const HERMES_CARD_TOOLS_PLUGIN_KEY = 'card-tools';
export const HERMES_CARD_TOOLS_TOOLSET = 'card-tools';

const SOURCE_FILES = ['__init__.py', 'plugin.yaml'] as const;
const MAX_CLI_OUTPUT_BYTES = 16_384;

export type HermesCliRunOptions = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  windowsHide: boolean;
};

export type HermesCliRunner = (
  executable: string,
  args: string[],
  options: HermesCliRunOptions,
) => Promise<void>;

export const runHermesCli: HermesCliRunner = async (executable, args, options) => {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: options.windowsHide,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const capture = (chunk: Buffer | string) => {
      output = `${output}${String(chunk)}`.slice(-MAX_CLI_OUTPUT_BYTES);
    };
    child.stdout?.on('data', capture);
    child.stderr?.on('data', capture);
    child.once('error', () => reject(new Error('hermes_card_tools_plugin_enable_spawn_failed')));
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`hermes_card_tools_plugin_enable_failed:${code ?? 'signal'}:${output.trim()}`));
    });
  });
};

export type HermesCardPluginTool = {
  canonicalName: string;
  hermesName: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type HermesCardExternalMcpTool = {
  canonicalName: string;
  connectionId: string;
  nativeName: string;
};

export type HermesCardTools = {
  projectId: string;
  deckId: string;
  cardId: string;
  cardRevisionId: string;
  cardRevisionSha256: string;
  runtime: { kind: 'hermes'; mode: 'main' | 'delegate' | 'kanban'; profile: string };
  enabledTools: string[];
  unavailableTools: string[];
  unavailableToolReasons: Record<string, string>;
  presentedTools: string[];
  nativeTools: string[];
  toolsets: string[];
  mcpConnectionIds: string[];
  pluginTools: HermesCardPluginTool[];
  externalMcpTools: HermesCardExternalMcpTool[];
  configurationFingerprint: string;
};

type MaterializeOptions = {
  repoRoot?: string;
  env?: NodeJS.ProcessEnv;
  runCli?: HermesCliRunner;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function strings(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    return null;
  }
  return value.map((item) => item.trim());
}

function requireCardTools(value: unknown, owner: AgentTerminalOwner, card: AgentCardInstance): HermesCardTools {
  const body = record(value);
  const runtime = record(body.runtime);
  const rawPluginTools = Array.isArray(body.pluginTools) ? body.pluginTools : null;
  const rawExternalMcpTools = Array.isArray(body.externalMcpTools) ? body.externalMcpTools : null;
  const unavailableToolReasons = record(body.unavailableToolReasons);
  const listFields = {
    enabledTools: strings(body.enabledTools),
    unavailableTools: strings(body.unavailableTools),
    presentedTools: strings(body.presentedTools),
    nativeTools: strings(body.nativeTools),
    toolsets: strings(body.toolsets),
    mcpConnectionIds: strings(body.mcpConnectionIds),
  };
  if (
    body.ok !== true
    || body.projectId !== owner.projectId
    || body.deckId !== owner.deckId
    || body.cardId !== owner.cardId
    || body.cardRevisionId !== card._cardRevisionId
    || body.cardRevisionSha256 !== card._cardRevisionSha256
    || runtime.kind !== 'hermes'
    || runtime.profile !== (card.runtime.kind === 'hermes' ? card.runtime.profile : '')
    || !['main', 'delegate', 'kanban'].includes(String(runtime.mode || ''))
    || !/^[a-f0-9]{64}$/.test(String(body.configurationFingerprint || ''))
    || !rawPluginTools
    || !rawExternalMcpTools
    || Object.values(listFields).some((item) => item === null)
  ) throw new Error('hermes_card_tools_authority_response_invalid');
  const pluginTools = rawPluginTools.map((value): HermesCardPluginTool => {
    const tool = record(value);
    const canonicalName = String(tool.canonicalName || '').trim();
    const hermesName = String(tool.hermesName || '').trim();
    const description = typeof tool.description === 'string' ? tool.description : '';
    const inputSchema = tool.inputSchema && typeof tool.inputSchema === 'object' && !Array.isArray(tool.inputSchema)
      ? tool.inputSchema as Record<string, unknown>
      : null;
    if (
      !canonicalName
      || !/^[A-Za-z0-9_]{1,64}$/.test(hermesName)
      || !inputSchema
    ) throw new Error('hermes_card_tools_authority_response_invalid');
    return { canonicalName, hermesName, description, inputSchema };
  });
  const externalMcpTools = rawExternalMcpTools.map((value): HermesCardExternalMcpTool => {
    const tool = record(value);
    const canonicalName = String(tool.canonicalName || '').trim();
    const connectionId = String(tool.connectionId || '').trim();
    const nativeName = String(tool.nativeName || '').trim();
    if (!canonicalName || !connectionId || !nativeName) {
      throw new Error('hermes_card_tools_authority_response_invalid');
    }
    return { canonicalName, connectionId, nativeName };
  });
  const unavailableReasonEntries = Object.entries(unavailableToolReasons);
  if (
    new Set(pluginTools.map((tool) => tool.canonicalName)).size !== pluginTools.length
    || new Set(pluginTools.map((tool) => tool.hermesName)).size !== pluginTools.length
    || new Set(externalMcpTools.map((tool) => tool.canonicalName)).size !== externalMcpTools.length
    || new Set(externalMcpTools.map((tool) => `${tool.connectionId}\0${tool.nativeName}`)).size
      !== externalMcpTools.length
    || unavailableReasonEntries.some(([name, reason]) => (
      !listFields.unavailableTools!.includes(name) || typeof reason !== 'string' || !reason.trim()
    ))
    || unavailableReasonEntries.length !== listFields.unavailableTools!.length
    || JSON.stringify([
      ...pluginTools.map((tool) => tool.canonicalName),
      ...externalMcpTools.map((tool) => tool.canonicalName),
    ].sort()) !== JSON.stringify([...listFields.presentedTools!].sort())
  ) throw new Error('hermes_card_tools_authority_response_invalid');
  return {
    projectId: owner.projectId,
    deckId: owner.deckId,
    cardId: owner.cardId,
    cardRevisionId: String(body.cardRevisionId),
    cardRevisionSha256: String(body.cardRevisionSha256),
    runtime: runtime as HermesCardTools['runtime'],
    enabledTools: listFields.enabledTools!,
    unavailableTools: listFields.unavailableTools!,
    unavailableToolReasons: Object.fromEntries(
      unavailableReasonEntries.map(([name, reason]) => [name, String(reason)]),
    ),
    presentedTools: listFields.presentedTools!,
    nativeTools: listFields.nativeTools!,
    toolsets: listFields.toolsets!,
    mcpConnectionIds: listFields.mcpConnectionIds!,
    pluginTools,
    externalMcpTools,
    configurationFingerprint: String(body.configurationFingerprint),
  };
}

export async function resolveHermesCardTools(
  owner: AgentTerminalOwner,
  card: AgentCardInstance,
): Promise<HermesCardTools> {
  if (card.runtime.kind !== 'hermes') throw new Error('hermes_card_tools_runtime_required');
  const externalToolCatalog = await readPythonAgentMcpCatalog();
  const externalOwnerTools = externalToolCatalog.tools.filter((value) => {
    const tool = record(value);
    return tool.connectionKind === 'external-mcp'
      && tool.sourceId !== 'main_mcp'
      && tool.sourceId !== 'python_runtime';
  });
  const resolved = await requestPythonRailsJson('/domain/hermes-card-tools/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: owner.projectId,
      deckId: owner.deckId,
      cardId: owner.cardId,
      cardRevisionId: card._cardRevisionId,
      // Internal plugin definitions come directly from Python's canonical
      // operation registry. Only independently owned MCP contracts are supplied
      // here for external-connection availability and native-name resolution.
      discoveredTools: externalOwnerTools,
      discoveredToolCatalogState: externalToolCatalog.state,
    }),
  });
  return requireCardTools(resolved, owner, card);
}

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (
    relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

async function requireDirectory(target: string, error: string): Promise<string> {
  try {
    const info = await lstat(target);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(error);
    return realpath(target);
  } catch {
    throw new Error(error);
  }
}

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function runtimeHashes(root: string): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  for (const name of [...SOURCE_FILES, 'tools.json']) {
    const file = path.join(root, name);
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`hermes_card_tools_file_invalid:${name}`);
    result.set(name, sha256(await readFile(file)));
  }
  return result;
}

async function verifyRuntime(root: string, expected: Map<string, string>): Promise<void> {
  const actual = await runtimeHashes(root);
  for (const [name, digest] of expected) {
    if (actual.get(name) !== digest) throw new Error(`hermes_card_tools_readback_mismatch:${name}`);
  }
}

export async function materializeHermesCardToolsPlugin(
  profileHome: string,
  configuration: HermesCardTools,
  options: MaterializeOptions = {},
): Promise<void> {
  const repoRoot = await requireDirectory(
    path.resolve(options.repoRoot ?? resolveRepoRoot()),
    'hermes_card_tools_repo_root_invalid',
  );
  const sourceRoot = await requireDirectory(
    path.join(repoRoot, 'packages', 'hermes-card-tools'),
    'hermes_card_tools_source_missing',
  );
  if (!inside(repoRoot, sourceRoot)) throw new Error('hermes_card_tools_source_invalid');
  const resolvedProfileHome = await requireDirectory(
    path.resolve(profileHome),
    'hermes_card_tools_profile_home_invalid',
  );
  try {
    if (!(await stat(path.join(resolvedProfileHome, 'config.yaml'))).isFile()) throw new Error();
  } catch {
    throw new Error('hermes_card_tools_profile_not_prepared');
  }
  const hermesRoot = path.join(repoRoot, 'Hermes');
  const executable = path.join(hermesRoot, 'venv', 'Scripts', 'python.exe');
  await access(executable).catch(() => { throw new Error('hermes_card_tools_cli_missing'); });
  const pluginsRoot = path.join(resolvedProfileHome, 'plugins');
  await mkdir(pluginsRoot, { recursive: true });
  const resolvedPluginsRoot = await realpath(pluginsRoot);
  if (!inside(resolvedProfileHome, resolvedPluginsRoot)) {
    throw new Error('hermes_card_tools_destination_outside_profile');
  }
  const destination = path.join(resolvedPluginsRoot, HERMES_CARD_TOOLS_PLUGIN_KEY);
  if (!inside(resolvedPluginsRoot, destination)) {
    throw new Error('hermes_card_tools_destination_outside_profile');
  }
  try {
    const info = await lstat(destination);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error('hermes_card_tools_destination_invalid');
    }
    if (!inside(resolvedPluginsRoot, await realpath(destination))) {
      throw new Error('hermes_card_tools_destination_outside_profile');
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('hermes_card_tools_')) throw error;
  }
  const stage = path.join(
    resolvedPluginsRoot,
    `.${HERMES_CARD_TOOLS_PLUGIN_KEY}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`,
  );
  try {
    await mkdir(stage, { recursive: false });
    for (const name of SOURCE_FILES) await copyFile(path.join(sourceRoot, name), path.join(stage, name));
    await writeFile(
      path.join(stage, 'tools.json'),
      `${JSON.stringify({ tools: configuration.pluginTools }, null, 2)}\n`,
      'utf8',
    );
    const expected = await runtimeHashes(stage);
    await rm(destination, { recursive: true, force: true });
    await rename(stage, destination);
    await verifyRuntime(destination, expected);
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
  await (options.runCli ?? runHermesCli)(
    executable,
    ['-m', 'hermes_cli.main', 'plugins', 'enable', HERMES_CARD_TOOLS_PLUGIN_KEY, '--no-allow-tool-override'],
    {
      cwd: hermesRoot,
      env: {
        ...withoutInternalMcpSecret(options.env ?? process.env),
        HERMES_HOME: resolvedProfileHome,
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
      },
      windowsHide: true,
    },
  );
}

export function requireLoadedHermesCardToolsPlugin(value: unknown): void {
  const plugins = record(value).plugins;
  if (!Array.isArray(plugins)) throw new Error('hermes_card_tools_plugin_list_invalid');
  const matches = plugins.filter((item) => record(item).name === HERMES_CARD_TOOLS_PLUGIN_KEY);
  if (matches.length !== 1 || record(matches[0]).enabled !== true) {
    throw new Error('hermes_card_tools_plugin_not_loaded');
  }
}

type HermesGatewayRequest = (
  method: string,
  params: Record<string, unknown>,
) => Promise<unknown>;

function sameStrings(left: Iterable<string>, right: Iterable<string>): boolean {
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Apply Python-resolved external MCP tools through stock Hermes profile and
 * tool configuration calls. This function does not decide authority: every
 * allowed {connectionId, nativeName} pair already came from the saved Card.
 */
export async function materializeHermesExternalMcpTools(
  request: HermesGatewayRequest,
  configuration: HermesCardTools,
  unavailableMcpServerReasons: Record<string, string> = {},
): Promise<Record<string, string>> {
  const byConnection = new Map<string, HermesCardExternalMcpTool[]>();
  for (const tool of configuration.externalMcpTools) {
    const tools = byConnection.get(tool.connectionId) || [];
    tools.push(tool);
    byConnection.set(tool.connectionId, tools);
  }
  if (!byConnection.size) return {};

  const unavailable: Record<string, string> = {};
  const markConnection = (connectionId: string, reason: string) => {
    for (const tool of byConnection.get(connectionId) || []) {
      unavailable[tool.canonicalName] = reason;
    }
  };
  const listed = record(await request('mcp.servers.list', {}));
  if (!Array.isArray(listed.servers)) throw new Error('hermes_native_mcp_server_list_invalid');
  const configured = new Map<string, Record<string, unknown>>();
  for (const value of listed.servers) {
    const server = record(value);
    const name = String(server.name || '').trim();
    if (!name || configured.has(name)) throw new Error('hermes_native_mcp_server_list_invalid');
    configured.set(name, server);
  }

  const usableConnections: string[] = [];
  for (const [connectionId, grantedTools] of byConnection) {
    const profileReason = unavailableMcpServerReasons[connectionId];
    const server = configured.get(connectionId);
    if (profileReason || !server) {
      markConnection(connectionId, profileReason || 'mcp_server_not_configured');
      continue;
    }
    if (server.auth === 'oauth' && server.oauth_tokens_present !== true) {
      markConnection(connectionId, 'mcp_credentials_not_configured');
      continue;
    }

    const tested = record(await request('mcp.servers.test', { name: connectionId }));
    if (tested.ok !== true) {
      markConnection(
        connectionId,
        tested.oauth_needed === true && tested.oauth_tokens_present !== true
          ? 'mcp_credentials_not_configured'
          : 'mcp_server_unavailable',
      );
      continue;
    }
    const testedTools = Array.isArray(tested.tools) ? tested.tools : [];
    const publishedNames: string[] = [];
    for (const value of testedTools) {
      const name = String(record(value).name || '').trim();
      if (!name || publishedNames.includes(name)) {
        throw new Error(`hermes_native_mcp_tool_list_invalid:${connectionId}`);
      }
      publishedNames.push(name);
    }
    const grantedNames = [...new Set(grantedTools.map((tool) => tool.nativeName))];
    const published = new Set(publishedNames);
    for (const tool of grantedTools) {
      if (!published.has(tool.nativeName)) {
        unavailable[tool.canonicalName] = 'mcp_tool_not_published';
      }
    }

    const toolsConfig = record(server.tools);
    const utilitySurfacePresent = (
      (Number(tested.prompts || 0) > 0 && toolsConfig.prompts !== false)
      || (Number(tested.resources || 0) > 0 && toolsConfig.resources !== false)
    );
    const hasInclude = Object.prototype.hasOwnProperty.call(toolsConfig, 'include');
    const include = hasInclude && Array.isArray(toolsConfig.include)
      ? toolsConfig.include.map((name) => String(name || '').trim()).filter(Boolean)
      : [];
    const includeRepresentable = !hasInclude || (
      Array.isArray(toolsConfig.include)
      && sameStrings(include, grantedNames)
    );
    const namesRepresentable = !connectionId.includes(':')
      && [...publishedNames, ...grantedNames].every((name) => !name.includes(':'));
    if (utilitySurfacePresent || !includeRepresentable || !namesRepresentable) {
      markConnection(connectionId, 'mcp_tool_filter_not_materializable');
      continue;
    }

    if (!hasInclude) {
      const ungrantedNames = publishedNames.filter((name) => !grantedNames.includes(name));
      for (const [action, names] of [
        ['disable', ungrantedNames],
        ['enable', grantedNames],
      ] as const) {
        if (!names.length) continue;
        const configuredTools = record(await request('tools.configure', {
          action,
          names: names.map((name) => `${connectionId}:${name}`),
        }));
        const missingServers = Array.isArray(configuredTools.missing_servers)
          ? configuredTools.missing_servers.map(String)
          : [];
        if (missingServers.includes(connectionId)) {
          markConnection(connectionId, 'mcp_server_not_configured');
          break;
        }
      }
      if (grantedTools.every((tool) => unavailable[tool.canonicalName])) continue;
    }
    usableConnections.push(connectionId);
  }

  if (!sameStrings(usableConnections, byConnection.keys())) {
    const applied = record(await request('profiles.configure', {
      name: configuration.runtime.profile,
      enabled_mcp_servers: usableConnections,
    }));
    if (applied.ok !== true || record(applied.applied).mcp_servers !== true) {
      throw new Error(`hermes_native_mcp_servers_apply_failed:${configuration.runtime.profile}`);
    }
  }
  return unavailable;
}

export function requireHermesCardToolsReadback(
  value: unknown,
  configuration: HermesCardTools,
  unavailableNativeToolReasons: Record<string, 'native_exact_filter_unavailable'> = {},
  unavailableRuntimeToolReasons: Record<string, string> = {},
): Record<string, string> {
  const sections = record(value).sections;
  if (!Array.isArray(sections)) throw new Error('hermes_card_tools_readback_invalid');
  const exposed = sections.flatMap((section) => {
    const tools = record(section).tools;
    return Array.isArray(tools)
      ? tools.map((tool) => String(record(tool).name || '').trim()).filter(Boolean)
      : [];
  });
  const cardSection = sections.filter(
    (section) => record(section).name === HERMES_CARD_TOOLS_TOOLSET,
  );
  if (cardSection.length > 1) throw new Error('hermes_card_tools_readback_invalid');
  const actualCardTools = cardSection.flatMap((section) => {
    const tools = record(section).tools;
    return Array.isArray(tools)
      ? tools.map((tool) => String(record(tool).name || '').trim()).filter(Boolean)
      : [];
  }).sort();
  const expectedCardTools = configuration.pluginTools.map((tool) => tool.hermesName).sort();
  const expectedCardToolNames = new Set(expectedCardTools);
  const extraCardTools = actualCardTools.filter((name) => !expectedCardToolNames.has(name));
  if (extraCardTools.length) {
    throw new Error(`hermes_card_tools_readback_broadened:${extraCardTools.join(',')}`);
  }
  const unavailableToolReasons: Record<string, string> = {
    ...configuration.unavailableToolReasons,
    ...unavailableNativeToolReasons,
    ...unavailableRuntimeToolReasons,
  };
  const actualCardToolNames = new Set(actualCardTools);
  for (const tool of configuration.pluginTools) {
    if (!actualCardToolNames.has(tool.hermesName)) {
      unavailableToolReasons[tool.canonicalName] = 'internal_plugin_tool_unavailable';
    }
  }
  for (const name of configuration.nativeTools) {
    if (exposed.includes(name)) delete unavailableToolReasons[name];
    else if (!unavailableToolReasons[name]) unavailableToolReasons[name] = 'native_tool_unavailable';
  }

  const selectedConnections = new Set(
    configuration.externalMcpTools.map((tool) => tool.connectionId),
  );
  for (const section of sections) {
    const sectionName = String(record(section).name || '').trim();
    if (sectionName.startsWith('mcp-') && !selectedConnections.has(sectionName.slice(4))) {
      throw new Error(`hermes_external_mcp_readback_broadened:${sectionName.slice(4)}`);
    }
  }
  for (const connectionId of selectedConnections) {
    const actual = sections
      .filter((section) => record(section).name === `mcp-${connectionId}`)
      .flatMap((section) => {
        const tools = record(section).tools;
        return Array.isArray(tools)
          ? tools.map((tool) => String(record(tool).name || '').trim()).filter(Boolean)
          : [];
      });
    const expectedTools = configuration.externalMcpTools
      .filter((tool) => tool.connectionId === connectionId)
      .map((tool) => `mcp__${mcpNameComponent(connectionId)}__${mcpNameComponent(tool.nativeName)}`);
    const expected = new Set(expectedTools);
    const extra = actual.filter((name) => !expected.has(name));
    if (extra.length) {
      throw new Error(`hermes_external_mcp_readback_broadened:${connectionId}`);
    }
    const actualNames = new Set(actual);
    for (const tool of configuration.externalMcpTools.filter(
      (candidate) => candidate.connectionId === connectionId,
    )) {
      const expectedName = `mcp__${mcpNameComponent(connectionId)}__${mcpNameComponent(tool.nativeName)}`;
      if (!actualNames.has(expectedName)) {
        unavailableToolReasons[tool.canonicalName] = 'external_mcp_tool_unavailable';
      }
    }
  }
  return unavailableToolReasons;
}

function mcpNameComponent(value: string): string {
  return value.replace(/[^A-Za-z0-9_]/g, '_');
}
