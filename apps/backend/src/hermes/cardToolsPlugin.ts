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
import { requestPythonRailsJson } from '../services/pythonRailsClient';
import { readPythonAgentMcpCatalog } from '../services/mcp/pythonAgentMcpClient';
import type { InternalMcpPrincipal } from '../services/mcp/internalMcpAuth';
import { withoutInternalMcpSecret } from '../services/mcp/internalMcpAuth';
import { resolveRepoRoot } from '../services/workspaceRoot';
import type { AgentTerminalOwner } from './agentTerminal';

export const HERMES_CARD_TOOLS_PLUGIN_KEY = 'card-tools';
export const HERMES_CARD_TOOLS_TOOLSET = 'card-tools';

const MANAGED_SYSTEM_CARD_PROFILES = new Set([
  'liquidaity-main',
  'builder',
  'thinkgraph',
  'knowgraph',
]);
const RETIRED_SYSTEM_CARD_PLUGIN_KEYS = ['card-bot-dm', 'liquidaity-card-mcp'] as const;
const RETIRED_SYSTEM_CARD_PLUGIN_DIRECTORY = 'card-bot-dm';

// Retired plugin state is reconciled through Hermes' config owner. Do not
// parse or rewrite config.yaml in TypeScript: load_config/save_config preserve
// every unrelated profile value and their native schema/version behavior.
export const HERMES_RETIRED_SYSTEM_CARD_PLUGINS_SCRIPT = [
  'from hermes_cli.config import load_config, save_config',
  `retired = ${JSON.stringify([...RETIRED_SYSTEM_CARD_PLUGIN_KEYS])}`,
  `replacement = ${JSON.stringify(HERMES_CARD_TOOLS_PLUGIN_KEY)}`,
  'cfg = load_config() or {}',
  'raw_plugins = cfg.get("plugins")',
  'if not isinstance(raw_plugins, dict):',
  '    raise SystemExit(3)',
  'plugins = dict(raw_plugins)',
  'raw_enabled = plugins.get("enabled")',
  'raw_disabled = plugins.get("disabled")',
  'raw_entries = plugins.get("entries")',
  'if not isinstance(raw_enabled, list) or any(not isinstance(item, str) for item in raw_enabled):',
  '    raise SystemExit(3)',
  'if raw_disabled is not None and (not isinstance(raw_disabled, list) or any(not isinstance(item, str) for item in raw_disabled)):',
  '    raise SystemExit(3)',
  'if raw_entries is not None and not isinstance(raw_entries, dict):',
  '    raise SystemExit(3)',
  'enabled = list(raw_enabled)',
  'disabled = list(raw_disabled or [])',
  'entries = dict(raw_entries or {})',
  'if replacement not in enabled:',
  '    raise SystemExit(4)',
  'next_enabled = [name for name in enabled if name not in retired]',
  'next_disabled = [name for name in disabled if name not in retired]',
  'next_entries = {name: value for name, value in entries.items() if name not in retired}',
  'changed = False',
  'if next_enabled != enabled:',
  '    plugins["enabled"] = next_enabled',
  '    changed = True',
  'if next_disabled != disabled:',
  '    plugins["disabled"] = next_disabled',
  '    changed = True',
  'if next_entries != entries:',
  '    plugins["entries"] = next_entries',
  '    changed = True',
  'if changed:',
  '    cfg["plugins"] = plugins',
  '    save_config(cfg)',
  'readback = load_config() or {}',
  'actual_plugins = readback.get("plugins")',
  'if not isinstance(actual_plugins, dict):',
  '    raise SystemExit(5)',
  'actual_enabled = actual_plugins.get("enabled")',
  'actual_disabled = actual_plugins.get("disabled") or []',
  'actual_entries = actual_plugins.get("entries") or {}',
  'if (not isinstance(actual_enabled, list) or not isinstance(actual_disabled, list)',
  '        or not isinstance(actual_entries, dict) or replacement not in actual_enabled',
  '        or replacement in actual_disabled or replacement not in actual_entries):',
  '    raise SystemExit(6)',
  'if (any(name in actual_enabled for name in retired)',
  '        or any(name in actual_disabled for name in retired)',
  '        or any(name in actual_entries for name in retired)):',
  '    raise SystemExit(7)',
].join('\n');

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
  runtime: { kind: 'hermes'; mode: 'main' | 'delegate' | 'kanban' | 'magentic_one'; profile: string };
  enabledTools: string[];
  unavailableTools: string[];
  unavailableToolReasons: Record<string, string>;
  presentedTools: string[];
  nativeTools: string[];
  toolsets: string[];
  mcpConnectionIds: string[];
  pluginTools: HermesCardPluginTool[];
  externalMcpTools: HermesCardExternalMcpTool[];
  externalToolCatalogState: 'available' | 'unavailable';
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

function requireCardTools(
  value: unknown,
  owner: AgentTerminalOwner,
  card: AgentCardInstance,
  externalToolCatalogState: HermesCardTools['externalToolCatalogState'],
): HermesCardTools {
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
    || !['main', 'delegate', 'kanban', 'magentic_one'].includes(String(runtime.mode || ''))
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
    externalToolCatalogState,
    configurationFingerprint: String(body.configurationFingerprint),
  };
}

export async function resolveHermesCardTools(
  owner: AgentTerminalOwner,
  card: AgentCardInstance,
  options: { externalCatalogPrincipal?: InternalMcpPrincipal } = {},
): Promise<HermesCardTools> {
  if (card.runtime.kind !== 'hermes') throw new Error('hermes_card_tools_runtime_required');
  // Merely opening a persistent Card session has no Run-scoped authority and
  // must not touch an external catalog. The authorized pre-turn seam supplies
  // the exact Card-runtime principal when external tools may be discovered.
  const externalToolCatalog = options.externalCatalogPrincipal
    ? await readPythonAgentMcpCatalog(options.externalCatalogPrincipal)
    : {
        state: 'unavailable' as const,
        tools: [],
        unavailableFamilies: [],
        reason: 'catalog_unavailable' as const,
      };
  const externalOwnerTools = externalToolCatalog.tools.filter((value) => {
    const tool = record(value);
    return tool.connectionKind === 'external-mcp'
      && tool.sourceId !== 'main_mcp'
      && tool.sourceId !== 'python_runtime';
  }).map((tool) => ({
    ...tool,
    // Hermes connects to the application-owned aggregate MCP endpoint.  Its
    // callable transport name is the canonical published name; source-native
    // names remain catalog provenance and are not callable on that endpoint.
    nativeName: tool.name,
  }));
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
      unavailableToolCatalogFamilies: externalToolCatalog.unavailableFamilies,
    }),
  });
  return requireCardTools(resolved, owner, card, externalToolCatalog.state);
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

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

async function retireContainedLegacyPluginDirectory(pluginsRoot: string): Promise<void> {
  const target = path.join(pluginsRoot, RETIRED_SYSTEM_CARD_PLUGIN_DIRECTORY);
  if (!inside(pluginsRoot, target)) throw new Error('hermes_retired_plugin_destination_outside_profile');
  let info;
  try {
    info = await lstat(target);
  } catch (error) {
    if (isMissingFileError(error)) return;
    throw new Error('hermes_retired_plugin_destination_unreadable');
  }
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error('hermes_retired_plugin_destination_invalid');
  }
  const resolvedTarget = await realpath(target);
  if (!inside(pluginsRoot, resolvedTarget)) {
    throw new Error('hermes_retired_plugin_destination_outside_profile');
  }
  await rm(target, { recursive: true, force: false });
  try {
    await lstat(target);
  } catch (error) {
    if (isMissingFileError(error)) return;
    throw new Error('hermes_retired_plugin_retirement_readback_failed');
  }
  throw new Error('hermes_retired_plugin_retirement_readback_failed');
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
  const profile = String(configuration.runtime.profile || '').trim();
  if (
    MANAGED_SYSTEM_CARD_PROFILES.has(profile)
    && path.basename(resolvedProfileHome).toLowerCase() !== profile
  ) {
    throw new Error(`hermes_retired_plugin_profile_home_mismatch:${profile}`);
  }
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

  if (MANAGED_SYSTEM_CARD_PROFILES.has(profile)) {
    // Reconcile only after the replacement files were hashed/read back and
    // Hermes successfully enabled card-tools. The script itself rereads the
    // native config and refuses to retire anything if that replacement is not
    // still enabled.
    await (options.runCli ?? runHermesCli)(
      executable,
      ['-X', 'utf8', '-c', HERMES_RETIRED_SYSTEM_CARD_PLUGINS_SCRIPT],
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
    await retireContainedLegacyPluginDirectory(resolvedPluginsRoot);
  }
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

export type HermesApplicationMcpServerSpec = {
  type: 'http';
  url: string;
  headers: Record<string, string>;
};

function sameStrings(left: Iterable<string>, right: Iterable<string>): boolean {
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Ensure each selected external owner is a profile-scoped view of the one
 * application MCP host. The signed credential is renewed for the staged Card
 * Run; each connection's persisted include list remains the exact saved grant.
 */
export async function materializeHermesApplicationMcpServers(
  request: HermesGatewayRequest,
  configuration: HermesCardTools,
  serverSpec: HermesApplicationMcpServerSpec,
): Promise<void> {
  const byConnection = new Map<string, string[]>();
  for (const tool of configuration.externalMcpTools) {
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(tool.connectionId)) {
      throw new Error(`hermes_application_mcp_connection_invalid:${tool.connectionId}`);
    }
    const names = byConnection.get(tool.connectionId) || [];
    names.push(tool.nativeName);
    byConnection.set(tool.connectionId, names);
  }
  if (!byConnection.size) return;

  const parsedUrl = new URL(serverSpec.url);
  if (
    serverSpec.type !== 'http'
    || parsedUrl.protocol !== 'http:'
    || !['127.0.0.1', 'localhost'].includes(parsedUrl.hostname)
    || parsedUrl.pathname !== '/mcp'
  ) {
    throw new Error('hermes_application_mcp_server_spec_invalid');
  }
  const authorization = Object.entries(serverSpec.headers).find(
    ([name]) => name.toLowerCase() === 'authorization',
  )?.[1];
  const bearer = /^Bearer\s+(\S+)$/i.exec(String(authorization || '').trim())?.[1];
  if (!bearer) throw new Error('hermes_application_mcp_bearer_missing');

  const listed = record(await request('mcp.servers.list', {}));
  if (!Array.isArray(listed.servers)) throw new Error('hermes_native_mcp_server_list_invalid');
  const configured = new Map<string, Record<string, unknown>>();
  for (const value of listed.servers) {
    const server = record(value);
    const name = String(server.name || '').trim();
    if (!name || configured.has(name)) throw new Error('hermes_native_mcp_server_list_invalid');
    configured.set(name, server);
  }

  for (const [connectionId, names] of byConnection) {
    const include = [...new Set(names)].sort();
    const existing = configured.get(connectionId);
    if (existing) {
      let existingUrl = '';
      try {
        existingUrl = new URL(String(existing.url || '')).toString();
      } catch {}
      if (existing.transport !== 'http' || existingUrl !== parsedUrl.toString()) {
        throw new Error(`hermes_application_mcp_server_conflict:${connectionId}`);
      }
      const tools = record(existing.tools);
      if (
        Object.prototype.hasOwnProperty.call(tools, 'include')
        && (!Array.isArray(tools.include) || !sameStrings(tools.include.map(String), include))
      ) {
        throw new Error(`hermes_application_mcp_filter_conflict:${connectionId}`);
      }
      const updated = record(await request('mcp.servers.set_api_key', {
        name: connectionId,
        value: bearer,
      }));
      if (updated.ok !== true || updated.name !== connectionId) {
        throw new Error(`hermes_application_mcp_credential_apply_failed:${connectionId}`);
      }
      continue;
    }

    const added = record(await request('mcp.servers.add', {
      name: connectionId,
      config: {
        url: parsedUrl.toString(),
        tools: { include, prompts: false, resources: false },
      },
      bearer_token: bearer,
    }));
    if (added.ok !== true || added.name !== connectionId) {
      throw new Error(`hermes_application_mcp_server_add_failed:${connectionId}`);
    }
  }
}

/** Remove the transient Run-scoped external MCP definitions after the turn. */
export async function removeHermesApplicationMcpServers(
  request: HermesGatewayRequest,
  configuration: HermesCardTools,
): Promise<void> {
  const connectionIds = [...new Set(
    configuration.externalMcpTools.map((tool) => tool.connectionId),
  )].sort();
  if (!connectionIds.length) return;

  const listed = record(await request('mcp.servers.list', {}));
  if (!Array.isArray(listed.servers)) throw new Error('hermes_native_mcp_server_list_invalid');
  const configured = new Set(listed.servers.map((value) => String(record(value).name || '').trim()));
  for (const name of connectionIds) {
    if (!configured.has(name)) continue;
    const removed = record(await request('mcp.servers.remove', {
      profile: configuration.runtime.profile,
      name,
    }));
    if (removed.ok !== true || removed.removed !== true) {
      throw new Error(`hermes_application_mcp_server_remove_failed:${name}`);
    }
  }
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
