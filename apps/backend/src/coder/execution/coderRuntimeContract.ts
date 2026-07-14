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

/** MCP server name for the composed CodeGraph host (see buildCoderMcpServers). */
export const CODEGRAPH_MCP_SERVER = 'liquid_aity_codegraph';

// The only CodeGraph MCP tools the read-only audit may call. Token form verified
// from OpenClaude source: `mcp__${normalizeNameForMCP(server)}__${normalizeNameForMCP(tool)}`,
// where normalizeNameForMCP replaces every [^a-zA-Z0-9_-] with '_' (localcoder
// src/services/mcp/normalization.ts + mcpStringUtils.ts) — so `codegraph.status`
// → `codegraph_status`. The write tools mcp_host also exposes are omitted here.
export const CODEGRAPH_MCP_TOOLS = [
  `mcp__${CODEGRAPH_MCP_SERVER}__codegraph_status`,
  `mcp__${CODEGRAPH_MCP_SERVER}__codegraph_search`,
];

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
      allowedTools: ['Read', 'Grep', 'Glob', ...CODEGRAPH_MCP_TOOLS],
      disallowedTools: ['Write', 'Edit', 'NotebookEdit', 'Bash', 'PowerShell', 'WebFetch', 'WebSearch'],
      permissionMode: 'dontAsk',
      allowsMutatingShell: false,
      codeGraphMcp: true,
    };
  }
  // mag_one_execution: approved implementation authority on the same identity.
  return {
    allowedTools: ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash', 'PowerShell'],
    disallowedTools: ['WebFetch', 'WebSearch'],
    permissionMode: 'dontAsk',
    allowsMutatingShell: true,
    codeGraphMcp: false,
  };
}

export type McpServerSpec = {
  type: 'stdio';
  command: string;
  args: string[];
  env: Record<string, string>;
};

/** Reuse the existing Python resolution (env override, else the in-repo venv). */
function resolvePythonExecutable(): string {
  return (
    process.env.LIQUIDAITY_PYTHON ||
    path.join(resolveRepoRoot(), 'apps', 'python-models', '.venv', 'Scripts', 'python.exe')
  );
}

/**
 * Compose the Coder CLI's MCP servers. The dev-harness MCP (Observatory/job
 * tools) is always present — that is today's exact config. When `includeCodeGraph`
 * is set (direct_main_audit), the product MCP host (`mcp_host.py`, which exposes
 * `codegraph.status`/`codegraph.search`) is added as a second stdio server; the
 * audit `--allowedTools` allowlist (CODEGRAPH_MCP_TOOLS) is what bounds it to
 * read-only CodeGraph and denies its write tools.
 *
 * ponytail: mcp_host is the ONE existing CodeGraph server — no new `.mjs`, no
 * second CodeGraph service. Whether it boots correctly as a per-run Coder
 * subprocess is a live-proof item for Sol (default stays includeCodeGraph=false).
 */
export function buildCoderMcpServers(opts: {
  runId: string;
  includeCodeGraph: boolean;
  /** Dev-harness Observatory/job MCP. Defaults on (legacy/execution); a read-only
   * audit sets this false so it gets ONLY the scoped codegraph doorway. */
  includeDevHarness?: boolean;
}): Record<string, McpServerSpec> {
  const python = resolvePythonExecutable();
  const appDir = path.join(resolveRepoRoot(), 'apps', 'python-models', 'app');
  const servers: Record<string, McpServerSpec> = {};
  if (opts.includeDevHarness ?? true) {
    servers.liquid_aity_coder = {
      type: 'stdio',
      command: python,
      args: [path.join(appDir, 'dev_agent_harness_mcp.py')],
      env: { LIQUIDAITY_CODER_RUN_ID: opts.runId },
    };
  }
  if (opts.includeCodeGraph) {
    // The RESTRICTED codegraph doorway (codegraph.status/search only) — NOT the
    // full mcp_host — so a read-only audit reaches CodeGraph and nothing else.
    servers[CODEGRAPH_MCP_SERVER] = {
      type: 'stdio',
      command: python,
      args: [path.join(appDir, 'codegraph_doorway_mcp.py')],
      env: { LIQUIDAITY_CODER_RUN_ID: opts.runId },
    };
  }
  return servers;
}

/**
 * OpenClaude tool allow/deny for a read-only direct_main_audit: native reads +
 * the two codegraph doorway tools only; every mutating/native-shell tool denied.
 * Flag names verified from OpenClaude source (main.tsx: `--allowedTools` /
 * `--disallowedTools`). Combined with `--permission-mode plan` and the scoped
 * doorway MCP, this is defense in depth — the audit cannot Edit/Write/shell or
 * reach any write tool.
 */
export function resolveConsoleAuditTools(): { allowedTools: string[]; disallowedTools: string[] } {
  return {
    allowedTools: ['Read', 'Grep', 'Glob', ...CODEGRAPH_MCP_TOOLS],
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
