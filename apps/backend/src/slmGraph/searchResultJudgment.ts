// Direct source-result judgment at ingest time. The graph is emergent, not gated: each search
// result is JUDGED now (against graph-seed knowledge + its own source title/snippet text) and
// the evaluated outcome (supported / contradicted / uncertain) is written straight into
// KnowGraph with its source evidence. There is NO candidate/draft/promotion/review/approval
// stage — `outcome` is the evaluated result, not a workflow state. Contradictions and
// uncertainty are preserved as first-class search signals for the next traversal.
//
// Conservative v1: judges only the source TITLE/snippet text Tavily already returned. It never
// fetches/scrapes pages, never invents a price or ticker, never asserts SpaceX is public, and
// never manufactures a relation just because two entities co-occur. Reuses the Neo4j singleton
// and the shared safe property serializer — no second graph stack, no live Tavily call here.
import type { Driver } from 'neo4j-driver';
import { getNeo4jDriver } from '../connectors/neo4j';
import { toNeoSafeProperties } from '../graph/neoSafeProperties';
import type { SearchAgentResultPacket } from './graphSeededSearchConvergence';

export type SourceBackedAssertion = {
  id: string;
  projectId: string;
  runId?: string;
  packetId?: string;
  sourceRef: string;
  sourceUrl?: string;
  sourceTitle?: string;
  subject: string;
  predicate: string;
  object: string;
  outcome: 'supported' | 'contradicted' | 'uncertain';
  confidence?: number;
  evidenceText?: string;
  uncertainty?: string[];
  extractionMethod: 'deterministic_title_snippet' | 'model_extracted';
  graphSeedRef?: string;
  /** Internal: ids of assertions this one conflicts with (same subject/predicate, different object). */
  contradictsIds?: string[];
};

/** An assertion the graph wants evidence for, anchored in graph-seed knowledge (not free text). */
export type AssertionTarget = {
  subject: string;
  predicate: string;
  /** The graph-known object (e.g. ticker 'RDW'). A source object matching this -> supported; a
   *  different sourced object -> contradicted. */
  expectedObject?: string;
  /** Source-text tokens that evidence this predicate (e.g. ticker/symbol/nyse). */
  predicateEvidenceTokens?: string[];
  /** Value-seeking target (price/valuation) — never invent a value; outcome is uncertain. */
  unknownObject?: boolean;
  /** 'ticker' enables bounded ticker-token extraction from source text. */
  objectKind?: 'ticker' | 'value' | 'text';
};

export type JudgeInput = {
  projectId: string;
  runId?: string;
  graphSeedRef?: string;
  targets: AssertionTarget[];
  packets: SearchAgentResultPacket[];
};

// Evidence-only KnowGraph labels/relationships. `outcome` carries the verdict; no fake-certainty
// relationship names are ever written.
export const ASSERTION_NODE_LABELS = ['SourceBackedAssertion', 'Source', 'SearchPacket', 'GraphSeed', 'ObservedEntity'] as const;
export const ASSERTION_REL_TYPES = ['ASSERTED_BY_SOURCE', 'ASSERTED_IN_PACKET', 'DERIVED_FROM_GRAPH_SEED', 'CONTRADICTS', 'RELATES_TO_ENTITY'] as const;
export const FORBIDDEN_REL_TYPES = ['PROVES', 'CONFIRMS', 'IS_TRUE', 'HAS_PRICE', 'PUBLICLY_TRADES_AS'] as const;

// Uppercase tokens that look like tickers but are not (exchanges / common acronyms).
const TICKER_STOPWORDS = new Set(['NYSE', 'NASDAQ', 'OTC', 'SEC', 'IPO', 'ETF', 'CEO', 'CFO', 'USD', 'EUR', 'AI', 'API', 'US', 'UK', 'EU', 'LLC', 'INC', 'CORP', 'ETF', 'PE', 'VC', 'Q1', 'Q2', 'Q3', 'Q4']);

function clean(v: unknown): string {
  return String(v ?? '').trim();
}
function lc(v: unknown): string {
  return clean(v).toLowerCase();
}
function anchorTokens(subject: string): string[] {
  const full = lc(subject);
  const first = full.split(/\s+/)[0] || full;
  return Array.from(new Set([full, first].filter((t) => t.length >= 3)));
}
/** Bounded EVIDENCE parsing (like URL-domain extraction): uppercase 2-5 letter ticker-shaped
 *  tokens. NOT task routing / intent classification — it reads tickers out of source text. */
function extractTickerTokens(text: string): string[] {
  const matches = clean(text).match(/\b[A-Z]{2,5}\b/g) || [];
  return Array.from(new Set(matches)).filter((t) => !TICKER_STOPWORDS.has(t));
}

function assertionId(projectId: string, subject: string, predicate: string, object: string, sourceKey: string): string {
  return `${projectId}::assertion::${lc(subject)}::${lc(predicate)}::${lc(object)}::${sourceKey}`;
}

/**
 * Judge search packets against graph-seed targets using ONLY source title/snippet text.
 * Returns direct source-backed assertions with evaluated outcomes. Pure — no DB, no network.
 * - supported: a source's text anchors the subject + predicate evidence + the graph-expected object.
 * - contradicted: a source's text anchors the subject + predicate but a DIFFERENT sourced object.
 * - uncertain: a value-seeking target (price/valuation) with no figure in the text, or an
 *   expected object that no source supported. Never invents the missing value.
 */
export function judgeSearchPackets(input: JudgeInput): SourceBackedAssertion[] {
  const projectId = clean(input.projectId);
  const runId = clean(input.runId) || undefined;
  const graphSeedRef = clean(input.graphSeedRef) || undefined;
  const targets = Array.isArray(input.targets) ? input.targets : [];
  const packets = Array.isArray(input.packets) ? input.packets : [];
  if (!projectId) return [];

  const out: SourceBackedAssertion[] = [];

  for (const target of targets) {
    const subject = clean(target.subject);
    const predicate = clean(target.predicate);
    if (!subject || !predicate) continue;
    const anchors = anchorTokens(subject);
    const predTokens = (target.predicateEvidenceTokens || []).map(lc).filter(Boolean);
    const expected = clean(target.expectedObject);

    let supportedThisTarget = false;
    let firstRelevantSource: { ref: string; url?: string; title?: string; packetId?: string } | null = null;
    const seen = new Set<string>();

    for (const packet of packets) {
      const packetId = clean(packet.searchTaskId) ? `${runId || 'run'}::packet::${clean(packet.searchTaskId)}::${clean(packet.agentId) || 'a'}` : undefined;
      for (const ref of Array.isArray(packet.sourceRefs) ? packet.sourceRefs : []) {
        const url = clean(ref?.url || ref?.ref);
        const title = clean(ref?.title);
        const text = `${title} ${clean((ref as any)?.snippet)}`;
        const textLc = text.toLowerCase();
        const hasAnchor = anchors.some((a) => textLc.includes(a));
        const hasPredEvidence = predTokens.length === 0 || predTokens.some((t) => textLc.includes(t));
        if (!hasAnchor || !hasPredEvidence) continue;
        if (!firstRelevantSource) firstRelevantSource = { ref: clean(ref?.ref) || url, url, title, packetId };

        if (target.unknownObject) {
          // Value-seeking: do NOT extract or invent a value from a title/snippet. Handled as
          // a single uncertain assertion below, anchored to a relevant source.
          continue;
        }

        // Object candidates from the source text (bounded evidence parsing) + the expected object
        // when it literally appears in the text.
        const candidateObjects = new Set<string>();
        if (target.objectKind === 'ticker' || /ticker/.test(lc(predicate))) {
          extractTickerTokens(text).forEach((t) => candidateObjects.add(t));
        }
        if (expected && textLc.includes(expected.toLowerCase())) candidateObjects.add(expected);

        for (const object of candidateObjects) {
          const sourceKey = url || clean(ref?.ref) || 'src';
          const dedupe = `${lc(object)}::${sourceKey}`;
          if (seen.has(dedupe)) continue;
          seen.add(dedupe);
          const outcome: SourceBackedAssertion['outcome'] = expected && lc(object) === expected.toLowerCase() ? 'supported' : 'contradicted';
          if (outcome === 'supported') supportedThisTarget = true;
          out.push({
            id: assertionId(projectId, subject, predicate, object, sourceKey),
            projectId,
            runId,
            packetId,
            sourceRef: clean(ref?.ref) || url,
            sourceUrl: url || undefined,
            sourceTitle: title || undefined,
            subject,
            predicate,
            object,
            outcome,
            confidence: outcome === 'supported' ? 0.6 : 0.5,
            evidenceText: title || text,
            extractionMethod: 'deterministic_title_snippet',
            graphSeedRef,
          });
        }
      }
    }

    if (target.unknownObject) {
      const src = firstRelevantSource;
      const sourceKey = src?.url || src?.ref || 'no_source';
      out.push({
        id: assertionId(projectId, subject, predicate, 'unknown', sourceKey),
        projectId,
        runId,
        packetId: src?.packetId,
        sourceRef: src?.ref || 'no_source',
        sourceUrl: src?.url,
        sourceTitle: src?.title,
        subject,
        predicate,
        object: 'unknown',
        outcome: 'uncertain',
        confidence: 0.2,
        evidenceText: src?.title,
        uncertainty: [`Source title/snippet did not contain a dated ${predicate} figure.`],
        extractionMethod: 'deterministic_title_snippet',
        graphSeedRef,
      });
    } else if (!supportedThisTarget) {
      const src = firstRelevantSource;
      out.push({
        id: assertionId(projectId, subject, predicate, expected || 'unknown', src?.url || src?.ref || 'no_source'),
        projectId,
        runId,
        packetId: src?.packetId,
        sourceRef: src?.ref || 'no_source',
        sourceUrl: src?.url,
        sourceTitle: src?.title,
        subject,
        predicate,
        object: expected || 'unknown',
        outcome: 'uncertain',
        confidence: 0.2,
        evidenceText: src?.title,
        uncertainty: ['No source title/snippet supported this assertion.'],
        extractionMethod: 'deterministic_title_snippet',
        graphSeedRef,
      });
    }
  }

  // Link contradictions: same subject+predicate, a contradicted object vs a supported object.
  const byKey = new Map<string, SourceBackedAssertion[]>();
  for (const a of out) {
    const k = `${lc(a.subject)}::${lc(a.predicate)}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(a);
  }
  for (const group of byKey.values()) {
    const supported = group.filter((a) => a.outcome === 'supported');
    const contradicted = group.filter((a) => a.outcome === 'contradicted');
    for (const c of contradicted) {
      const targets = supported.filter((s) => lc(s.object) !== lc(c.object)).map((s) => s.id);
      if (targets.length > 0) c.contradictsIds = Array.from(new Set([...(c.contradictsIds || []), ...targets]));
    }
  }

  return out;
}

export type JudgeIngestInput = {
  projectId: string;
  runId: string;
  graphSeedRef?: string;
  graphSeed?: { targets: AssertionTarget[] };
  targets?: AssertionTarget[];
  packets: SearchAgentResultPacket[];
};

export type JudgeIngestResult =
  | { ok: true; projectId: string; runId: string; assertionCount: number; outcomes: { supported: number; contradicted: number; uncertain: number }; contradictionLinks: number }
  | { ok: false; reason: string };

export type JudgeIngestDeps = { driver?: Driver };

/**
 * Judge packets and write the source-backed assertions DIRECTLY into KnowGraph (project-scoped).
 * No candidate/promotion stage. Idempotent MERGE (dedupes by subject/predicate/object/sourceRef).
 * Fails closed before any DB touch on invalid input. Never calls Tavily.
 */
export async function judgeAndIngestSearchPacketsToKnowGraph(
  input: JudgeIngestInput,
  deps: JudgeIngestDeps = {},
): Promise<JudgeIngestResult> {
  const projectId = clean(input.projectId);
  const runId = clean(input.runId);
  if (!projectId) return { ok: false, reason: 'project_id_required' };
  if (!runId) return { ok: false, reason: 'run_id_required' };
  const targets = input.targets || input.graphSeed?.targets || [];
  if (!Array.isArray(targets) || targets.length === 0) return { ok: false, reason: 'targets_required' };
  if (!Array.isArray(input.packets) || input.packets.length === 0) return { ok: false, reason: 'no_packets' };

  const assertions = judgeSearchPackets({ projectId, runId, graphSeedRef: input.graphSeedRef, targets, packets: input.packets });
  if (assertions.length === 0) return { ok: false, reason: 'no_assertions' };

  const driver = deps.driver ?? getNeo4jDriver();
  const database = clean(process.env.NEO4J_DATABASE);
  const session = driver.session(database ? { database } : undefined);
  let contradictionLinks = 0;
  try {
    for (const a of assertions) {
      const props = toNeoSafeProperties({
        id: a.id,
        project_id: projectId,
        run_id: runId,
        packet_id: a.packetId || null,
        subject: a.subject,
        predicate: a.predicate,
        object: a.object,
        outcome: a.outcome,
        confidence: typeof a.confidence === 'number' ? a.confidence : null,
        evidence_text: a.evidenceText || null,
        uncertainty: a.uncertainty || [],
        source_ref: a.sourceRef,
        source_url: a.sourceUrl || null,
        source_title: a.sourceTitle || null,
        extraction_method: a.extractionMethod,
        graph_seed_ref: a.graphSeedRef || null,
        created_at: new Date().toISOString(),
      });
      await session.run(
        `MERGE (a:SourceBackedAssertion { id: $id })
         SET a += $props, a.id = $id, a.project_id = $projectId`,
        { id: a.id, props, projectId },
      );

      // assertion -> source
      const sourceUrl = a.sourceUrl || a.sourceRef;
      if (sourceUrl && sourceUrl !== 'no_source') {
        const sourceId = `${projectId}::source::${sourceUrl}`;
        await session.run(
          `MERGE (s:Source { id: $sourceId })
           ON CREATE SET s.created_at = $ts
           SET s.project_id = $projectId, s.url = $url, s.title = $title, s.ref = $ref
           WITH s
           MATCH (a:SourceBackedAssertion { id: $id })
           MERGE (a)-[r:ASSERTED_BY_SOURCE { id: $relId }]->(s)
           SET r.project_id = $projectId`,
          { sourceId, projectId, url: sourceUrl, title: a.sourceTitle || sourceUrl, ref: a.sourceRef, ts: new Date().toISOString(), id: a.id, relId: `${a.id}->source` },
        );
      }

      // assertion -> graph seed
      if (a.graphSeedRef) {
        const seedId = `${projectId}::seed::${a.graphSeedRef}`;
        await session.run(
          `MERGE (g:GraphSeed { id: $seedId })
           SET g.project_id = $projectId, g.source_ref = $seedRef
           WITH g
           MATCH (a:SourceBackedAssertion { id: $id })
           MERGE (a)-[r:DERIVED_FROM_GRAPH_SEED { id: $relId }]->(g)
           SET r.project_id = $projectId`,
          { seedId, projectId, seedRef: a.graphSeedRef, id: a.id, relId: `${a.id}->seed` },
        );
      }

      // assertion -> packet
      if (a.packetId) {
        await session.run(
          `MERGE (p:SearchPacket { id: $packetId })
           SET p.project_id = $projectId, p.run_id = $runId
           WITH p
           MATCH (a:SourceBackedAssertion { id: $id })
           MERGE (a)-[r:ASSERTED_IN_PACKET { id: $relId }]->(p)
           SET r.project_id = $projectId`,
          { packetId: a.packetId, projectId, runId, id: a.id, relId: `${a.id}->packet` },
        );
      }

      // assertion -> subject entity (observed)
      const entityId = `${projectId}::obsentity::${lc(a.subject)}`;
      await session.run(
        `MERGE (e:ObservedEntity { id: $entityId })
         SET e.project_id = $projectId, e.label = $label, e.label_lc = $labelLc, e.observed = true
         WITH e
         MATCH (a:SourceBackedAssertion { id: $id })
         MERGE (a)-[r:RELATES_TO_ENTITY { id: $relId }]->(e)
         SET r.project_id = $projectId`,
        { entityId, projectId, label: a.subject, labelLc: lc(a.subject), id: a.id, relId: `${a.id}->entity` },
      );
    }

    // contradiction links
    for (const a of assertions) {
      for (const otherId of a.contradictsIds || []) {
        await session.run(
          `MATCH (a:SourceBackedAssertion { id: $fromId, project_id: $projectId }),
                 (b:SourceBackedAssertion { id: $toId, project_id: $projectId })
           MERGE (a)-[r:CONTRADICTS { id: $relId }]->(b)
           SET r.project_id = $projectId`,
          { fromId: a.id, toId: otherId, projectId, relId: `${a.id}-contradicts-${otherId}` },
        );
        contradictionLinks += 1;
      }
    }

    const outcomes = {
      supported: assertions.filter((a) => a.outcome === 'supported').length,
      contradicted: assertions.filter((a) => a.outcome === 'contradicted').length,
      uncertain: assertions.filter((a) => a.outcome === 'uncertain').length,
    };
    return { ok: true, projectId, runId, assertionCount: assertions.length, outcomes, contradictionLinks };
  } catch (err: any) {
    return { ok: false, reason: clean(err?.message) || 'assertion_write_failed' };
  } finally {
    await session.close();
  }
}

export type AssertionReadBackResult =
  | {
      ok: true;
      projectId: string;
      runId: string;
      assertions: Array<{ id: string; subject: string; predicate: string; object: string; outcome: string; sourceRef: string }>;
      outcomes: { supported: number; contradicted: number; uncertain: number };
      relTypes: string[];
      forbiddenRelTypesFound: string[];
      labels: string[];
      forbiddenLabelsFound: string[];
      allHaveSourceRef: boolean;
    }
  | { ok: false; reason: string };

/** Read back assertions for a run to prove outcomes, sourceRefs, links, and that no forbidden
 *  truth-claim relationship and no candidate/draft/promotion label exist. */
export async function readBackSourceAssertions(
  query: { projectId: string; runId: string },
  deps: JudgeIngestDeps = {},
): Promise<AssertionReadBackResult> {
  const projectId = clean(query.projectId);
  const runId = clean(query.runId);
  if (!projectId || !runId) return { ok: false, reason: 'project_id_and_run_id_required' };

  const driver = deps.driver ?? getNeo4jDriver();
  const database = clean(process.env.NEO4J_DATABASE);
  const session = driver.session(database ? { database } : undefined);
  try {
    const res = await session.run(
      `MATCH (a:SourceBackedAssertion { project_id: $projectId, run_id: $runId })
       OPTIONAL MATCH (a)-[r]->(x)
       RETURN a.id AS id, a.subject AS subject, a.predicate AS predicate, a.object AS object,
         a.outcome AS outcome, a.source_ref AS source_ref,
         collect(DISTINCT type(r)) AS rel_types, collect(DISTINCT labels(x)) AS neighbor_labels`,
      { projectId, runId },
    );
    const assertions: Array<{ id: string; subject: string; predicate: string; object: string; outcome: string; sourceRef: string }> = [];
    const relTypeSet = new Set<string>();
    const labelSet = new Set<string>(['SourceBackedAssertion']);
    let allHaveSourceRef = true;
    for (const rec of res.records) {
      const sourceRef = clean(rec.get('source_ref'));
      if (!sourceRef || sourceRef === 'no_source') allHaveSourceRef = false;
      (rec.get('rel_types') as any[]).filter(Boolean).forEach((t) => relTypeSet.add(String(t)));
      (rec.get('neighbor_labels') as any[]).forEach((labels) => (Array.isArray(labels) ? labels : []).forEach((l) => labelSet.add(String(l))));
      assertions.push({
        id: clean(rec.get('id')),
        subject: clean(rec.get('subject')),
        predicate: clean(rec.get('predicate')),
        object: clean(rec.get('object')),
        outcome: clean(rec.get('outcome')),
        sourceRef,
      });
    }
    const relTypes = Array.from(relTypeSet);
    const labels = Array.from(labelSet);
    const forbiddenRelTypesFound = relTypes.filter((t) => (FORBIDDEN_REL_TYPES as readonly string[]).includes(t));
    const forbiddenLabelsFound = labels.filter((l) => /candidate|draft|promotion|approval|review|queue/i.test(l));
    const outcomes = {
      supported: assertions.filter((a: any) => a.outcome === 'supported').length,
      contradicted: assertions.filter((a: any) => a.outcome === 'contradicted').length,
      uncertain: assertions.filter((a: any) => a.outcome === 'uncertain').length,
    };
    return { ok: true, projectId, runId, assertions, outcomes, relTypes, forbiddenRelTypesFound, labels, forbiddenLabelsFound, allHaveSourceRef };
  } catch (err: any) {
    return { ok: false, reason: clean(err?.message) || 'assertion_read_failed' };
  } finally {
    await session.close();
  }
}
