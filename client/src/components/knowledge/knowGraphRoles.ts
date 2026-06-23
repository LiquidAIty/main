/**
 * KnowGraph semantic-role contract.
 *
 * The KnowGraph store keeps every record under the storage `kind:"entity"`; its real
 * semantic class lives in the structured `owlClass` (== `@type`) field. This module is
 * the code-native mapping from that EXISTING structured field to a small, explicit set
 * of semantic roles. It is a view/contract only — it does not redesign the KnowGraph
 * visualization, and it does not touch Controls or filters.
 *
 * Rules: no generic `Thing`, no loose label string-matching, no model-defined roles.
 * Every raw owlClass either maps to a declared role or is reported explicitly unmapped.
 * Raw source/packet/task/run/seed records stay durable — roles never delete them.
 *
 * Vocabulary below is the live observed KnowGraph vocabulary for the active project
 * (Source, SemanticRecord, SearchPacket, ObservedEntity, SearchTask,
 * SourceBackedAssertion, SearchRun, GraphSeed).
 */

export type KnowGraphSemanticRole =
  | 'PrimaryEntity'
  | 'Claim'
  | 'Observation'
  | 'Evidence'
  | 'Source'
  | 'ProvenanceProcess';

/** Explicit mapping from the structured KnowGraph `owlClass` to a semantic role. Keyed
 *  on the real OWL class string — not inferred from labels or text. */
export const KNOWGRAPH_OWLCLASS_ROLE: Readonly<
  Record<string, KnowGraphSemanticRole>
> = {
  ObservedEntity: 'PrimaryEntity',
  SemanticRecord: 'PrimaryEntity',
  SourceBackedAssertion: 'Claim',
  Source: 'Source',
  SearchPacket: 'ProvenanceProcess',
  SearchTask: 'ProvenanceProcess',
  SearchRun: 'ProvenanceProcess',
  GraphSeed: 'ProvenanceProcess',
};

/** A finer sub-role signal for `SemanticRecord` records, read ONLY from the structured
 *  inner `entities[0].properties.owlClass` field (e.g. Claim). Still no string-matching. */
const SEMANTIC_RECORD_SUBROLE: Readonly<Record<string, KnowGraphSemanticRole>> = {
  Claim: 'Claim',
  Observation: 'Observation',
};

export type KnowGraphRoleInput = {
  owlClass?: string | null;
  /** Optional inner structured sub-class for SemanticRecord (entities[0].properties.owlClass). */
  innerOwlClass?: string | null;
};

/**
 * Resolve the semantic role for a KnowGraph record from its structured fields.
 * Returns `null` when the owlClass is unknown (caller must treat that as explicitly
 * unmapped — never silently default to a generic role).
 */
export function resolveKnowGraphRole(
  input: KnowGraphRoleInput,
): KnowGraphSemanticRole | null {
  const owlClass = String(input?.owlClass || '').trim();
  if (!owlClass) return null;
  const base = KNOWGRAPH_OWLCLASS_ROLE[owlClass];
  if (!base) return null;
  if (owlClass === 'SemanticRecord') {
    const inner = String(input?.innerOwlClass || '').trim();
    const sub = inner ? SEMANTIC_RECORD_SUBROLE[inner] : undefined;
    if (sub) return sub;
  }
  return base;
}

/** Report which of the supplied raw owlClasses are not covered by the mapping. Used to
 *  keep coverage honest: unmapped raw types must be explicit, never invented. */
export function unmappedKnowGraphOwlClasses(owlClasses: string[]): string[] {
  return Array.from(
    new Set(
      owlClasses
        .map((c) => String(c || '').trim())
        .filter((c) => c && !(c in KNOWGRAPH_OWLCLASS_ROLE)),
    ),
  );
}
