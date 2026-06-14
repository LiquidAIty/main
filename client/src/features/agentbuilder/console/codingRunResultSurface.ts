import type {
  CodingRunLifecycle,
  CodingRunResult,
  ConsoleSessionInfo,
} from './openClaudeConsoleClient';

export type CodingRunReference = {
  codingRunId: string;
  consoleSessionId: string | null;
  resultStatusUrl: string;
};

export type SurfacedCodingRunResult = {
  run: CodingRunLifecycle;
  session: ConsoleSessionInfo | null;
};

const TERMINAL_STATUSES = new Set<CodingRunLifecycle['status']>([
  'completed',
  'failed',
  'blocked',
]);

export function extractCodingRunReference(text: string): CodingRunReference | null {
  const consoleSessionId =
    text.match(/\bCode Console session\s+([A-Za-z0-9_-]+)/i)?.[1] ||
    text.match(/\bSession\s+([A-Za-z0-9_-]+)/i)?.[1] ||
    null;
  const codingRunId =
    text.match(/\bCoding run:\s*([A-Za-z0-9_-]+)/i)?.[1] ||
    text.match(/["']?coding_run_id["']?\s*[:=]\s*["']?([A-Za-z0-9_-]+)/i)?.[1];
  const resultStatusUrl =
    text.match(/\bResult status:\s*(\/api\/coder\/openclaude\/console\/runs\/[A-Za-z0-9_-]+)/i)?.[1] ||
    text.match(/["']?result_status_url["']?\s*[:=]\s*["']?(\/api\/coder\/openclaude\/console\/runs\/[A-Za-z0-9_-]+)/i)?.[1];
  return codingRunId && resultStatusUrl
    ? { codingRunId, consoleSessionId, resultStatusUrl }
    : null;
}

export async function pollCodingRunUntilTerminal(
  reference: CodingRunReference,
  options: {
    getCodingRun: (idOrStatusUrl: string) => Promise<CodingRunResult | null>;
    getSession: (id: string) => Promise<{ session: ConsoleSessionInfo } | null>;
    intervalMs?: number;
    timeoutMs?: number;
    sleep?: (milliseconds: number) => Promise<void>;
  },
): Promise<SurfacedCodingRunResult> {
  const intervalMs = options.intervalMs ?? 2_000;
  const timeoutMs = options.timeoutMs ?? 15 * 60_000;
  const sleep =
    options.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => {
        window.setTimeout(resolve, milliseconds);
      }));
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    const result = await options.getCodingRun(reference.resultStatusUrl);
    if (!result) {
      throw new Error(`Coding run ${reference.codingRunId} result status was not found.`);
    }
    if (TERMINAL_STATUSES.has(result.codingRun.status)) {
      const sessionResult = result.codingRun.sessionId
        ? await options.getSession(result.codingRun.sessionId)
        : null;
      return { run: result.codingRun, session: sessionResult?.session || null };
    }
    await sleep(intervalMs);
  }

  throw new Error(`Coding run ${reference.codingRunId} result polling timed out.`);
}
