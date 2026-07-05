import fs from 'node:fs';
import path from 'node:path';

/**
 * Structural edit-scope check for a LocalCoder run.
 *
 * CBM (Codebase Memory) is a capability the coder MAY use to code better — it is
 * NEVER a gate. A stale, missing, or unavailable CBM index does not block a run:
 * the coder reports CBM state honestly and inspects the repo normally. This
 * function enforces ONLY structural safety — the target must be a real directory
 * the coder is allowed to edit within (a valid root; no cross-project writes).
 * It does not run an index, require required files, or check index freshness.
 */
export type LocalCoderCbmScopeGateResult = {
  sourceRoot: string;
  scopeStatus: 'ok' | 'blocked';
  editAllowed: boolean;
  blockedReason: string;
};

export async function runLocalCoderCbmScopeGate(
  repoPath: string,
): Promise<LocalCoderCbmScopeGateResult> {
  const resolvedRoot = path.resolve(String(repoPath ?? ''));
  const blocked = (reason: string): LocalCoderCbmScopeGateResult => ({
    sourceRoot: resolvedRoot,
    scopeStatus: 'blocked',
    editAllowed: false,
    blockedReason: reason,
  });

  if (!String(repoPath ?? '').trim()) {
    return blocked('edit_scope_repo_path_required');
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolvedRoot);
  } catch {
    return blocked(`edit_scope_root_not_found: ${resolvedRoot}`);
  }
  if (!stat.isDirectory()) {
    return blocked(`edit_scope_root_not_a_directory: ${resolvedRoot}`);
  }
  return { sourceRoot: resolvedRoot, scopeStatus: 'ok', editAllowed: true, blockedReason: '' };
}
