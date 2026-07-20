import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildCoderMcpServers,
  buildOpenClaudeSubagentArgs,
  parseOpenClaudeCoderReport,
  parseCoderAuditResult,
  resolveCoderToolPolicy,
  resolveConsolePermissionMode,
  resolveConsoleAuditTools,
  CODEGRAPH_MCP_SERVER,
  CODEGRAPH_MCP_TOOLS,
  LEGACY_HARNESS_TOOL_POLICY,
} from './coderRuntimeContract';

function validReportEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    coderPacketId: 'coder_1',
    status: 'succeeded',
    summary: 'did the thing',
    specComparison: [],
    filesChanged: [],
    proofCommands: [],
    proofResults: [],
    failedCommands: [],
    blockers: [],
    assumptions: [],
    outOfScopeFindings: [],
    nextRecommendedTask: '',
    rawOutput: '',
    ...overrides,
  };
}

afterEach(() => vi.unstubAllEnvs());

describe('resolveCoderToolPolicy', () => {
  it('direct_main_audit is structurally read-only: native reads + CodeGraph, no edits, no shell', () => {
    const policy = resolveCoderToolPolicy('direct_main_audit');
    expect(policy.allowedTools).toEqual(expect.arrayContaining(['Read', 'Grep', 'Glob', ...CODEGRAPH_MCP_TOOLS]));
    // No mutating capability may be allow-listed.
    for (const forbidden of ['Edit', 'Write', 'NotebookEdit', 'Bash', 'PowerShell']) {
      expect(policy.allowedTools).not.toContain(forbidden);
    }
    expect(policy.disallowedTools).toEqual(expect.arrayContaining(['Edit', 'Write', 'NotebookEdit', 'Bash', 'PowerShell']));
    expect(policy.allowsMutatingShell).toBe(false);
    expect(policy.codeGraphMcp).toBe(true);
    expect(policy.permissionMode).toBe('dontAsk');
  });

  it('mag_one_execution grants implementation authority (Edit/Write/shell), no CodeGraph MCP', () => {
    const policy = resolveCoderToolPolicy('mag_one_execution');
    expect(policy.allowedTools).toEqual(expect.arrayContaining(['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash', 'PowerShell']));
    expect(policy.allowsMutatingShell).toBe(true);
    expect(policy.codeGraphMcp).toBe(false);
  });

  it('audit CodeGraph tools are read-only status/search only (no write tool ids)', () => {
    expect(CODEGRAPH_MCP_TOOLS).toEqual([
      `mcp__${CODEGRAPH_MCP_SERVER}__codegraph_status`,
      `mcp__${CODEGRAPH_MCP_SERVER}__codegraph_search`,
    ]);
    for (const tool of CODEGRAPH_MCP_TOOLS) {
      expect(tool).not.toMatch(/thinkgraph|knowgraph|submit|ingest|update|write|run_mag_one|run_coder/i);
    }
  });

  it('legacy harness policy is exactly the historical shell-capable, no-edit args', () => {
    expect(LEGACY_HARNESS_TOOL_POLICY.allowedTools.join(',')).toBe('Bash,PowerShell');
    expect(LEGACY_HARNESS_TOOL_POLICY.disallowedTools.join(',')).toBe('WebFetch,WebSearch,Write,Edit,NotebookEdit');
    expect(LEGACY_HARNESS_TOOL_POLICY.permissionMode).toBe('dontAsk');
  });
});

describe('buildCoderMcpServers', () => {
  it('does not inject an MCP server into ordinary execution', () => {
    vi.stubEnv('LIQUIDAITY_PYTHON', '/py/python');
    vi.stubEnv('LIQUIDAITY_GRPC_CWD', '/repo');
    const servers = buildCoderMcpServers({ runId: 'coder_x', includeCodeGraph: false });
    expect(servers).toEqual({});
  });

  it('codegraph composition points at the RESTRICTED doorway, never the full mcp_host', () => {
    vi.stubEnv('LIQUIDAITY_PYTHON', '/py/python');
    vi.stubEnv('LIQUIDAITY_GRPC_CWD', '/repo');
    const servers = buildCoderMcpServers({ runId: 'coder_y', includeCodeGraph: true });
    expect(servers[CODEGRAPH_MCP_SERVER].args[0].replace(/\\/g, '/')).toMatch(/apps\/python-models\/app\/codegraph_doorway_mcp\.py$/);
    expect(servers[CODEGRAPH_MCP_SERVER].args[0]).not.toMatch(/mcp_host\.py$/);
  });

  it('scoped audit composition exposes ONLY the codegraph doorway', () => {
    vi.stubEnv('LIQUIDAITY_PYTHON', '/py/python');
    vi.stubEnv('LIQUIDAITY_GRPC_CWD', '/repo');
    const servers = buildCoderMcpServers({ runId: 'coder_a', includeCodeGraph: true });
    expect(Object.keys(servers)).toEqual([CODEGRAPH_MCP_SERVER]);
    expect(servers[CODEGRAPH_MCP_SERVER].args[0].replace(/\\/g, '/')).toMatch(/codegraph_doorway_mcp\.py$/);
  });
});

describe('resolveConsoleAuditTools + audit argv (item 4)', () => {
  it('allows only Read/Grep/Glob + the two codegraph doorway tokens; denies all mutation/shell', () => {
    const { allowedTools, disallowedTools } = resolveConsoleAuditTools();
    expect(allowedTools).toEqual(['Read', 'Grep', 'Glob', ...CODEGRAPH_MCP_TOOLS]);
    for (const forbidden of ['Bash', 'PowerShell', 'Edit', 'Write', 'NotebookEdit']) {
      expect(allowedTools).not.toContain(forbidden);
      expect(disallowedTools).toContain(forbidden);
    }
  });

  it('argv carries the verified --allowedTools/--disallowedTools flags when a policy is supplied', () => {
    const { allowedTools, disallowedTools } = resolveConsoleAuditTools();
    const args = buildOpenClaudeSubagentArgs({
      prompt: 'audit', model: 'm', permissionMode: 'plan', jsonSchema: {},
      mcpFlags: ['--mcp-config', '/tmp/mcp.json', '--strict-mcp-config'],
      allowedTools, disallowedTools,
    });
    expect(args[args.indexOf('--allowedTools') + 1]).toContain('mcp__liquid_aity_codegraph__codegraph_status');
    expect(args[args.indexOf('--allowedTools') + 1]).toContain('Read');
    expect(args[args.indexOf('--disallowedTools') + 1]).toContain('Bash');
    expect(args).toEqual(expect.arrayContaining(['--mcp-config', '/tmp/mcp.json', '--strict-mcp-config']));
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('plan');
  });

  it('omits tool flags entirely when no policy is supplied (execution / legacy job)', () => {
    const args = buildOpenClaudeSubagentArgs({ prompt: 'x', model: 'm', permissionMode: 'acceptEdits', jsonSchema: {} });
    expect(args).not.toContain('--allowedTools');
    expect(args).not.toContain('--disallowedTools');
  });
});

describe('OpenClaude console dialect (canonical runtime)', () => {
  it('maps authority onto OpenClaude permission-mode (read-only by default)', () => {
    expect(resolveConsolePermissionMode('direct_main_audit')).toBe('plan');
    expect(resolveConsolePermissionMode('mag_one_execution')).toBe('acceptEdits');
    expect(resolveConsolePermissionMode(undefined)).toBe('plan');
  });

  it('builds the exact OpenClaude non-interactive job argv (shared with LocalCoder)', () => {
    const args = buildOpenClaudeSubagentArgs({
      prompt: 'do it',
      model: 'glm-5.2',
      permissionMode: 'plan',
      jsonSchema: { type: 'object' },
      mcpFlags: ['--mcp-config', '/tmp/mcp.json', '--strict-mcp-config'],
    });
    expect(args.slice(0, 6)).toEqual(['--print', 'do it', '--output-format', 'json', '--json-schema', JSON.stringify({ type: 'object' })]);
    expect(args).toEqual(expect.arrayContaining(['--mcp-config', '/tmp/mcp.json', '--strict-mcp-config']));
    expect(args.slice(-7)).toEqual(['--permission-mode', 'plan', '--model', 'glm-5.2', '--provider', 'openai', '--no-session-persistence']);
  });
});

describe('parseOpenClaudeCoderReport', () => {
  it('extracts a validated CoderReport from a raw json envelope and preserves rawOutput', () => {
    const stdout = JSON.stringify(validReportEnvelope({ summary: 'audited' }));
    const parsed = parseOpenClaudeCoderReport(stdout);
    expect(parsed.report?.summary).toBe('audited');
    expect(parsed.report?.rawOutput).toBe(stdout);
  });

  it('reads a report nested under structured_output', () => {
    const stdout = JSON.stringify({ structured_output: validReportEnvelope() });
    expect(parseOpenClaudeCoderReport(stdout).report?.coderPacketId).toBe('coder_1');
  });

  it('enforces requirePacketId when supplied (headless job path)', () => {
    const stdout = JSON.stringify(validReportEnvelope({ coderPacketId: 'other' }));
    expect(parseOpenClaudeCoderReport(stdout, { requirePacketId: 'coder_1' }).report).toBeNull();
    expect(parseOpenClaudeCoderReport(stdout, { requirePacketId: 'other' }).report).not.toBeNull();
  });

  it('returns an honest null for unparseable or invalid output — never a fabricated report', () => {
    expect(parseOpenClaudeCoderReport('not json at all').report).toBeNull();
    expect(parseOpenClaudeCoderReport(JSON.stringify({ nope: true })).report).toBeNull();
  });
});

describe('parseCoderAuditResult (direct_main_audit)', () => {
  const audit = {
    conclusion: 'c', repositoryRoot: 'r', repositoryIdentity: 'i', revision: 'v', freshness: 'f',
    codeGraphQuery: 'q', codeGraphNodeRefs: ['n'], files: ['a.ts'], symbols: ['s'], findings: [],
    unresolvedQuestions: [], risks: [], implementationBoundaries: [], requiredTests: [],
    viewContract: { focusSymbols: ['s'] }, artifactRefs: [],
  };

  it('extracts a validated audit result with its CodeGraphViewContract', () => {
    const parsed = parseCoderAuditResult(JSON.stringify(audit));
    expect(parsed.auditResult?.conclusion).toBe('c');
    expect(parsed.auditResult?.viewContract.focusSymbols).toEqual(['s']);
  });

  it('reads an audit nested under structured_output', () => {
    expect(parseCoderAuditResult(JSON.stringify({ structured_output: audit })).auditResult?.conclusion).toBe('c');
  });

  it('returns null for a CoderReport-shaped or unparseable envelope — never fabricated', () => {
    expect(parseCoderAuditResult(JSON.stringify({ coderPacketId: 'x' })).auditResult).toBeNull();
    expect(parseCoderAuditResult('nope').auditResult).toBeNull();
  });
});
