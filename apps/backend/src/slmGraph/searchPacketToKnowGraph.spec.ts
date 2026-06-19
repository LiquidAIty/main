import { describe, expect, it, vi } from 'vitest';

import {
  EVIDENCE_NODE_LABELS,
  EVIDENCE_REL_TYPES,
  TRUTH_CLAIM_REL_TYPES,
  ingestSearchAgentPacketsToKnowGraph,
  searchPacketsToKnowGraphEvidence,
} from './searchPacketToKnowGraph';
import type { SearchAgentResultPacket } from './graphSeededSearchConvergence';

const PROJECT_ID = '20ac92da-01fd-4cf6-97cc-0672421e751a';
const RUN_ID = 'search-run-test-1';

const PACKETS: SearchAgentResultPacket[] = [
  {
    agentId: 'entity-agent', searchTaskId: 't_entity_1', query: 'Redwire Corporation requires company',
    sourceRefs: [{ ref: 'https://finance.yahoo.com/quote/RDW', url: 'https://finance.yahoo.com/quote/RDW', title: 'RDW - Yahoo Finance', sourceType: 'web' }],
    entities: [{ label: 'Redwire Corporation', confidence: 0.8 }],
    relations: [], claims: [], uncertainty: ['live_v1: title/snippet match only'],
  },
  {
    agentId: 'entity-agent', searchTaskId: 't_entity_2', query: 'RDW',
    // SAME url as packet 1 -> must dedupe to one Source node
    sourceRefs: [{ ref: 'https://finance.yahoo.com/quote/RDW', url: 'https://finance.yahoo.com/quote/RDW', title: 'RDW - Yahoo Finance', sourceType: 'web' }],
    entities: [{ label: 'RDW', confidence: 0.8 }],
    relations: [], claims: [], uncertainty: [],
  },
];

const BASE = { projectId: PROJECT_ID, runId: RUN_ID, graphSeedSourceRef: 'user_request_stream', packets: PACKETS };

function isSafeValue(v: unknown): boolean {
  if (v === null) return true;
  if (Array.isArray(v)) return v.every((x) => x === null || ['string', 'number', 'boolean'].includes(typeof x));
  return ['string', 'number', 'boolean'].includes(typeof v);
}

function fakeDriver() {
  const runs: Array<{ cypher: string; params: any }> = [];
  const session = {
    run: vi.fn(async (cypher: string, params: any) => { runs.push({ cypher, params }); return { records: [] }; }),
    close: vi.fn(async () => {}),
  };
  const driver = { session: vi.fn(() => session) } as any;
  return { driver, session, runs };
}

describe('searchPacketsToKnowGraphEvidence (pure mapper)', () => {
  it('produces only safe evidence node labels and relationship types', () => {
    const plan = searchPacketsToKnowGraphEvidence(BASE);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    for (const n of plan.nodes) expect(EVIDENCE_NODE_LABELS).toContain(n.label);
    for (const r of plan.relationships) expect(EVIDENCE_REL_TYPES).toContain(r.type);
  });

  it('writes NO truth-claim relationship types', () => {
    const plan = searchPacketsToKnowGraphEvidence(BASE);
    if (!plan.ok) return;
    const types = new Set(plan.relationships.map((r) => r.type));
    for (const banned of TRUTH_CLAIM_REL_TYPES) expect(types.has(banned as any)).toBe(false);
    // and the relationships used are provenance-only
    expect(types.has('RETURNED_SOURCE')).toBe(true);
    expect(types.has('MENTIONS_ENTITY')).toBe(true);
    expect(types.has('PACKET_FOR_TASK')).toBe(true);
  });

  it('scopes every node to projectId and keeps all properties Neo4j-safe', () => {
    const plan = searchPacketsToKnowGraphEvidence(BASE);
    if (!plan.ok) return;
    for (const n of plan.nodes) {
      expect(n.properties.project_id).toBe(PROJECT_ID);
      for (const v of Object.values(n.properties)) expect(isSafeValue(v)).toBe(true);
    }
    for (const r of plan.relationships) expect(r.properties.project_id).toBe(PROJECT_ID);
  });

  it('dedupes a shared sourceRef into one Source node and preserves url/title', () => {
    const plan = searchPacketsToKnowGraphEvidence(BASE);
    if (!plan.ok) return;
    const sources = plan.nodes.filter((n) => n.label === 'Source');
    expect(sources).toHaveLength(1); // both packets cited the same url
    expect(sources[0].properties.url).toBe('https://finance.yahoo.com/quote/RDW');
    expect(sources[0].properties.title).toBe('RDW - Yahoo Finance');
  });

  it('preserves observed entities as MENTIONS (not verified facts)', () => {
    const plan = searchPacketsToKnowGraphEvidence(BASE);
    if (!plan.ok) return;
    const obs = plan.nodes.filter((n) => n.label === 'ObservedEntity');
    expect(obs.map((n) => n.properties.label)).toEqual(expect.arrayContaining(['Redwire Corporation', 'RDW']));
    expect(obs.every((n) => n.properties.observed === true)).toBe(true);
    expect(plan.relationships.some((r) => r.type === 'MENTIONS_ENTITY')).toBe(true);
  });

  it('fails closed on missing projectId', () => {
    expect(searchPacketsToKnowGraphEvidence({ ...BASE, projectId: '' })).toEqual({ ok: false, reason: 'project_id_required' });
  });

  it('fails closed on a malformed packet', () => {
    const bad = searchPacketsToKnowGraphEvidence({ ...BASE, packets: [{ agentId: 'x' } as any] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toBe('invalid_packet');
  });

  it('introduces no draft-generator naming', () => {
    expect(JSON.stringify(searchPacketsToKnowGraphEvidence(BASE)).toLowerCase()).not.toContain('draft');
  });
});

describe('ingestSearchAgentPacketsToKnowGraph (DB write, injectable driver)', () => {
  it('writes evidence nodes + relationships and returns counts', async () => {
    const { driver, runs } = fakeDriver();
    const res = await ingestSearchAgentPacketsToKnowGraph(BASE, { driver });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.nodeCount).toBeGreaterThan(0);
    expect(res.relationshipCount).toBeGreaterThan(0);
    expect(res.sourceCount).toBe(1);
    // every MERGE used an evidence label/type; none used a truth-claim type
    const cypherBlob = runs.map((r) => r.cypher).join('\n');
    for (const banned of TRUTH_CLAIM_REL_TYPES) expect(cypherBlob).not.toContain(`:\`${banned}\``);
    expect(cypherBlob).toContain(':`SearchPacket`');
    expect(cypherBlob).toContain(':`Source`');
    expect(cypherBlob).toContain(':`MENTIONS_ENTITY`');
  });

  it('fails closed WITHOUT touching the DB when projectId is missing', async () => {
    const { driver } = fakeDriver();
    const res = await ingestSearchAgentPacketsToKnowGraph({ ...BASE, projectId: '' }, { driver });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('project_id_required');
    expect(driver.session).not.toHaveBeenCalled(); // no write attempted
  });

  it('fails closed (no DB write) on a malformed packet', async () => {
    const { driver } = fakeDriver();
    const res = await ingestSearchAgentPacketsToKnowGraph({ ...BASE, packets: [{} as any] }, { driver });
    expect(res.ok).toBe(false);
    expect(driver.session).not.toHaveBeenCalled();
  });
});
