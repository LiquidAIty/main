import { describe, expect, it } from 'vitest';
import {
  buildOpenClaudeJobArgs,
  parseOpenClaudeCoderReport,
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

describe('buildOpenClaudeJobArgs', () => {
  it('builds the canonical non-interactive LocalCoder argv', () => {
    const args = buildOpenClaudeJobArgs({
      prompt: 'do it',
      model: 'deepseek/deepseek-r1',
      permissionMode: 'acceptEdits',
      jsonSchema: { type: 'object' },
      mcpFlags: ['--mcp-config', '/tmp/mcp.json', '--strict-mcp-config'],
      reasoningEffort: 'xhigh',
      allowedTools: ['mcp__liquidaity__search_graph'],
    });
    expect(args.slice(0, 6)).toEqual([
      '--print', 'do it', '--output-format', 'json', '--json-schema', JSON.stringify({ type: 'object' }),
    ]);
    expect(args).toEqual(expect.arrayContaining([
      '--mcp-config', '/tmp/mcp.json', '--strict-mcp-config',
      '--allowed-tools', 'mcp__liquidaity__search_graph',
      '--effort', 'max',
    ]));
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('acceptEdits');
    expect(args[args.indexOf('--model') + 1]).toBe('deepseek/deepseek-r1');
    expect(args[args.indexOf('--provider') + 1]).toBe('openai');
  });

  it('selects the supported OpenAI dialect for the native Codex transport', () => {
    const args = buildOpenClaudeJobArgs({
      prompt: 'inspect',
      model: 'gpt-5.6-luna',
      permissionMode: 'plan',
      jsonSchema: {},
    });
    expect(args[args.indexOf('--provider') + 1]).toBe('openai');
  });
});

describe('parseOpenClaudeCoderReport', () => {
  it('extracts a validated CoderReport and preserves raw output', () => {
    const stdout = JSON.stringify({ structured_output: validReportEnvelope({ summary: 'complete' }) });
    const parsed = parseOpenClaudeCoderReport(stdout, { requirePacketId: 'coder_1' });
    expect(parsed.report?.summary).toBe('complete');
    expect(parsed.report?.rawOutput).toBe(stdout);
  });

  it('rejects invalid output and the wrong packet identity', () => {
    expect(parseOpenClaudeCoderReport('not json').report).toBeNull();
    expect(parseOpenClaudeCoderReport(
      JSON.stringify(validReportEnvelope({ coderPacketId: 'other' })),
      { requirePacketId: 'coder_1' },
    ).report).toBeNull();
  });
});
