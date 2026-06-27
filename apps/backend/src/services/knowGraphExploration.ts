// @graph entity: KnowGraphExploration
// @graph role: semantic-lens-projection-over-raw-graph
// @graph relates_to: knowgraph.routes(/explore), KnowGraphEvidenceRetrieval
// @graph depends_on: Neo4j (KnowGraph, read-only)
//
// PURE projection that turns the RAW persisted KnowGraph (entities, assertions, EDGAR records,
// sources, AND storage/provenance/process/run/packet control records) into a bounded SEMANTIC
// EXPLORATION LENS. This is NOT a second graph and NOT deletion: every projected node/edge keeps
// the raw IDs that reach the original assertion / source / EDGAR / run records on inspect/expand.
//
// The default topology shows ONLY meaningful objects — entities, tickers, EDGAR sections, topics —
// connected by meaningful relationships (assertions become EDGES, not hub nodes). Storage/process/
// provenance roots (project UUID, GraphSeed, SearchPacket/Run, ResearchRun, etc.) are classified
// and EXCLUDED from topology (reachable later via a provenance lens / Inspector), never rendered as
// the central force-graph hubs that made the old view unusable.

export type ExplorationRole =
  | 'semantic-primary'   // entities you explore FROM: company, ticker/security, issuer, person
  | 'semantic-secondary' // entities you explore THROUGH: topic, EDGAR section, filing, question
  | 'evidence'           // source-backed assertions + sources (reachable on expand)
  | 'provenance'         // extraction/run provenance attached to evidence
  | 'process'            // search/research runs, packets, tasks, query patterns
  | 'storage';           // project root, graph seeds, retained chunks, control/validation records

export type RawNodeInput = { id: string; label?: string | null; type?: string | null; properties?: Record<string, unknown> | null };
export type RawEdgeInput = { id?: string | null; from?: string | null; to?: string | null; source?: string | null; target?: string | null; type?: string | null; properties?: Record<string, unknown> | null };

export type ExploreNode = {
  id: string;
  rawIds: string[];
  explorationRole: ExplorationRole;
  semanticKind: string;
  displayLabel: string;
  canonicalName: string;
  evidenceCount: number;
  statusSummary: Record<string, number>;
  sourceCount: number;
  sourceDates: string[];
  degree: number;
};

export type ExploreEdge = {
  id: string;
  rawIds: string[];
  source: string;
  target: string;
  predicate: string;
  direction: 'directed' | 'undirected';
  evidenceIds: string[];
  sourceIds: string[];
  statusCounts: Record<string, number>;
  weight: number;
  directness: 'asserted' | 'structural' | 'derived';
};

export type ExploreLens = {
  focus: { id: string | null; canonicalName: string | null; matched: boolean };
  lens: string;
  depth: number;
  nodes: ExploreNode[];
  edges: ExploreEdge[];
  excludedFromTopology: { byRole: Record<string, number>; note: string };
  warnings: string[];
};

export type ExploreOptions = {
  /** Free-text focus label — explicit SEARCH fallback only (may resolve to a merged entity). */
  focus?: string | null;
  /** Exact focus reference: a raw graph id (Neo4j elementId / assertion id / source ref) or a
   *  canonical lens id (kg:ent:* / kg:sec:* / kg:ev:* / kg:src:*). Takes precedence over `focus`. */
  focusId?: string | null;
  /** Semantic kind of the focused node (company/ticker/section/claim/source/topic). When it is an
   *  evidence kind the lens materializes assertion/source nodes so the claim/source can be centered. */
  focusKind?: string | null;
  lens?: string | null;
  depth?: number | null;
  /** Materialize source-backed assertions + sources as first-class nodes (claim/source lenses). */
  includeEvidence?: boolean;
};

const SECTION_LABEL: Readonly<Record<string, string>> = {
  businesscontext: 'Business',
  riskcontext: 'Risks',
  managementdiscussioncontext: 'MD&A',
};
const TICKER_RE = /^[A-Z]{1,5}$/;
const UNKNOWN_OBJECT = new Set(['', 'unknown', 'n/a', 'na', 'tbd', 'none']);

function s(v: unknown): string { return typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim(); }
function slug(v: string): string { return v.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80); }

// Canonical entity key: strip trailing corporate suffix words so "Redwire Corporation" and
// "Redwire" resolve to the SAME entity (one node carrying both its tickers and its topics). The
// fullest display name is kept on the merged node; raw IDs of all merged records are preserved.
const CORP_SUFFIX = /[\s,]+(corporation|corp|incorporated|inc|company|co|limited|ltd|plc|llc|holdings|holding|group)\.?$/i;
function entityCanonicalKey(name: string): string {
  let n = s(name); let prev = '';
  while (n !== prev) { prev = n; n = n.replace(CORP_SUFFIX, '').trim(); }
  return slug(n) || slug(name);
}

/** Classify a raw node into its exploration layer. Server-side semantics — never a UI blacklist. */
export function classifyRawRole(type: string): { role: ExplorationRole; kind: string } {
  const t = s(type).toLowerCase();
  if (['observedentity', 'company', 'organization', 'person', 'issuer', 'ticker', 'security'].includes(t)) {
    return { role: 'semantic-primary', kind: t === 'observedentity' ? 'entity' : t };
  }
  if (['businesscontext', 'riskcontext', 'managementdiscussioncontext', 'documentsection', 'filing', 'evidencesection', 'topic', 'product', 'event', 'question', 'assessment'].includes(t)) {
    return { role: 'semantic-secondary', kind: t };
  }
  if (['sourcebackedassertion', 'claim', 'source', 'proofclaim', 'observation'].includes(t)) {
    return { role: 'evidence', kind: t };
  }
  if (['searchrun', 'researchrun', 'searchpacket', 'searchtask', 'querypattern', 'decision', 'action'].includes(t)) {
    return { role: 'process', kind: t };
  }
  // project root, graphseed, retainedchunk, validation, guardrail, skill*, codegraphreference,
  // generic semanticrecord, and anything unrecognized → storage/control (never a topology hub).
  return { role: 'storage', kind: t || 'record' };
}

function predicateToSemantic(predicate: string): string {
  const p = s(predicate).toLowerCase();
  if (p === 'has_ticker_symbol' || p === 'trades_as') return 'TRADES_AS';
  if (!p) return 'RELATED_TO';
  return p.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'RELATED_TO';
}

function classifyObject(object: string): { role: ExplorationRole; kind: string } | null {
  const o = s(object);
  if (UNKNOWN_OBJECT.has(o.toLowerCase())) return null;
  if (TICKER_RE.test(o)) return { role: 'semantic-primary', kind: 'ticker' };
  return { role: 'semantic-secondary', kind: 'topic' };
}

const EVIDENCE_FOCUS_KINDS = new Set(['claim', 'assertion', 'sourcebackedassertion', 'source', 'evidence', 'proofclaim']);
/** A focus on a claim/source kind implies the evidence layer must be materialized to center it. */
export function focusKindNeedsEvidence(focusKind: string | null | undefined): boolean {
  return EVIDENCE_FOCUS_KINDS.has(s(focusKind).toLowerCase());
}

/** Concise human label for a materialized claim node — never the long raw assertion id. */
function conciseClaimLabel(subject: string, predicate: string, object: string): string {
  const p = s(predicate).replace(/_/g, ' ').toLowerCase();
  return `${s(subject)} ${p} ${s(object)}`.trim().slice(0, 64);
}

type NodeAcc = ExploreNode & { _edgeIds: Set<string> };

/**
 * Project the raw graph into a bounded semantic lens around a focus.
 * Pure + deterministic. Assertions are folded into edges (their subject/predicate/object), with
 * the assertion + source IDs preserved on the edge for expand/inspect. Storage/process/provenance
 * nodes are classified and excluded from the returned topology.
 */
export function projectExplorationLens(
  rawNodes: RawNodeInput[],
  rawEdges: RawEdgeInput[],
  opts: ExploreOptions = {},
): ExploreLens {
  const lens = s(opts.lens) || 'entity';
  const depth = Math.max(1, Math.min(3, Math.trunc(opts.depth ?? 1) || 1));
  // Evidence is materialized for any EXPLICIT focus (a deliberate drill-in wants the claim/source
  // layer), when the focus kind is itself a claim/source, or when explicitly requested. The unfocused
  // default load passes none of these → the overview topology stays clean (assertions stay folded).
  const includeEvidence =
    Boolean(opts.includeEvidence) || focusKindNeedsEvidence(opts.focusKind) || Boolean(s(opts.focusId));
  const warnings: string[] = [];

  const nodes = new Map<string, NodeAcc>();
  const edges = new Map<string, ExploreEdge>();
  // raw graph id (Neo4j elementId / assertion id / source ref) → canonical lens node id. This is what
  // makes EXACT focus possible: a unique raw id resolves to its node without label ambiguity.
  const rawIdToCanonical = new Map<string, string>();
  const excludedByRole: Record<string, number> = {};

  const ensureNode = (
    canonicalId: string,
    canonicalName: string,
    role: ExplorationRole,
    kind: string,
    displayLabel: string,
    rawId?: string,
  ): NodeAcc => {
    let n = nodes.get(canonicalId);
    if (!n) {
      n = {
        id: canonicalId, rawIds: [], explorationRole: role, semanticKind: kind,
        displayLabel, canonicalName, evidenceCount: 0, statusSummary: {}, sourceCount: 0,
        sourceDates: [], degree: 0, _edgeIds: new Set(),
      };
      nodes.set(canonicalId, n);
    }
    // Prefer a more specific role/kind when a node is seen multiple ways (e.g. ObservedEntity "RDW"
    // + Issuer "RDW" + assertion-object "RDW" all merge → ticker/issuer beats generic entity).
    if (role === 'semantic-primary' && n.explorationRole !== 'semantic-primary') {
      n.explorationRole = 'semantic-primary';
      n.semanticKind = kind;
    }
    const SPECIFIC = new Set(['ticker', 'security', 'issuer', 'company', 'organization', 'person']);
    if (SPECIFIC.has(kind) && !SPECIFIC.has(n.semanticKind)) n.semanticKind = kind;
    // Keep the fullest display name on a merged entity ("Redwire Corporation" beats "Redwire").
    if (!(n.semanticKind in SECTION_LABEL) && canonicalName.length > n.canonicalName.length) {
      n.canonicalName = canonicalName;
      n.displayLabel = displayLabel;
    }
    if (rawId && !n.rawIds.includes(rawId)) n.rawIds.push(rawId);
    return n;
  };

  // 1) Register semantic entities/sections from raw nodes; tally excluded roles; map raw→canonical.
  const rawById = new Map<string, RawNodeInput>();
  for (const raw of Array.isArray(rawNodes) ? rawNodes : []) {
    const id = s(raw.id);
    if (!id) continue;
    rawById.set(id, raw);
    const { role, kind } = classifyRawRole(s(raw.type));
    const props = (raw.properties || {}) as Record<string, unknown>;

    if (role === 'semantic-primary' || role === 'semantic-secondary') {
      const isSection = kind in SECTION_LABEL;
      const canonicalName = isSection
        ? s(raw.label) || id
        : s(props.ticker) || s(props.name) || s(props.canonical_name) || s(raw.label) || id;
      const canonicalId = isSection ? `kg:sec:${slug(canonicalName)}` : `kg:ent:${entityCanonicalKey(canonicalName)}`;
      const displayLabel = isSection ? (SECTION_LABEL[kind] ?? canonicalName) : canonicalName;
      ensureNode(canonicalId, canonicalName, role, kind, displayLabel, id);
      rawIdToCanonical.set(id, canonicalId);
    } else {
      excludedByRole[role] = (excludedByRole[role] || 0) + 1;
    }
  }

  // Ensure a canonical entity for a name referenced by an assertion (subject/object).
  const ensureNamedEntity = (name: string, role: ExplorationRole, kind: string): string => {
    const canonicalId = `kg:ent:${entityCanonicalKey(name)}`;
    ensureNode(canonicalId, name, role, kind, name);
    return canonicalId;
  };

  const addEdge = (
    from: string, to: string, predicate: string, directness: ExploreEdge['directness'],
    opts2: { rawId?: string; evidenceId?: string; sourceId?: string; status?: string; date?: string } = {},
  ) => {
    if (!from || !to || from === to) return; // no self-loop edges in topology (still in raw)
    const id = `${from}|${predicate}|${to}`;
    let e = edges.get(id);
    if (!e) {
      e = { id, rawIds: [], source: from, target: to, predicate, direction: 'directed', evidenceIds: [], sourceIds: [], statusCounts: {}, weight: 0, directness };
      edges.set(id, e);
    }
    e.weight += 1;
    if (opts2.rawId && !e.rawIds.includes(opts2.rawId)) e.rawIds.push(opts2.rawId);
    if (opts2.evidenceId && !e.evidenceIds.includes(opts2.evidenceId)) e.evidenceIds.push(opts2.evidenceId);
    if (opts2.sourceId && !e.sourceIds.includes(opts2.sourceId)) e.sourceIds.push(opts2.sourceId);
    if (opts2.status) e.statusCounts[opts2.status] = (e.statusCounts[opts2.status] || 0) + 1;
    const fn = nodes.get(from); const tn = nodes.get(to);
    if (fn) { fn._edgeIds.add(id); if (opts2.evidenceId) { fn.evidenceCount += 1; if (opts2.status) fn.statusSummary[opts2.status] = (fn.statusSummary[opts2.status] || 0) + 1; } if (opts2.sourceId) fn.sourceCount += 1; if (opts2.date) fn.sourceDates.push(opts2.date); }
    if (tn) tn._edgeIds.add(id);
  };

  // 2) Fold source-backed assertions into SEMANTIC EDGES (subject -[predicate]-> object).
  const competing = new Map<string, Map<string, string>>(); // subject|predicate -> outcome -> objectId
  for (const raw of rawById.values()) {
    if (classifyRawRole(s(raw.type)).kind !== 'sourcebackedassertion' && s(raw.type).toLowerCase() !== 'sourcebackedassertion') continue;
    const p = (raw.properties || {}) as Record<string, unknown>;
    const subject = s(p.subject); const object = s(p.object);
    if (!subject) continue;
    const subjectId = ensureNamedEntity(subject, 'semantic-primary', /\b(corp|corporation|inc|incorporated|company|co|ltd|plc|llc|holdings|group)\b/i.test(subject) ? 'company' : 'entity');
    const objClass = classifyObject(object);
    if (!objClass) { warnings.push(`assertion_object_unmapped:${slug(object) || 'empty'}`); continue; }
    const objectId = ensureNamedEntity(object, objClass.role, objClass.kind);
    const predicate = predicateToSemantic(s(p.predicate));
    const outcome = s(p.outcome).toLowerCase() || 'directly_stated';
    const sourceRef = s(p.source_ref) || s(p.source_url);
    if (includeEvidence) {
      // Materialize the assertion as a first-class node so a Claim/Source can be the lens center:
      //   subject -HAS_CLAIM-> claim -[predicate]-> object ;  claim -FROM_SOURCE-> source
      const claimId = `kg:ev:${slug(s(raw.id))}`;
      ensureNode(claimId, conciseClaimLabel(subject, s(p.predicate), object), 'evidence', 'claim', conciseClaimLabel(subject, s(p.predicate), object), s(raw.id));
      rawIdToCanonical.set(s(raw.id), claimId);
      addEdge(subjectId, claimId, 'HAS_CLAIM', 'asserted', { rawId: s(raw.id), evidenceId: s(raw.id), status: outcome });
      addEdge(claimId, objectId, predicate, 'asserted', { rawId: s(raw.id), evidenceId: s(raw.id), sourceId: sourceRef, status: outcome, date: s(p.created_at) });
      if (sourceRef) {
        const srcId = `kg:src:${slug(sourceRef)}`;
        ensureNode(srcId, s(p.source_title) || sourceRef, 'evidence', 'source', s(p.source_title) || sourceRef, sourceRef);
        rawIdToCanonical.set(sourceRef, srcId);
        addEdge(claimId, srcId, 'FROM_SOURCE', 'asserted', { sourceId: sourceRef });
      }
    } else {
      addEdge(subjectId, objectId, predicate, 'asserted', {
        rawId: s(raw.id), evidenceId: s(raw.id), sourceId: sourceRef, status: outcome, date: s(p.created_at),
      });
    }
    const key = `${slug(subject)}|${predicate}`;
    const byOutcome = competing.get(key) ?? new Map<string, string>();
    byOutcome.set(outcome, objectId);
    competing.set(key, byOutcome);
  }

  // 3) Weave EDGAR structure: Issuer -HAS_CONTEXT-> Section (real stored structural edges).
  for (const e of Array.isArray(rawEdges) ? rawEdges : []) {
    const type = s(e.type).toLowerCase();
    const fromRaw = s(e.from ?? e.source); const toRaw = s(e.to ?? e.target);
    if (!fromRaw || !toRaw) continue;
    const fromCanon = rawIdToCanonical.get(fromRaw); const toCanon = rawIdToCanonical.get(toRaw);
    if (!fromCanon || !toCanon) continue; // both endpoints must be semantic (raw storage edges drop out)
    if (type === 'has_context') addEdge(fromCanon, toCanon, 'HAS_CONTEXT', 'structural', { rawId: s(e.id) });
    else if (type === 'mentions_entity') addEdge(fromCanon, toCanon, 'MENTIONS', 'structural', { rawId: s(e.id) });
  }

  // 4) Explicit CONTRADICTS edge between competing supported/contradicted objects of the same claim.
  for (const byOutcome of competing.values()) {
    const sup = byOutcome.get('supported'); const con = byOutcome.get('contradicted');
    if (sup && con && sup !== con) addEdge(con, sup, 'CONTRADICTS', 'derived', { status: 'contradicted' });
  }

  // degree
  for (const n of nodes.values()) n.degree = n._edgeIds.size;

  // 5) Resolve focus. An EXACT id (raw graph id / canonical lens id, ANY role — company, ticker,
  // section, claim, source, topic) wins over the free-text label, which is only a search fallback.
  const focusIdReq = s(opts.focusId);
  const focusReq = s(opts.focus);
  const primaries = [...nodes.values()].filter((n) => n.explorationRole === 'semantic-primary');
  let focusNode: NodeAcc | null = null;
  let focusUnresolved = false;
  if (focusIdReq) {
    if (nodes.has(focusIdReq)) focusNode = nodes.get(focusIdReq)!;                       // canonical lens id
    else if (rawIdToCanonical.has(focusIdReq)) focusNode = nodes.get(rawIdToCanonical.get(focusIdReq)!) ?? null; // raw graph id
    // An unresolved focus id is almost always cross-project / out-of-scope → never silently center a
    // different object; fall back to the default and report it.
    if (!focusNode) { focusUnresolved = true; warnings.push(`focus_id_not_in_project_scope:${focusIdReq}`); }
  }
  if (!focusNode && focusReq && !focusIdReq) {
    // explicit SEARCH fallback (label) — across ALL roles, exact label first, then partial by degree.
    const fSlug = slug(focusReq);
    const all = [...nodes.values()];
    const exact = all.filter((n) => slug(n.canonicalName) === fSlug || slug(n.displayLabel) === fSlug);
    const partial = all.filter((n) => { const ns = slug(n.canonicalName); return ns.includes(fSlug) || fSlug.includes(ns); });
    focusNode = exact.sort((a, b) => b.degree - a.degree)[0] || partial.sort((a, b) => b.degree - a.degree)[0] || null;
  }
  // Default (no focus, or an out-of-scope focus id) → the highest-degree semantic-primary entity.
  if (!focusNode) focusNode = [...primaries].sort((a, b) => b.degree - a.degree)[0] || null;

  // 6) BFS depth-N from focus over semantic edges; pull EDGAR sections of any ticker/issuer reached.
  const keep = new Set<string>();
  if (focusNode) {
    const adj = new Map<string, Set<string>>();
    for (const e of edges.values()) {
      (adj.get(e.source) ?? adj.set(e.source, new Set()).get(e.source)!).add(e.target);
      (adj.get(e.target) ?? adj.set(e.target, new Set()).get(e.target)!).add(e.source);
    }
    let frontier = new Set<string>([focusNode.id]);
    keep.add(focusNode.id);
    for (let d = 0; d < depth; d += 1) {
      const next = new Set<string>();
      for (const id of frontier) for (const nb of adj.get(id) ?? []) if (!keep.has(nb)) { keep.add(nb); next.add(nb); }
      frontier = next;
    }
    // EDGAR reach: any kept node pulls in its HAS_CONTEXT sections (one extra hop), so a focus on
    // Redwire shows Redwire → RDW → Business/Risks/MD&A even at depth 1.
    for (const id of [...keep]) {
      for (const e of edges.values()) if (e.predicate === 'HAS_CONTEXT' && e.source === id) keep.add(e.target);
    }
    // Evidence reach: when the evidence layer is materialized, assertions are 2-hop
    // (subject -HAS_CLAIM-> claim -[predicate]-> object), so a plain depth-N BFS from an entity would
    // show its claims but not the objects (e.g. Redwire's claims but not RDW/RWE). Two extra hops fix
    // that while staying bounded to the focus neighborhood:
    if (includeEvidence) {
      // (a) any kept node pulls in the claim nodes incident to it (the evidence "generated here").
      for (const id of [...keep]) {
        for (const e of edges.values()) {
          const other = e.source === id ? e.target : e.target === id ? e.source : null;
          if (other && !keep.has(other) && nodes.get(other)?.explorationRole === 'evidence') keep.add(other);
        }
      }
      // (b) complete each kept claim's path — its subject, object AND source — so a claim is never a
      //     dangling node and the related tickers/entities/sources (and the CONTRADICTS edge between
      //     competing objects) stay visible around it.
      for (const id of [...keep]) {
        if (nodes.get(id)?.explorationRole !== 'evidence') continue;
        for (const e of edges.values()) {
          if (e.source === id) keep.add(e.target);
          if (e.target === id) keep.add(e.source);
        }
      }
    }
  } else {
    warnings.push('no_semantic_focus_resolved');
  }

  const keptNodes = [...nodes.values()].filter((n) => keep.has(n.id)).map(({ _edgeIds, ...n }) => n);
  const keptIds = new Set(keptNodes.map((n) => n.id));
  const keptEdges = [...edges.values()].filter((e) => keptIds.has(e.source) && keptIds.has(e.target));

  return {
    focus: {
      id: focusNode?.id ?? null,
      canonicalName: focusNode?.canonicalName ?? null,
      // matched = we centered on the EXACTLY requested focus (not a fallback after an unresolved id).
      matched: Boolean(focusNode) && !focusUnresolved,
    },
    lens, depth,
    nodes: keptNodes,
    edges: keptEdges,
    excludedFromTopology: { byRole: excludedByRole, note: 'process/storage/provenance records are reachable via Inspector/provenance lens, never rendered as topology hubs' },
    warnings,
  };
}
