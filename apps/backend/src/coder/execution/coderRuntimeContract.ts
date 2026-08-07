import {
  coderReportSchema,
  type CoderReport,
} from '../../contracts/coderContracts';

export type ConsolePermissionMode = 'plan' | 'acceptEdits';

/**
 * Build the one non-interactive OpenClaude argv used by LocalCoder jobs.
 * OpenRouter is supplied through the OpenAI-compatible environment prepared by
 * LocalCoderAdapter, so OpenClaude intentionally receives its `openai` provider
 * dialect for both account-backed OpenAI and OpenRouter runs.
 */
export function buildOpenClaudeJobArgs(opts: {
  prompt: string;
  model: string;
  permissionMode: ConsolePermissionMode;
  jsonSchema: unknown;
  mcpFlags?: string[];
}): string[] {
  return [
    '--print',
    opts.prompt,
    '--output-format',
    'json',
    '--json-schema',
    JSON.stringify(opts.jsonSchema),
    ...(opts.mcpFlags ?? []),
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

/** Candidate objects an OpenClaude JSON envelope may carry a report under. */
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

/** Parse and validate the bounded CoderReport; invalid output remains failure. */
export function parseOpenClaudeCoderReport(
  stdout: string,
  opts: { requirePacketId?: string } = {},
): OpenClaudeParseResult {
  const candidates = extractOpenClaudeEnvelopeCandidates(stdout);
  if (!candidates) {
    return { report: null, jsonParseStarted: true, coderReportValidationStarted: false };
  }
  for (const candidate of candidates) {
    const parsed = coderReportSchema.safeParse(candidate);
    if (parsed.success && (!opts.requirePacketId || parsed.data.coderPacketId === opts.requirePacketId)) {
      return {
        report: { ...parsed.data, rawOutput: stdout },
        jsonParseStarted: true,
        coderReportValidationStarted: true,
      };
    }
  }
  return { report: null, jsonParseStarted: true, coderReportValidationStarted: true };
}
