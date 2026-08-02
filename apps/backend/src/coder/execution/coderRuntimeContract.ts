import { readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveRepoRoot } from '../workspaceRoot';
import {
  resolvePythonAgentMcpServerSpec,
  type PythonMcpToolDescriptor,
} from '../../services/mcp/pythonAgentMcpClient';
import {
  coderReportSchema,
  coderAuditResultSchema,
  type CoderReport,
  type CoderAuditResult,
} from '../../contracts/coderContracts';

/**
 * Shared Coder-runtime contract (dossier §3.3/§3.4). The CALLER supplies
 * authority; it is NEVER inferred from prompt text — the CLI args are the
 * security boundary, not the prompt. Two explicit modes:
 *  - direct_main_audit  : Main's read-only code audit. Native reads + CodeGraph
 *                         only; no file edits, no mutating shell.
 *  - mag_one_execution  : approved implementation. Edit/Write/shell/tests.
 *
 * This module is the single source for tool/permission construction and MCP
 * composition for the live console session in one place.
 */
export type CoderAuthorityMode = 'direct_main_audit' | 'mag_one_execution';

export type EffectiveCoderTool = {
  canonicalName: string;
  runtimeName: string | null;
  displayName: string;
  description: string;
  source: 'openclaude_native' | 'codebase_memory' | 'liquidaity_mcp' | 'runtime_control' | 'saved_unavailable';
  group: 'Native' | 'Codebase Memory' | 'Engraphis' | 'Other MCP' | 'Runtime controls' | 'Unavailable';
  risk: 'read' | 'write' | 'shell' | 'network' | 'paid' | 'control';
  saved: boolean;
  enabled: boolean;
  callable: boolean;
  reason: string;
};

export type EffectiveCoderToolSnapshot = {
  authority: CoderAuthorityMode;
  permissionMode: ConsolePermissionMode;
  allowsShell: boolean;
  allowsWrite: boolean;
  allowsNetwork: boolean;
  hasPaidTools: boolean;
  unresolved: string[];
  nativeTools: string[];
  allowedTools: string[];
  disallowedTools: string[];
  mcpServers: Record<string, McpServerSpec>;
  tools: EffectiveCoderTool[];
  counts: { saved: number; enabled: number; callable: number; unavailable: number };
};

const OPENCLAUDE_NATIVE_TOOL_CONTRACT = [
  'Read', 'Grep', 'Glob', 'Edit', 'Write', 'NotebookEdit', 'Bash', 'PowerShell',
  'WebFetch', 'WebSearch', 'Agent', 'Skill', 'TaskCreate', 'TaskGet', 'TaskList',
  'TaskOutput', 'TaskStop', 'TaskUpdate', 'ToolSearch',
] as const;

function normalizeMcpName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function runtimeMcpName(server: string, tool: string): string {
  return `mcp__${normalizeMcpName(server)}__${normalizeMcpName(tool)}`;
}

function nativeRisk(name: string): EffectiveCoderTool['risk'] {
  if (['Edit', 'Write', 'NotebookEdit'].includes(name)) return 'write';
  if (['Bash', 'PowerShell'].includes(name)) return 'shell';
  if (['WebFetch', 'WebSearch'].includes(name)) return 'network';
  return name.startsWith('Task') || name === 'Agent' ? 'control' : 'read';
}

/** Resolve one immutable, complete view of the tools a Coder run may actually
 * invoke. The live Python MCP catalog remains catalog authority; this function
 * only combines it with saved grants and the checked-in OpenClaude contract. */
export function resolveEffectiveCoderToolSnapshot(opts: {
  authority: CoderAuthorityMode;
  savedTools: string[];
  catalog: PythonMcpToolDescriptor[];
  runId: string;
}): EffectiveCoderToolSnapshot {
  const policy = resolveCoderToolPolicy(opts.authority);
  const saved = [...new Set(opts.savedTools.map((name) => String(name).trim()).filter(Boolean))];
  const catalog = new Map(opts.catalog.map((tool) => [tool.name, tool]));
  const enabledNative = new Set(policy.allowedTools.filter((name) => !name.startsWith('mcp__')));
  const tools: EffectiveCoderTool[] = OPENCLAUDE_NATIVE_TOOL_CONTRACT.map((name) => ({
    canonicalName: name,
    runtimeName: name,
    displayName: name,
    description: 'OpenClaude native tool.',
    source: 'openclaude_native',
    group: 'Native',
    risk: nativeRisk(name),
    saved: false,
    enabled: enabledNative.has(name),
    callable: enabledNative.has(name),
    reason: enabledNative.has(name) ? `Allowed by ${opts.authority}.` : `Denied by ${opts.authority}.`,
  }));
  const unresolved: string[] = [];
  const selectedMcpRuntimeNames: string[] = [];
  let needsLiquidaity = false;
  let needsCodeGraph = policy.codeGraphMcp;

  for (const canonicalName of saved) {
    if (canonicalName === 'run_local_coder') {
      tools.push({
        canonicalName, runtimeName: null, displayName: 'Run Local Coder',
        description: 'Required controller doorway that starts this Coder; it is not callable from inside its own run.',
        source: 'runtime_control', group: 'Runtime controls', risk: 'control', saved: true,
        enabled: true, callable: false, reason: 'Controller capability; recursion is intentionally disabled.',
      });
      continue;
    }
    const descriptor = catalog.get(canonicalName);
    if (!descriptor) {
      unresolved.push(canonicalName);
      tools.push({
        canonicalName, runtimeName: null, displayName: canonicalName,
        description: 'Saved grant is absent from the live canonical catalog.',
        source: 'saved_unavailable', group: 'Unavailable', risk: 'control', saved: true,
        enabled: false, callable: false, reason: 'Unavailable in the live Python MCP catalog.',
      });
      continue;
    }
    const isCbm = canonicalName.startsWith('cbm.');
    const runtimeName = isCbm
      ? runtimeMcpName(CODEBASE_MEMORY_MCP_SERVER, canonicalName.slice(4))
      : runtimeMcpName('liquidaity', canonicalName);
    const deniedByAuditAuthority = opts.authority === 'direct_main_audit'
      && (descriptor.capability.approvalRequired || descriptor.capability.providerPossible);
    const enabled = !deniedByAuditAuthority;
    if (enabled) {
      if (isCbm) needsCodeGraph = true;
      else needsLiquidaity = true;
      selectedMcpRuntimeNames.push(runtimeName);
    }
    const group: EffectiveCoderTool['group'] = isCbm
      ? 'Codebase Memory'
      : canonicalName.startsWith('engraphis.') ? 'Engraphis' : 'Other MCP';
    const risk: EffectiveCoderTool['risk'] = descriptor.capability.providerPossible
      ? 'paid'
      : descriptor.capability.approvalRequired ? 'write' : 'read';
    tools.push({
      canonicalName, runtimeName,
      displayName: descriptor.title || canonicalName,
      description: descriptor.description || descriptor.capability.recommendedUse,
      source: isCbm ? 'codebase_memory' : 'liquidaity_mcp', group, risk, saved: true,
      enabled, callable: enabled,
      reason: enabled
        ? `Saved grant; callable in ${opts.authority}.`
        : 'Saved grant is visible but denied by read-only audit authority.',
    });
  }

  tools.push({
    canonicalName: 'Stop', runtimeName: null, displayName: 'Stop',
    description: 'Stops the one live OpenClaude process owned by this session.',
    source: 'runtime_control', group: 'Runtime controls', risk: 'control', saved: false,
    enabled: true, callable: false, reason: 'Available to the user through the canonical session owner.',
  });
  const mcpServers = buildCoderMcpServers({
    runId: opts.runId,
    includeCodeGraph: needsCodeGraph,
    includeLiquidaity: needsLiquidaity,
  });
  const allowedTools = [
    ...enabledNative,
    ...selectedMcpRuntimeNames,
  ];
  const disallowedTools = OPENCLAUDE_NATIVE_TOOL_CONTRACT.filter((name) => !enabledNative.has(name));
  const snapshot: EffectiveCoderToolSnapshot = {
    authority: opts.authority,
    permissionMode: resolveConsolePermissionMode(opts.authority),
    allowsShell: policy.allowsMutatingShell,
    allowsWrite: enabledNative.has('Edit') || enabledNative.has('Write'),
    allowsNetwork: enabledNative.has('WebFetch') || enabledNative.has('WebSearch'),
    hasPaidTools: tools.some((tool) => tool.enabled && tool.risk === 'paid'),
    unresolved,
    nativeTools: [...enabledNative],
    allowedTools,
    disallowedTools,
    mcpServers,
    tools,
    counts: {
      saved: saved.length,
      enabled: tools.filter((tool) => tool.enabled).length,
      callable: tools.filter((tool) => tool.callable).length,
      unavailable: tools.filter((tool) => tool.source === 'saved_unavailable').length,
    },
  };
  return Object.freeze(snapshot);
}

export type CoderToolPolicy = {
  /** `--allowedTools` — with `--permission-mode dontAsk`, everything NOT listed is auto-denied. */
  allowedTools: string[];
  /** `--disallowedTools` — explicit denial on top of the auto-deny (belt and suspenders). */
  disallowedTools: string[];
  permissionMode: 'dontAsk';
  /** True only when the mode may run mutating shell (Bash/PowerShell). */
  allowsMutatingShell: boolean;
  /** True when the mode composes the CodeGraph MCP server into its config. */
  codeGraphMcp: boolean;
};

/** Native CBM server name from the repository's canonical .mcp.json. */
export const CODEBASE_MEMORY_MCP_SERVER = 'codebase-memory';

/** Resolve the caller-supplied authority mode into a concrete CLI tool policy. */
export function resolveCoderToolPolicy(mode: CoderAuthorityMode): CoderToolPolicy {
  if (mode === 'direct_main_audit') {
    return {
      // Read-only audit: native reads + CodeGraph, nothing that mutates the repo.
      // Exact CodeGraph tool grants are derived from the saved card and live
      // catalog by resolveEffectiveCoderToolSnapshot. A server-wide grant here
      // would silently admit destructive CBM operations that the card did not save.
      allowedTools: ['Read', 'Grep', 'Glob'],
      disallowedTools: ['Write', 'Edit', 'NotebookEdit', 'Bash', 'PowerShell', 'WebFetch', 'WebSearch'],
      permissionMode: 'dontAsk',
      allowsMutatingShell: false,
      codeGraphMcp: true,
    };
  }
  // mag_one_execution: approved implementation authority on the same identity.
  return {
    allowedTools: [
      'Read',
      'Grep',
      'Glob',
      'Edit',
      'Write',
      'Bash',
      'PowerShell',
    ],
    disallowedTools: ['WebFetch', 'WebSearch'],
    permissionMode: 'dontAsk',
    allowsMutatingShell: true,
    codeGraphMcp: true,
  };
}

export type McpServerSpec = {
  type: 'stdio';
  command: string;
  args: string[];
  env: Record<string, string>;
};

function resolveNativeCodebaseMemoryServer(): McpServerSpec {
  const repoRoot = resolveRepoRoot();
  const configPath = path.join(repoRoot, '.mcp.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
    mcpServers?: Record<string, {
      type?: unknown;
      command?: unknown;
      args?: unknown;
      env?: unknown;
    }>;
  };
  const configured = config.mcpServers?.[CODEBASE_MEMORY_MCP_SERVER];
  const command = String(configured?.command || '').trim();
  const args = Array.isArray(configured?.args)
    ? configured.args.map((value) => String(value))
    : [];
  const rawEnv = configured?.env && typeof configured.env === 'object'
    ? configured.env as Record<string, unknown>
    : {};
  const env = Object.fromEntries(
    Object.entries(rawEnv).map(([key, value]) => [key, String(value)]),
  );
  if (!command) throw new Error('native_codebase_memory_mcp_command_required');
  if (!env.CODEBASE_ROOT || path.resolve(env.CODEBASE_ROOT) !== path.resolve(repoRoot)) {
    throw new Error('native_codebase_memory_mcp_root_mismatch');
  }
  return { type: 'stdio', command, args, env };
}

/**
 * Compose the Coder CLI's MCP servers. When `includeCodeGraph` is set
 * (direct_main_audit), the repository's canonical native CBM server is added
 * directly. No LiquidAIty wrapper, second indexer, or alternate graph authority
 * sits between Coder and CBM.
 */
export function buildCoderMcpServers(opts: {
  runId: string;
  includeCodeGraph: boolean;
  includeLiquidaity?: boolean;
}): Record<string, McpServerSpec> {
  const servers: Record<string, McpServerSpec> = {};
  if (opts.includeCodeGraph) {
    const native = resolveNativeCodebaseMemoryServer();
    servers[CODEBASE_MEMORY_MCP_SERVER] = {
      ...native,
      env: { ...native.env, LIQUIDAITY_CODER_RUN_ID: opts.runId },
    };
  }
  if (opts.includeLiquidaity) {
    servers.liquidaity = resolvePythonAgentMcpServerSpec();
  }
  return servers;
}

/**
 * OpenClaude's permission dialect (NOT `claude`'s `--allowedTools`). OpenClaude
 * gates mutation with `--permission-mode`: `plan` = read-only (proposes, never
 * edits), `acceptEdits` = may edit. Maps the caller authority onto it; the
 * read-only default (`plan`) is deliberately the safe one when unset.
 */
export type ConsolePermissionMode = 'plan' | 'acceptEdits';

export function resolveConsolePermissionMode(authority?: CoderAuthorityMode): ConsolePermissionMode {
  return authority === 'mag_one_execution' ? 'acceptEdits' : 'plan';
}

/**
 * The exact OpenClaude non-interactive console argv. `--output-format json` emits a
 * single structured envelope on stdout (tool logs go to stderr), which
 * `parseOpenClaudeCoderReport` reads.
 */
export function buildOpenClaudeSubagentArgs(opts: {
  prompt: string;
  model: string;
  permissionMode: ConsolePermissionMode;
  jsonSchema: unknown;
  mcpFlags?: string[];
  allowedTools?: string[];
  disallowedTools?: string[];
  nativeTools?: string[];
}): string[] {
  const toolFlags: string[] = [];
  if (opts.allowedTools && opts.allowedTools.length > 0) {
    toolFlags.push('--allowedTools', opts.allowedTools.join(','));
  }
  if (opts.disallowedTools && opts.disallowedTools.length > 0) {
    toolFlags.push('--disallowedTools', opts.disallowedTools.join(','));
  }
  return [
    '--print',
    opts.prompt,
    '--output-format',
    'json',
    '--json-schema',
    JSON.stringify(opts.jsonSchema),
    ...(opts.mcpFlags ?? []),
    ...(opts.nativeTools ? ['--tools', opts.nativeTools.join(',')] : []),
    ...toolFlags,
    '--permission-mode',
    opts.permissionMode,
    '--model',
    opts.model,
    '--provider',
    'openai',
    '--no-session-persistence',
  ];
}

export type OpenClaudeParseResult = {
  report: CoderReport | null;
  jsonParseStarted: boolean;
  coderReportValidationStarted: boolean;
};

/**
 * Parse an OpenClaude `--output-format json` stdout envelope into a validated
 * `CoderReport`. The Console invocation accepts any schema-valid report. Never
 * throws; an unparseable/invalid envelope is an
 * honest null, never a fabricated report.
 */
/** Candidate objects an OpenClaude `--output-format json` envelope may carry the
 * structured result under. Returns null when stdout is not JSON at all. */
function extractOpenClaudeEnvelopeCandidates(stdout: string): unknown[] | null {
  let envelope: Record<string, unknown>;
  try {
    envelope = JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    return null;
  }
  return [envelope.structured_output, envelope.result, envelope.output, envelope].map((candidate) =>
    typeof candidate === 'string'
      ? (() => {
          try {
            return JSON.parse(candidate);
          } catch {
            return null;
          }
        })()
      : candidate,
  );
}

export function parseOpenClaudeCoderReport(
  stdout: string,
  opts: { requirePacketId?: string } = {},
): OpenClaudeParseResult {
  const candidates = extractOpenClaudeEnvelopeCandidates(stdout);
  if (!candidates) return { report: null, jsonParseStarted: true, coderReportValidationStarted: false };
  for (const candidate of candidates) {
    const parsed = coderReportSchema.safeParse(candidate);
    if (parsed.success && (!opts.requirePacketId || parsed.data.coderPacketId === opts.requirePacketId)) {
      return { report: { ...parsed.data, rawOutput: stdout }, jsonParseStarted: true, coderReportValidationStarted: true };
    }
  }
  return { report: null, jsonParseStarted: true, coderReportValidationStarted: true };
}

/** Parse an OpenClaude `--output-format json` envelope into a validated audit
 * result (direct_main_audit). Never throws; invalid → null, never fabricated. */
export function parseCoderAuditResult(stdout: string): { auditResult: CoderAuditResult | null } {
  const candidates = extractOpenClaudeEnvelopeCandidates(stdout);
  if (!candidates) return { auditResult: null };
  for (const candidate of candidates) {
    const parsed = coderAuditResultSchema.safeParse(candidate);
    if (parsed.success) return { auditResult: parsed.data };
  }
  return { auditResult: null };
}
