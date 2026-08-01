import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildCoderMcpServers,
  buildOpenClaudeSubagentArgs,
  parseOpenClaudeCoderReport,
  parseCoderAuditResult,
  resolveCoderToolPolicy,
  resolveConsolePermissionMode,
  CODEBASE_MEMORY_MCP_SERVER,
  LEGACY_HARNESS_TOOL_POLICY,
  resolveEffectiveCoderToolSnapshot,
} from './coderRuntimeContract';

const descriptor = (name: string, overrides: Record<string, unknown> = {}) => ({
  name,
  description: `${name} description`,
  inputSchema: { type: 'object' },
  capability: {
    surface: 'knowledge' as const,
    capabilityType: 'callable_tool' as const,
    graphAuthority: name.startsWith('cbm.') ? 'codegraph' as const : 'thinkgraph' as const,
    authorityClass: 'read', runtimeCompatibility: ['local_coder'], cardAssignable: true,
    latency: 'fast' as const, providerPossible: false, health: 'available',
    recommendedUse: 'read', verification: 'live', approvalRequired: false, deprecated: false,
    ...overrides,
  },
});

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
    expect(policy.allowedTools).toEqual(expect.arrayContaining(['Read', 'Grep', 'Glob']));
    expect(policy.allowedTools).not.toContain('mcp__codebase-memory');
    // No mutating capability may be allow-listed.
    for (const forbidden of ['Edit', 'Write', 'NotebookEdit', 'Bash', 'PowerShell']) {
      expect(policy.allowedTools).not.toContain(forbidden);
    }
    expect(policy.disallowedTools).toEqual(expect.arrayContaining(['Edit', 'Write', 'NotebookEdit', 'Bash', 'PowerShell']));
    expect(policy.allowsMutatingShell).toBe(false);
    expect(policy.codeGraphMcp).toBe(true);
    expect(policy.permissionMode).toBe('dontAsk');
  });

  it('mag_one_execution grants implementation authority plus the native CodeGraph MCP', () => {
    const policy = resolveCoderToolPolicy('mag_one_execution');
    expect(policy.allowedTools).toEqual(expect.arrayContaining([
      'Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash', 'PowerShell',
    ]));
    expect(policy.allowedTools).not.toContain('mcp__codebase-memory');
    expect(policy.allowsMutatingShell).toBe(true);
    expect(policy.codeGraphMcp).toBe(true);
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

  it('codegraph composition points directly at the native CBM executable', () => {
    const servers = buildCoderMcpServers({ runId: 'coder_y', includeCodeGraph: true });
    expect(servers[CODEBASE_MEMORY_MCP_SERVER].command.replace(/\\/g, '/')).toMatch(/codebase-memory-mcp\.exe$/);
    expect(servers[CODEBASE_MEMORY_MCP_SERVER].args).toEqual([]);
    expect(servers[CODEBASE_MEMORY_MCP_SERVER].env.CODEBASE_ROOT.replace(/\\/g, '/')).toMatch(/\/Projects\/main$/i);
  });

  it('scoped audit composition exposes only the canonical native CBM server', () => {
    const servers = buildCoderMcpServers({ runId: 'coder_a', includeCodeGraph: true });
    expect(Object.keys(servers)).toEqual([CODEBASE_MEMORY_MCP_SERVER]);
    expect(servers[CODEBASE_MEMORY_MCP_SERVER].env.LIQUIDAITY_CODER_RUN_ID).toBe('coder_a');
  });
});

describe('resolveEffectiveCoderToolSnapshot', () => {
  it('resolves exact audit tools from saved grants and keeps the controller non-recursive', () => {
    const snapshot = resolveEffectiveCoderToolSnapshot({
      authority: 'direct_main_audit', runId: 'coder_snapshot',
      savedTools: ['run_local_coder', 'cbm.search_graph', 'engraphis.search_code'],
      catalog: [descriptor('cbm.search_graph'), descriptor('engraphis.search_code')],
    });
    expect(snapshot.unresolved).toEqual([]);
    expect(snapshot.nativeTools).toEqual(['Read', 'Grep', 'Glob']);
    expect(snapshot.allowedTools).toEqual(expect.arrayContaining([
      'mcp__codebase-memory__search_graph', 'mcp__liquidaity__engraphis_search_code',
    ]));
    expect(snapshot.allowedTools).not.toContain('mcp__codebase-memory');
    expect(Object.keys(snapshot.mcpServers)).toEqual(['codebase-memory', 'liquidaity']);
    expect(snapshot.tools.find((tool) => tool.canonicalName === 'run_local_coder')?.callable).toBe(false);
  });

  it('fails preflight honestly for a saved grant absent from the live catalog', () => {
    const snapshot = resolveEffectiveCoderToolSnapshot({
      authority: 'mag_one_execution', runId: 'coder_snapshot', savedTools: ['old.tool'], catalog: [],
    });
    expect(snapshot.unresolved).toEqual(['old.tool']);
    expect(snapshot.tools.find((tool) => tool.canonicalName === 'old.tool')?.group).toBe('Unavailable');
  });

  it('keeps paid and approval-required saved grants visible but unavailable to read-only audit', () => {
    const snapshot = resolveEffectiveCoderToolSnapshot({
      authority: 'direct_main_audit', runId: 'coder_snapshot',
      savedTools: ['engraphis.search_code', 'engraphis.index_repo', 'research.run'],
      catalog: [
        descriptor('engraphis.search_code'),
        descriptor('engraphis.index_repo', { approvalRequired: true }),
        descriptor('research.run', { providerPossible: true }),
      ],
    });
    expect(snapshot.allowedTools).toContain('mcp__liquidaity__engraphis_search_code');
    expect(snapshot.allowedTools).not.toContain('mcp__liquidaity__engraphis_index_repo');
    expect(snapshot.allowedTools).not.toContain('mcp__liquidaity__research_run');
    expect(snapshot.tools.find((tool) => tool.canonicalName === 'engraphis.index_repo')).toMatchObject({
      saved: true, enabled: false, callable: false,
    });
    expect(snapshot.tools.find((tool) => tool.canonicalName === 'research.run')).toMatchObject({
      risk: 'paid', enabled: false, callable: false,
    });
    expect(snapshot.hasPaidTools).toBe(false);
  });
});

describe('audit argv (item 4)', () => {
  it('argv carries the exact resolved tool grants and native denials', () => {
    const allowedTools = ['Read', 'Grep', 'Glob', 'mcp__codebase-memory__search_graph'];
    const disallowedTools = ['Bash', 'PowerShell', 'Edit', 'Write', 'NotebookEdit'];
    const args = buildOpenClaudeSubagentArgs({
      prompt: 'audit', model: 'm', permissionMode: 'plan', jsonSchema: {},
      mcpFlags: ['--mcp-config', '/tmp/mcp.json', '--strict-mcp-config'],
      allowedTools, disallowedTools,
    });
    expect(args[args.indexOf('--allowedTools') + 1]).toContain('mcp__codebase-memory__search_graph');
    expect(args[args.indexOf('--allowedTools') + 1]).not.toContain('mcp__codebase-memory,');
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
