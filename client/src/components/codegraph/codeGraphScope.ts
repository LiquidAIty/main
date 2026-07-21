/**
 * CodeGraphScope — explicit, bounded, reversible code-context contract for a future
 * CoderPacket. It lets a task request only the slice of the CodeGraph it needs
 * (repository → folder → module → symbol → dependency/test depth) WITHOUT inferring
 * scope from chat text, filenames, or ranking, and without defaulting to "the whole
 * repository" once an explicit bounded scope is supplied.
 *
 * This is a context contract for the Coder, not a new visual panel. It does not change
 * the CodeGraph renderer, Controls, or filters. Raw CBM node/edge IDs are preserved so
 * any selection stays fully reversible to the live index.
 */

/** A bounded CodeGraph selection. `repositoryId` is the authoritative CBM project
 *  identity (resolved via CBM root-path matching, never hardcoded). */
export type CodeGraphScope = {
  repositoryId: string; // CBM project identity, e.g. "C-Projects-main"
  rootPath: string;
  folderPath?: string; // explicit path only — never guessed from a filename
  moduleIds?: string[]; // explicit CBM module ids only
  symbolIds?: string[]; // explicit CBM symbol ids only
  testIds?: string[]; // explicit CBM test ids only
  dependencyDepth?: number; // explicit bounded integer (0..MAX_DEPENDENCY_DEPTH)
  includeImports?: boolean;
  includeTests?: boolean;
  representedRawNodeIds: string[]; // raw CBM node ids this scope stands for
  representedRawEdgeIds: string[]; // raw CBM edge ids this scope stands for
};

export const MAX_DEPENDENCY_DEPTH = 10;

type CodeGraphScopeValidation = { ok: boolean; errors: string[] };

function isExplicitIdList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((v) => typeof v === 'string' && v.trim().length > 0)
  );
}

/**
 * Validate a CodeGraphScope. The identity must be explicit (no default / guessed
 * fallback), id lists must contain only non-empty explicit ids, and dependencyDepth
 * must be a bounded non-negative integer. Returns the collected errors so callers can
 * fail closed rather than silently proceeding.
 */
export function validateCodeGraphScope(
  scope: CodeGraphScope,
): CodeGraphScopeValidation {
  const errors: string[] = [];
  if (!scope || typeof scope !== 'object') {
    return { ok: false, errors: ['scope missing'] };
  }
  if (!String(scope.repositoryId || '').trim()) {
    errors.push('repositoryId required (authoritative CBM identity, no default)');
  }
  if (!String(scope.rootPath || '').trim()) {
    errors.push('rootPath required');
  }
  if (scope.folderPath !== undefined && !String(scope.folderPath).trim()) {
    errors.push('folderPath, when present, must be an explicit non-empty path');
  }
  for (const key of ['moduleIds', 'symbolIds', 'testIds'] as const) {
    const value = scope[key];
    if (value !== undefined && !isExplicitIdList(value)) {
      errors.push(`${key} must be a list of explicit non-empty ids`);
    }
  }
  if (scope.dependencyDepth !== undefined) {
    const d = scope.dependencyDepth;
    if (!Number.isInteger(d) || d < 0 || d > MAX_DEPENDENCY_DEPTH) {
      errors.push(
        `dependencyDepth must be an integer in 0..${MAX_DEPENDENCY_DEPTH}`,
      );
    }
  }
  if (!Array.isArray(scope.representedRawNodeIds)) {
    errors.push('representedRawNodeIds must be present (raw CBM ids, reversible)');
  }
  if (!Array.isArray(scope.representedRawEdgeIds)) {
    errors.push('representedRawEdgeIds must be present (raw CBM ids, reversible)');
  }
  return { ok: errors.length === 0, errors };
}

/** True when the scope is explicitly bounded (a folder, module(s), or symbol(s) was
 *  selected) — i.e. it must NOT be widened to the whole repository. */
export function isBoundedCodeGraphScope(scope: CodeGraphScope): boolean {
  return Boolean(
    String(scope.folderPath || '').trim() ||
      (scope.moduleIds && scope.moduleIds.length > 0) ||
      (scope.symbolIds && scope.symbolIds.length > 0) ||
      (scope.testIds && scope.testIds.length > 0),
  );
}
