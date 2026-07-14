import type { CodeGraphViewContractResult } from '../../contracts/coderContracts';

/**
 * Latest filtered CodeGraph VIEW produced by a direct_main_audit run, per
 * conversation. The read-only audit returns a `CodeGraphViewContract` (focus +
 * allowlists over the REAL CodeGraph — never new facts); the frontend polls the
 * latest one and applies it via setGraphViewContract to focus the existing
 * CodeGraphSurface on the audited branch. Bounded, in-process, honest: nothing is
 * stored unless an audit actually returned a valid view.
 */
export type CoderAuditView = {
  projectId: string;
  conversationId: string;
  childRunId: string;
  correlationId: string;
  conclusion: string;
  repositoryIdentity: string;
  revision: string;
  freshness: string;
  codeGraphQuery: string;
  codeGraphNodeRefs: string[];
  viewContract: CodeGraphViewContractResult;
  transcriptArtifact: string | null;
  updatedAt: string;
};

export type CoderAuditViewInput = Omit<CoderAuditView, 'updatedAt'>;

const MAX_VIEWS = 200;
const latest = new Map<string, CoderAuditView>();

function key(projectId: string, conversationId: string): string {
  return `${projectId}::${conversationId}`;
}

/** Record the latest audit view for a conversation. Bounded LRU-ish by insertion. */
export function setLatestCoderAuditView(input: CoderAuditViewInput, now = new Date().toISOString()): CoderAuditView {
  const view: CoderAuditView = { ...input, updatedAt: now };
  const k = key(input.projectId, input.conversationId);
  latest.delete(k); // re-insert to keep most-recent last for the size bound
  latest.set(k, view);
  while (latest.size > MAX_VIEWS) {
    const oldest = latest.keys().next().value;
    if (oldest === undefined) break;
    latest.delete(oldest);
  }
  return view;
}

/** The latest audit view for a conversation, or null. The caller (frontend)
 * rejects it if the project no longer matches — this never invents one. */
export function getLatestCoderAuditView(projectId: string, conversationId: string): CoderAuditView | null {
  return latest.get(key(projectId, conversationId)) ?? null;
}

/** Test-only reset. */
export function resetCoderAuditViewsForTest(): void {
  latest.clear();
}
