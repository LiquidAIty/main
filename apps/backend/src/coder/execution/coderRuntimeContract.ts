import { readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveRepoRoot } from '../workspaceRoot';
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
 * composition so the headless adapter and (later, per §3) the live console
 * session build identical argv/MCP from one place — never two.
 */
export type CoderAuthorityMode = 'direct_main_audit' | 'mag_one_execution';

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

// OpenClaude's server-level MCP permission. It is intentionally not a list of
// CBM tool names: the connected native server owns discovery and this grant
// admits whatever catalog that server actually advertises.
export const CODEBASE_MEMORY_TOOL_GRANT = `mcp__${CODEBASE_MEMORY_MCP_SERVER}`;

/**
 * The legacy `harness_subagent` policy: exactly what `run_coder_subagent` has
 * always produced (shell-capable, no file edits, dev-harness MCP only). Named
 * and shared so the live path stays byte-identical until a caller opts into an
 * explicit authority mode. Do not change these tokens without a live re-proof.
 */
export const LEGACY_HARNESS_TOOL_POLICY: CoderToolPolicy = {
  allowedTools: ['Bash', 'PowerShell'],
  disallowedTools: ['WebFetch', 'WebSearch', 'Write', 'Edit', 'NotebookEdit'],
  permissionMode: 'dontAsk',
  allowsMutatingShell: true,
  codeGraphMcp: false,
};

/** Resolve the caller-supplied authority mode into a concrete CLI tool policy. */
export function resolveCoderToolPolicy(mode: CoderAuthorityMode): CoderToolPolicy {
  if (mode === 'direct_main_audit') {
    return {
      // Read-only audit: native reads + CodeGraph, nothing that mutates the repo.
      allowedTools: ['Read', 'Grep', 'Glob', CODEBASE_MEMORY_TOOL_GRANT],
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
      CODEBASE_MEMORY_TOOL_GRANT,
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
}): Record<string, McpServerSpec> {
  const servers: Record<string, McpServerSpec> = {};
  if (opts.includeCodeGraph) {
    const native = resolveNativeCodebaseMemoryServer();
    servers[CODEBASE_MEMORY_MCP_SERVER] = {
      ...native,
      env: { ...native.env, LIQUIDAITY_CODER_RUN_ID: opts.runId },
    };
  }
  return servers;
}

/**
 * OpenClaude tool allow/deny for a read-only direct_main_audit: native reads +
 * the native Codebase Memory server; every mutating/native-shell tool denied.
 * Flag names verified from OpenClaude source (main.tsx: `--allowedTools` /
 * `--disallowedTools`). Combined with `--permission-mode plan` and the scoped
 * doorway MCP, this is defense in depth — the audit cannot Edit/Write/shell or
 * reach any write tool.
 */
export function resolveConsoleAuditTools(): { allowedTools: string[]; disallowedTools: string[] } {
  return {
    allowedTools: ['Read', 'Grep', 'Glob', CODEBASE_MEMORY_TOOL_GRANT],
    disallowedTools: ['Bash', 'PowerShell', 'Edit', 'Write', 'NotebookEdit'],
  };
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
 * The exact OpenClaude non-interactive job argv (mirrors, and is consumed by,
 * `LocalCoderAdapter.jobArgs` so the streamed Console subagent run and the
 * headless LocalCoder job build ONE argv shape). `--output-format json` emits a
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
 * `CoderReport`. Shared by `LocalCoderAdapter.parseLocalCoderOutput` (which pins
 * `requirePacketId` to its packet) and the Console subagent bridge (which accepts
 * any schema-valid report). Never throws; an unparseable/invalid envelope is an
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
