/**
 * Dev coder-job interface — a READ/CLAIM view over the ONE canonical job
 * primitive this repo already has: the Coder job folder
 * (<coder-workspace>/handoff/<jobId>/prompt.md is the job contract;
 * returns/<jobId>/ is the result surface). No second job store, no new
 * schema — this module only lists/reads those folders and adds a small
 * claimed.json marker so an execution adapter can announce itself.
 *
 * Execution adapters are interchangeable over the same job (SPEC correction:
 * dual-path Coder): an external coder (Claude Code / Codex / MCP / plugin)
 * or the managed OpenClaude Code + configured API model. The adapter never
 * redefines the job — claimed.json records only WHO is executing it.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolveCoderWorkspaceRoot } from '../coder/workspaceRoot';

export const CODER_EXECUTION_MODES = [
  'external_coder',
  'mcp_coder',
  'plugin_coder',
  'openclaude_api_coder',
] as const;
export type CoderExecutionMode = (typeof CODER_EXECUTION_MODES)[number];

export type CoderJobClaim = {
  adapter: string;
  executionMode: CoderExecutionMode;
  claimedAt: string;
  /** Model identity when the adapter exposes one (API mode); external tools
   * that own their own model selection may honestly leave this null. */
  model: string | null;
};

export type CoderJobSummary = {
  jobId: string;
  promptChars: number;
  createdAt: string | null;
  claim: CoderJobClaim | null;
  returnedFiles: number;
};

const JOB_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
const PROMPT_MAX_CHARS = 100_000;

function handoffRoot(workspaceRoot: string): string {
  return path.join(workspaceRoot, 'handoff');
}

function jobPaths(jobId: string, workspaceRoot: string) {
  return {
    dir: path.join(handoffRoot(workspaceRoot), jobId),
    prompt: path.join(handoffRoot(workspaceRoot), jobId, 'prompt.md'),
    claim: path.join(handoffRoot(workspaceRoot), jobId, 'claimed.json'),
    returnsDir: path.join(workspaceRoot, 'returns', jobId),
  };
}

export function isValidJobId(jobId: string): boolean {
  return JOB_ID_PATTERN.test(jobId);
}

function readClaim(claimFile: string): CoderJobClaim | null {
  try {
    const parsed = JSON.parse(readFileSync(claimFile, 'utf8'));
    if (parsed && typeof parsed.adapter === 'string' && typeof parsed.claimedAt === 'string') {
      return {
        adapter: parsed.adapter,
        executionMode: (CODER_EXECUTION_MODES as readonly string[]).includes(parsed.executionMode)
          ? parsed.executionMode
          : 'external_coder',
        claimedAt: parsed.claimedAt,
        model: typeof parsed.model === 'string' ? parsed.model : null,
      };
    }
  } catch {
    // missing or corrupt marker = unclaimed
  }
  return null;
}

function countFilesRecursive(dir: string): number {
  if (!existsSync(dir)) return 0;
  let count = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) count += countFilesRecursive(abs);
    else if (entry.isFile()) count += 1;
  }
  return count;
}

export function listCoderJobs(workspaceRoot = resolveCoderWorkspaceRoot()): CoderJobSummary[] {
  const root = handoffRoot(workspaceRoot);
  if (!existsSync(root)) return [];
  const jobs: CoderJobSummary[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !isValidJobId(entry.name)) continue;
    const paths = jobPaths(entry.name, workspaceRoot);
    if (!existsSync(paths.prompt)) continue; // a job IS its prompt.md
    let promptChars = 0;
    let createdAt: string | null = null;
    try {
      const stats = statSync(paths.prompt);
      promptChars = stats.size;
      createdAt = stats.mtime.toISOString();
    } catch {
      continue;
    }
    jobs.push({
      jobId: entry.name,
      promptChars,
      createdAt,
      claim: readClaim(paths.claim),
      returnedFiles: countFilesRecursive(paths.returnsDir),
    });
  }
  return jobs.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export type CoderJobDetail = CoderJobSummary & {
  prompt: string;
  promptTruncated: boolean;
  returnedFilePaths: string[];
};

export function getCoderJob(
  jobId: string,
  workspaceRoot = resolveCoderWorkspaceRoot(),
): CoderJobDetail | { error: string } {
  if (!isValidJobId(jobId)) return { error: `coder_job_id_invalid: ${jobId}` };
  const paths = jobPaths(jobId, workspaceRoot);
  if (!existsSync(paths.prompt)) return { error: `coder_job_not_found: ${jobId}` };
  let prompt = '';
  try {
    prompt = readFileSync(paths.prompt, 'utf8');
  } catch (error: any) {
    return { error: `coder_job_unreadable: ${String(error?.message || jobId)}` };
  }
  const stats = statSync(paths.prompt);
  const returnedFilePaths: string[] = [];
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile()) returnedFilePaths.push(path.relative(workspaceRoot, abs).replace(/\\/g, '/'));
    }
  };
  walk(paths.returnsDir);
  return {
    jobId,
    prompt: prompt.slice(0, PROMPT_MAX_CHARS),
    promptTruncated: prompt.length > PROMPT_MAX_CHARS,
    promptChars: prompt.length,
    createdAt: stats.mtime.toISOString(),
    claim: readClaim(paths.claim),
    returnedFiles: returnedFilePaths.length,
    returnedFilePaths: returnedFilePaths.sort(),
  };
}

export function claimCoderJob(
  input: { jobId: string; adapter: string; executionMode: string; model?: string | null; force?: boolean },
  workspaceRoot = resolveCoderWorkspaceRoot(),
): { ok: true; claim: CoderJobClaim } | { ok: false; error: string } {
  const jobId = String(input.jobId || '').trim();
  const adapter = String(input.adapter || '').trim();
  const executionMode = String(input.executionMode || '').trim();
  if (!isValidJobId(jobId)) return { ok: false, error: `coder_job_id_invalid: ${jobId}` };
  if (!adapter) return { ok: false, error: 'coder_job_claim_adapter_required' };
  if (!(CODER_EXECUTION_MODES as readonly string[]).includes(executionMode)) {
    return {
      ok: false,
      error: `coder_job_execution_mode_unknown: ${executionMode} (known: ${CODER_EXECUTION_MODES.join(',')})`,
    };
  }
  const paths = jobPaths(jobId, workspaceRoot);
  if (!existsSync(paths.prompt)) return { ok: false, error: `coder_job_not_found: ${jobId}` };
  const existing = readClaim(paths.claim);
  if (existing && input.force !== true) {
    return {
      ok: false,
      error: `coder_job_already_claimed: by ${existing.adapter} (${existing.executionMode}) at ${existing.claimedAt}; pass force=true to re-claim`,
    };
  }
  const claim: CoderJobClaim = {
    adapter,
    executionMode: executionMode as CoderExecutionMode,
    claimedAt: new Date().toISOString(),
    model: typeof input.model === 'string' && input.model.trim() ? input.model.trim() : null,
  };
  try {
    mkdirSync(paths.dir, { recursive: true });
    writeFileSync(paths.claim, JSON.stringify(claim, null, 2), 'utf8');
  } catch (error: any) {
    return { ok: false, error: `coder_job_claim_write_failed: ${String(error?.message || 'unknown')}` };
  }
  return { ok: true, claim };
}
