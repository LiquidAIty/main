import { describe, expect, it } from 'vitest';

import {
  classifyKnowGraphRouteError,
  classifyKnowGraphSemanticResult,
  resolveKnowGraphLivePrecedence,
  resolveKnowGraphSourceLabel,
  semanticReadResultToLegacyKnowGraph,
} from './knowGraphView';

describe('KnowGraph read classification (honest, distinct failure modes)', () => {
  it('real records -> knowgraph-neo4j (ok)', () => {
    expect(classifyKnowGraphSemanticResult({ status: 'ok', nodeCount: 3, relCount: 2 })).toEqual({ ok: true, source: 'knowgraph-neo4j' });
  });

  it('legacy DTO path with data -> knowgraph-route', () => {
    expect(classifyKnowGraphSemanticResult({ status: 'ok', nodeCount: 1, relCount: 0, legacy: true })).toEqual({ ok: true, source: 'knowgraph-route' });
  });

  it('unavailable + "no records" -> honest no_knowgraph_records_for_project (ok, empty)', () => {
    const s = classifyKnowGraphSemanticResult({ status: 'unavailable', warnings: ['no semantic records found for project in persisted graph yet'], nodeCount: 0, relCount: 0 });
    expect(s.ok).toBe(true);
    expect(s.reason).toBe('no_knowgraph_records_for_project');
  });

  it('unavailable + auth warning -> neo4j_auth_failed (NOT empty success)', () => {
    const s = classifyKnowGraphSemanticResult({ status: 'unavailable', warnings: ['The client is unauthorized due to authentication failure.'], nodeCount: 0, relCount: 0 });
    expect(s.ok).toBe(false);
    expect(s.reason).toBe('neo4j_auth_failed');
    expect(s.blocker).toContain('authentication');
  });

  it('unavailable + generic error -> neo4j_unavailable (distinct from empty)', () => {
    const s = classifyKnowGraphSemanticResult({ status: 'unavailable', warnings: ['connect ECONNREFUSED 127.0.0.1:7687'], nodeCount: 0, relCount: 0 });
    expect(s.ok).toBe(false);
    expect(s.reason).toBe('neo4j_unavailable');
    expect(s.blocker).toContain('ECONNREFUSED');
  });

  it('route fetch error -> route_error with blocker', () => {
    expect(classifyKnowGraphRouteError('/api/knowgraph/semantic-graph | 500 | boom')).toMatchObject({ ok: false, source: 'unavailable', reason: 'route_error' });
  });

  it('route fetch error with auth -> neo4j_auth_failed', () => {
    expect(classifyKnowGraphRouteError('401 Unauthorized').reason).toBe('neo4j_auth_failed');
  });
});

describe('KnowGraph honest SHORT source label (no long reasons on canvas)', () => {
  it('reports knowgraph-neo4j when real records exist', () => {
    expect(resolveKnowGraphSourceLabel({ ok: true, source: 'knowgraph-neo4j' }, true, true)).toBe('knowgraph-neo4j');
  });

  it('reports a SHORT knowgraph-neo4j when read ok but empty (no_records detail stays off-canvas)', () => {
    expect(resolveKnowGraphSourceLabel({ ok: true, source: 'knowgraph-neo4j', reason: 'no_knowgraph_records_for_project' }, true, false)).toBe('knowgraph-neo4j');
  });

  it('reports a SHORT "unavailable" when the read failed (NOT host-provided, no long reason)', () => {
    const label = resolveKnowGraphSourceLabel({ ok: false, source: 'unavailable', reason: 'neo4j_auth_failed', blocker: 'auth' }, true, false);
    expect(label).toBe('unavailable');
    expect(label).not.toContain('host-provided');
    expect(label).not.toContain(':');
  });

  it('does NOT report unavailable just because ingest health failed (read runs independently)', () => {
    expect(resolveKnowGraphSourceLabel(null, false, false)).toBe('knowgraph-neo4j');
  });

  it('only falls back to host-provided when nothing read and legacy host data is present', () => {
    expect(resolveKnowGraphSourceLabel(null, true, true)).toBe('host-provided');
    expect(resolveKnowGraphSourceLabel(null, true, false)).toBe('knowgraph-neo4j');
  });

  it('never paints a long backend reason on the label', () => {
    for (const reason of ['no_knowgraph_records_for_project', 'neo4j_auth_failed', 'neo4j_unavailable', 'route_error']) {
      const ok = resolveKnowGraphSourceLabel({ ok: true, source: 'knowgraph-neo4j', reason }, true, false);
      const bad = resolveKnowGraphSourceLabel({ ok: false, source: 'unavailable', reason }, true, false);
      expect(ok).not.toContain(reason);
      expect(bad).not.toContain(reason);
    }
  });
});

describe('semanticReadResultToLegacyKnowGraph (live EDGAR context records reach normalization)', () => {
  it('ingests BusinessContext / RiskContext / ManagementDiscussionContext, preserving type + owlClass', () => {
    const live = {
      status: 'ok',
      records: [
        { id: 'biz-1', label: 'Item 1 - Business', owlClass: 'BusinessContext', properties: { scope: 'grounded_research' } },
        { id: 'risk-1', label: 'Item 1A - Risk Factors', owlClass: 'RiskContext', properties: {} },
        { id: 'mdna-1', label: 'Part I Item 2 - MD&A', owlClass: 'ManagementDiscussionContext', properties: {} },
      ],
      relationships: [{ id: 'r1', from: 'biz-1', to: 'risk-1', type: 'related_to' }],
      sourceRefs: [],
      warnings: [],
    } as any;

    const adapted = semanticReadResultToLegacyKnowGraph(live);
    const byId = new Map(adapted.nodes.map((n: any) => [n.id, n]));

    // The exact EDGAR context owlClasses the SPEC requires must survive into the legacy
    // graph nodes the existing KnowGraph tab normalizes/renders.
    expect(byId.get('biz-1')?.type).toBe('BusinessContext');
    expect(byId.get('risk-1')?.type).toBe('RiskContext');
    expect(byId.get('mdna-1')?.type).toBe('ManagementDiscussionContext');
    expect(byId.get('biz-1')?.properties.owlClass).toBe('BusinessContext');
    expect(byId.get('risk-1')?.properties.owlClass).toBe('RiskContext');
    expect(byId.get('mdna-1')?.properties.owlClass).toBe('ManagementDiscussionContext');
    expect(adapted.relationships).toHaveLength(1);
    expect(adapted.status).toBe('ok');
  });

  it('honest no-records / empty live read yields an empty graph (no fabricated nodes)', () => {
    const empty = { status: 'unavailable', records: [], relationships: [], sourceRefs: [], warnings: ['no semantic records found for project in persisted graph yet'] } as any;
    const adapted = semanticReadResultToLegacyKnowGraph(empty);
    expect(adapted.nodes).toHaveLength(0);
    expect(adapted.relationships).toHaveLength(0);
  });
});

describe('resolveKnowGraphLivePrecedence (live is authoritative; cache only on live failure)', () => {
  it('a successful live response with data WINS over cached KnowGraph data', () => {
    expect(
      resolveKnowGraphLivePrecedence({ liveAuthoritative: true, liveNodeCount: 29, liveRelCount: 12, cacheHasData: true }),
    ).toEqual({ display: 'live', status: 'Knowledge graph refresh succeeded.' });
  });

  it('cached KnowGraph data is used ONLY after a live request failure, preserving the honest reason', () => {
    const out = resolveKnowGraphLivePrecedence({
      liveAuthoritative: false,
      liveNodeCount: 0,
      liveRelCount: 0,
      liveReason: 'neo4j_unavailable',
      cacheHasData: true,
    });
    expect(out.display).toBe('cache');
    expect(out.reason).toBe('neo4j_unavailable');
    expect(out.status.toLowerCase()).toContain('cached');
  });

  it('live failure with NO cache does not invent a cache (display live, status failed)', () => {
    const out = resolveKnowGraphLivePrecedence({ liveAuthoritative: false, liveNodeCount: 0, liveRelCount: 0, liveReason: 'route_error', cacheHasData: false });
    expect(out.display).toBe('live');
    expect(out.status).toContain('failed');
  });

  it('an authoritative EMPTY (honest no-records) stays LIVE — never falls back to a stale cache', () => {
    const out = resolveKnowGraphLivePrecedence({ liveAuthoritative: true, liveNodeCount: 0, liveRelCount: 0, cacheHasData: true });
    expect(out.display).toBe('live');
    expect(out.reason).toBe('no_knowgraph_records_for_project');
  });

  it('never reports "Using cached knowledge graph." after a successful live read', () => {
    const out = resolveKnowGraphLivePrecedence({ liveAuthoritative: true, liveNodeCount: 10, liveRelCount: 9, cacheHasData: true });
    expect(out.status).not.toContain('Using cached knowledge graph.');
  });
});
