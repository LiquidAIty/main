/**
 * ThinkGraph project-reasoning role contract.
 *
 * ThinkGraph holds project reasoning (kept DISTINCT from KnowGraph). This module maps
 * the EXISTING structured ThinkGraph record `type`/`kind` to a small set of project
 * roles. It is a view/contract only and does not redesign the ThinkGraph view, convert
 * chat history into records, or alter Controls/filters.
 *
 * Live observed vocabulary for the active project includes `task` (project reasoning)
 * plus entity references `company` / `ticker` (these are NOT project-reasoning roles
 * and are reported explicitly unmapped — never force-fit). The broader structured
 * vocabulary the ThinkGraph writer can emit is mapped where it is genuinely a
 * reasoning role; everything else stays explicitly unmapped.
 *
 * Rules: no fabricated role assignment, no generic global ontology, no string-matching
 * role invention. Unmapped raw types remain explicit.
 */

export type ThinkGraphProjectRole =
  | 'Task'
  | 'Hypothesis'
  | 'Approval'
  | 'Decision'
  | 'ResearchNote'
  | 'Constraint'
  | 'Outcome'
  | 'NextAction'
  | 'OperationalRun';

/** Mapping keyed on the structured ThinkGraph record `type`/`kind` (lowercased exact
 *  match, not a fuzzy contains). Entity-reference types (company/ticker/entity) are
 *  intentionally ABSENT — they resolve to unmapped. */
export const THINKGRAPH_TYPE_ROLE: Readonly<
  Record<string, ThinkGraphProjectRole>
> = {
  task: 'Task',
  mission: 'Task',
  hypothesis: 'Hypothesis',
  approval: 'Approval',
  decision: 'Decision',
  research_note: 'ResearchNote',
  note: 'ResearchNote',
  summary: 'ResearchNote',
  constraint: 'Constraint',
  outcome: 'Outcome',
  result: 'Outcome',
  next_action: 'NextAction',
  action: 'NextAction',
  question: 'NextAction',
  agent_run: 'OperationalRun',
  run: 'OperationalRun',
  event: 'OperationalRun',
};

/**
 * Resolve the project-reasoning role for a ThinkGraph record from its structured
 * `type`/`kind`. Returns `null` for entity references (company/ticker/…) and any other
 * type that is not a project-reasoning role — callers must treat that as explicitly
 * unmapped rather than fabricating a role.
 */
export function resolveThinkGraphRole(
  typeOrKind: string | null | undefined,
): ThinkGraphProjectRole | null {
  const key = String(typeOrKind || '')
    .trim()
    .toLowerCase();
  if (!key) return null;
  return THINKGRAPH_TYPE_ROLE[key] ?? null;
}

/** Report which of the supplied raw types are not project-reasoning roles (e.g.
 *  company, ticker). Keeps coverage honest: unmapped raw types must be explicit. */
export function unmappedThinkGraphTypes(types: string[]): string[] {
  return Array.from(
    new Set(
      types
        .map((t) => String(t || '').trim().toLowerCase())
        .filter((t) => t && !(t in THINKGRAPH_TYPE_ROLE)),
    ),
  );
}
